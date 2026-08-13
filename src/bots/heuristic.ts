/**
 * A card player that follows the rules of thumb a beginner is taught.
 *
 * Second hand low, third hand high, win as cheaply as you can, don't beat your
 * own partner, ruff when the trick is going to the opponents, lead the top of a
 * sequence, otherwise fourth highest from your longest suit.
 *
 * It misses finesses, cannot count the hand, and never plans more than the
 * current trick — which is the point. This *is* the Kitchen table difficulty,
 * not scaffolding for it: a beginner opponent who plays sensibly and can be
 * beaten by anyone paying attention.
 *
 * A deliberate weakness worth not "fixing" by accident: when this plays a card
 * for dummy it looks only at dummy's hand, even though declarer is entitled to
 * see both. It therefore plays the two hands as if they were strangers, and will
 * happily crash an ace under its own king. That is under-using information it
 * legitimately has, which is precisely what the weakest level should do — a
 * beginner mishandles exactly this. The solver-backed levels will use both.
 *
 * IT MUST NOT CHEAT. `PlayState` carries all four hands because the engine needs
 * them, so everything here reads `state.hands[seat]` — the hand it is playing
 * from — and the cards already on the table, and nothing else. Difficulty comes
 * from how well a bot reasons, never from what it can see. Any future change
 * that reaches into another seat's hand is a bug however much it improves the
 * play.
 */

import type { Card, Suit } from '../cards.js';
import { SUITS, cardsOfSuit, rankOf, suitOf } from '../cards.js';
import type { PlayState } from '../play.js';
import { currentPlayer, legalPlays, trickWinner, trumpSuit } from '../play.js';
import type { Seat } from '../seats.js';
import { partnerOf } from '../seats.js';

/** Would this card be winning the trick, given what is on the table so far? */
function beats(card: Card, best: Card, trump: Suit | null): boolean {
  const suit = suitOf(card);
  const bestSuit = suitOf(best);
  if (suit === bestSuit) return rankOf(card) > rankOf(best);
  return suit === trump;
}

function lowest(cards: readonly Card[]): Card {
  return cards.reduce((low, card) => (rankOf(card) < rankOf(low) ? card : low));
}

function highest(cards: readonly Card[]): Card {
  return cards.reduce((high, card) => (rankOf(card) > rankOf(high) ? card : high));
}

/** Honour value of a holding, used to decide which suit to throw away from. */
function honourValue(cards: readonly Card[]): number {
  return cards.reduce((total, card) => total + Math.max(0, rankOf(card) - 10), 0);
}

/** The longest suit, ties broken by the stronger one. */
function longestSuit(hand: readonly Card[], exclude: Suit | null): Suit | null {
  let best: Suit | null = null;
  let bestLength = 0;
  let bestHonours = -1;
  for (const suit of SUITS) {
    if (suit === exclude) continue;
    const cards = cardsOfSuit(hand, suit);
    if (cards.length === 0) continue;
    const honours = honourValue(cards);
    if (cards.length > bestLength || (cards.length === bestLength && honours > bestHonours)) {
      best = suit;
      bestLength = cards.length;
      bestHonours = honours;
    }
  }
  return best;
}

/**
 * The top of three or more touching cards — KQJ, QJT. Leading one of these
 * cannot cost a trick, which is why it is the first thing a beginner is told.
 */
function topOfSequence(hand: readonly Card[]): Card | null {
  for (const suit of SUITS) {
    const cards = cardsOfSuit(hand, suit).sort((a, b) => rankOf(b) - rankOf(a));
    let run = 1;
    for (let i = 1; i < cards.length; i++) {
      if (rankOf(cards[i - 1]!) - rankOf(cards[i]!) === 1) {
        run++;
        if (run >= 3 && rankOf(cards[i - run + 1]!) >= 11) return cards[i - run + 1]!;
      } else {
        run = 1;
      }
    }
  }
  return null;
}

