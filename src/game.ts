/**
 * A deal and the state machine over it: auction, then play, then a score.
 *
 * Deals come from a seed so every hand has an id you can type back in and get
 * the identical cards.
 */

import type { Card } from './cards.js';
import { shuffledDeck, sortHand } from './cards.js';
import { mulberry32, seedFromString } from './random.js';
import type { Seat, Side, Vulnerability } from './seats.js';
import { SEATS, chicagoDealer, chicagoVulnerability, sideOf } from './seats.js';
import type { Auction, Call, Contract } from './auction.js';
import { contractOf, isAuctionComplete, isPassedOut, makeCall, newAuction, auctionTurn } from './auction.js';
import type { Hands, PlayState } from './play.js';
import { currentPlayer, declarerTricks, isPlayComplete, playCard, startPlay } from './play.js';
import type { ScoreBreakdown } from './score.js';
import { scoreDeal } from './score.js';

export type Deal = {
  readonly id: string;
  readonly dealer: Seat;
  readonly vulnerability: Vulnerability;
  readonly hands: Hands;
};

export function dealFromSeed(id: string, dealer: Seat, vulnerability: Vulnerability): Deal {
  const deck = shuffledDeck(mulberry32(seedFromString(id)));
  const hands = {} as Record<Seat, readonly Card[]>;
  SEATS.forEach((seat, index) => {
    hands[seat] = sortHand(deck.slice(index * 13, index * 13 + 13));
  });
  return { id, dealer, vulnerability, hands };
}

/** Hand numbers are 1-based; the Chicago cycle repeats every four. */
export function chicagoDeal(id: string, handNumber: number): Deal {
  return dealFromSeed(id, chicagoDealer(handNumber), chicagoVulnerability(handNumber));
}

export type Phase = 'auction' | 'play' | 'complete';

export type Game = {
  readonly deal: Deal;
  readonly auction: Auction;
  readonly play: PlayState | null;
  readonly phase: Phase;
};

export function newGame(deal: Deal): Game {
  return { deal, auction: newAuction(deal.dealer), play: null, phase: 'auction' };
}

/** Whose turn it is, whatever phase we are in. Null once the deal is over. */
export function turnOf(game: Game): Seat | null {
  if (game.phase === 'auction') return auctionTurn(game.auction);
  if (game.phase === 'play' && game.play) return currentPlayer(game.play);
  return null;
}

export function applyCall(game: Game, call: Call): Game {
  if (game.phase !== 'auction') throw new Error('the auction is over');
  const auction = makeCall(game.auction, call);
  if (!isAuctionComplete(auction)) {
    return { ...game, auction };
  }
  if (isPassedOut(auction)) {
    return { ...game, auction, phase: 'complete' };
  }
  const contract = contractOf(auction)!;
  return { ...game, auction, play: startPlay(contract, game.deal.hands), phase: 'play' };
}

export function applyPlay(game: Game, card: Card): Game {
  if (game.phase !== 'play' || !game.play) throw new Error('not in the play');
  const play = playCard(game.play, card);
  return { ...game, play, phase: isPlayComplete(play) ? 'complete' : 'play' };
}

export type DealResult = {
  readonly contract: Contract | null;
  readonly tricksWon: number;
  readonly breakdown: ScoreBreakdown | null;
  /** Score from North-South's point of view, so hands can be totalled. */
  readonly northSouthScore: number;
};

export function resultOf(game: Game): DealResult | null {
  if (game.phase !== 'complete') return null;
  const contract = contractOf(game.auction);
  if (contract === null || game.play === null) {
    return { contract: null, tricksWon: 0, breakdown: null, northSouthScore: 0 };
  }
  const tricksWon = declarerTricks(game.play);
  const breakdown = scoreDeal(contract, tricksWon, game.deal.vulnerability);
  const declaringSide: Side = sideOf(contract.declarer);
  return {
    contract,
    tricksWon,
    breakdown,
    northSouthScore: declaringSide === 'NS' ? breakdown.score : -breakdown.score,
  };
}
