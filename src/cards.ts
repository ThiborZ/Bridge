/**
 * Cards are plain numbers 0..51, ordered by suit then rank:
 *   card = suitIndex * 13 + (rank - 2)
 * with suits in bidding order C < D < H < S and ranks 2..14 (14 = ace).
 *
 * A number rather than an object because the double-dummy solver will be
 * sorting and comparing millions of these; the string helpers are for tests
 * and for anything a human has to read.
 */

import type { Rng } from './random.js';
import { shuffleInPlace } from './random.js';

export const SUITS = ['C', 'D', 'H', 'S'] as const;
export type Suit = (typeof SUITS)[number];

export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const ACE = 14;
export const KING = 13;
export const QUEEN = 12;
export const JACK = 11;
export const TEN = 10;

export function suitIndex(suit: Suit): number {
  return SUITS.indexOf(suit);
}

export function makeCard(suit: Suit, rank: number): Card {
  return suitIndex(suit) * 13 + (rank - 2);
}

export function suitOf(card: Card): Suit {
  return SUITS[Math.floor(card / 13)]!;
}

export function rankOf(card: Card): number {
  return (card % 13) + 2;
}

export function sameSuit(a: Card, b: Card): boolean {
  return Math.floor(a / 13) === Math.floor(b / 13);
}

/** "SA", "HT", "C2" — suit first, so cards sort readably in test output. */
export function cardToString(card: Card): string {
  return suitOf(card) + RANK_CHARS[rankOf(card) - 2];
}

export function parseCard(text: string): Card {
  const suit = text[0]?.toUpperCase() as Suit;
  const rankChar = text[1]?.toUpperCase() ?? '';
  const rank = RANK_CHARS.indexOf(rankChar) + 2;
  if (!SUITS.includes(suit) || rank < 2) throw new Error(`not a card: "${text}"`);
  return makeCard(suit, rank);
}

export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffleInPlace(fullDeck(), rng);
}

/** Descending by rank within a suit, suits in bidding order — how a hand is held. */
export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const suitDiff = Math.floor(b / 13) - Math.floor(a / 13);
    return suitDiff !== 0 ? suitDiff : rankOf(b) - rankOf(a);
  });
}

export function cardsOfSuit(cards: readonly Card[], suit: Suit): Card[] {
  return cards.filter((c) => suitOf(c) === suit);
}

export function hasSuit(cards: readonly Card[], suit: Suit): boolean {
  return cards.some((c) => suitOf(c) === suit);
}

/** Milton Work: ace 4, king 3, queen 2, jack 1. Forty in the pack. */
export function highCardPoints(cards: readonly Card[]): number {
  let points = 0;
  for (const card of cards) {
    const rank = rankOf(card);
    if (rank >= JACK) points += rank - 10;
  }
  return points;
}

/** Card counts per suit, in bidding order C D H S. */
export function shape(cards: readonly Card[]): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const card of cards) counts[Math.floor(card / 13)]!++;
  return counts;
}

/**
 * 4333, 4432 and 5332 — the hands that open or rebid in no-trumps.
 * No void or singleton, nothing longer than five, and at most one doubleton,
 * which is what rules 5422 out.
 */
export function isBalanced(cards: readonly Card[]): boolean {
  const counts = [...shape(cards)].sort((a, b) => b - a);
  const doubletons = counts.filter((n) => n === 2).length;
  return counts[0]! <= 5 && counts[3]! >= 2 && doubletons <= 1;
}
