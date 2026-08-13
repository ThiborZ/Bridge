/**
 * The three levels, as card play.
 *
 * Weakness is *omission*, never noise. Every level plays the same sensible
 * heuristics; the stronger ones additionally solve the endgame, from further
 * out and over more sampled layouts. So a weaker bot never makes a bizarre
 * play — it just stops seeing as far ahead, which is exactly how a weaker
 * player is weaker, and is the difference between a partner who is beatable
 * and one who is infuriating.
 *
 * None of them cheat. Difficulty is how well they reason, never what they see.
 */

import type { Card } from '../cards.js';
import type { Rng } from '../random.js';
import type { PlayState } from '../play.js';
import { currentPlayer } from '../play.js';
import type { Seat } from '../seats.js';
import { heuristicPlay } from './heuristic.js';
import { monteCarloPlay } from './montecarlo.js';

export const TIERS = ['kitchen', 'club', 'tournament'] as const;
export type Tier = (typeof TIERS)[number];

export type TierSpec = {
  /** Start solving once this many tricks or fewer remain. Zero never solves. */
  readonly fromTricksLeft: number;
  /** Layouts sampled per decision. More is stronger and slower. */
  readonly samples: number;
};

/**
 * The numbers are set by measurement, not taste — see the benchmark and the
 * strength ladder in test/levels.test.ts. Raising `fromTricksLeft` is expensive
 * fast: the solver's work grows sharply with the cards left.
 */
export const CARD_PLAY: Record<Tier, TierSpec> = {
  // Rules of thumb only. This is a beginner who plays tidily and can be beaten
  // by anybody paying attention.
  kitchen: { fromTricksLeft: 0, samples: 0 },
  // Sees the last few tricks properly.
  club: { fromTricksLeft: 4, samples: 12 },
  /*
   * Plays the whole endgame perfectly, on far more evidence.
   *
   * Seven tricks out was measured too: it gained about six tricks over forty
   * deals — inside the noise — and cost nine times the thinking, 387ms for the
   * slowest decision against 44ms. On this machine that still fits the pause
   * between cards; on her tablet it would not. Six is the measurement, not a
   * guess, and raising it is a decision to re-measure on the slowest device
   * that matters.
   */
  tournament: { fromTricksLeft: 6, samples: 24 },
};

export function chooseCard(
  state: PlayState,
  seat: Seat = currentPlayer(state),
  tier: Tier = 'club',
  rng: Rng = Math.random,
): Card {
  const spec = CARD_PLAY[tier];
  const solved = monteCarloPlay(state, seat, { ...spec, rng });
  // Null means "too early to be worth solving", not "failed".
  return solved ?? heuristicPlay(state, seat);
}
