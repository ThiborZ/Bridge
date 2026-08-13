/**
 * Whole deals played out, where the answer can be worked out by hand.
 *
 * The fuzz test proves the engine never breaks a rule. It does not prove the
 * engine counts the right winner — a consistently wrong trick-winner would pass
 * every legality check ever written. These deals pin the count down.
 *
 * Each hand holds one complete suit, so nobody can ever follow anybody. That
 * makes the outcome independent of how the cards are chosen: whoever's suit is
 * trumps takes all thirteen tricks, and in no-trumps the opening leader does.
 */

import { describe, it, expect } from 'vitest';
import { parsePBNHands } from '../src/pbn.js';
import type { Strain } from '../src/auction.js';
import { PASS, bid } from '../src/auction.js';
import { applyCall, applyPlay, newGame, resultOf } from '../src/game.js';
import type { Game } from '../src/game.js';
import { legalPlays, trickWinner, trumpSuit } from '../src/play.js';
import type { Seat } from '../src/seats.js';
import { SEATS } from '../src/seats.js';

/** North holds every heart, East every diamond, South every spade, West every club. */
const ONE_SUIT_EACH =
  'N:.AKQJT98765432.. ..AKQJT98765432. AKQJT98765432... ...AKQJT98765432';

function tricksBySeat(game: Game): Record<Seat, number> {
  const counts: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
  const trump = trumpSuit(game.play!.contract);
  for (const trick of game.play!.completed) counts[trickWinner(trick, trump)]++;
  return counts;
}

/** South declares at the seven level, then everyone plays their first legal card. */
function playSevenLevel(strain: Strain): Game {
  const hands = parsePBNHands(ONE_SUIT_EACH);
  let game = newGame({ id: 'one-suit-each', dealer: 'S', vulnerability: 'None', hands });
  game = applyCall(game, bid(7, strain));
  for (let i = 0; i < 3; i++) game = applyCall(game, PASS);

  expect(game.phase).toBe('play');
  expect(game.play!.contract).toMatchObject({ level: 7, strain, declarer: 'S' });
  expect(game.play!.current.leader).toBe('W');

  while (game.phase === 'play') {
    game = applyPlay(game, legalPlays(game.play!)[0]!);
  }
  return game;
}

describe('a deal where nobody can follow suit', () => {
  it('gives declarer all thirteen when the trump suit is his own', () => {
    // 7S: South ruffs the opening lead and then leads spades nobody else holds.
    const game = playSevenLevel('S');
    const result = resultOf(game)!;
    expect(tricksBySeat(game)).toEqual({ N: 0, E: 0, S: 13, W: 0 });
    expect(result.tricksWon).toBe(13);
    expect(result.breakdown).toMatchObject({ made: true, by: 0, slamBonus: 1000, gameBonus: 300 });
    expect(result.breakdown!.score).toBe(210 + 300 + 1000);
    expect(result.northSouthScore).toBe(1510);
  });

  it('gives declarer nothing in no-trumps', () => {
    // 7NT: West leads clubs, South can only discard spades, so West takes the lot.
    const game = playSevenLevel('NT');
    const result = resultOf(game)!;
    expect(tricksBySeat(game)).toEqual({ N: 0, E: 0, S: 0, W: 13 });
    expect(result.tricksWon).toBe(0);
    expect(result.breakdown).toMatchObject({ made: false, by: 13 });
    expect(result.breakdown!.score).toBe(-650); // thirteen undoubled undertricks
    expect(result.northSouthScore).toBe(-650);
  });

  it('gives declarer nothing when the trump suit belongs to the defence', () => {
    // 7C: West holds every club, so West ruffs — or rather, simply wins — everything.
    const game = playSevenLevel('C');
    const result = resultOf(game)!;
    expect(tricksBySeat(game)).toEqual({ N: 0, E: 0, S: 0, W: 13 });
    expect(result.tricksWon).toBe(0);
    expect(result.breakdown!.score).toBe(-650);
  });

  it('always plays exactly thirteen tricks of four cards', () => {
    for (const strain of ['S', 'H', 'D', 'C', 'NT'] as const) {
      const game = playSevenLevel(strain);
      expect(game.phase).toBe('complete');
      expect(game.play!.completed).toHaveLength(13);
      for (const trick of game.play!.completed) expect(trick.cards).toHaveLength(4);
      for (const seat of SEATS) expect(game.play!.hands[seat]).toHaveLength(0);
      const counts = tricksBySeat(game);
      expect(counts.N + counts.E + counts.S + counts.W).toBe(13);
    }
  });

  it('gives every trick to whoever owns the trump suit', () => {
    // The suit each player holds, so the winner is predictable for every strain.
    const owner: Record<string, Seat> = { H: 'N', D: 'E', S: 'S', C: 'W' };
    for (const strain of ['S', 'H', 'D', 'C'] as const) {
      const counts = tricksBySeat(playSevenLevel(strain));
      expect(counts[owner[strain]!]).toBe(13);
    }
  });
});
