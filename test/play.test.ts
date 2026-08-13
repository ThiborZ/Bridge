import { describe, it, expect } from 'vitest';
import { cardToString, parseCard, parseCards } from '../src/cards.js';
import type { Card } from '../src/cards.js';
import type { Contract } from '../src/auction.js';
import type { Hands, PlayState, Trick } from '../src/play.js';
import {
  currentPlayer, isLegalPlay, legalPlays, playCard, startPlay, trickWinner, trumpSuit,
} from '../src/play.js';
import type { Seat } from '../src/seats.js';

function hands(spec: Record<Seat, string>): Hands {
  return {
    N: parseCards(spec.N), E: parseCards(spec.E),
    S: parseCards(spec.S), W: parseCards(spec.W),
  };
}

function trick(leader: Seat, cards: string): Trick {
  return { leader, cards: parseCards(cards) };
}

function stateWith(contract: Contract, spec: Record<Seat, string>): PlayState {
  return startPlay(contract, hands(spec));
}

const fourHearts: Contract = { level: 4, strain: 'H', risk: 'none', declarer: 'S' };
const threeNoTrumps: Contract = { level: 3, strain: 'NT', risk: 'none', declarer: 'S' };

describe('who is on lead', () => {
  it('opens on declarer\'s left', () => {
    const state = stateWith(fourHearts, { N: 'SA', E: 'SK', S: 'SQ', W: 'SJ' });
    expect(state.current.leader).toBe('W');
    expect(currentPlayer(state)).toBe('W');
  });

  it('moves clockwise within a trick', () => {
    let state = stateWith(fourHearts, { N: 'SA', E: 'SK', S: 'SQ', W: 'SJ' });
    state = playCard(state, parseCard('SJ')); // W
    expect(currentPlayer(state)).toBe('N');
    state = playCard(state, parseCard('SA')); // N
    expect(currentPlayer(state)).toBe('E');
  });
});

describe('following suit', () => {
  it('forces a follow when the suit is held', () => {
    const state = stateWith(threeNoTrumps, {
      W: 'SA S5', N: 'S7 H2 D3', E: 'S9', S: 'SK',
    });
    const afterLead = playCard(state, parseCard('SA'));
    expect(legalPlays(afterLead).map(cardToString)).toEqual(['S7']);
    expect(isLegalPlay(afterLead, parseCard('H2'))).toBe(false);
    expect(() => playCard(afterLead, parseCard('D3'))).toThrow(/illegal/);
  });

  it('allows anything when void', () => {
    const state = stateWith(threeNoTrumps, {
      W: 'SA', N: 'H2 D3 C4', E: 'S9', S: 'SK',
    });
    const afterLead = playCard(state, parseCard('SA'));
    expect(legalPlays(afterLead).map(cardToString).sort()).toEqual(['C4', 'D3', 'H2']);
  });

  it('lets the leader play anything', () => {
    const state = stateWith(threeNoTrumps, { W: 'SA H2', N: 'S7', E: 'S9', S: 'SK' });
    expect(legalPlays(state)).toHaveLength(2);
  });

  it('refuses a card that is not in the hand', () => {
    const state = stateWith(threeNoTrumps, { W: 'SA', N: 'S7', E: 'S9', S: 'SK' });
    expect(isLegalPlay(state, parseCard('DQ'))).toBe(false);
  });
});

describe('winning a trick', () => {
  it('gives it to the highest card of the suit led, in no-trumps', () => {
    // Play order from W is W, N, E, S — so the fourth card is South's.
    expect(trickWinner(trick('W', 'S2 S7 S9 SA'), null)).toBe('S');
  });

  it('can be won from any seat in the trick', () => {
    expect(trickWinner(trick('W', 'SA S7 S9 S2'), null)).toBe('W');
    expect(trickWinner(trick('W', 'S2 SA S9 S7'), null)).toBe('N');
    expect(trickWinner(trick('W', 'S2 S7 SA S9'), null)).toBe('E');
  });

  it('ignores higher cards in other suits', () => {
    expect(trickWinner(trick('W', 'S2 HA DK CQ'), null)).toBe('W');
  });

  it('gives it to a ruff', () => {
    expect(trickWinner(trick('W', 'SA SK S3 H2'), 'H')).toBe('S');
  });

  it('gives it to the higher of two ruffs', () => {
    expect(trickWinner(trick('W', 'SA H2 S3 H5'), 'H')).toBe('S');
  });

  it('is unaffected by trumps nobody played', () => {
    expect(trickWinner(trick('N', 'DK DA D2 D5'), 'S')).toBe('E');
  });

  it('lets the led suit win when the trump suit is the led suit', () => {
    expect(trickWinner(trick('N', 'H3 H9 HK H4'), 'H')).toBe('S');
  });
});

describe('trumps', () => {
  it('is null in no-trumps', () => {
    expect(trumpSuit(threeNoTrumps)).toBeNull();
    expect(trumpSuit(fourHearts)).toBe('H');
  });
});

describe('completing a trick', () => {
  // W leads low, South's king is the highest spade played, so North-South win it.
  const spec: Record<Seat, string> = { W: 'S2 SA', N: 'S7 S3', E: 'S9 S4', S: 'SK S5' };

  it('credits the winning side and gives them the lead', () => {
    let state = stateWith(fourHearts, spec);
    for (const card of ['S2', 'S7', 'S9', 'SK']) state = playCard(state, parseCard(card));
    expect(state.completed).toHaveLength(1);
    expect(state.tricksWon).toEqual({ NS: 1, EW: 0 });
    expect(state.current.leader).toBe('S');
    expect(state.current.cards).toEqual([]);
  });

  it('removes played cards from hands', () => {
    let state = stateWith(fourHearts, spec);
    state = playCard(state, parseCard('S2'));
    expect(state.hands.W.map(cardToString)).toEqual(['SA']);
  });

  it('does not mutate the state it was given', () => {
    const before = stateWith(fourHearts, spec);
    const handBefore: readonly Card[] = before.hands.W;
    playCard(before, parseCard('S2'));
    expect(before.hands.W).toBe(handBefore);
    expect(before.hands.W).toHaveLength(2);
    expect(before.current.cards).toEqual([]);
  });
});
