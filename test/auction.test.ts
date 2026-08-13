import { describe, it, expect } from 'vitest';
import {
  DOUBLE, PASS, REDOUBLE,
  auctionTurn, bid, contractOf, isAuctionComplete, isLegalCall, isPassedOut,
  legalCalls, makeCall, newAuction, openingLeader, parseCalls, tricksRequired,
} from '../src/auction.js';
import type { Auction, Call } from '../src/auction.js';
import type { Seat } from '../src/seats.js';

/** Build an auction from shorthand: "1H P 4H P P P". */
function auctionOf(dealer: Seat, calls: string): Auction {
  return parseCalls(calls).reduce<Auction>(makeCall, newAuction(dealer));
}

describe('turn order', () => {
  it('starts with the dealer and goes clockwise', () => {
    let auction = newAuction('E');
    expect(auctionTurn(auction)).toBe('E');
    auction = makeCall(auction, PASS);
    expect(auctionTurn(auction)).toBe('S');
    auction = makeCall(auction, PASS);
    expect(auctionTurn(auction)).toBe('W');
    auction = makeCall(auction, PASS);
    expect(auctionTurn(auction)).toBe('N');
  });
});

describe('bids must ascend', () => {
  it('ranks strains C < D < H < S < NT at the same level', () => {
    const auction = auctionOf('N', '1H');
    expect(isLegalCall(auction, bid(1, 'S'))).toBe(true);
    expect(isLegalCall(auction, bid(1, 'NT'))).toBe(true);
    expect(isLegalCall(auction, bid(1, 'D'))).toBe(false);
    expect(isLegalCall(auction, bid(1, 'H'))).toBe(false);
    expect(isLegalCall(auction, bid(2, 'C'))).toBe(true);
  });

  it('offers every higher bid, plus pass', () => {
    const auction = auctionOf('N', '7S');
    expect(legalCalls(auction).map((c) => c.type)).toEqual(['pass', 'bid', 'double']);
    expect(legalCalls(auction)[1]).toEqual(bid(7, 'NT'));
  });

  it('offers all 35 bids on an opening call', () => {
    const opening = legalCalls(newAuction('N'));
    expect(opening.filter((c) => c.type === 'bid')).toHaveLength(35);
    expect(opening.filter((c) => c.type !== 'bid')).toEqual([PASS]);
  });
});

describe('doubles', () => {
  it('can double an opponent', () => {
    expect(isLegalCall(auctionOf('N', '1H'), DOUBLE)).toBe(true);
  });

  it('cannot double partner', () => {
    // N bid, E passed, so it is S's turn — S may not double their own partner.
    expect(isLegalCall(auctionOf('N', '1H P'), DOUBLE)).toBe(false);
  });

  it('cannot double a contract that is already doubled', () => {
    expect(isLegalCall(auctionOf('N', '1H X P'), DOUBLE)).toBe(false);
  });

  it('can redouble a double of our own side, but the opponents cannot', () => {
    expect(isLegalCall(auctionOf('N', '1H X'), REDOUBLE)).toBe(true); // S, partner of the bidder
    expect(isLegalCall(auctionOf('N', '1H X P'), REDOUBLE)).toBe(false); // W, the doubling side
  });

  it('cannot redouble when nobody has doubled', () => {
    expect(isLegalCall(auctionOf('N', '1H'), REDOUBLE)).toBe(false);
  });

  it('wipes the double when someone bids again', () => {
    const auction = auctionOf('N', '1H X 2H');
    expect(contractOf(auctionOf('N', '1H X 2H P P P'))!.risk).toBe('none');
    expect(isLegalCall(auction, DOUBLE)).toBe(true); // W may double the new bid
    expect(isLegalCall(auction, REDOUBLE)).toBe(false);
  });
});

describe('when the auction ends', () => {
  it('is not over after three calls', () => {
    expect(isAuctionComplete(auctionOf('N', '1C P P'))).toBe(false);
  });

  it('ends on three passes after a bid', () => {
    expect(isAuctionComplete(auctionOf('N', '1C P P P'))).toBe(true);
  });

  it('does not end on three passes before any bid', () => {
    const auction = auctionOf('N', 'P P P');
    expect(isAuctionComplete(auction)).toBe(false);
    expect(isAuctionComplete(makeCall(auction, bid(1, 'C')))).toBe(false);
  });

  it('is passed out on four passes', () => {
    const auction = auctionOf('N', 'P P P P');
    expect(isAuctionComplete(auction)).toBe(true);
    expect(isPassedOut(auction)).toBe(true);
    expect(contractOf(auction)).toBeNull();
  });

  it('accepts no further calls once it is over', () => {
    const auction = auctionOf('N', '1C P P P');
    expect(legalCalls(auction)).toEqual([]);
    expect(() => makeCall(auction, PASS)).toThrow(/illegal/);
  });
});

describe('declarer is whoever named the strain first', () => {
  it('is the last bidder when only they bid it', () => {
    const contract = contractOf(auctionOf('N', 'P 1H P P P'))!;
    expect(contract).toMatchObject({ level: 1, strain: 'H', declarer: 'E', risk: 'none' });
  });

  it('is opener, not the partner who raised — the classic mistake', () => {
    // E opens 1H, W raises to 4H. The final bid is West's, but East declares.
    const contract = contractOf(auctionOf('N', 'P 1H P 4H P P P'))!;
    expect(contract.declarer).toBe('E');
    expect(contract.level).toBe(4);
  });

  it('ignores the same strain bid by the losing side', () => {
    // N bids hearts first, but East-West win the auction in hearts.
    const contract = contractOf(auctionOf('N', '1H 2H P P P'))!;
    expect(contract.declarer).toBe('E');
  });

  it('picks the first naming even across a contested auction', () => {
    // N 1S, E 2H, S 2S, W 3H, N 3S: North named spades first, so North declares.
    const contract = contractOf(auctionOf('N', '1S 2H 2S 3H 3S P P P'))!;
    expect(contract).toMatchObject({ strain: 'S', declarer: 'N', level: 3 });
  });

  it('tracks the strain, not the level', () => {
    // S opens 1C, N bids 3NT: South named no-trumps second, so North declares.
    const contract = contractOf(auctionOf('S', '1C P 3NT P P P'))!;
    expect(contract).toMatchObject({ strain: 'NT', declarer: 'N' });
  });

  it('carries the doubling through', () => {
    expect(contractOf(auctionOf('N', '1NT X P P P'))!.risk).toBe('doubled');
    expect(contractOf(auctionOf('N', '1NT X XX P P P'))!.risk).toBe('redoubled');
  });
});

describe('opening lead and book', () => {
  it('is led by the player on declarer\'s left', () => {
    const contract = contractOf(auctionOf('N', '1H P P P'))!;
    expect(contract.declarer).toBe('N');
    expect(openingLeader(contract)).toBe('E');
  });

  it('needs six plus the level', () => {
    expect(tricksRequired({ level: 4, strain: 'H', risk: 'none', declarer: 'N' })).toBe(10);
    expect(tricksRequired({ level: 7, strain: 'NT', risk: 'none', declarer: 'N' })).toBe(13);
  });
});

describe('makeCall refuses illegal calls', () => {
  const illegal: Array<[string, Call]> = [
    ['1H', bid(1, 'D')],
    ['1H P', DOUBLE],
    ['1H', REDOUBLE],
    ['1H X P', DOUBLE],
  ];
  it.each(illegal)('rejects %s then %o', (history, call) => {
    expect(() => makeCall(auctionOf('N', history), call)).toThrow(/illegal/);
  });
});
