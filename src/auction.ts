/**
 * The auction: legality of calls, when bidding ends, and what contract it left.
 *
 * The subtle rule lives in `contractOf`: declarer is whoever on the winning side
 * FIRST named the final strain, which is often not the player who made the last
 * bid. See the tests.
 */

import type { Seat } from './seats.js';
import { areOpponents, nextSeat, seatIndex, sideOf, SEATS } from './seats.js';

export const STRAINS = ['C', 'D', 'H', 'S', 'NT'] as const;
export type Strain = (typeof STRAINS)[number];

export type Call =
  | { readonly type: 'pass' }
  | { readonly type: 'double' }
  | { readonly type: 'redouble' }
  | { readonly type: 'bid'; readonly level: number; readonly strain: Strain };

export type Risk = 'none' | 'doubled' | 'redoubled';

export const PASS: Call = { type: 'pass' };
export const DOUBLE: Call = { type: 'double' };
export const REDOUBLE: Call = { type: 'redouble' };

export function bid(level: number, strain: Strain): Call {
  if (level < 1 || level > 7) throw new Error(`no such level: ${level}`);
  return { type: 'bid', level, strain };
}

export function strainIndex(strain: Strain): number {
  return STRAINS.indexOf(strain);
}

/** 1C is 0, 7NT is 34 — a single comparable number per bid. */
export function bidRank(level: number, strain: Strain): number {
  return (level - 1) * 5 + strainIndex(strain);
}

export function isMajor(strain: Strain): boolean {
  return strain === 'H' || strain === 'S';
}

export function isMinor(strain: Strain): boolean {
  return strain === 'C' || strain === 'D';
}

export function callToString(call: Call): string {
  switch (call.type) {
    case 'pass': return 'P';
    case 'double': return 'X';
    case 'redouble': return 'XX';
    case 'bid': return `${call.level}${call.strain}`;
  }
}

export function parseCall(text: string): Call {
  const token = text.trim().toUpperCase();
  if (token === 'P' || token === 'PASS') return PASS;
  if (token === 'X' || token === 'DBL') return DOUBLE;
  if (token === 'XX' || token === 'RDBL') return REDOUBLE;
  const match = /^([1-7])(C|D|H|S|NT)$/.exec(token);
  if (!match) throw new Error(`not a call: "${text}"`);
  return bid(Number(match[1]), match[2] as Strain);
}

export function callsToString(calls: readonly Call[]): string {
  return calls.map(callToString).join(' ');
}

export function parseCalls(text: string): Call[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCall);
}

export type Auction = {
  readonly dealer: Seat;
  readonly calls: readonly Call[];
};

export function newAuction(dealer: Seat): Auction {
  return { dealer, calls: [] };
}

/** The seat that made call number `index`, counting from the dealer. */
export function seatOfCall(auction: Auction, index: number): Seat {
  return SEATS[(seatIndex(auction.dealer) + index) % 4]!;
}

/** Whose turn it is to call. */
export function auctionTurn(auction: Auction): Seat {
  return seatOfCall(auction, auction.calls.length);
}

type AuctionSummary = {
  lastBid: { level: number; strain: Strain } | null;
  lastBidder: Seat | null;
  risk: Risk;
};

function summarize(auction: Auction): AuctionSummary {
  let lastBid: { level: number; strain: Strain } | null = null;
  let lastBidder: Seat | null = null;
  let risk: Risk = 'none';
  auction.calls.forEach((call, index) => {
    if (call.type === 'bid') {
      lastBid = { level: call.level, strain: call.strain };
      lastBidder = seatOfCall(auction, index);
      risk = 'none';
    } else if (call.type === 'double') {
      risk = 'doubled';
    } else if (call.type === 'redouble') {
      risk = 'redoubled';
    }
  });
  return { lastBid, lastBidder, risk };
}

export function isPassedOut(auction: Auction): boolean {
  return auction.calls.length === 4 && auction.calls.every((c) => c.type === 'pass');
}

