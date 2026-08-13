/**
 * A deliberately stupid double-dummy solver, for checking the real one.
 *
 * No bitmasks, no pruning, no transposition table, no equivalent-card
 * collapsing — just every legal card, every time, all the way down. It is
 * hopelessly slow beyond about five cards each, which is fine: its whole job is
 * to be so simple that it is obviously right, and then to disagree loudly if the
 * fast solver is not.
 *
 * It shares no code with doubleDummy.ts on purpose. Two implementations that
 * call the same helper agree about that helper's bugs.
 */

import type { Card, Suit } from '../cards.js';
import { suitOf, rankOf } from '../cards.js';
import type { Hands } from '../play.js';
import type { Seat } from '../seats.js';
import { SEATS, nextSeat, sideOf } from '../seats.js';

type Played = { seat: Seat; card: Card };

/** North-South tricks, with both sides playing perfectly and all hands visible. */
export function referenceNorthSouthTricks(hands: Hands, leader: Seat, trump: Suit | null): number {
  const remaining: Record<Seat, Card[]> = {
    N: [...hands.N], E: [...hands.E], S: [...hands.S], W: [...hands.W],
  };

  const winnerOf = (trick: Played[]): Seat => {
    let best = trick[0]!;
    for (const play of trick.slice(1)) {
      const suit = suitOf(play.card);
      const bestSuit = suitOf(best.card);
      if (suit === bestSuit) {
        if (rankOf(play.card) > rankOf(best.card)) best = play;
      } else if (suit === trump && bestSuit !== trump) {
        best = play;
      }
    }
    return best.seat;
  };

  const search = (leadSeat: Seat, trick: Played[]): number => {
    if (trick.length === 4) {
      const winner = winnerOf(trick);
      return (sideOf(winner) === 'NS' ? 1 : 0) + search(winner, []);
    }

    const seat = nextSeat(leadSeat, trick.length);
    const hand = remaining[seat];
    if (hand.length === 0) return 0; // every card has been played

    const led = trick.length > 0 ? suitOf(trick[0]!.card) : null;
    const mustFollow = led !== null && hand.some((card) => suitOf(card) === led);
    const choices = mustFollow ? hand.filter((card) => suitOf(card) === led) : [...hand];

    const ourTurn = sideOf(seat) === 'NS';
    let best = ourTurn ? -1 : Number.MAX_SAFE_INTEGER;

    for (const card of choices) {
      remaining[seat] = hand.filter((held) => held !== card);
      const value = search(leadSeat, [...trick, { seat, card }]);
      remaining[seat] = hand;
      if (ourTurn ? value > best : value < best) best = value;
    }
    return best;
  };

  return search(leader, []);
}

/** Both sides' totals, for symmetry with the fast solver's result. */
export function referenceTricks(hands: Hands, leader: Seat, trump: Suit | null): {
  northSouth: number; eastWest: number;
} {
  const perHand = SEATS.reduce((most, seat) => Math.max(most, hands[seat].length), 0);
  const northSouth = referenceNorthSouthTricks(hands, leader, trump);
  return { northSouth, eastWest: perHand - northSouth };
}
