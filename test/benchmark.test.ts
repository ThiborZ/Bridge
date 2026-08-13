/**
 * A diagnostic, not a test. Skipped unless you ask for it:
 *   BENCH=1 npx vitest run test/benchmark.test.ts --reporter=verbose
 *
 * Solve times against hand size, to tell "merely unoptimised" (smooth growth)
 * from "broken" (a cliff). Keep it around — the strongest difficulty level lives
 * or dies on these numbers, since Monte Carlo needs tens of solves per card.
 */

import { describe, it } from 'vitest';
import { shuffledDeck, sortHand } from '../src/cards.js';
import type { Card } from '../src/cards.js';
import { mulberry32 } from '../src/random.js';
import type { Hands } from '../src/play.js';
import type { Seat } from '../src/seats.js';
import { SEATS } from '../src/seats.js';
import { solve } from '../src/solver/doubleDummy.js';

function deal(seed: number, perHand: number): Hands {
  const deck = shuffledDeck(mulberry32(seed));
  const hands = {} as Record<Seat, readonly Card[]>;
  SEATS.forEach((seat, index) => {
    hands[seat] = sortHand(deck.slice(index * perHand, index * perHand + perHand));
  });
  return hands;
}

const enabled = process.env.BENCH === '1';
const maxHandSize = Number(process.env.BENCH_MAX ?? 13);
const minHandSize = Number(process.env.BENCH_MIN ?? 4);

describe.skipIf(!enabled)('how the solver scales', () => {
  it('times a solve at each hand size', () => {
    for (let perHand = minHandSize; perHand <= maxHandSize; perHand++) {
      const hands = deal(4242, perHand);
      const started = performance.now();
      const result = solve(hands, 'W', 'S');
      const elapsed = performance.now() - started;
      const hitRate = result.nodes > 0 ? (100 * result.hits / result.nodes).toFixed(0) : '0';
      console.log(
        `  ${String(perHand).padStart(2)} cards each: ${result.northSouth} tricks, ` +
        `${result.nodes.toLocaleString('en-GB').padStart(13)} nodes, ${elapsed.toFixed(0).padStart(7)}ms, ` +
        `table hits ${hitRate.padStart(3)}%, clears ${result.clears}`,
      );
      if (elapsed > 20_000) {
        console.log('  (stopping here — too slow to continue)');
        break;
      }
    }
  }, 300_000);
});