export function isAuctionComplete(auction: Auction): boolean {
  const { calls } = auction;
  if (calls.length < 4) return false;
  if (isPassedOut(auction)) return true;
  const lastThreeArePasses = calls.slice(-3).every((c) => c.type === 'pass');
  return lastThreeArePasses && calls.some((c) => c.type === 'bid');
}

export function isLegalCall(auction: Auction, call: Call): boolean {
  if (isAuctionComplete(auction)) return false;
  const { lastBid, lastBidder, risk } = summarize(auction);
  const turn = auctionTurn(auction);

  switch (call.type) {
    case 'pass':
      return true;
    case 'bid':
      if (call.level < 1 || call.level > 7) return false;
      return lastBid === null || bidRank(call.level, call.strain) > bidRank(lastBid.level, lastBid.strain);
    case 'double':
      // Only over an opponent's bid that is not already doubled.
      return lastBid !== null && risk === 'none' && areOpponents(turn, lastBidder!);
    case 'redouble':
      // Only over a double of our own side's bid.
      return lastBid !== null && risk === 'doubled' && !areOpponents(turn, lastBidder!);
  }
}

export function legalCalls(auction: Auction): Call[] {
  if (isAuctionComplete(auction)) return [];
  const calls: Call[] = [PASS];
  const { lastBid } = summarize(auction);
  const floor = lastBid === null ? -1 : bidRank(lastBid.level, lastBid.strain);
  for (let rank = floor + 1; rank <= 34; rank++) {
    calls.push(bid(Math.floor(rank / 5) + 1, STRAINS[rank % 5]!));
  }
  if (isLegalCall(auction, DOUBLE)) calls.push(DOUBLE);
  if (isLegalCall(auction, REDOUBLE)) calls.push(REDOUBLE);
  return calls;
}

export function makeCall(auction: Auction, call: Call): Auction {
  if (!isLegalCall(auction, call)) {
    throw new Error(`illegal call ${callToString(call)} after "${callsToString(auction.calls)}"`);
  }
  return { dealer: auction.dealer, calls: [...auction.calls, call] };
}

export type Contract = {
  readonly level: number;
  readonly strain: Strain;
  readonly risk: Risk;
  readonly declarer: Seat;
};

/** Tricks the contract needs: book of six, plus the level. */
export function tricksRequired(contract: Contract): number {
  return contract.level + 6;
}

export function contractToString(contract: Contract): string {
  const suffix = contract.risk === 'doubled' ? 'X' : contract.risk === 'redoubled' ? 'XX' : '';
  return `${contract.level}${contract.strain}${suffix} by ${contract.declarer}`;
}

/**
 * The contract the auction settled on, or null if it was passed out or is
 * still running.
 *
 * Declarer is the member of the winning partnership who first named the final
 * strain — not necessarily the player who made the final bid. If East opens
 * 1H and West later bids 4H, East declares.
 */
export function contractOf(auction: Auction): Contract | null {
  if (!isAuctionComplete(auction) || isPassedOut(auction)) return null;
  const { lastBid, lastBidder, risk } = summarize(auction);
  if (lastBid === null || lastBidder === null) return null;

  const winningSide = sideOf(lastBidder);
  let declarer: Seat | null = null;
  for (let index = 0; index < auction.calls.length; index++) {
    const call = auction.calls[index]!;
    if (call.type !== 'bid' || call.strain !== lastBid.strain) continue;
    const seat = seatOfCall(auction, index);
    if (sideOf(seat) !== winningSide) continue;
    declarer = seat;
    break;
  }
  if (declarer === null) throw new Error('unreachable: winning side never named the final strain');

  return { level: lastBid.level, strain: lastBid.strain, risk, declarer };
}

/** The player on declarer's left, who makes the opening lead. */
export function openingLeader(contract: Contract): Seat {
  return nextSeat(contract.declarer);
}
