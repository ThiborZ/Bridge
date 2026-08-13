/**
 * The Acol rule table.
 *
 * Three kinds of test, and the last two matter more than the first:
 *
 *   Rows — a hand and an auction, and the call the system says to make. These
 *   are the spec, and the thing to show her: if she disagrees with a row, the
 *   row is what changes, not the code.
 *
 *   Legality and termination — thousands of auctions bid out by the rules, with
 *   every call checked. A bot that makes an illegal call breaks the game.
 *
 *   Coverage and quality — how often the table falls through, and whether the
 *   contracts it reaches are better than the random bidder's. "It bids legally"
 *   was already true of random.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Card, Suit } from '../src/cards.js';
import { RANK_CHARS, makeCard } from '../src/cards.js';
import type { Auction } from '../src/auction.js';
import {
  callToString, contractOf, isAuctionComplete, isLegalCall, isPassedOut,
  makeCall, newAuction, parseCalls, auctionTurn,
} from '../src/auction.js';
import { highCardPoints } from '../src/cards.js';
import { dealFromSeed } from '../src/game.js';
import { SEATS, sideOf } from '../src/seats.js';
import type { Seat } from '../src/seats.js';
import { currentPlayer, isPlayComplete, playCard, startPlay } from '../src/play.js';
import { scoreDeal } from '../src/score.js';
import { heuristicPlay } from '../src/bots/heuristic.js';
import { randomCall } from '../src/bots/random.js';
import { mulberry32 } from '../src/random.js';
import { clearGaps, decideCall, recordedGaps } from '../src/bidding/index.js';

/** A hand written the way a bridge book writes one: spades.hearts.diamonds.clubs */
function hand(text: string): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const parts = text.split('.');
  const cards: Card[] = [];
  parts.forEach((ranks, index) => {
    for (const character of ranks) {
      cards.push(makeCard(suits[index]!, RANK_CHARS.indexOf(character.toUpperCase()) + 2));
    }
  });
  if (cards.length !== 13) throw new Error(`${text} is ${cards.length} cards, not 13`);
  return cards;
}

function auctionAfter(dealer: Seat, calls: string): Auction {
  return parseCalls(calls).reduce(makeCall, newAuction(dealer));
}

const said = (auction: Auction, cards: Card[]) => callToString(decideCall(auction, cards, auctionTurn(auction), { recordGaps: false }).call);

describe('opening bids', () => {
  const opening = (cards: string) => said(newAuction('N'), hand(cards));

  it('opens a weak no-trump on twelve to fourteen balanced', () => {
    expect(opening('KQ32.AJ4.Q95.876')).toBe('1NT');
  });

  it('opens 2NT on twenty to twenty-two balanced', () => {
    expect(opening('AKQ2.AK4.KQ5.876')).toBe('2NT');
  });

  it('opens an artificial 2C on a huge hand', () => {
    expect(opening('AKQJ.AKQ.AKQ.876')).toBe('2C');
  });

  it('opens a four-card major — the Acol signature', () => {
    // Sixteen balanced, four spades and four hearts: too strong for the weak
    // no-trump, and with four-four in the majors Acol opens hearts.
    expect(opening('AK32.KQ54.A76.87')).toBe('1H');
  });

  it('opens the suit below the singleton on 4-4-4-1', () => {
    expect(opening('2.AK54.KQ76.AJ32')).toBe('1H');
  });

  it('preempts with a seven-card suit and little else', () => {
    expect(opening('KQJ8765.43.65.82')).toBe('3S');
  });

  it('passes a hand not worth opening', () => {
    expect(opening('K765.432.J92.643')).toBe('P');
  });
});

describe('responding to a weak no-trump', () => {
  const after1NT = (cards: string) => said(auctionAfter('N', '1NT P'), hand(cards));

  it('bids Stayman with eleven and a four-card major', () => {
    expect(after1NT('K32.AQ54.Q876.32')).toBe('2C');
  });

  it('raises straight to game with thirteen and no major', () => {
    expect(after1NT('KQ2.K32.AQ32.432')).toBe('3NT');
  });

  it('invites with eleven or twelve and no major', () => {
    expect(after1NT('KQ2.K32.Q432.J43')).toBe('2NT');
  });

  it('takes out into a long suit when weak — there are no transfers', () => {
    expect(after1NT('Q8765.432.J65.32')).toBe('2S');
  });
});

