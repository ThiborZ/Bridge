/**
 * The play: following suit, winning tricks, and counting them.
 *
 * Every function here takes a state and returns a new one. Nothing mutates,
 * nothing reaches for a clock, and nothing knows a screen exists — which is
 * what lets the fuzz test run thousands of deals a second.
 */

import type { Card, Suit } from './cards.js';
import { cardsOfSuit, hasSuit, rankOf, suitOf } from './cards.js';
import type { Contract } from './auction.js';
import { openingLeader, tricksRequired } from './auction.js';
import type { Seat, Side } from './seats.js';
import { nextSeat, sideOf } from './seats.js';

export type Hands = Readonly<Record<Seat, readonly Card[]>>;

export type Trick = {
  readonly leader: Seat;
  /** In play order, starting with the leader. */
  readonly cards: readonly Card[];
};

export type PlayState = {
  readonly contract: Contract;
  readonly hands: Hands;
  readonly completed: readonly Trick[];
  readonly current: Trick;
  readonly tricksWon: Readonly<Record<Side, number>>;
};

/** Null in no-trumps. */
export function trumpSuit(contract: Contract): Suit | null {
  return contract.strain === 'NT' ? null : contract.strain;
}

export function startPlay(contract: Contract, hands: Hands): PlayState {
  return {
    contract,
    hands,
    completed: [],
    current: { leader: openingLeader(contract), cards: [] },
    tricksWon: { NS: 0, EW: 0 },
  };
}

export function isPlayComplete(state: PlayState): boolean {
  return state.completed.length === 13;
}

/** Whose turn it is to play a card. */
export function currentPlayer(state: PlayState): Seat {
  return nextSeat(state.current.leader, state.current.cards.length);
}

/** The suit led to the current trick, or null if nobody has led yet. */
export function suitLed(state: PlayState): Suit | null {
  const first = state.current.cards[0];
  return first === undefined ? null : suitOf(first);
}

/**
 * Follow suit if you can; otherwise anything. The whole of the play's legality,
 * and the reason a void has to be inferred rather than announced.
 */
export function legalPlays(state: PlayState, seat: Seat = currentPlayer(state)): Card[] {
  const hand = state.hands[seat];
  const led = suitLed(state);
  if (led === null) return [...hand];
  return hasSuit(hand, led) ? cardsOfSuit(hand, led) : [...hand];
}

export function isLegalPlay(state: PlayState, card: Card, seat: Seat = currentPlayer(state)): boolean {
  if (isPlayComplete(state)) return false;
  if (!state.hands[seat].includes(card)) return false;
  const led = suitLed(state);
  if (led === null) return true;
  return suitOf(card) === led || !hasSuit(state.hands[seat], led);
}

/**
 * Highest trump in the trick, or if there is none, the highest card of the
 * suit that was led.
 */
export function trickWinner(trick: Trick, trump: Suit | null): Seat {
  const led = suitOf(trick.cards[0]!);
  let bestIndex = 0;
  let bestSuit = led;
  for (let i = 1; i < trick.cards.length; i++) {
    const card = trick.cards[i]!;
    const suit = suitOf(card);
    const beatsOnTrump = trump !== null && suit === trump && bestSuit !== trump;
    const beatsOnRank = suit === bestSuit && rankOf(card) > rankOf(trick.cards[bestIndex]!);
    if (beatsOnTrump || beatsOnRank) {
      bestIndex = i;
      bestSuit = suit;
    }
  }
  return nextSeat(trick.leader, bestIndex);
}

export function playCard(state: PlayState, card: Card): PlayState {
  const seat = currentPlayer(state);
  if (!isLegalPlay(state, card, seat)) {
    throw new Error(`illegal play: ${seat} cannot play card ${card}`);
  }

  const hands = { ...state.hands, [seat]: state.hands[seat].filter((c) => c !== card) };
  const cards = [...state.current.cards, card];

  if (cards.length < 4) {
    return { ...state, hands, current: { leader: state.current.leader, cards } };
  }

  const trick: Trick = { leader: state.current.leader, cards };
  const winner = trickWinner(trick, trumpSuit(state.contract));
  const side = sideOf(winner);
  return {
    ...state,
    hands,
    completed: [...state.completed, trick],
    current: { leader: winner, cards: [] },
    tricksWon: { ...state.tricksWon, [side]: state.tricksWon[side] + 1 },
  };
}

/** Tricks taken by declarer's side. */
export function declarerTricks(state: PlayState): number {
  return state.tricksWon[sideOf(state.contract.declarer)];
}

/** Positive if the contract made with overtricks, negative if it went down. */
export function resultRelativeToContract(state: PlayState): number {
  return declarerTricks(state) - tricksRequired(state.contract);
}
