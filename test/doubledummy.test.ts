/**
 * Does the solver play correctly?
 *
 * "No rule was broken" is not the same question as "the right card was chosen",
 * and nothing in the suite so far could tell the difference — a consistently
 * wrong solver breaks no rules at all. Three separate checks here:
 *
 *   1. Against an independent exhaustive minimax, on deals small enough to solve
 *      by brute force. This is where correctness is actually established: two
 *      implementations sharing no code, compared over thousands of positions.
 *   2. Against deals whose answer can be worked out by hand.
 *   3. Against two published double-dummy tables, as a full-size sanity check.
 */

import { describe, it, expect } from 'vitest';
import type { Suit } from '../src/cards.js';
import { cardsToString, shuffledDeck, sortHand } from '../src/cards.js';
import type { Card } from '../src/cards.js';
import { mulberry32 } from '../src/random.js';
import type { Hands } from '../src/play.js';
import type { Seat } from '../src/seats.js';
import { SEATS } from '../src/seats.js';
import type { Strain } from '../src/auction.js';
import { parsePBNHands } from '../src/pbn.js';
import { optimumResultTable, solve, tricksForDeclarer } from '../src/solver/doubleDummy.js';
import { referenceNorthSouthTricks } from '../src/solver/reference.js';

const TRUMPS: Array<Suit | null> = ['C', 'D', 'H', 'S', null];

/** Deal `perHand` cards to each seat from a shuffled pack. */
function smallDeal(seed: number, perHand: number): Hands {
  const deck = shuffledDeck(mulberry32(seed));
  const hands = {} as Record<Seat, readonly Card[]>;
  SEATS.forEach((seat, index) => {
    hands[seat] = sortHand(deck.slice(index * perHand, index * perHand + perHand));
  });
  return hands;
}