describe('answering Stayman', () => {
  const afterStayman = (cards: string) => said(auctionAfter('N', '1NT P 2C P'), hand(cards));

  it('shows four hearts', () => {
    expect(afterStayman('K32.AQ54.Q76.J43')).toBe('2H');
  });

  it('shows four spades when there are no hearts to show', () => {
    expect(afterStayman('KQ54.A32.Q76.J43')).toBe('2S');
  });

  it('denies a four-card major with 2D', () => {
    expect(afterStayman('K32.A54.KQ63.J43')).toBe('2D');
  });
});

describe('responding to a suit opening', () => {
  it('jump raises a major with support and ten to twelve', () => {
    expect(said(auctionAfter('N', '1H P'), hand('KQ2.KQ54.876.432'))).toBe('3H');
  });

  it('raises simply with support and six to nine', () => {
    expect(said(auctionAfter('N', '1S P'), hand('Q32.J43.K876.432'))).toBe('2S');
  });

  it('bids a new suit at the one level', () => {
    expect(said(auctionAfter('N', '1D P'), hand('KQJ2.543.876.432'))).toBe('1S');
  });

  it('passes a hand with nothing in it', () => {
    expect(said(auctionAfter('N', '1H P'), hand('432.543.8765.432'))).toBe('P');
  });
});

describe('competing', () => {
  it('overcalls 1NT on fifteen to eighteen balanced', () => {
    expect(said(auctionAfter('N', '1C'), hand('K432.AQ3.KQ5.J43'))).toBe('1NT');
  });

  it('doubles for takeout: opening values, short in their suit', () => {
    expect(said(auctionAfter('N', '1D'), hand('K432.AQ32.5.K432'))).toBe('X');
  });
});

describe('legality and termination', () => {
  it('bids out two thousand deals without an illegal call', () => {
    const failures: string[] = [];
    let calls = 0;
    let passedOut = 0;

    for (let n = 0; n < 2000; n++) {
      const deal = dealFromSeed(`bid-${n}`, SEATS[n % 4]!, 'None');
      let auction = newAuction(deal.dealer);
      let guard = 0;

      while (!isAuctionComplete(auction)) {
        if (guard++ > 80) { failures.push(`deal ${n}: auction would not end`); break; }
        const seat = auctionTurn(auction);
        const call = decideCall(auction, deal.hands[seat], seat, { recordGaps: false }).call;
        if (!isLegalCall(auction, call)) {
          failures.push(`deal ${n}: ${seat} called ${callToString(call)} illegally`);
          break;
        }
        auction = makeCall(auction, call);
        calls++;
      }
      if (isPassedOut(auction)) passedOut++;
    }

    expect(failures).toEqual([]);
    expect(calls).toBeGreaterThan(2000 * 4);
    // A quarter or so of deals having nobody with an opening bid is normal.
    console.log(`  passed out: ${((passedOut / 2000) * 100).toFixed(1)}% of deals`);
    expect(passedOut / 2000).toBeLessThan(0.35);
  }, 60_000);
});

