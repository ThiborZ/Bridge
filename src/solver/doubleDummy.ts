/**
 * The double-dummy solver: how many tricks each side takes with all four hands
 * face up and both sides playing perfectly.
 *
 * This is the engine the card-play bots will be built on. Monte Carlo play works
 * by dealing out the unseen cards many times consistently with what is known,
 * solving each of those complete layouts here, and playing the card that wins
 * most often. So this has to be both right and quick.
 *
 * Three things make it quick enough:
 *
 *   Bitmasks. A hand is four 13-bit integers, one per suit, so "can he follow?"
 *   is a non-zero test and playing a card is one XOR.
 *
 *   Equivalent cards. If nobody still holds anything between two of your cards
 *   in a suit, those cards are strategically identical and only one need be
 *   searched. In the endgame this collapses the branching factor enormously.
 *
 *   A transposition table at trick boundaries. The same position is reached by
 *   many different orders of play, and at the start of a trick the position is
 *   completely described by who holds what plus who is on lead.
 *
 * Correctness is established in test/doubledummy.test.ts against an independent
 * exhaustive minimax that has none of the above.
 */

import type { Card, Suit } from '../cards.js';
import { SUITS } from '../cards.js';
import type { Strain } from '../auction.js';
import type { Hands } from '../play.js';
import type { Seat } from '../seats.js';
import { SEATS, nextSeat, seatIndex } from '../seats.js';

/**
 * Distinct trick-start positions held before the table is dropped and rebuilt.
 *
 * This is the single most sensitive number in the solver. At 400,000 a full deal
 * wiped the table thirty-nine times mid-solve and took 96 million nodes; the
 * table only pays for itself if it survives long enough to be read.
 */
const TABLE_LIMIT = 3_000_000;

/** North and South are the even seats, which makes "is this my side?" a parity test. */
function isNorthSouth(seat: number): boolean {
  return seat % 2 === 0;
}

export type SolveOptions = {
  /** Turn off the transposition table. Used by the tests to isolate its effect. */
  useTranspositions?: boolean;
  /** Turn off equivalent-card collapsing. Also only for the tests. */
  collapseEquivalents?: boolean;
  /**
   * Cards already on the table for the current trick, in play order starting
   * with `leader`. `hands` must not contain them.
   *
   * A bot has to choose at all four seats of a trick, not only on lead, so
   * Monte Carlo needs to ask "what happens after this card" from halfway
   * through. Without this the solver could only answer at trick boundaries.
   */
  played?: readonly Card[];
};

export type SolveResult = {
  /** Tricks North-South take with best play from both sides. */
  northSouth: number;
  eastWest: number;
  /** Positions searched — a rough measure of how hard the deal was. */
  nodes: number;
  /** Transposition table behaviour, for diagnosing slow solves. */
  hits: number;
  clears: number;
};

/**
 * Solve a full position. `leader` is on lead to the first trick; `trump` is null
 * in no-trumps.
 */
