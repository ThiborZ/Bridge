import { describe, it, expect } from 'vitest';
import {
  cardToString, cardsToString, fullDeck, highCardPoints, isBalanced, makeCard,
  parseCard, parseCards, rankOf, shape, shuffledDeck, sortHand, suitOf,
} from '../src/cards.js';
import { mulberry32, seedFromString } from '../src/random.js';

describe('card encoding', () => {
  it('round-trips every card in the pack', () => {
    for (const card of fullDeck()) {
      expect(makeCard(suitOf(card), rankOf(card))).toBe(card);
      expect(parseCard(cardToString(card))).toBe(card);
    }
  });

  it('reads and writes the notation people use', () => {
    expect(cardToString(parseCard('SA'))).toBe('SA');
    expect(cardToString(parseCard('HT'))).toBe('HT');
    expect(cardToString(parseCard('c2'))).toBe('C2');
    expect(() => parseCard('SX')).toThrow();
    expect(() => parseCard('ZA')).toThrow();
  });

  it('holds 52 distinct cards in a deck', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });
});

describe('sorting a hand', () => {
  it('puts spades first and ranks high to low', () => {
    const hand = parseCards('C2 SA H7 SK D9 HT');
    expect(cardsToString(sortHand(hand))).toBe('SA SK HT H7 D9 C2');
  });
});

describe('shuffling', () => {
  it('gives the same deal for the same seed', () => {
    const a = shuffledDeck(mulberry32(seedFromString('board-1')));
    const b = shuffledDeck(mulberry32(seedFromString('board-1')));
    expect(a).toEqual(b);
  });

  it('gives a different deal for a different seed', () => {
    const a = shuffledDeck(mulberry32(seedFromString('board-1')));
    const b = shuffledDeck(mulberry32(seedFromString('board-2')));
    expect(a).not.toEqual(b);
  });

  it('still holds every card', () => {
    const deck = shuffledDeck(mulberry32(7));
    expect(new Set(deck).size).toBe(52);
  });
});

describe('hand evaluation', () => {
  it('counts 4-3-2-1 for the honours', () => {
    expect(highCardPoints(parseCards('SA SK SQ SJ'))).toBe(10);
    expect(highCardPoints(parseCards('S2 S3 HT D9'))).toBe(0);
  });

  it('finds forty points in the pack', () => {
    expect(highCardPoints(fullDeck())).toBe(40);
  });

  it('counts the suits in bidding order', () => {
    expect(shape(parseCards('SA SK HQ D2 D3 D4 C9'))).toEqual([1, 3, 1, 2]);
  });
});

describe('balanced hands', () => {
  const balanced = [
    ['4333', 'SA SK SQ SJ H2 H3 H4 D2 D3 D4 C2 C3 C4'],
    ['4432', 'SA SK SQ SJ HA HK HQ HJ D2 D3 D4 C2 C3'],
    ['5332', 'SA SK SQ SJ ST H2 H3 H4 D2 D3 D4 C2 C3'],
  ] as const;

  const unbalanced = [
    ['5422', 'SA SK SQ SJ ST HA HK HQ HJ D2 D3 C2 C3'],
    ['4441', 'SA SK SQ SJ HA HK HQ HJ DA DK DQ DJ C2'],
    ['6322', 'SA SK SQ SJ ST S9 H2 H3 H4 D2 D3 C2 C3'],
  ] as const;

  it.each(balanced)('calls %s balanced', (_label, cards) => {
    expect(isBalanced(parseCards(cards))).toBe(true);
  });

  it.each(unbalanced)('calls %s unbalanced', (_label, cards) => {
    expect(isBalanced(parseCards(cards))).toBe(false);
  });
});