/** What to throw when the trick is lost anyway: the least useful card we hold. */
function discard(hand: readonly Card[], trump: Suit | null): Card {
  const suits = SUITS.filter((suit) => suit !== trump && cardsOfSuit(hand, suit).length > 0);
  if (suits.length === 0) return lowest(hand); // nothing but trumps left

  // Throw from the suit carrying the fewest honours; break ties by throwing
  // from the longest, since a short suit's low card may still be a stopper.
  let choice = suits[0]!;
  for (const suit of suits.slice(1)) {
    const cards = cardsOfSuit(hand, suit);
    const bestCards = cardsOfSuit(hand, choice);
    const better =
      honourValue(cards) < honourValue(bestCards) ||
      (honourValue(cards) === honourValue(bestCards) && cards.length > bestCards.length);
    if (better) choice = suit;
  }
  return lowest(cardsOfSuit(hand, choice));
}

function chooseLead(state: PlayState, seat: Seat, legal: readonly Card[]): Card {
  const hand = state.hands[seat];
  const trump = trumpSuit(state.contract);

  const sequence = topOfSequence(hand);
  if (sequence !== null) return sequence;

  // Declarer draws trumps while any are still out. Counting only its own trumps
  // and the ones already played keeps it honest — and slightly pessimistic,
  // which is the right way for a weak bot to be wrong.
  const declaringSide = seat === state.contract.declarer || seat === partnerOf(state.contract.declarer);
  if (trump !== null && declaringSide) {
    const mine = cardsOfSuit(hand, trump);
    const gone = state.completed.flatMap((trick) => trick.cards).filter((c) => suitOf(c) === trump).length;
    if (mine.length > 0 && mine.length + gone < 13) return highest(mine);
  }

  const suit = longestSuit(hand, null);
  if (suit === null) return lowest(legal);
  const cards = cardsOfSuit(hand, suit).sort((a, b) => rankOf(b) - rankOf(a));
  // Fourth highest from length, the standard lead; from a short suit the top.
  return cards.length >= 4 ? cards[3]! : cards[0]!;
}

function chooseFollow(state: PlayState, seat: Seat, legal: readonly Card[]): Card {
  const trump = trumpSuit(state.contract);
  const played = state.current.cards;
  const position = played.length; // 1 = second hand, 2 = third, 3 = fourth
  const best = played[0]!;
  const bestCard = played.reduce((winner, card) => (beats(card, winner, trump) ? card : winner), best);
  const winningSeat = trickWinner({ leader: state.current.leader, cards: played }, trump);
  const partnerWinning = winningSeat === partnerOf(seat);

  const ledSuit = suitOf(played[0]!);
  const canFollow = legal.some((card) => suitOf(card) === ledSuit);
  const winners = legal.filter((card) => beats(card, bestCard, trump));

  if (canFollow) {
    // Never spend a card beating your own partner.
    if (partnerWinning) return lowest(legal);
    if (winners.length === 0) return lowest(legal);

    // Second hand low: the two players behind you have yet to commit, so a high
    // card here is usually wasted. Third and fourth hand take the trick.
    if (position === 1) return lowest(legal);
    if (position === 2) return highest(legal); // third hand high
    return lowest(winners); // fourth hand wins as cheaply as it can
  }

  // Void in the suit led. Ruffing to beat your own partner is throwing a trump away.
  if (partnerWinning) return discard(state.hands[seat], trump);
  const ruffs = winners.filter((card) => suitOf(card) === trump);
  if (ruffs.length > 0) return lowest(ruffs);
  return discard(state.hands[seat], trump);
}

export function heuristicPlay(state: PlayState, seat: Seat = currentPlayer(state)): Card {
  const legal = legalPlays(state, seat);
  if (legal.length === 1) return legal[0]!;
  return state.current.cards.length === 0
    ? chooseLead(state, seat, legal)
    : chooseFollow(state, seat, legal);
}
