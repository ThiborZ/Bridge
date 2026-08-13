/**
 * Applying the rule table.
 *
 * Three things this guarantees, and they are the three the plan made
 * non-negotiable:
 *
 *   It never returns an illegal call. Every rule's suggestion is checked, and a
 *   rule that produces something illegal is skipped rather than trusted — which
 *   means a bad rule degrades the bidding instead of crashing the game.
 *
 *   An auction no rule matches passes, and says so. `ruleId` is `'fallback'` and
 *   the situation is recorded, so the gaps in the system are countable instead
 *   of invisible. See the coverage test.
 *
 *   A weaker bot is weak by omission. It is handed fewer rules and therefore
 *   passes where a stronger one acts; it is never given noise.
 */

import type { Card } from '../cards.js';
import type { Auction, Call } from '../auction.js';
import { PASS, callToString, isLegalCall } from '../auction.js';
import type { Seat } from '../seats.js';
import { auctionTurn } from '../auction.js';
import { contextFor } from './context.js';
import type { Context, Situation } from './context.js';
import { rulesFor } from './acol.js';
import type { Tier } from './acol.js';

export type Decision = {
  readonly call: Call;
  /** The rule that chose it, or 'fallback' when nothing matched. */
  readonly ruleId: string;
  /** What the bid shows, in words she can read. */
  readonly meaning: string;
  readonly situation: Situation;
};

export type Gap = {
  readonly situation: Situation;
  readonly auction: string;
  readonly hcp: number;
};

/**
 * Auctions that fell through to Pass. Kept in memory for a session so a play
 * session can be reviewed afterwards; the tests assert on it directly.
 */
const gaps: Gap[] = [];

export function recordedGaps(): readonly Gap[] {
  return gaps;
}

export function clearGaps(): void {
  gaps.length = 0;
}

export type ChooseOptions = {
  readonly tier?: Tier;
  /** Off in tests that only care about the call. */
  readonly recordGaps?: boolean;
};

export function decideCall(
  auction: Auction,
  hand: readonly Card[],
  seat: Seat = auctionTurn(auction),
  options: ChooseOptions = {},
): Decision {
  const { tier = 'tournament', recordGaps = true } = options;
  const context: Context = contextFor(auction, hand, seat);

  for (const rule of rulesFor(tier)) {
    if (rule.situation !== context.situation) continue;
    let matches = false;
    try {
      matches = rule.when(context);
    } catch {
      continue; // a rule that throws is a broken rule, not a broken auction
    }
    if (!matches) continue;

    const call = rule.call(context);
    // A rule may want a bid the auction has already passed — the hand is worth
    // 2H but somebody has bid 4S. Skipping is right: the next rule down, and
    // ultimately Pass, is a better answer than an illegal call.
    if (call === null || !isLegalCall(auction, call)) continue;

    return { call, ruleId: rule.id, meaning: rule.meaning, situation: context.situation };
  }

  if (recordGaps && context.situation !== 'later') {
    gaps.push({
      situation: context.situation,
      auction: auction.calls.map(callToString).join(' ') || '(none)',
      hcp: context.hcp,
    });
  }

  return {
    call: PASS,
    ruleId: 'fallback',
    meaning: 'Nothing to say.',
    situation: context.situation,
  };
}

/** The call alone, for callers that do not need the explanation. */
export function acolCall(
  auction: Auction,
  hand: readonly Card[],
  seat: Seat = auctionTurn(auction),
  options: ChooseOptions = {},
): Call {
  return decideCall(auction, hand, seat, options).call;
}

export type { Tier } from './acol.js';
export { ACOL, rulesFor } from './acol.js';