describe('how often a hand opens', () => {
  /**
   * A number worth pinning down, because it is felt rather than noticed: bots
   * that open too freely make every deal a contested auction and pass-outs
   * vanish. Around a third of hands is right — the traditional figure is that
   * roughly one deal in ten is passed out.
   */
  it('opens a realistic share of hands', () => {
    const byRule = new Map<string, number>();
    const total = 20_000;

    for (let n = 0; n < total; n++) {
      const deal = dealFromSeed(`rate-${n}`, 'N', 'None');
      const decision = decideCall(newAuction('N'), deal.hands.N, 'N', { recordGaps: false });
      byRule.set(decision.ruleId, (byRule.get(decision.ruleId) ?? 0) + 1);
    }

    const passes = byRule.get('open-pass') ?? 0;
    const openRate = 1 - passes / total;
    console.log(`  opens ${(openRate * 100).toFixed(1)}% of hands:`);
    for (const [id, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${((count / total) * 100).toFixed(2).padStart(6)}%  ${id}`);
    }

    expect(openRate).toBeGreaterThan(0.26);
    expect(openRate).toBeLessThan(0.42);
  }, 60_000);
});

describe('coverage — the gaps are counted, not hidden', () => {
  beforeEach(clearGaps);

  it('reports how often no rule matches, and where', () => {
    const byRule = new Map<string, number>();
    let calls = 0;

    for (let n = 0; n < 1000; n++) {
      const deal = dealFromSeed(`coverage-${n}`, SEATS[n % 4]!, 'None');
      let auction = newAuction(deal.dealer);
      let guard = 0;
      while (!isAuctionComplete(auction) && guard++ < 80) {
        const seat = auctionTurn(auction);
        const decision = decideCall(auction, deal.hands[seat], seat);
        byRule.set(decision.ruleId, (byRule.get(decision.ruleId) ?? 0) + 1);
        auction = makeCall(auction, decision.call);
        calls++;
      }
    }

    const ranked = [...byRule.entries()].sort((a, b) => b[1] - a[1]);
    console.log('  rules used:');
    for (const [id, count] of ranked.slice(0, 12)) {
      console.log(`    ${((count / calls) * 100).toFixed(1).padStart(5)}%  ${id}`);
    }

    const fallback = (byRule.get('fallback') ?? 0) / calls;
    const later = (byRule.get('later-pass') ?? 0) / calls;
    console.log(`  unmatched: ${(fallback * 100).toFixed(2)}%   past the system: ${(later * 100).toFixed(1)}%`);

    // Where the gaps actually are, so they can be closed on purpose rather than
    // guessed at. This is the list to work from when extending the table.
    const bySituation = new Map<string, number>();
    for (const gap of recordedGaps()) {
      bySituation.set(gap.situation, (bySituation.get(gap.situation) ?? 0) + 1);
    }
    console.log(`  ${recordedGaps().length} unmatched auctions, by situation:`);
    for (const [situation, count] of [...bySituation.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)}  ${situation}`);
    }
    for (const gap of recordedGaps().slice(0, 4)) {
      console.log(`      e.g. ${gap.situation} on "${gap.auction}" with ${gap.hcp} points`);
    }

    // Nothing in a situation the system claims to cover should fall through.
    // This was 1.8% — all of it responding after an overcall — until that branch
    // was written. Raising this threshold to make a run pass would be the wrong
    // fix; the gap list above says exactly what to write instead.
    expect(fallback).toBeLessThan(0.002);
  }, 60_000);
});

/**
 * The end-to-end question: do the contracts it reaches score better? Same deals,
 * same card play on both sides, only the bidding differs.
 */
