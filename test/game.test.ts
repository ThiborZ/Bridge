/**
 * The state machine: auction to play to score, and the doors that must stay shut.
 *
 * The fuzz harness only ever drives this correctly. These check what happens when
 * something drives it wrongly, which is what a user interface will eventually do.
 */

import { describe, it, expect } from 'vitest';
import { PASS, bid } from '../src/auction.js';
import { applyCall, applyPlay, chicagoDeal, dealFromSeed, newGame, resultOf, turnOf } from '../src/game.js';
import type { Game } from '../src/game.js';
import { legalPlays } from '../src/play.js';
import { SEATS } from '../src/seats.js';

const deal = () => dealFromSeed('game-test', 'N', 'None');

function bidTo(game: Game, level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT'): Game {
  let next = applyCall(game, bid(level, strain));
  for (let i = 0; i < 3; i++) next = applyCall(next, PASS);
  return next;
}

describe('dealing', () => {
  it('gives everyone thirteen cards from one pack', () => {
    const { hands } = deal();
    const all = SEATS.flatMap((seat) => [...hands[seat]]);
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
    for (const seat of SEATS) expect(hands[seat]).toHaveLength(13);
  });

  it('is reproducible from the id alone', () => {
    expect(dealFromSeed('same', 'N', 'None').hands).toEqual(dealFromSeed('same', 'N', 'None').hands);
    expect(dealFromSeed('same', 'N', 'None').hands).not.toEqual(dealFromSeed('other', 'N', 'None').hands);
  });

  it('takes its dealer and vulnerability from the Chicago cycle', () => {
    expect(chicagoDeal('a', 1)).toMatchObject({ dealer: 'N', vulnerability: 'None' });
    expect(chicagoDeal('a', 2)).toMatchObject({ dealer: 'E', vulnerability: 'EW' });
    expect(chicagoDeal('a', 3)).toMatchObject({ dealer: 'S', vulnerability: 'NS' });
    expect(chicagoDeal('a', 4)).toMatchObject({ dealer: 'W', vulnerability: 'All' });
  });

  it('does not depend on the seat or vulnerability for the cards', () => {
    expect(dealFromSeed('x', 'N', 'None').hands).toEqual(dealFromSeed('x', 'W', 'All').hands);
  });
});

describe('a fresh game', () => {
  it('starts in the auction with the dealer to call', () => {
    const game = newGame(deal());
    expect(game.phase).toBe('auction');
    expect(turnOf(game)).toBe('N');
    expect(game.play).toBeNull();
    expect(resultOf(game)).toBeNull();
  });

  it('will not accept a card', () => {
    const game = newGame(deal());
    expect(() => applyPlay(game, 0)).toThrow(/not in the play/);
  });
});

describe('a passed-out deal', () => {
  it('completes with no contract and no score', () => {
    let game = newGame(deal());
    for (let i = 0; i < 4; i++) game = applyCall(game, PASS);
    expect(game.phase).toBe('complete');
    expect(game.play).toBeNull();
    expect(turnOf(game)).toBeNull();
    expect(resultOf(game)).toEqual({
      contract: null, tricksWon: 0, breakdown: null, northSouthScore: 0,
    });
  });

  it('accepts nothing further', () => {
    let game = newGame(deal());
    for (let i = 0; i < 4; i++) game = applyCall(game, PASS);
    expect(() => applyCall(game, PASS)).toThrow(/auction is over/);
    expect(() => applyPlay(game, 0)).toThrow(/not in the play/);
  });
});

describe('the handover from auction to play', () => {
  it('sets the contract and puts declarer\'s left on lead', () => {
    const game = bidTo(newGame(deal()), 4, 'H');
    expect(game.phase).toBe('play');
    expect(game.play!.contract).toMatchObject({ level: 4, strain: 'H', declarer: 'N', risk: 'none' });
    expect(game.play!.current.leader).toBe('E');
    expect(turnOf(game)).toBe('E');
    expect(resultOf(game)).toBeNull();
  });

  it('deals the play the same cards the deal held', () => {
    const original = deal();
    const game = bidTo(newGame(original), 1, 'NT');
    expect(game.play!.hands).toEqual(original.hands);
  });

  it('will not accept another call', () => {
    const game = bidTo(newGame(deal()), 4, 'H');
    expect(() => applyCall(game, PASS)).toThrow(/auction is over/);
  });
});

describe('playing a deal to the end', () => {
  const finished = (): Game => {
    let game = bidTo(newGame(deal()), 1, 'NT');
    while (game.phase === 'play') game = applyPlay(game, legalPlays(game.play!)[0]!);
    return game;
  };

  it('ends complete, with empty hands and thirteen tricks', () => {
    const game = finished();
    expect(game.phase).toBe('complete');
    expect(game.play!.completed).toHaveLength(13);
    for (const seat of SEATS) expect(game.play!.hands[seat]).toHaveLength(0);
  });

  it('produces a score that matches the tricks taken', () => {
    const game = finished();
    const result = resultOf(game)!;
    const total = game.play!.tricksWon.NS + game.play!.tricksWon.EW;
    expect(total).toBe(13);
    expect(result.tricksWon).toBe(game.play!.tricksWon.NS); // declarer is North
    expect(result.breakdown!.made).toBe(result.tricksWon >= 7);
    expect(Math.sign(result.northSouthScore)).toBe(result.breakdown!.made ? 1 : -1);
  });

  it('accepts no more cards', () => {
    const game = finished();
    expect(() => applyPlay(game, 0)).toThrow(/not in the play/);
    expect(turnOf(game)).toBeNull();
  });
});

describe('the state it is given', () => {
  it('is never modified', () => {
    const game = newGame(deal());
    const callsBefore = game.auction.calls;
    const after = applyCall(game, PASS);
    expect(game.auction.calls).toBe(callsBefore);
    expect(game.auction.calls).toHaveLength(0);
    expect(after.auction.calls).toHaveLength(1);
    expect(game.phase).toBe('auction');
  });
});
