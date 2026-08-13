/**
 * Portable Bridge Notation — the standard text format for deals.
 *
 * Cheap to support and worth a lot: it means deals from books and from other
 * bridge software can be loaded straight into the tests, so the play engine can
 * be checked against hands whose right answer is already published.
 *
 * A deal reads "N:spades.hearts.diamonds.clubs ..." with one hand per seat
 * clockwise from the named one, ranks descending.
 */

import type { Card } from './cards.js';
import { RANK_CHARS, makeCard, rankOf, sortHand, suitOf } from './cards.js';
import type { Suit } from './cards.js';
import type { Seat } from './seats.js';
import { SEATS, nextSeat, seatIndex } from './seats.js';
import type { Hands } from './play.js';

/** PBN writes suits high to low, which is the reverse of our bidding order. */
const PBN_SUIT_ORDER: readonly Suit[] = ['S', 'H', 'D', 'C'];

function handToPBN(cards: readonly Card[]): string {
  return PBN_SUIT_ORDER.map((suit) =>
    sortHand(cards.filter((card) => suitOf(card) === suit))
      .map((card) => RANK_CHARS[rankOf(card) - 2])
      .join(''),
  ).join('.');
}

/** The value of a PBN Deal tag, e.g. `N:AK5.QJ4.T98.7632 ...`. */
export function handsToPBN(hands: Hands, first: Seat = 'N'): string {
  const seats = [0, 1, 2, 3].map((step) => nextSeat(first, step));
  return `${first}:${seats.map((seat) => handToPBN(hands[seat])).join(' ')}`;
}

export function parsePBNHands(text: string): Hands {
  const trimmed = text.trim().replace(/^\[?\s*Deal\s+"|"\s*\]?$/g, '');
  const match = /^([NESW]):(.+)$/.exec(trimmed);
  if (!match) throw new Error(`not a PBN deal: "${text}"`);

  const first = match[1] as Seat;
  const handTexts = match[2]!.trim().split(/\s+/);
  if (handTexts.length !== 4) throw new Error(`expected 4 hands, found ${handTexts.length}`);

  const hands = {} as Record<Seat, readonly Card[]>;
  handTexts.forEach((handText, step) => {
    const suits = handText.split('.');
    if (suits.length !== 4) throw new Error(`expected 4 suits in "${handText}"`);
    const cards: Card[] = [];
    suits.forEach((ranks, suitPosition) => {
      const suit = PBN_SUIT_ORDER[suitPosition]!;
      for (const char of ranks) {
        const rank = RANK_CHARS.indexOf(char.toUpperCase()) + 2;
        if (rank < 2) throw new Error(`not a rank: "${char}"`);
        cards.push(makeCard(suit, rank));
      }
    });
    hands[nextSeat(first, step)] = sortHand(cards);
  });

  const seen = new Set(SEATS.flatMap((seat) => [...hands[seat]]));
  if (seen.size !== 52) throw new Error(`deal does not use all 52 cards (found ${seen.size})`);
  return hands;
}

/** A full PBN tag block for one deal, which most bridge software will read. */
export function dealToPBN(options: {
  hands: Hands;
  dealer: Seat;
  vulnerable: string;
  board?: number;
}): string {
  const lines = [
    `[Board "${options.board ?? 1}"]`,
    `[Dealer "${options.dealer}"]`,
    `[Vulnerable "${options.vulnerable}"]`,
    `[Deal "${handsToPBN(options.hands, options.dealer)}"]`,
  ];
  return lines.join('\n');
}

/** Seat order used when printing a deal for a human to read. */
export function seatsFrom(first: Seat): Seat[] {
  return [0, 1, 2, 3].map((step) => SEATS[(seatIndex(first) + step) % 4]!);
}
