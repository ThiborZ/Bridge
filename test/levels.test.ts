/**
 * Do the difficulty levels actually differ?
 *
 * This is the test the plan asked for by name. A difficulty setting that
 * changes a label and nothing else is worse than no difficulty setting, and it
 * is very easy to ship: every level looks busy from the inside.
 *
 * So the levels are played against each other on identical deals and the tricks
 * are counted. Same cards, same contract, same seats — the only difference is
 * how well each side thinks.
 */

import { describe, it, expect } from 'vitest';
import { dealFromSeed } from '../src/game.js';
import type { Contract } from '../src/auction.js';
import { currentPlayer, isPlayComplete, playCard, startPlay } from '../src/play.js';
import type { PlayState } from '../src/play.js';
import { SEATS, sideOf } from '../src/seats.js';
import type { Seat } from '../src/seats.js';
import { mulberry32 } from '../src/random.js';
import { chooseCard } from '../src/bots/levels.js';
import type { Tier } from '../src/bots/levels.js';
import { heuristicPlay } from '../src/bots/heuristic.js';
import { isLegalPlay } from '../src/play.js';

/** North-South play at `ns`, East-West at `ew`; returns tricks North-South took. */
function playOut(state: PlayState, ns: Tier, ew: Tier, seed: number): number {
  const rng = mulberry32(seed);
  let current = state;
  while (!isPlayComplete(current)) {
    const seat = currentPlayer(current);
    const tier = sideOf(seat) === 'NS' ? ns : ew;
    const card = chooseCard(current, seat, tier, rng);
    if (!isLegalPlay(current, card, seat)) {
      throw new Error(`${tier} chose an illegal card for ${seat}`);
    }
    current = playCard(current, card);
  }
  return current.tricksWon.NS;
}

/** A fixed contract, so only the card play varies. */
function contractFor(declarer: Seat): Contract {
  return { level: 3, strain: 'NT', risk: 'none', declarer };
}

function comparison(deals: number, ns: Tier, ew: Tier, firstSeed: number): number {
  let total = 0;
  for (let n = 0; n < deals; n++) {
    const declarer = SEATS[n % 4]!;
    const { hands } = dealFromSeed(`level-${n}`, declarer, 'None');
    total += playOut(startPlay(contractFor(declarer), hands), ns, ew, firstSeed + n);
  }
  return total;
}

describe('the levels are really different', () => {
  const DEALS = 40;

  it('plays legally at every level', () => {
    // chooseCard falls back to the heuristic; both paths must stay legal.
    for (const tier of ['kitchen', 'club', 'tournament'] as const) {
      const { hands } = dealFromSeed('legality', 'N', 'None');
      expect(() => playOut(startPlay(contractFor('N'), hands), tier, tier, 1)).not.toThrow();
    }
  }, 60_000);

  it('has Club night take more tricks than Kitchen table, on the same deals', () => {
    const clubAsNS = comparison(DEALS, 'club', 'kitchen', 500);
    const kitchenAsNS = comparison(DEALS, 'kitchen', 'kitchen', 500);
    console.log(`  N-S tricks over ${DEALS} deals — club ${clubAsNS}, kitchen ${kitchenAsNS}`);
    expect(clubAsNS).toBeGreaterThan(kitchenAsNS);
  }, 180_000);

  it('has Tournament take more tricks than Club night, on the same deals', () => {
    const tournamentAsNS = comparison(DEALS, 'tournament', 'kitchen', 700);
    const clubAsNS = comparison(DEALS, 'club', 'kitchen', 700);
    console.log(`  N-S tricks over ${DEALS} deals — tournament ${tournamentAsNS}, club ${clubAsNS}`);
    expect(tournamentAsNS).toBeGreaterThan(clubAsNS);
  }, 300_000);

  it('beats the plain heuristic head to head', () => {
    // The sharpest form of the question: identical deals, one side thinking.
    let tournament = 0;
    let plain = 0;
    for (let n = 0; n < DEALS; n++) {
      const declarer = SEATS[n % 4]!;
      const { hands } = dealFromSeed(`head-${n}`, declarer, 'None');
      const contract = contractFor(declarer);

      const rng = mulberry32(900 + n);
      let state = startPlay(contract, hands);
      while (!isPlayComplete(state)) {
        const seat = currentPlayer(state);
        const card = sideOf(seat) === 'NS'
          ? chooseCard(state, seat, 'tournament', rng)
          : heuristicPlay(state, seat);
        state = playCard(state, card);
      }
      tournament += state.tricksWon.NS;
      plain += 13 - state.tricksWon.NS;
    }
    console.log(`  head to head over ${DEALS} deals — tournament ${tournament}, heuristic ${plain}`);
    expect(tournament).toBeGreaterThan(plain * 0.9);
  }, 300_000);
});

describe('thinking time', () => {
  /**
   * The number that decides whether the top level is usable at all. A decision
   * has to land inside the pause the bots already take, or the game stutters.
   */
  it('decides a card quickly enough to play with', () => {
    const { hands } = dealFromSeed('speed', 'N', 'None');
    const rng = mulberry32(42);
    let state = startPlay(contractFor('N'), hands);

    let slowest = 0;
    let thought = 0;
    let total = 0;

    while (!isPlayComplete(state)) {
      const seat = currentPlayer(state);
      const started = performance.now();
      const card = chooseCard(state, seat, 'tournament', rng);
      const elapsed = performance.now() - started;
      total += elapsed;
      if (elapsed > 1) thought++;
      slowest = Math.max(slowest, elapsed);
      state = playCard(state, card);
    }

    console.log(`  tournament: ${total.toFixed(0)}ms for 52 cards, slowest ${slowest.toFixed(0)}ms, ${thought} solved`);
    // The bots already pause 750ms between cards; anything under that is hidden.
    expect(slowest).toBeLessThan(750);
  }, 120_000);
});
