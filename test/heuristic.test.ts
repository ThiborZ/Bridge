/**
 * The heuristic card player.
 *
 * Legality is the easy half and the fuzz test already covers the engine, so the
 * work here is proving it applies the rules it claims to — and, at the end, that
 * it is measurably stronger than the random bot it replaces. "It plays legally"
 * was already true of random; that test would have passed on day one and told us
 * nothing.
 */

import { describe, it, expect } from 'vitest';
import type { Contract } from '../src/auction.js';
import { cardToString, parseCard, suitOf } from '../src/cards.js';
import type { Card } from '../src/cards.js';
import { dealFromSeed } from '../src/game.js';
import { parsePBNHands } from '../src/pbn.js';
import type { Hands, PlayState } from '../src/play.js';
import { currentPlayer, isLegalPlay, isPlayComplete, playCard, startPlay } from '../src/play.js';
import { mulberry32 } from '../src/random.js';
import { SEATS, sideOf } from '../src/seats.js';
import type { Seat, Side } from '../src/seats.js';
import { heuristicPlay } from '../src/bots/heuristic.js';
import { randomPlay } from '../src/bots/random.js';

function contract(level: number, strain: Contract['strain'], declarer: Seat): Contract {
  return { level, strain, risk: 'none', declarer };
}

/** Deal, set the contract, and play out the given cards in order. */
function situation(pbn: string, deal: Contract, cards: string[]): PlayState {
  let state = startPlay(deal, parsePBNHands(pbn));
  for (const card of cards) state = playCard(state, parseCard(card));
  return state;
}

const played = (state: PlayState) => cardToString(heuristicPlay(state));

/*
 * One deal, used for most of the following. Nobody is void, so every rule about
 * following suit can be exercised on it.
 *   N  S K72   H AK2    D AKQ    C AKQJ
 *   E  S Q65   H QJ3    D JT98   C T98
 *   S  S A93   H T987   D 765    C 765
 *   W  S JT84  H 654    D 432    C 432
 */
const FLAT = 'N:K72.AK2.AKQ.AKQJ Q65.QJ3.JT98.T98 A93.T987.765.765 JT84.654.432.432';

/*
 * South void in diamonds, spades as trumps, for the ruffing rules.
 *   N  S KQ2   H AK2     D AKQJ   C AKQ
 *   E  S J65   H QJ3     D T987   C JT9
 *   S  S A973  H T9876   D —      C 8765
 *   W  S T84   H 54      D 65432  C 432
 */
const VOID = 'N:KQ2.AK2.AKQJ.AKQ J65.QJ3.T987.JT9 A973.T9876..8765 T84.54.65432.432';

describe('the rules it claims to follow', () => {
  it('plays third hand high', () => {
    // West declares, so North leads. North leads a low spade, East plays the
    // five; South is third hand and takes it with the ace.
    const state = situation(FLAT, contract(3, 'NT', 'W'), ['S2', 'S5']);
    expect(currentPlayer(state)).toBe('S');
    expect(played(state)).toBe('SA');
  });

  it('plays second hand low', () => {
    // North declares, so East leads. South is second hand and could win with any
    // of four hearts — and plays the smallest anyway.
    const state = situation(FLAT, contract(3, 'NT', 'N'), ['H3']);
    expect(currentPlayer(state)).toBe('S');
    expect(played(state)).toBe('H7');
  });

  it('does not beat its own partner', () => {
    // North's ace is winning the trick. South holds the ten and plays the seven.
    const state = situation(FLAT, contract(3, 'NT', 'W'), ['HA', 'H3']);
    expect(currentPlayer(state)).toBe('S');
    expect(played(state)).toBe('H7');
  });

  it('wins as cheaply as it can in fourth seat', () => {
    // South declares, so West leads. South is last to play, holding the ace and
    // the nine over East's six. The nine is enough.
    const state = situation(FLAT, contract(3, 'NT', 'S'), ['S4', 'S2', 'S6']);
    expect(currentPlayer(state)).toBe('S');
    expect(played(state)).toBe('S9');
  });

  it('leads the top of a sequence', () => {
    const state = situation(FLAT, contract(3, 'NT', 'W'), []);
    expect(currentPlayer(state)).toBe('N');
    expect(played(state)).toBe('CA');
  });

  it('ruffs with its smallest trump when the opponents are winning', () => {
    // North declares in spades, East leads a diamond, South is void.
    const state = situation(VOID, contract(4, 'S', 'N'), ['DT']);
    expect(currentPlayer(state)).toBe('S');
    expect(played(state)).toBe('S3');
  });

  it('does not ruff a trick its partner is already winning', () => {
    // North's diamond ace is winning. South is void and holds four trumps, and
    // spending one here would be throwing it away.
    const state = situation(VOID, contract(4, 'S', 'W'), ['DA', 'D7']);
    expect(currentPlayer(state)).toBe('S');
    const card = heuristicPlay(state);
    expect(suitOf(card)).not.toBe('S');
    expect(cardToString(card)).toBe('H6');
  });
});

