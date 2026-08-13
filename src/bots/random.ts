/**
 * A bot that makes legal calls and plays legal cards, and nothing more.
 *
 * It plays terribly. That is the point: it is the harness the engine is
 * fuzz-tested against, and the placeholder the real players replace in phase 3.
 *
 * The call weighting is there for coverage, not for realism. Drawing uniformly
 * from the legal calls sounds neutral but is not: after a bid of rank r the
 * choices are r+1..34, so every call leaps about seven ranks and four in five
 * deals end up in a slam. The engine's part-score paths would then go
 * essentially untested. Passing often, and preferring the cheapest available
 * bid, spreads the contracts across all seven levels instead.
 */

import type { Rng } from '../random.js';
import { pick } from '../random.js';
import type { Auction, Call } from '../auction.js';
import { PASS, legalCalls } from '../auction.js';
import type { Card } from '../cards.js';
import type { PlayState } from '../play.js';
import { legalPlays } from '../play.js';

export type RandomCallOptions = {
  /** Chance of simply passing. Higher means shorter auctions. */
  passBias?: number;
  /** Chance of doubling or redoubling when it is available. */
  doubleBias?: number;
  /** Chance of stepping up one more bid instead of taking the cheapest. */
  climbBias?: number;
};

export function randomCall(auction: Auction, rng: Rng, options: RandomCallOptions = {}): Call {
  const { passBias = 0.6, doubleBias = 0.15, climbBias = 0.5 } = options;
  const calls = legalCalls(auction);
  if (calls.length === 0) throw new Error('the auction is over');

  if (rng() < passBias) return PASS;

  const penalty = calls.find((call) => call.type === 'double' || call.type === 'redouble');
  if (penalty && rng() < doubleBias) return penalty;

  const bids = calls.filter((call) => call.type === 'bid');
  if (bids.length === 0) return PASS;

  let index = 0;
  while (index < bids.length - 1 && rng() < climbBias) index++;
  return bids[index]!;
}

export function randomPlay(state: PlayState, rng: Rng): Card {
  return pick(rng, legalPlays(state));
}
