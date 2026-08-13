/**
 * Working out what a hand is worth, and which suit it wants to open.
 *
 * Every bidding rule leans on this, so it is separated from the rules
 * themselves: the rules say "twelve to fourteen and balanced", this file decides
 * what those words mean.
 */

import type { Card, Suit } from '../cards.js';
import { SUITS, cardsOfSuit, highCardPoints, isBalanced, rankOf, shape } from '../cards.js';
import { suitIndex } from '../cards.js';

export type SuitLengths = Readonly<Record<Suit, number>>;

export function lengths(hand: readonly Card[]): SuitLengths {
  const counts = shape(hand);
  return { C: counts[0], D: counts[1], H: counts[2], S: counts[3] };
}

export function lengthOf(hand: readonly Card[], suit: Suit): number {
  return cardsOfSuit(hand, suit).length;
}

export const hcp = highCardPoints;
export const balanced = isBalanced;

/**
 * High-card points plus something for shape. Length points — one for each card
 * past four in a suit — are the simplest of the many schemes and the one most
 * beginners are taught alongside Acol.
 */
export function totalPoints(hand: readonly Card[]): number {
  const counts = lengths(hand);
  let extra = 0;
  for (const suit of SUITS) extra += Math.max(0, counts[suit] - 4);
  return hcp(hand) + extra;
}

/**
 * A rough count of the tricks a hand can expect to take playing in its own long
 * suit. Strong two-bids are defined in tricks rather than points, so something
 * has to estimate them; this counts honours in sequence at the top of each suit
 * and adds length past three in the longest.
 *
 * It is approximate on purpose — the alternative is a simulation, and a strong
 * two is rare enough that being half a trick out costs very little.
 */
export function playingTricks(hand: readonly Card[]): number {
  let tricks = 0;
  for (const suit of SUITS) {
    const cards = cardsOfSuit(hand, suit).sort((a, b) => rankOf(b) - rankOf(a));
    const ranks = cards.map(rankOf);
    const has = (rank: number) => ranks.includes(rank);

    let top = 0;
    if (has(14)) top += 1;
    if (has(13)) top += cards.length >= 2 ? 1 : 0.5;
    if (has(12)) top += cards.length >= 3 ? 1 : 0.5;
    if (has(11) && has(12) && has(13)) top += 0.5;
    tricks += Math.min(top, cards.length);

    // Long cards past the top honours tend to make once trumps are drawn.
    if (cards.length >= 5) tricks += (cards.length - 4) * 0.5;
  }
  return tricks;
}

/**
 * The Rule of 20: open if the high-card points plus the lengths of the two
 * longest suits reach twenty. It is the standard modern Acol guide to the
 * borderline hands, and it is a real named rule she may well know — which
 * matters, because it decides whether a hand she would have opened gets opened.
 *
 * Twelve points opens regardless; this is what lets a shapely eleven in.
 */
export function ruleOfTwenty(hand: readonly Card[]): boolean {
  const counts = lengths(hand);
  const [longest = 0, second = 0] = SUITS.map((suit) => counts[suit]).sort((a, b) => b - a);
  return hcp(hand) + longest + second >= 20;
}

/**
 * Which suit to open, playing four-card majors.
 *
 * The Acol conventions, in order: open the longest suit; with two five-card
 * suits open the higher; with four-four in the majors open hearts; with
 * four-four in the minors open diamonds and with three-three open clubs; and
 * with 4-4-4-1 open the suit below the singleton.
 */
export function openingSuit(hand: readonly Card[]): Suit {
  const counts = lengths(hand);
  const sorted = [...SUITS].sort((a, b) => counts[b] - counts[a]);
  const longest = counts[sorted[0]!];

  const tied = SUITS.filter((suit) => counts[suit] === longest);
  if (tied.length === 1) return tied[0]!;

  // 4-4-4-1: the suit below the singleton, wrapping clubs round to diamonds.
  const singleton = SUITS.find((suit) => counts[suit] === 1);
  if (longest === 4 && tied.length === 3 && singleton) {
    const below = SUITS[(suitIndex(singleton) + 3) % 4]!;
    return counts[below] === 4 ? below : tied[0]!;
  }

  if (longest >= 5) {
    // The higher of two long suits.
    return tied.reduce((high, suit) => (suitIndex(suit) > suitIndex(high) ? suit : high));
  }

  if (longest === 4) {
    if (counts.H === 4 && counts.S === 4) return 'H'; // four-four in the majors
    if (counts.C === 4 && counts.D === 4) return 'D'; // four-four in the minors
    return tied.reduce((high, suit) => (suitIndex(suit) > suitIndex(high) ? suit : high));
  }

  // Nothing longer than three: 4-3-3-3 has been handled above, so this is the
  // three-three minor case.
  if (counts.C === 3 && counts.D === 3) return 'C';
  return tied[0]!;
}

/** A five-card suit or longer, best first — what a hand wants to bid naturally. */
export function longSuits(hand: readonly Card[], minimum = 5): Suit[] {
  const counts = lengths(hand);
  return SUITS.filter((suit) => counts[suit] >= minimum)
    .sort((a, b) => counts[b] - counts[a] || suitIndex(b) - suitIndex(a));
}

/** Does the hand hold at least one card of every suit but the named one? */
export function shortIn(hand: readonly Card[], suit: Suit, most = 2): boolean {
  return lengthOf(hand, suit) <= most;
}

/** Rough test for a hand that can support a takeout double of the named suit. */
export function supportsOtherSuits(hand: readonly Card[], theirSuit: Suit, minimum = 3): boolean {
  return SUITS.filter((suit) => suit !== theirSuit).every((suit) => lengthOf(hand, suit) >= minimum);
}