export function solve(
  hands: Hands,
  leader: Seat,
  trump: Suit | null,
  options: SolveOptions = {},
): SolveResult {
  const { useTranspositions = true, collapseEquivalents = true } = options;

  // masks[seat * 4 + suit] holds a 13-bit set of ranks; bit r is the card of rank r + 2.
  const masks = new Int32Array(16);
  let totalCards = 0;
  for (let seat = 0; seat < 4; seat++) {
    for (const card of hands[SEATS[seat]!]) {
      masks[seat * 4 + Math.floor(card / 13)] |= 1 << (card % 13);
      totalCards++;
    }
  }
  /*
   * Mid-trick, the seats that have already played hold one card fewer, so the
   * hands are legitimately uneven. What must still hold is that the cards in
   * hand plus the cards on the table divide into whole tricks.
   */
  const played = options.played ?? [];
  if (played.length > 3) throw new Error('a trick holds four cards');
  const atTrickStart = totalCards + played.length;
  if (atTrickStart % 4 !== 0) throw new Error('cards in hand plus cards played must make whole tricks');
  const tricksLeft = atTrickStart / 4;

  for (let seat = 0; seat < 4; seat++) {
    let held = 0;
    for (let suit = 0; suit < 4; suit++) held += popCount(masks[seat * 4 + suit]!);
    // Where this seat sits in the current trick: the first `played.length` of
    // them have already contributed a card and so hold one fewer.
    const position = (seat - seatIndex(leader) + 4) % 4;
    const expected = position < played.length ? tricksLeft - 1 : tricksLeft;
    if (held !== expected) throw new Error(`hand ${SEATS[seat]} has ${held} cards, expected ${expected}`);
  }

  const trumpIndex = trump === null ? -1 : SUITS.indexOf(trump);
  const transpositions = new Map<string, { low: number; high: number }>();
  // One move buffer per ply, so move generation never allocates.
  const moveBuffer = new Int32Array((totalCards + 1) * 13);
  let nodes = 0;
  let hits = 0;
  let clears = 0;

  /**
   * A position's identity, with the ranks compressed.
   *
   * Only the *relative* order of the cards still out matters. Once the two, three
   * and four of a suit have gone, a holding of the five and six plays exactly like
   * a holding of the seven and eight — so both must produce the same key, or the
   * table stores the same position many times over and almost never hits. This is
   * the difference between a thirteen-card deal being unsolvable and being quick.
   */
  // Seventeen 13-bit values, written as characters: one per seat per suit, plus
  // the leader. Building the key this way rather than by concatenating sixteen
  // base-36 numbers matters more than it looks — the key is built at every one
  // of the millions of trick-start nodes, so it is squarely on the hot path.
  const keyBuffer = new Uint16Array(17);
  const key = (leaderSeat: number): string => {
    keyBuffer[0] = leaderSeat;
    for (let suit = 0; suit < 4; suit++) {
      const north = masks[suit]!;
      const east = masks[4 + suit]!;
      const south = masks[8 + suit]!;
      const west = masks[12 + suit]!;
      const outstanding = north | east | south | west;

      let cn = 0, ce = 0, cs = 0, cw = 0, position = 0;
      for (let rank = 12; rank >= 0; rank--) {
        const bit = 1 << rank;
        if ((outstanding & bit) === 0) continue;
        const slot = 1 << position;
        if (north & bit) cn |= slot;
        else if (east & bit) ce |= slot;
        else if (south & bit) cs |= slot;
        else cw |= slot;
        position++;
      }
      const base = suit * 4 + 1;
      keyBuffer[base] = cn;
      keyBuffer[base + 1] = ce;
      keyBuffer[base + 2] = cs;
      keyBuffer[base + 3] = cw;
    }
    return String.fromCharCode.apply(null, keyBuffer as unknown as number[]);
  };

  /** Cards of each suit lying on the table in the trick being played. */
  const onTable = new Int32Array(4);

  /**
   * Cards of `suit` that can still affect anything — held by somebody, or face up
   * in the current trick.
   *
   * Leaving out the cards on the table is a real and subtle bug, not a
   * refinement. If an opponent has just played the queen, she is in nobody's hand
   * any more, so the king and the jack look adjacent and get treated as
   * equivalent — when in fact the king beats that queen and the jack loses to it.
   * The solver then quietly discards one side's best option.
   */
  const stillOut = (suit: number): number =>
    masks[suit]! | masks[4 + suit]! | masks[8 + suit]! | masks[12 + suit]! | onTable[suit]!;

  /**
   * Write this seat's candidate cards into the buffer and return how many there
   * are. Only one card from each run of equivalents is offered.
   *
   * The order matters enormously. Alpha-beta only prunes when the good move is
   * tried early, and searching highest-first means solemnly considering the ace
   * when the deuce would have done. The ordering used is the one a player would
   * recognise: if you can win the trick, try the cheapest card that does it; if
   * you cannot, or your partner already holds it, play the lowest thing you have.
   * The cards are packed as score * 64 + card so a single insertion sort orders
   * them without a second array — card codes are 0..51, comfortably under 64.
   */
  const generateMoves = (
    seat: number, ledSuit: number, depth: number,
    position: number, bestSuit: number, bestRank: number, bestSeat: number,
  ): number => {
    const canFollow = ledSuit >= 0 && masks[seat * 4 + ledSuit] !== 0;
    const firstSuit = canFollow ? ledSuit : 0;
    const lastSuit = canFollow ? ledSuit : 3;
    const offset = depth * 13;
    let count = 0;

    const partnerWinning = bestSeat >= 0 && bestSeat % 2 === seat % 2;

    const rate = (suit: number, rank: number): number => {
      if (position === 0) return rank; // on lead: highest first
      const wins = !partnerWinning && (suit === bestSuit ? rank > bestRank : suit === trumpIndex);
      return wins ? 200 - rank : 100 - rank;
    };

    for (let suit = firstSuit; suit <= lastSuit; suit++) {
      const mine = masks[seat * 4 + suit]!;
      if (mine === 0) continue;

      const outstanding = collapseEquivalents ? stillOut(suit) : mine;
      let previousWasMine = false;
      for (let rank = 12; rank >= 0; rank--) {
        const bit = 1 << rank;
        if ((outstanding & bit) === 0) continue;
        const mineHere = (mine & bit) !== 0;
        // Consecutive cards still in play that are all mine are equivalent, so
        // only the highest of each run is worth searching.
        if (mineHere && !(collapseEquivalents && previousWasMine)) {
          moveBuffer[offset + count++] = rate(suit, rank) * 64 + suit * 13 + rank;
        }
        previousWasMine = mineHere;
      }
    }

    // Insertion sort, descending. Never more than thirteen entries.
    for (let i = 1; i < count; i++) {
      const value = moveBuffer[offset + i]!;
      let j = i - 1;
      while (j >= 0 && moveBuffer[offset + j]! < value) {
        moveBuffer[offset + j + 1] = moveBuffer[offset + j]!;
        j--;
      }
      moveBuffer[offset + j + 1] = value;
    }
    return count;
  };

  const beatsBest = (suit: number, rank: number, bestSuit: number, bestRank: number): boolean => {
    if (suit === bestSuit) return rank > bestRank;
    return suit === trumpIndex;
  };

  /** North-South tricks from the start of a trick, with `cardsLeft` cards still out. */
  const fromTrickStart = (
    leaderSeat: number, alpha: number, beta: number, cardsLeft: number, depth: number,
  ): number => {
    if (cardsLeft === 0) return 0;
    nodes++;

    // Nothing left to win beyond this, so the window is already decided.
    const mostPossible = cardsLeft / 4;
    if (alpha >= mostPossible) return mostPossible;
    if (beta <= 0) return 0;

    let low = alpha;
    let high = beta;
    let cached: { low: number; high: number } | undefined;
    let cacheKey = '';
    if (useTranspositions) {
      cacheKey = key(leaderSeat);
      cached = transpositions.get(cacheKey);
      if (cached) {
        if (cached.low === cached.high) { hits++; return cached.low; }
        if (cached.low >= high) { hits++; return cached.low; }
        if (cached.high <= low) { hits++; return cached.high; }
        if (cached.low > low) low = cached.low;
        if (cached.high < high) high = cached.high;
      }
    }

    const value = withinTrick(leaderSeat, 0, -1, -1, -1, -1, low, high, cardsLeft, depth);

    if (useTranspositions) {
      const entry = cached ?? { low: 0, high: mostPossible };
      if (value <= low) entry.high = Math.min(entry.high, value);
      else if (value >= high) entry.low = Math.max(entry.low, value);
      else { entry.low = value; entry.high = value; }
      // A thirteen-card deal reaches millions of distinct positions; without a
      // ceiling the table exhausts memory and kills the process.
      if (!cached && transpositions.size >= TABLE_LIMIT) { transpositions.clear(); clears++; }
      transpositions.set(cacheKey, entry);
    }
    return value;
  };

  const withinTrick = (
    seat: number, position: number,
    ledSuit: number, bestSuit: number, bestRank: number, bestSeat: number,
    alpha: number, beta: number, cardsLeft: number, depth: number,
  ): number => {
    if (position === 4) {
      const wonByUs = isNorthSouth(bestSeat) ? 1 : 0;
      // The trick is over: its cards stop mattering, so clear the table before
      // searching on, and put it back on the way out.
      const table0 = onTable[0]!, table1 = onTable[1]!, table2 = onTable[2]!, table3 = onTable[3]!;
      onTable[0] = 0; onTable[1] = 0; onTable[2] = 0; onTable[3] = 0;
      const rest = fromTrickStart(bestSeat, alpha - wonByUs, beta - wonByUs, cardsLeft - 4, depth);
      onTable[0] = table0; onTable[1] = table1; onTable[2] = table2; onTable[3] = table3;
      return wonByUs + rest;
    }

    const count = generateMoves(seat, ledSuit, depth, position, bestSuit, bestRank, bestSeat);
    const offset = depth * 13;
    const maximising = isNorthSouth(seat);
    let value = maximising ? -1 : Number.MAX_SAFE_INTEGER;
    let a = alpha;
    let b = beta;

    for (let i = 0; i < count; i++) {
      const card = moveBuffer[offset + i]! % 64;
      const suit = Math.floor(card / 13);
      const rank = card % 13;
      const bit = 1 << rank;
      masks[seat * 4 + suit] = masks[seat * 4 + suit]! & ~bit;
      onTable[suit] = onTable[suit]! | bit;

      const wins = bestSeat < 0 || beatsBest(suit, rank, bestSuit, bestRank);
      const result = withinTrick(
        (seat + 1) % 4, position + 1,
        position === 0 ? suit : ledSuit,
        wins ? suit : bestSuit, wins ? rank : bestRank, wins ? seat : bestSeat,
        a, b, cardsLeft, depth + 1,
      );

      onTable[suit] = onTable[suit]! & ~bit;
      masks[seat * 4 + suit] = masks[seat * 4 + suit]! | bit;

      if (maximising) {
        if (result > value) value = result;
        if (value > a) a = value;
      } else {
        if (result < value) value = result;
        if (value < b) b = value;
      }
      if (a >= b) break;
    }
    return value;
  };

  /**
   * Binary search on the answer, each step asking a yes-or-no question with a
   * one-trick-wide window: "can North-South take at least k?"
   *
   * Searching the full 0..13 window directly is what makes a thirteen-card deal
   * hopeless — the tree barely prunes and the transposition table grows without
   * limit. A null window prunes hard, and four such searches settle the answer.
   */
  /*
   * Seed the current trick when one is half played: put those cards on the
   * table, work out who is winning it so far, and enter the search at the seat
   * next to play rather than at a trick boundary.
   */
  let seedLedSuit = -1;
  let seedSuit = -1;
  let seedRank = -1;
  let seedSeat = -1;
  played.forEach((card, index) => {
    const suit = Math.floor(card / 13);
    const rank = card % 13;
    onTable[suit] = onTable[suit]! | (1 << rank);
    if (index === 0) seedLedSuit = suit;
    const wins = seedSeat < 0 ||
      (suit === seedSuit ? rank > seedRank : suit === trumpIndex && seedSuit !== trumpIndex);
    if (wins) {
      seedSuit = suit;
      seedRank = rank;
      seedSeat = (seatIndex(leader) + index) % 4;
    }
  });

  const ask = (alpha: number, beta: number): number =>
    played.length === 0
      ? fromTrickStart(seatIndex(leader), alpha, beta, totalCards, 0)
      : withinTrick(
          (seatIndex(leader) + played.length) % 4, played.length,
          seedLedSuit, seedSuit, seedRank, seedSeat,
          alpha, beta, atTrickStart, 0,
        );

  let lowest = 0;
  let highest = tricksLeft;
  while (lowest < highest) {
    const midpoint = Math.floor((lowest + highest + 1) / 2);
    if (ask(midpoint - 1, midpoint) >= midpoint) lowest = midpoint;
    else highest = midpoint - 1;
  }

  return { northSouth: lowest, eastWest: tricksLeft - lowest, nodes, hits, clears };
}

function popCount(bits: number): number {
  let n = bits;
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/**
 * Tricks the declarer takes in a given strain, with the opening lead coming from
 * the player on their left. This is the figure a published double-dummy table
 * reports, and the one a Monte Carlo bot ultimately wants.
 */
export function tricksForDeclarer(hands: Hands, declarer: Seat, strain: Strain): number {
  const trump: Suit | null = strain === 'NT' ? null : strain;
  const { northSouth, eastWest } = solve(hands, nextSeat(declarer), trump);
  return seatIndex(declarer) % 2 === 0 ? northSouth : eastWest;
}

/** The full 20-entry grid: every declarer, every strain. */
export function optimumResultTable(hands: Hands): Record<Seat, Record<Strain, number>> {
  const table = {} as Record<Seat, Record<Strain, number>>;
  for (const declarer of SEATS) {
    table[declarer] = {} as Record<Strain, number>;
    for (const strain of ['C', 'D', 'H', 'S', 'NT'] as const) {
      table[declarer][strain] = tricksForDeclarer(hands, declarer, strain);
    }
  }
  return table;
}