describe('legality', () => {
  it('never plays an illegal card, over a thousand deals', () => {
    const failures: string[] = [];
    let cardsPlayed = 0;

    for (let n = 0; n < 1000; n++) {
      const deal = dealFromSeed(`heuristic-${n}`, 'N', 'None');
      const strain = (['C', 'D', 'H', 'S', 'NT'] as const)[n % 5]!;
      const declarer = SEATS[n % 4]!;
      let state = startPlay(contract(3, strain, declarer), deal.hands);

      while (!isPlayComplete(state)) {
        const seat = currentPlayer(state);
        const card = heuristicPlay(state, seat);
        if (!isLegalPlay(state, card, seat)) {
          failures.push(`deal ${n}: ${seat} played ${cardToString(card)} illegally`);
          break;
        }
        state = playCard(state, card);
        cardsPlayed++;
      }
      if (state.completed.length !== 13 && failures.length === 0) {
        failures.push(`deal ${n}: finished with ${state.completed.length} tricks`);
      }
    }

    expect(failures).toEqual([]);
    expect(cardsPlayed).toBe(1000 * 52);
  }, 60_000);
});

/**
 * The test that justifies the file. Each deal is played twice — once with
 * North-South using the heuristic, once with East-West using it — so the cards
 * are identical and only the player differs. Anything left is the player.
 */
describe('strength', () => {
  function playOut(hands: Hands, deal: Contract, smartSide: Side, seed: number): number {
    const rng = mulberry32(seed);
    let state = startPlay(deal, hands);
    while (!isPlayComplete(state)) {
      const seat = currentPlayer(state);
      const card: Card = sideOf(seat) === smartSide ? heuristicPlay(state, seat) : randomPlay(state, rng);
      state = playCard(state, card);
    }
    return state.tricksWon.NS;
  }

  const measure = (strain: Contract['strain'], deals: number) => {
    let heuristicTricks = 0;
    for (let n = 0; n < deals; n++) {
      const { hands } = dealFromSeed(`strength-${strain}-${n}`, 'N', 'None');
      const deal = contract(3, strain, 'N');
      // Same deal, same random seed, only the side that thinks changes.
      heuristicTricks += playOut(hands, deal, 'NS', 5000 + n);
      heuristicTricks += 13 - playOut(hands, deal, 'EW', 5000 + n);
    }
    return heuristicTricks / (deals * 2);
  };

  it('takes more tricks than the random bot in no-trumps', () => {
    const average = measure('NT', 200);
    console.log(`  no-trumps: heuristic ${average.toFixed(2)} tricks, random ${(13 - average).toFixed(2)}`);
    expect(average).toBeGreaterThan(7.5);
  }, 60_000);

  it('takes more tricks than the random bot with a trump suit', () => {
    const average = measure('S', 200);
    console.log(`  spades:    heuristic ${average.toFixed(2)} tricks, random ${(13 - average).toFixed(2)}`);
    expect(average).toBeGreaterThan(7.5);
  }, 60_000);
});
