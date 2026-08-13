/**
 * Exhaustive walk over the auction tree.
 *
 * `legalCalls` and `isLegalCall` are two separate pieces of code that must agree
 * exactly — one generates, the other validates — and nothing so far had ever
 * compared them. If they drift, the bots offer moves the engine will reject, or
 * worse, the engine accepts a call the rules do not.
 *
 * Every node in the tree is also checked against an independently written
 * declarer rule, so the trickiest line in the engine is confirmed by a second
 * formulation rather than by itself.
 */

import { describe, it, expect } from 'vitest';
import {
  DOUBLE, PASS, REDOUBLE, STRAINS,
  bid, bidRank, callToString, callsToString, contractOf, isAuctionComplete,
  isLegalCall, isPassedOut, legalCalls, makeCall, newAuction, seatOfCall,
} from '../src/auction.js';
import type { Auction, Call, Strain } from '../src/auction.js';
import type { Seat } from '../src/seats.js';
import { SEATS, seatsOfSide, sideOf } from '../src/seats.js';

/** Every call that exists: 35 bids, pass, double, redouble. */
const ALL_CALLS: Call[] = [
  PASS, DOUBLE, REDOUBLE,
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((level) => STRAINS.map((strain) => bid(level, strain))),
];

/**
 * A restricted alphabet, so the tree can be walked exhaustively. It contains
 * every kind of call and at least one bid in all five strains — an earlier
 * version left out diamonds and spades and reached only three strains, which the
 * coverage assertions below now prevent. Keeping the bids at the one level makes
 * the ascending-bid rule prune the tree hard, so the walk stays quick.
 */
const ALPHABET: Call[] = [
  PASS, DOUBLE, REDOUBLE,
  bid(1, 'C'), bid(1, 'D'), bid(1, 'H'), bid(1, 'S'), bid(1, 'NT'),
  // 2H so a suit can be bid twice: without a repeatable strain, "declarer is
  // not the last bidder" could only ever arise through 1NT followed by 7NT.
  bid(2, 'H'), bid(7, 'NT'),
];

const MAX_DEPTH = 7;

/** Declarer, worked out per seat rather than by scanning the calls in order. */
function declarerByEarliestNaming(auction: Auction): Seat {
  const calls = auction.calls;
  const lastBidIndex = calls.map((c) => c.type).lastIndexOf('bid');
  const finalBid = calls[lastBidIndex]!;
  if (finalBid.type !== 'bid') throw new Error('no bid in this auction');
  const winners = seatsOfSide(sideOf(seatOfCall(auction, lastBidIndex)));

  const earliestNaming = (seat: Seat): number => {
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index]!;
      if (call.type === 'bid' && call.strain === finalBid.strain && seatOfCall(auction, index) === seat) {
        return index;
      }
    }
    return Number.POSITIVE_INFINITY;
  };

  const [first, second] = winners;
  return earliestNaming(first) <= earliestNaming(second) ? first : second;
}

type Stats = {
  nodes: number;
  complete: number;
  passedOut: number;
  contracts: number;
  doubled: number;
  redoubled: number;
  declarerIsNotLastBidder: number;
  strainsSeen: Set<Strain>;
  /** Every disagreement found, described well enough to debug from. */
  failures: string[];
};

/**
 * Failures are collected rather than asserted per node. A million `expect` calls
 * would cost more than the walk itself, and one assertion at the end fails just
 * as loudly.
 */
