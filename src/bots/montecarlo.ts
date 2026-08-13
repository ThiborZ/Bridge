/**
 * Card play by sampling: deal out the cards you cannot see, many times, in ways
 * consistent with everything you know; solve each of those complete layouts
 * perfectly; play the card that does best on average.
 *
 * This is how computer bridge is played, and it is the difference between an
 * opponent that follows rules of thumb and one that finds the winning line.
 *
 * IT ONLY THINKS NEAR THE END, and that is the whole trick that makes it
 * possible here. Solving a full thirteen-trick deal takes this solver between
 * seventeen seconds and seventeen minutes — hopeless when tens of solves are
 * needed per card. With five tricks left it is a fraction of a millisecond. So
 * the heuristic plays the early cards and this takes over for the endgame,
 * which is where contracts are actually won and lost.
 *
 * IT MUST NOT CHEAT. `PlayState` carries all four hands because the engine
 * needs them; the only things read here are the hand being played from, dummy
 * once it is face up, the cards already played, and how many cards each player
 * holds — every one of which a human at the table knows. The unseen cards are
 * *sampled*, never looked at. Reading `state.hands[other]` for anything but
 * `.length` would be cheating, however much it improved the play.
 */

import type { Card, Suit } from '../cards.js';
import { SUITS, cardsOfSuit, fullDeck, rankOf, suitOf } from '../cards.js';
import type { Rng } from '../random.js';
import type { Hands, PlayState } from '../play.js';
import { currentPlayer, isPlayComplete, legalPlays, playCard, trumpSuit } from '../play.js';
import type { Seat } from '../seats.js';
import { SEATS, nextSeat, partnerOf, sideOf } from '../seats.js';
import { solve } from '../solver/doubleDummy.js';

export type MonteCarloOptions = {
  /** How many layouts to sample per decision. */
  readonly samples: number;
  /** Only think once this many tricks or fewer remain. */
  readonly fromTricksLeft: number;
  readonly rng: Rng;
};

/** Every card that has hit the table so far, in any trick. */
function playedCards(state: PlayState): Card[] {
  return [...state.completed.flatMap((trick) => trick.cards), ...state.current.cards];
}

/**
 * Who has shown out of what. A player who failed to follow suit cannot hold
 * that suit, and that is the single most valuable inference available — it is
 * also information anybody at the table has, simply by watching.
 */
function knownVoids(state: PlayState): Record<Seat, Set<Suit>> {
  const voids: Record<Seat, Set<Suit>> = { N: new Set(), E: new Set(), S: new Set(), W: new Set() };
  const tricks = [...state.completed, state.current];
  for (const trick of tricks) {
    if (trick.cards.length === 0) continue;
    const led = suitOf(trick.cards[0]!);
    trick.cards.forEach((card, index) => {
      if (index > 0 && suitOf(card) !== led) voids[nextSeat(trick.leader, index)].add(led);
    });
  }
  return voids;
}

/** Dummy's hand is face up to everybody once the opening lead has been made. */
function exposedDummy(state: PlayState): Seat | null {
  const played = state.completed.length > 0 || state.current.cards.length > 0;
  return played ? partnerOf(state.contract.declarer) : null;
}

/**
 * Deal the unseen cards out at random, respecting how many each player holds and
 * which suits they have shown out of. Returns null if it cannot — a heavily
 * constrained ending can dead-end — and the caller simply tries again.
 */
function sampleLayout(
  unseen: Card[],
  needs: Array<{ seat: Seat; count: number; voids: Set<Suit> }>,
  rng: Rng,
): Record<Seat, Card[]> | null {
  const result: Record<string, Card[]> = {};
  for (const { seat } of needs) result[seat] = [];
  const remaining = new Map(needs.map((need) => [need.seat, need.count]));

  // Hardest cards first: a card only one player can hold must go to that player,
  // and placing it late is what causes dead ends.
  const order = [...unseen].sort((a, b) => {
    const takers = (card: Card) =>
      needs.filter((need) => !need.voids.has(suitOf(card)) && (remaining.get(need.seat) ?? 0) > 0).length;
    return takers(a) - takers(b);
  });

  for (const card of order) {
    const eligible = needs.filter(
      (need) => !need.voids.has(suitOf(card)) && (remaining.get(need.seat) ?? 0) > 0,
    );
    if (eligible.length === 0) return null;
    const chosen = eligible[Math.floor(rng() * eligible.length)] ?? eligible[0]!;
    result[chosen.seat]!.push(card);
    remaining.set(chosen.seat, (remaining.get(chosen.seat) ?? 0) - 1);
  }

  for (const need of needs) {
    if (result[need.seat]!.length !== need.count) return null;
  }
  return result as Record<Seat, Card[]>;
}

