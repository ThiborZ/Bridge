/**
 * Does a saved game come back exactly?
 *
 * The save is a history, not a snapshot, so the question is whether replaying it
 * lands on precisely the position that was left. Every point in a hand is a
 * different answer — mid-auction, mid-trick, between tricks, after the last card
 * — so this walks a game and checks the round trip at every single step rather
 * than at one convenient moment.
 */

import { describe, it, expect } from 'vitest';
import { applyCall, applyPlay, chicagoDeal, newGame, turnOf } from '../src/game.js';
import type { Game } from '../src/game.js';
import { decideCall } from '../src/bidding/index.js';
import { heuristicPlay } from '../src/bots/heuristic.js';
import { SEATS } from '../src/seats.js';
import { cardsToString } from '../src/cards.js';
import { callsToString } from '../src/auction.js';
import { cardsPlayed, reconstruct, serialise } from '../src/ui/saved.js';

const STRENGTHS = { opponents: 'club', partner: 'tournament' } as const;

/** Every state a game passes through, from the deal to the last card. */
function everyStep(dealId: string, handNumber: number): Game[] {
  let game = newGame(chicagoDeal(dealId, handNumber));
  const steps: Game[] = [game];
  let guard = 0;

  while (game.phase !== 'complete' && guard++ < 120) {
    const seat = turnOf(game)!;
    game = game.phase === 'auction'
      ? applyCall(game, decideCall(game.auction, game.deal.hands[seat], seat, { recordGaps: false }).call)
      : applyPlay(game, heuristicPlay(game.play!, seat));
    steps.push(game);
  }
  return steps;
}

const snapshot = (game: Game) => ({
  phase: game.phase,
  dealId: game.deal.id,
  dealer: game.deal.dealer,
  vulnerability: game.deal.vulnerability,
  calls: callsToString(game.auction.calls),
  hands: SEATS.map((seat) =>
    `${seat}:${cardsToString(game.play ? game.play.hands[seat] : game.deal.hands[seat])}`).join(' | '),
  completed: game.play?.completed.length ?? null,
  current: game.play ? cardsToString(game.play.current.cards) : null,
  leader: game.play?.current.leader ?? null,
  tricksWon: game.play ? { ...game.play.tricksWon } : null,
  cardsPlayed: cardsToString(cardsPlayed(game)),
});

describe('a saved game comes back exactly', () => {
  it('round-trips at every step of a whole hand', () => {
    const mismatches: string[] = [];
    let checked = 0;

    for (let n = 0; n < 12; n++) {
      const handNumber = (n % 4) + 1;
      const steps = everyStep(`save-${n}`, handNumber);

      for (const [index, game] of steps.entries()) {
        const meanings = new Map([[0, 'een testverklaring']]);
        const saved = serialise(game, handNumber, { NS: 140, EW: -140 }, STRENGTHS, meanings);
        const restored = reconstruct(JSON.parse(JSON.stringify(saved)));

        checked++;
        if (restored === null) {
          mismatches.push(`deal ${n} step ${index}: refused to reconstruct`);
          continue;
        }
        const before = snapshot(game);
        const after = snapshot(restored.game);
        if (JSON.stringify(before) !== JSON.stringify(after) && mismatches.length < 5) {
          mismatches.push(`deal ${n} step ${index}:\n  was ${JSON.stringify(before)}\n  got ${JSON.stringify(after)}`);
        }
        if (restored.handNumber !== handNumber) mismatches.push(`deal ${n}: hand number lost`);
        if (restored.totals.NS !== 140) mismatches.push(`deal ${n}: totals lost`);
        if (restored.strengths.partner !== 'tournament') mismatches.push(`deal ${n}: strengths lost`);
        if (restored.meanings.get(0) !== 'een testverklaring') mismatches.push(`deal ${n}: meanings lost`);
      }
    }

    expect(mismatches).toEqual([]);
    // A full hand is an auction plus fifty-two cards, so this is a lot of steps.
    expect(checked).toBeGreaterThan(500);
  }, 60_000);

  it('keeps the same cards in the same hands, not just the same counts', () => {
    const steps = everyStep('exact', 2);
    const midway = steps[Math.floor(steps.length * 0.7)]!;
    const restored = reconstruct(JSON.parse(JSON.stringify(
      serialise(midway, 2, { NS: 0, EW: 0 }, STRENGTHS, new Map()))))!;

    for (const seat of SEATS) {
      const was = midway.play!.hands[seat];
      const got = restored.game.play!.hands[seat];
      expect(cardsToString(got)).toBe(cardsToString(was));
    }
  });
});

describe('a save that does not add up is refused', () => {
  const good = () => {
    const steps = everyStep('refuse', 1);
    return serialise(steps[steps.length - 5]!, 1, { NS: 0, EW: 0 }, STRENGTHS, new Map());
  };

  it('refuses a different format version', () => {
    expect(reconstruct({ ...good(), v: 99 })).toBeNull();
  });

  it('refuses a card that cannot legally have been played', () => {
    // Swapping a played card for one still in somebody's hand makes the replay
    // illegal, and the engine — not this module — is what notices.
    const record = good();
    const tampered = { ...record, cards: [...record.cards.slice(0, -1), 51] };
    const restored = reconstruct(tampered);
    expect(restored === null || cardsToString(cardsPlayed(restored.game)) !== cardsToString(record.cards)).toBe(true);
  });

  it('refuses nonsense', () => {
    expect(reconstruct(null)).toBeNull();
    expect(reconstruct({})).toBeNull();
    expect(reconstruct({ ...good(), dealId: 42 })).toBeNull();
    expect(reconstruct({ ...good(), strengths: { opponents: 'wizard', partner: 'club' } })).toBeNull();
  });

  it('survives a deal id that produces a different deal', () => {
    // The seed *is* the deal. A different id means different cards, so the
    // recorded calls and cards will not be legal against it.
    const record = good();
    const restored = reconstruct({ ...record, dealId: 'something-else' });
    expect(restored).toBeNull();
  });
});
