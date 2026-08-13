/**
 * The phase-1 milestone: play thousands of deals with bots that call and play at
 * random, and check independently that no rule was ever broken.
 *
 * "Independently" is the point. These assertions re-derive the trick winner, the
 * follow-suit obligation and the card count from the deal itself rather than
 * asking the engine whether it thinks it behaved — otherwise a bug in the engine
 * would simply agree with itself.
 */

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/random.js';
import { mulberry32 } from '../src/random.js';
import type { Card } from '../src/cards.js';
import { rankOf, suitOf } from '../src/cards.js';
import type { Seat } from '../src/seats.js';
import { SEATS, chicagoDealer, chicagoVulnerability, nextSeat, sideOf } from '../src/seats.js';
import {
  DOUBLE, PASS, REDOUBLE, STRAINS,
  bid, callToString, contractOf, isLegalCall, legalCalls, seatOfCall, tricksRequired,
} from '../src/auction.js';
import type { Call } from '../src/auction.js';
import type { Game } from '../src/game.js';
import { applyCall, applyPlay, dealFromSeed, newGame, resultOf } from '../src/game.js';
import { currentPlayer, isLegalPlay, legalPlays } from '../src/play.js';
import { randomCall, randomPlay } from '../src/bots/random.js';

/** Every call there is, for checking the generator against the validator. */
const ALL_CALLS: Call[] = [
  PASS, DOUBLE, REDOUBLE,
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((level) => STRAINS.map((strain) => bid(level, strain))),
];

const DEAL_COUNT = Number(process.env.FUZZ_DEALS ?? 10_000);

function playDealOut(game: Game, rng: Rng): Game {
  let steps = 0;
  while (game.phase === 'auction') {
    if (++steps > 500) throw new Error('the auction never ended');
    game = applyCall(game, randomCall(game.auction, rng));
  }
  while (game.phase === 'play') {
    if (++steps > 1000) throw new Error('the play never ended');
    game = applyPlay(game, randomPlay(game.play!, rng));
  }
  return game;
}

/** Worked out here rather than imported, so the engine cannot mark its own homework. */
function winnerOfTrick(leader: Seat, cards: readonly Card[], trump: string | null): Seat {
  const led = suitOf(cards[0]!);
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    const card = cards[i]!;
    const bestCard = cards[best]!;
    const cardIsTrump = suitOf(card) === trump;
    const bestIsTrump = suitOf(bestCard) === trump;
    if (cardIsTrump && !bestIsTrump) best = i;
    else if (cardIsTrump === bestIsTrump && suitOf(card) === suitOf(bestCard)
      && suitOf(card) === (bestIsTrump ? trump : led) && rankOf(card) > rankOf(bestCard)) best = i;
  }
  return nextSeat(leader, best);
}