describe('quality — better contracts than bidding at random', () => {
  function bidOut(dealer: Seat, hands: Record<Seat, readonly Card[]>, useRules: boolean, seed: number) {
    const rng = mulberry32(seed);
    let auction = newAuction(dealer);
    let guard = 0;
    while (!isAuctionComplete(auction) && guard++ < 80) {
      const seat = auctionTurn(auction);
      const call = useRules
        ? decideCall(auction, hands[seat], seat, { recordGaps: false }).call
        : randomCall(auction, rng);
      if (!isLegalCall(auction, call)) break;
      auction = makeCall(auction, call);
    }
    return auction;
  }

  function scoreFor(dealer: Seat, hands: Record<Seat, readonly Card[]>, useRules: boolean, seed: number) {
    const auction = bidOut(dealer, hands, useRules, seed);
    const deal = contractOf(auction);
    if (deal === null) return { declarerScore: 0, level: 0, made: null as boolean | null };

    let state = startPlay(deal, hands);
    while (!isPlayComplete(state)) {
      state = playCard(state, heuristicPlay(state, currentPlayer(state)));
    }
    const tricks = state.tricksWon[sideOf(deal.declarer)];
    const breakdown = scoreDeal(deal, tricks, 'None');
    // The declaring side's own score. Totalling North-South instead would only
    // measure which side happened to end up declaring, since both sides use the
    // same bidder in a given run — it looks like a comparison and is not one.
    return { declarerScore: breakdown.score, level: deal.level, made: breakdown.made };
  }

  it('reaches contracts that make more often, and scores better for the side that bids them', () => {
    let rulesScore = 0;
    let randomScore = 0;
    let rulesMade = 0;
    let randomMade = 0;
    let rulesContracts = 0;
    let randomContracts = 0;

    for (let n = 0; n < 300; n++) {
      const dealer = SEATS[n % 4]!;
      const { hands } = dealFromSeed(`quality-${n}`, dealer, 'None');

      const withRules = scoreFor(dealer, hands, true, 9000 + n);
      const withRandom = scoreFor(dealer, hands, false, 9000 + n);

      rulesScore += withRules.declarerScore;
      randomScore += withRandom.declarerScore;
      if (withRules.made !== null) { rulesContracts++; if (withRules.made) rulesMade++; }
      if (withRandom.made !== null) { randomContracts++; if (withRandom.made) randomMade++; }
    }

    const rulesRate = rulesMade / Math.max(1, rulesContracts);
    const randomRate = randomMade / Math.max(1, randomContracts);
    console.log(`  contracts made:      rules ${(rulesRate * 100).toFixed(0)}%  random ${(randomRate * 100).toFixed(0)}%`);
    console.log(`  declarer avg score:  rules ${(rulesScore / Math.max(1, rulesContracts)).toFixed(0)}  random ${(randomScore / Math.max(1, randomContracts)).toFixed(0)}`);

    // The point of a bidding system is landing in contracts you can make, and
    // being paid rather than penalised for the ones you bid.
    expect(rulesRate).toBeGreaterThan(randomRate + 0.15);
    expect(rulesScore / Math.max(1, rulesContracts)).toBeGreaterThan(randomScore / Math.max(1, randomContracts));
  }, 120_000);
});

describe('the meanings are usable', () => {
  it('gives every call an explanation she could read', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 300; n++) {
      const deal = dealFromSeed(`meaning-${n}`, 'N', 'None');
      let auction = newAuction('N');
      let guard = 0;
      while (!isAuctionComplete(auction) && guard++ < 80) {
        const seat = auctionTurn(auction);
        const decision = decideCall(auction, deal.hands[seat], seat, { recordGaps: false });
        expect(decision.meaning.length).toBeGreaterThan(3);
        seen.add(decision.ruleId);
        auction = makeCall(auction, decision.call);
      }
    }
    // A system where only a handful of rules ever fire is not a system.
    console.log(`  distinct rules exercised: ${seen.size}`);
    expect(seen.size).toBeGreaterThan(12);
  }, 30_000);
});

describe('hand evaluation sanity', () => {
  it('counts the pack as forty points', () => {
    const deal = dealFromSeed('points', 'N', 'None');
    const total = SEATS.reduce((sum, seat) => sum + highCardPoints(deal.hands[seat]), 0);
    expect(total).toBe(40);
  });

  it('never lets a bot see another hand', () => {
    // The context is built from one hand; passing a different hand must change
    // the decision, and passing the same one must not depend on the deal.
    const auction = auctionAfter('N', '');
    const strong = hand('AKQJ.AKQ.AKQ.876');
    const weak = hand('K765.432.J92.643');
    expect(said(auction, strong)).not.toBe(said(auction, weak));
    expect(said(auction, strong)).toBe(said(auction, [...strong]));
  });

  it('a weaker tier passes where a stronger one acts, and never bids differently by noise', () => {
    // Kitchen table does not know preempts, so it passes a hand Club night opens.
    const preempt = hand('KQJ8765.43.65.82');
    const auction = newAuction('N');
    const kitchen = decideCall(auction, preempt, 'N', { tier: 'kitchen', recordGaps: false });
    const club = decideCall(auction, preempt, 'N', { tier: 'club', recordGaps: false });
    expect(callToString(club.call)).toBe('3S');
    expect(callToString(kitchen.call)).toBe('P');
  });
});