function walk(dealer: Seat, stats: Stats): void {
  const fail = (auction: Auction, message: string): void => {
    if (stats.failures.length < 20) {
      stats.failures.push(`${dealer} dealt, "${callsToString(auction.calls)}": ${message}`);
    }
  };

  const visit = (auction: Auction, depth: number): void => {
    stats.nodes++;

    // The two APIs must describe exactly the same set of calls.
    const generated = legalCalls(auction).map(callToString).sort();
    const validated = ALL_CALLS.filter((call) => isLegalCall(auction, call)).map(callToString).sort();
    if (generated.join(' ') !== validated.join(' ')) {
      fail(auction, `legalCalls gave [${generated}] but isLegalCall allows [${validated}]`);
    }

    if (isAuctionComplete(auction)) {
      stats.complete++;
      if (generated.length !== 0) fail(auction, 'a finished auction still offers calls');
      let refused = false;
      try { makeCall(auction, PASS); } catch { refused = true; }
      if (!refused) fail(auction, 'a finished auction accepted another pass');

      const contract = contractOf(auction);
      if (isPassedOut(auction)) {
        stats.passedOut++;
        if (contract !== null) fail(auction, 'a passed-out auction produced a contract');
        return;
      }

      if (contract === null) {
        fail(auction, 'a finished auction with a bid produced no contract');
        return;
      }
      stats.contracts++;
      stats.strainsSeen.add(contract.strain);
      if (contract.risk === 'doubled') stats.doubled++;
      if (contract.risk === 'redoubled') stats.redoubled++;

      // The independent formulation must agree.
      const alternative = declarerByEarliestNaming(auction);
      if (contract.declarer !== alternative) {
        fail(auction, `declarer ${contract.declarer} but earliest-naming says ${alternative}`);
      }

      const lastBidIndex = auction.calls.map((c) => c.type).lastIndexOf('bid');
      const lastBidder = seatOfCall(auction, lastBidIndex);
      if (sideOf(contract.declarer) !== sideOf(lastBidder)) {
        fail(auction, `declarer ${contract.declarer} is not on the side that bid last`);
      }
      if (contract.declarer !== lastBidder) stats.declarerIsNotLastBidder++;
      return;
    }

    // An unfinished auction must always offer something, and always a pass.
    if (!generated.includes('P')) fail(auction, 'an unfinished auction does not allow a pass');

    // The bids offered must be exactly those above the current highest.
    const highest = auction.calls.reduce(
      (rank, call) => (call.type === 'bid' ? Math.max(rank, bidRank(call.level, call.strain)) : rank),
      -1,
    );
    const bidsOffered = legalCalls(auction).filter((call) => call.type === 'bid').length;
    if (bidsOffered !== 34 - highest) {
      fail(auction, `offered ${bidsOffered} bids, expected ${34 - highest}`);
    }

    if (depth >= MAX_DEPTH) return;
    for (const call of ALPHABET) {
      if (!isLegalCall(auction, call)) continue;
      visit(makeCall(auction, call), depth + 1);
    }
  };

  visit(newAuction(dealer), 0);
}

describe('the auction tree, walked exhaustively', () => {
  const stats: Stats = {
    nodes: 0, complete: 0, passedOut: 0, contracts: 0, doubled: 0, redoubled: 0,
    declarerIsNotLastBidder: 0, strainsSeen: new Set(), failures: [],
  };

  it('agrees with itself at every node, from every dealer', () => {
    for (const dealer of SEATS) walk(dealer, stats);
    expect(stats.failures).toEqual([]);
    expect(stats.nodes).toBeGreaterThan(10_000);
    console.log('  auction nodes:', JSON.stringify({
      ...stats, strainsSeen: [...stats.strainsSeen],
    }));
  }, 120_000);

  it('reached every kind of ending', () => {
    expect(stats.complete).toBeGreaterThan(0);
    expect(stats.passedOut).toBe(4); // one per dealer
    expect(stats.contracts).toBeGreaterThan(0);
    expect(stats.doubled).toBeGreaterThan(0);
    expect(stats.redoubled).toBeGreaterThan(0);
  });

  it('reached a contract in all five strains', () => {
    // Otherwise the walk silently tests less than it appears to.
    expect([...stats.strainsSeen].sort()).toEqual(['C', 'D', 'H', 'NT', 'S']);
  });

  it('found auctions where declarer is not the player who bid last', () => {
    // The whole point of the declarer rule. If this is zero, the tree never
    // exercised it and the agreement above proved nothing interesting.
    expect(stats.declarerIsNotLastBidder).toBeGreaterThan(0);
  });
});

describe('bid ranking', () => {
  it('orders all 35 bids without a gap or a repeat', () => {
    const ranks = [1, 2, 3, 4, 5, 6, 7].flatMap((level) =>
      STRAINS.map((strain) => bidRank(level, strain)));
    expect(ranks).toHaveLength(35);
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 35 }, (_, i) => i));
  });

  it('ranks 1NT below 2C, and 7NT top', () => {
    expect(bidRank(1, 'NT')).toBeLessThan(bidRank(2, 'C'));
    expect(bidRank(7, 'NT')).toBe(34);
    expect(bidRank(1, 'C')).toBe(0);
  });
});

describe('call notation', () => {
  it('round-trips every call', () => {
    for (const call of ALL_CALLS) {
      expect(callsToString([call])).toBe(callToString(call));
    }
    expect(callToString(PASS)).toBe('P');
    expect(callToString(DOUBLE)).toBe('X');
    expect(callToString(REDOUBLE)).toBe('XX');
    expect(callToString(bid(3, 'NT'))).toBe('3NT');
  });

  it('refuses a level that does not exist', () => {
    expect(() => bid(0, 'C')).toThrow();
    expect(() => bid(8, 'C')).toThrow();
  });
});