/**
 * Cards that play identically: nothing an opponent still holds lies between
 * them. Trying both is pure waste, and waste here is measured in solver calls.
 */
function distinctCandidates(legal: readonly Card[], stillOut: readonly Card[]): Card[] {
  const chosen: Card[] = [];
  for (const suit of SUITS) {
    const mine = cardsOfSuit(legal, suit).sort((a, b) => rankOf(b) - rankOf(a));
    if (mine.length === 0) continue;
    const outstanding = cardsOfSuit(stillOut, suit).map(rankOf);
    let previous: number | null = null;
    for (const card of mine) {
      const rank = rankOf(card);
      const separated = previous === null ||
        outstanding.some((other) => other < previous! && other > rank);
      if (separated) chosen.push(card);
      previous = rank;
    }
  }
  return chosen.length > 0 ? chosen : [...legal];
}

/**
 * The card to play, or null if it is too early in the hand to be worth solving.
 * Null is not a failure — it is this player saying "the heuristic can have this
 * one", which is what keeps the whole thing fast enough to use.
 */
export function monteCarloPlay(
  state: PlayState,
  seat: Seat = currentPlayer(state),
  options: MonteCarloOptions,
): Card | null {
  // Everything below imagines playing this card next, so it must genuinely be
  // this seat's turn.
  if (seat !== currentPlayer(state)) return null;

  const legal = legalPlays(state, seat);
  if (legal.length === 1) return legal[0]!;

  const tricksLeft = 13 - state.completed.length;
  if (tricksLeft > options.fromTricksLeft || options.samples === 0) return null;

  const trump = trumpSuit(state.contract);
  const gone = playedCards(state);
  const dummy = exposedDummy(state);

  // What this seat is entitled to see.
  const visible: Partial<Record<Seat, readonly Card[]>> = { [seat]: state.hands[seat] };
  if (dummy !== null && dummy !== seat) visible[dummy] = state.hands[dummy];

  const seen = new Set<Card>([...gone, ...Object.values(visible).flatMap((cards) => [...cards!])]);
  const unseen = fullDeck().filter((card) => !seen.has(card));

  const voids = knownVoids(state);
  const needs = SEATS.filter((other) => visible[other] === undefined).map((other) => ({
    seat: other,
    // How many cards somebody holds is public; which ones is not.
    count: state.hands[other].length,
    voids: voids[other],
  }));

  const candidates = distinctCandidates(legal, unseen);
  if (candidates.length === 1) return candidates[0]!;

  const ours = sideOf(seat);
  const totals = new Map<Card, number>(candidates.map((card) => [card, 0]));
  let usable = 0;

  for (let attempt = 0; attempt < options.samples * 3 && usable < options.samples; attempt++) {
    const sampled = sampleLayout(unseen, needs, options.rng);
    if (sampled === null) continue;
    usable++;

    const hands = {} as Record<Seat, readonly Card[]>;
    for (const other of SEATS) hands[other] = visible[other] ?? sampled[other];
    const imagined: PlayState = { ...state, hands: hands as Hands };

    for (const candidate of candidates) {
      /*
       * Let the engine play the card rather than reasoning about the trick
       * here. Playing fourth completes the trick, which is a new trick start
       * and not a mid-trick position at all; `playCard` already knows the
       * difference, resolves the winner and hands back whatever comes next.
       */
      const after = playCard(imagined, candidate);
      const wonNow = after.tricksWon[ours] - state.tricksWon[ours];
      const rest = isPlayComplete(after)
        ? 0
        : (() => {
            const result = solve(after.hands, after.current.leader, trump, {
              played: after.current.cards,
            });
            return ours === 'NS' ? result.northSouth : result.eastWest;
          })();
      totals.set(candidate, totals.get(candidate)! + wonNow + rest);
    }
  }

  if (usable === 0) return null; // could not build a legal layout; heuristic instead

  // Best average, and among equals the cheapest card — spending an honour that
  // wins nothing extra is how a strong player still looks careless.
  let best = candidates[0]!;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = totals.get(candidate)! / usable;
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-9 && rankOf(candidate) < rankOf(best))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