describe(`${DEAL_COUNT.toLocaleString('en-GB')} random deals`, () => {
  it('never breaks a rule', () => {
    const tally = {
      passedOut: 0, made: 0, wentDown: 0, doubled: 0, redoubled: 0,
      partScores: 0, slams: 0, declaredByNS: 0, declaredByEW: 0, notrumps: 0,
      levels: new Set<number>(), strains: new Set<string>(), maxCalls: 0,
    };

    for (let n = 1; n <= DEAL_COUNT; n++) {
      const rng = mulberry32(n * 2654435761);
      const deal = dealFromSeed(`fuzz-${n}`, chicagoDealer(n), chicagoVulnerability(n));

      // The deal itself must be a partition of the pack.
      const dealt = SEATS.flatMap((seat) => [...deal.hands[seat]]);
      expect(dealt).toHaveLength(52);
      expect(new Set(dealt).size).toBe(52);
      for (const seat of SEATS) expect(deal.hands[seat]).toHaveLength(13);

      const game = playDealOut(newGame(deal), rng);
      const result = resultOf(game)!;
      tally.maxCalls = Math.max(tally.maxCalls, game.auction.calls.length);

      // The auction must have ended the only two ways it can.
      const calls = game.auction.calls;
      const passedOut = calls.length === 4 && calls.every((c) => c.type === 'pass');
      expect(passedOut || calls.slice(-3).every((c) => c.type === 'pass')).toBe(true);

      if (result.contract === null) {
        tally.passedOut++;
        expect(game.play).toBeNull();
        expect(result.northSouthScore).toBe(0);
        continue;
      }

      const contract = result.contract;

      // Declarer is on the side that made the final bid, and did name that strain.
      const lastBidIndex = calls.map((c) => c.type).lastIndexOf('bid');
      const lastBidder = seatOfCall(game.auction, lastBidIndex);
      expect(sideOf(contract.declarer)).toBe(sideOf(lastBidder));
      const declarerNamedIt = calls.some((call, index) =>
        call.type === 'bid' && call.strain === contract.strain
        && seatOfCall(game.auction, index) === contract.declarer);
      expect(declarerNamedIt).toBe(true);

      // Thirteen tricks, four cards each, every card played exactly once.
      const play = game.play!;
      expect(play.completed).toHaveLength(13);
      const played = play.completed.flatMap((t) => [...t.cards]);
      expect(played).toHaveLength(52);
      expect(new Set(played).size).toBe(52);
      for (const seat of SEATS) expect(play.hands[seat]).toHaveLength(0);

      // Replay the tricks against the original hands: every card was held, every
      // off-suit card came from a genuine void, and each trick was led by the
      // player who won the one before.
      const remaining: Record<Seat, Set<Card>> = {
        N: new Set(deal.hands.N), E: new Set(deal.hands.E),
        S: new Set(deal.hands.S), W: new Set(deal.hands.W),
      };
      const trump = contract.strain === 'NT' ? null : contract.strain;
      let expectedLeader: Seat = nextSeat(contract.declarer);
      const won = { NS: 0, EW: 0 };

      for (const trick of play.completed) {
        expect(trick.leader).toBe(expectedLeader);
        expect(trick.cards).toHaveLength(4);
        const led = suitOf(trick.cards[0]!);
        trick.cards.forEach((card, offset) => {
          const seat = nextSeat(trick.leader, offset);
          expect(remaining[seat].has(card)).toBe(true);
          if (suitOf(card) !== led) {
            const couldHaveFollowed = [...remaining[seat]].some((c) => suitOf(c) === led);
            expect(couldHaveFollowed).toBe(false);
          }
          remaining[seat].delete(card);
        });
        expectedLeader = winnerOfTrick(trick.leader, trick.cards, trump);
        won[sideOf(expectedLeader)]++;
      }

      expect(won).toEqual(play.tricksWon);
      expect(won.NS + won.EW).toBe(13);
      expect(result.tricksWon).toBe(won[sideOf(contract.declarer)]);

      // The score must be a whole number, and its sign must match the result.
      const madeIt = result.tricksWon >= tricksRequired(contract);
      expect(Number.isInteger(result.breakdown!.score)).toBe(true);
      expect(result.breakdown!.made).toBe(madeIt);
      expect(Math.sign(result.breakdown!.score)).toBe(madeIt ? 1 : -1);

      if (madeIt) tally.made++; else tally.wentDown++;
      if (contract.risk === 'doubled') tally.doubled++;
      if (contract.risk === 'redoubled') tally.redoubled++;
      if (contract.level <= 2) tally.partScores++;
      if (contract.level >= 6) tally.slams++;
      if (contract.strain === 'NT') tally.notrumps++;
      if (sideOf(contract.declarer) === 'NS') tally.declaredByNS++; else tally.declaredByEW++;
      tally.levels.add(contract.level);
      tally.strains.add(contract.strain);
    }

    // Everything the engine can do must actually have happened.
    expect(tally.passedOut).toBeGreaterThan(0);
    expect(tally.doubled).toBeGreaterThan(0);
    expect(tally.redoubled).toBeGreaterThan(0);
    expect(tally.slams).toBeGreaterThan(0);
    expect(tally.declaredByNS).toBeGreaterThan(0);
    expect(tally.declaredByEW).toBeGreaterThan(0);
    expect([...tally.levels].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([...tally.strains].sort()).toEqual(['C', 'D', 'H', 'NT', 'S']);

    // And no single corner of the engine may dominate the run. Without this the
    // harness passes while testing almost nothing but grand slams going down,
    // which is exactly what it did before the bot's call weighting was fixed.
    const played = DEAL_COUNT - tally.passedOut;
    expect(tally.slams / played).toBeLessThan(0.25);
    expect(tally.partScores / played).toBeGreaterThan(0.1);
    expect(tally.made / played).toBeGreaterThan(0.1);
    expect(tally.wentDown / played).toBeGreaterThan(0.1);

    console.log('  deals:', DEAL_COUNT, JSON.stringify({
      ...tally,
      levels: [...tally.levels].sort((a, b) => a - b),
      strains: [...tally.strains],
    }));
  }, 180_000);

  /**
   * The wide run above checks the finished deal. This one checks every single
   * step of a smaller sample, including that `legalPlays` and `isLegalPlay` —
   * two separate pieces of code, one generating and one validating — describe
   * exactly the same set of cards at every point in every trick.
   */
  it('holds its invariants at every step, not just at the end', () => {
    const DEEP = 400;
    const failures: string[] = [];
    const note = (message: string) => { if (failures.length < 20) failures.push(message); };

    for (let n = 1; n <= DEEP; n++) {
      const rng = mulberry32(n * 40503);
      const deal = dealFromSeed(`deep-${n}`, chicagoDealer(n), chicagoVulnerability(n));
      let game = newGame(deal);

      while (game.phase === 'auction') {
        const auction = game.auction;
        const offered = legalCalls(auction);
        const validated = ALL_CALLS.filter((call) => isLegalCall(auction, call));
        if (offered.length !== validated.length) {
          note(`deal ${n}: legalCalls gave ${offered.length}, isLegalCall allows ${validated.length}`);
        }
        const chosen = randomCall(auction, rng);
        if (!offered.some((call) => callToString(call) === callToString(chosen))) {
          note(`deal ${n}: the bot chose ${callToString(chosen)}, which was not offered`);
        }
        game = applyCall(game, chosen);
      }

      let cardsPlayed = 0;
      while (game.phase === 'play') {
        const play = game.play!;
        const seat = currentPlayer(play);

        // Position in the trick must match whose turn it is.
        if (seat !== nextSeat(play.current.leader, play.current.cards.length)) {
          note(`deal ${n}: ${seat} is on lead out of turn`);
        }

        // The two play APIs must agree, exactly.
        const offered = legalPlays(play).slice().sort((a, b) => a - b);
        const validated = play.hands[seat].filter((card) => isLegalPlay(play, card, seat))
          .slice().sort((a, b) => a - b);
        if (offered.join(',') !== validated.join(',')) {
          note(`deal ${n}: legalPlays [${offered}] but isLegalPlay allows [${validated}]`);
        }
        if (offered.length === 0) note(`deal ${n}: ${seat} has no legal card`);

        // Cards must be conserved, and tricks counted as they complete.
        const held = SEATS.reduce((total, s) => total + play.hands[s].length, 0);
        if (held !== 52 - cardsPlayed) {
          note(`deal ${n}: ${held} cards held after ${cardsPlayed} played`);
        }
        if (play.tricksWon.NS + play.tricksWon.EW !== play.completed.length) {
          note(`deal ${n}: trick count disagrees with completed tricks`);
        }

        game = applyPlay(game, randomPlay(play, rng));
        cardsPlayed++;
      }

      if (game.play !== null && cardsPlayed !== 52) {
        note(`deal ${n}: play ended after ${cardsPlayed} cards`);
      }
    }

    expect(failures).toEqual([]);
  }, 60_000);

  it('deals the same cards for the same id', () => {
    const a = dealFromSeed('repeatable', 'N', 'None');
    const b = dealFromSeed('repeatable', 'N', 'None');
    expect(a.hands).toEqual(b.hands);
    expect(dealFromSeed('other', 'N', 'None').hands).not.toEqual(a.hands);
  });

  it('has no contract while the auction is still running', () => {
    expect(contractOf({ dealer: 'N', calls: [] })).toBeNull();
    expect(contractOf({ dealer: 'N', calls: [{ type: 'bid', level: 1, strain: 'H' }] })).toBeNull();
  });
});
