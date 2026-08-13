/**
 * What a bidder knows: its own thirteen cards and the calls made so far.
 *
 * Rules match on the facts here rather than picking through the raw call list,
 * which is what keeps the rule table readable. Nothing in this file can see
 * another player's cards, and nothing should ever be added that can.
 */

import type { Card, Suit } from '../cards.js';
import type { Auction, Call, Strain } from '../auction.js';
import { auctionTurn, bidRank, seatOfCall } from '../auction.js';
import type { Seat } from '../seats.js';
import { partnerOf, sideOf } from '../seats.js';
import { balanced, hcp, lengths, playingTricks, totalPoints } from './evaluate.js';
import type { SuitLengths } from './evaluate.js';

export type Bid = { readonly level: number; readonly strain: Strain };

/** Where in the conversation this call falls. Rules are grouped by it. */
export type Situation =
  | 'opening'      // nobody has bid yet
  | 'overcall'     // they have opened, we have not bid
  | 'response'     // partner opened, our first reply
  | 'rebid'        // we opened, partner has replied
  | 'advance'      // partner overcalled, our first reply
  | 'later';       // anything further along

export type Context = {
  readonly hand: readonly Card[];
  readonly seat: Seat;
  readonly auction: Auction;

  readonly hcp: number;
  readonly points: number;
  readonly tricks: number;
  readonly balanced: boolean;
  readonly suits: SuitLengths;

  readonly situation: Situation;
  /** Partner's opening bid, when partner opened. */
  readonly partnerOpening: Bid | null;
  /** Our own opening bid, when we opened. */
  readonly ourOpening: Bid | null;
  /** Partner's reply to our opening. */
  readonly partnerResponse: Call | null;
  /** Partner's most recent bid, whoever opened — what an overcall leaves us. */
  readonly partnerLastBid: Bid | null;
  /** Highest bid so far by anybody. */
  readonly highestBid: Bid | null;
  /** The suit the opponents have bid most recently, for takeout doubles. */
  readonly theirSuit: Suit | null;
  readonly contested: boolean;
};

type Made = { seat: Seat; call: Call; index: number };

function history(auction: Auction): Made[] {
  return auction.calls.map((call, index) => ({ call, index, seat: seatOfCall(auction, index) }));
}

export function contextFor(auction: Auction, hand: readonly Card[], seat: Seat = auctionTurn(auction)): Context {
  const made = history(auction);
  const partner = partnerOf(seat);
  const ours = made.filter((entry) => sideOf(entry.seat) === sideOf(seat));
  const theirs = made.filter((entry) => sideOf(entry.seat) !== sideOf(seat));

  const bidsByMe = made.filter((entry) => entry.seat === seat && entry.call.type === 'bid');
  const bidsByPartner = made.filter((entry) => entry.seat === partner && entry.call.type === 'bid');
  const ourBids = ours.filter((entry) => entry.call.type === 'bid');
  const theirBids = theirs.filter((entry) => entry.call.type === 'bid');

  const asBid = (entry: Made | undefined): Bid | null =>
    entry && entry.call.type === 'bid' ? { level: entry.call.level, strain: entry.call.strain } : null;

  const ourFirst = ourBids[0];
  const weOpened = ourFirst !== undefined && (theirBids.length === 0 || ourFirst.index < theirBids[0]!.index);

  let situation: Situation;
  if (made.every((entry) => entry.call.type !== 'bid')) {
    situation = 'opening';
  } else if (ourBids.length === 0) {
    situation = 'overcall';
  } else if (bidsByMe.length === 0 && bidsByPartner.length > 0) {
    situation = weOpened ? 'response' : 'advance';
  } else if (bidsByMe.length === 1 && ourFirst?.seat === seat && weOpened) {
    situation = 'rebid';
  } else {
    situation = 'later';
  }

  const allBids = made.filter((entry) => entry.call.type === 'bid');
  const highest = allBids.reduce<Made | undefined>((best, entry) => {
    if (!best) return entry;
    const a = entry.call as { level: number; strain: Strain };
    const b = best.call as { level: number; strain: Strain };
    return bidRank(a.level, a.strain) > bidRank(b.level, b.strain) ? entry : best;
  }, undefined);

  const lastTheirBid = theirBids[theirBids.length - 1];
  const theirStrain = lastTheirBid && lastTheirBid.call.type === 'bid' ? lastTheirBid.call.strain : null;

  const partnerReply = made.find(
    (entry) => entry.seat === partner && ourFirst !== undefined && entry.index > ourFirst.index,
  );

  return {
    hand,
    seat,
    auction,
    hcp: hcp(hand),
    points: totalPoints(hand),
    tricks: playingTricks(hand),
    balanced: balanced(hand),
    suits: lengths(hand),
    situation,
    partnerOpening: weOpened && ourFirst?.seat === partner ? asBid(ourFirst) : null,
    ourOpening: weOpened && ourFirst?.seat === seat ? asBid(ourFirst) : null,
    partnerResponse: partnerReply?.call ?? null,
    partnerLastBid: asBid(bidsByPartner[bidsByPartner.length - 1]),
    highestBid: asBid(highest),
    theirSuit: theirStrain === 'NT' || theirStrain === null ? null : theirStrain,
    contested: theirBids.length > 0,
  };
}