describe('against an independent exhaustive search', () => {
  /**
   * Every combination of trump suit and opening leader, on every deal — so each
   * deal is twenty comparisons, not one.
   */
  const compareAcross = (deals: number, perHand: number, firstSeed: number): number => {
    const disagreements: string[] = [];
    let comparisons = 0;

    for (let n = 0; n < deals; n++) {
      const hands = smallDeal(firstSeed + n, perHand);
      for (const trump of TRUMPS) {
        for (const leader of SEATS) {
          const fast = solve(hands, leader, trump).northSouth;
          const slow = referenceNorthSouthTricks(hands, leader, trump);
          comparisons++;
          if (fast !== slow && disagreements.length < 5) {
            disagreements.push(
              `${perHand} cards each, seed ${firstSeed + n}, trumps ${trump ?? 'none'}, ` +
              `${leader} on lead: solver says ${fast}, reference says ${slow}. ` +
              SEATS.map((seat) => `${seat}: ${cardsToString(hands[seat])}`).join(' | '),
            );
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
    return comparisons;
  };

  it('agrees on one-card endings', () => {
    expect(compareAcross(60, 1, 1000)).toBe(60 * 20);
  });

  it('agrees on two-card endings', () => {
    expect(compareAcross(60, 2, 2000)).toBe(60 * 20);
  });

  it('agrees on three-card endings', () => {
    expect(compareAcross(50, 3, 3000)).toBe(50 * 20);
  }, 60_000);

  it('agrees on four-card endings', () => {
    expect(compareAcross(30, 4, 4000)).toBe(30 * 20);
  }, 180_000);

  it('agrees on five-card endings', () => {
    // The reference is close to unusable at this size, so only a few deals.
    expect(compareAcross(4, 5, 5000)).toBe(4 * 20);
  }, 300_000);
});

describe('the optimisations do not change the answer', () => {
  /**
   * If the plain search and the optimised one ever differ, this says which
   * optimisation did it — the transposition table or the equivalence collapsing.
   */
  it('gives the same result with each optimisation turned off', () => {
    const differences: string[] = [];
    for (let n = 0; n < 25; n++) {
      const hands = smallDeal(7000 + n, 4);
      for (const trump of TRUMPS) {
        for (const leader of SEATS) {
          const full = solve(hands, leader, trump).northSouth;
          const noTable = solve(hands, leader, trump, { useTranspositions: false }).northSouth;
          const noCollapse = solve(hands, leader, trump, { collapseEquivalents: false }).northSouth;
          const neither = solve(hands, leader, trump, {
            useTranspositions: false, collapseEquivalents: false,
          }).northSouth;
          if (full !== noTable) differences.push(`seed ${7000 + n}: transposition table changed ${noTable} to ${full}`);
          if (full !== noCollapse) differences.push(`seed ${7000 + n}: equivalence collapsing changed ${noCollapse} to ${full}`);
          if (full !== neither) differences.push(`seed ${7000 + n}: the pair changed ${neither} to ${full}`);
        }
      }
    }
    expect(differences).toEqual([]);
  }, 120_000);
});

describe('deals whose answer is known by hand', () => {
  const ONE_SUIT_EACH =
    'N:.AKQJT98765432.. ..AKQJT98765432. AKQJT98765432... ...AKQJT98765432';

  it('gives every trick to the side holding the trump suit', () => {
    const hands = parsePBNHands(ONE_SUIT_EACH);
    // South holds the spades, North the hearts — both North-South.
    expect(solve(hands, 'W', 'S').northSouth).toBe(13);
    expect(solve(hands, 'W', 'H').northSouth).toBe(13);
    // East holds diamonds and West clubs.
    expect(solve(hands, 'W', 'D').northSouth).toBe(0);
    expect(solve(hands, 'W', 'C').northSouth).toBe(0);
  });

  it('gives every trick to the opening leader in no-trumps', () => {
    const hands = parsePBNHands(ONE_SUIT_EACH);
    // Nobody can ever follow, so whoever leads keeps winning and leading.
    expect(solve(hands, 'W', null).northSouth).toBe(0);
    expect(solve(hands, 'N', null).northSouth).toBe(13);
    expect(solve(hands, 'E', null).northSouth).toBe(0);
    expect(solve(hands, 'S', null).northSouth).toBe(13);
  });

  it('gives a solid running suit exactly its length and no more', () => {
    // North holds the top five spades. Every other card North-South hold is lower
    // than every card the defence holds in that suit, bar one useless club. So in
    // no-trumps with North on lead they cash five tricks and never win another.
    const hands = parsePBNHands(
      'N:AKQJT.765.765.32 65.AKQJ.AKQJ.AKQ 987.432.432.8765 432.T98.T98.JT94',
    );
    expect(solve(hands, 'N', null).northSouth).toBe(5);

    // But the lead is everything. With East on lead, East cashes eleven winners
    // in the other three suits before North-South ever regain the lead, so they
    // are left with only the last two tricks. Five winners are worth nothing if
    // you never get in to play them.
    expect(solve(hands, 'E', null).northSouth).toBe(2);

    // Making spades trumps changes nothing with North on lead: cashing them
    // strips the defence of trumps as well, and North-South have no other winner.
    expect(solve(hands, 'N', 'S').northSouth).toBe(5);
  });

  it('counts the same for both sides', () => {
    for (let n = 0; n < 12; n++) {
      const hands = smallDeal(9000 + n, 4);
      for (const trump of TRUMPS) {
        const result = solve(hands, 'N', trump);
        expect(result.northSouth + result.eastWest).toBe(4);
      }
    }
  });
});

/**
 * Two deals with published double-dummy tables, from the test fixtures of an
 * established solver library. Twenty numbers each: every declarer, every strain.
 *
 * These are a sanity check at full size, not the primary evidence — the small-deal
 * comparison above is what establishes correctness, because a disagreement there
 * can be arbitrated by brute force. If one of these ever disagrees, do not assume
 * the published figure is right; reproduce the line of play first.
 *
 * Skipped by default: forty full-deal solves take minutes, not seconds. Run with
 *   DD_FULL=1 npx vitest run test/doubledummy.test.ts
 * and expect to wait. That cost is itself a finding — see the README.
 */
const fullDealsEnabled = process.env.DD_FULL === '1';

describe.skipIf(!fullDealsEnabled)('against published double-dummy tables', () => {
  const published: Array<{ deal: string; table: Record<Seat, Record<Strain, number>> }> = [
    {
      deal: 'N:AT94.97.KQ954.94 K5.KT62.J2.KQT82 J72.A854.A8.AJ75 Q863.QJ3.T763.63',
      table: {
        N: { C: 7, D: 9, H: 7, S: 9, NT: 8 },
        E: { C: 5, D: 3, H: 5, S: 4, NT: 4 },
        S: { C: 7, D: 9, H: 7, S: 9, NT: 8 },
        W: { C: 5, D: 3, H: 5, S: 4, NT: 4 },
      },
    },
    {
      deal: 'N:A5.AT3.Q98.QJT43 T2.KQJ4.65.97652 QJ98743.95.KJ.AK K6.8762.AT7432.8',
      table: {
        N: { C: 10, D: 6, H: 7, S: 11, NT: 10 },
        E: { C: 1, D: 7, H: 6, S: 0, NT: 0 },
        S: { C: 10, D: 6, H: 7, S: 11, NT: 10 },
        W: { C: 1, D: 7, H: 6, S: 0, NT: 0 },
      },
    },
  ];

  it.each(published.map((entry, index) => [index + 1, entry] as const))(
    'reproduces all twenty entries of published deal %i',
    (_index, entry) => {
      const hands = parsePBNHands(entry.deal);
      const started = performance.now();
      const table = optimumResultTable(hands);
      console.log(`  deal ${_index}: twenty solves in ${((performance.now() - started) / 1000).toFixed(0)}s`);
      expect(table).toEqual(entry.table);
    },
    2_400_000,
  );

  it('solves a full thirteen-trick deal in reasonable time', () => {
    const hands = parsePBNHands(published[0]!.deal);
    const started = performance.now();
    const tricks = tricksForDeclarer(hands, 'N', 'NT');
    const elapsed = performance.now() - started;
    expect(tricks).toBe(8);
    console.log(`  one 13-trick solve: ${(elapsed / 1000).toFixed(0)}s`);
    // A canary against catastrophic regression, not a target. The real target is
    // well under a second — Monte Carlo needs tens of solves per card — and how
    // far off that is belongs in the README, not in a threshold that would go
    // stale or fail on a slower machine. Deals vary enormously: this one takes
    // more than four times as long as the one in the benchmark.
    expect(elapsed).toBeLessThan(300_000);
  }, 360_000);
});
