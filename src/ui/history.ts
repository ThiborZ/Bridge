/**
 * Keeping score across games.
 *
 * Every finished game is written down, so "how am I doing?" has an answer that
 * outlives the session. This is the one thing on the backlog where waiting cost
 * something permanent: statistics only start counting from the day they exist,
 * and every game played before that is gone.
 *
 * The summarising is a pure function of the records, kept apart from the
 * storage, so it can be tested without a browser.
 */

import type { Tier } from '../bots/levels.js';
import { TIERS } from '../bots/levels.js';

const STORAGE_KEY = 'bridge.history';

/** Bump when the shape changes; older records are dropped rather than guessed at. */
const FORMAT = 1;

/**
 * Enough games to see a trend without letting storage grow for ever. At roughly
 * 200 bytes a game this stays trivially small.
 */
const KEEP = 200;

export type HandRecord = {
  /** Null when the hand was passed out and nobody played. */
  readonly declaredByUs: boolean | null;
  readonly made: boolean | null;
  /** Score from North-South's point of view, so games can be totalled. */
  readonly northSouth: number;
  /** 0 and '' when passed out. */
  readonly level: number;
  readonly strain: string;
};

export type GameRecord = {
  readonly v: number;
  /** Milliseconds since the epoch, for ordering and for "laatst gespeeld". */
  readonly at: number;
  readonly opponents: Tier;
  readonly partner: Tier;
  readonly northSouth: number;
  readonly eastWest: number;
  readonly hands: readonly HandRecord[];
};

export type StrengthSummary = {
  readonly tier: Tier;
  readonly games: number;
  readonly won: number;
  readonly best: number | null;
  readonly average: number;
};

export type Summary = {
  readonly games: number;
  readonly hands: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly best: number | null;
  readonly average: number;
  /** Hands her side declared, and how many of those came home. */
  readonly declared: number;
  readonly made: number;
  /** Null rather than zero when she has not declared anything yet. */
  readonly madeShare: number | null;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly byStrength: readonly StrengthSummary[];
  readonly lastPlayed: number | null;
};

/* ------------------------------------------------------------------ storage */

function isRecord(value: unknown): value is GameRecord {
  if (typeof value !== 'object' || value === null) return false;
  const game = value as Partial<GameRecord>;
  return (
    game.v === FORMAT &&
    typeof game.at === 'number' &&
    typeof game.northSouth === 'number' &&
    typeof game.eastWest === 'number' &&
    Array.isArray(game.hands) &&
    typeof game.opponents === 'string' && TIERS.includes(game.opponents as Tier) &&
    typeof game.partner === 'string' && TIERS.includes(game.partner as Tier)
  );
}

export function loadHistory(): GameRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // One bad row should not throw away the rest of her record.
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

export function recordGame(game: Omit<GameRecord, 'v'>): void {
  try {
    const kept = [...loadHistory(), { ...game, v: FORMAT }].slice(-KEEP);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // A full or disabled store must never cost her the game she just played.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; the statistics simply stay as they were.
  }
}

/* ------------------------------------------------------------- summarising */

/** Won, drawn or lost, from her side of the table. */
export function outcomeOf(game: GameRecord): 'won' | 'drawn' | 'lost' {
  if (game.northSouth > game.eastWest) return 'won';
  if (game.northSouth === game.eastWest) return 'drawn';
  return 'lost';
}

export function summarise(games: readonly GameRecord[]): Summary {
  if (games.length === 0) {
    return {
      games: 0, hands: 0, won: 0, drawn: 0, lost: 0,
      best: null, average: 0, declared: 0, made: 0, madeShare: null,
      currentStreak: 0, bestStreak: 0, byStrength: [], lastPlayed: null,
    };
  }

  const ordered = [...games].sort((a, b) => a.at - b.at);

  let won = 0;
  let drawn = 0;
  let lost = 0;
  let hands = 0;
  let declared = 0;
  let made = 0;
  let total = 0;
  let best: number | null = null;
  let streak = 0;
  let bestStreak = 0;

  for (const game of ordered) {
    const outcome = outcomeOf(game);
    if (outcome === 'won') { won++; streak++; bestStreak = Math.max(bestStreak, streak); }
    else { if (outcome === 'drawn') drawn++; else lost++; streak = 0; }

    total += game.northSouth;
    best = best === null ? game.northSouth : Math.max(best, game.northSouth);

    for (const hand of game.hands) {
      hands++;
      if (hand.declaredByUs === true) {
        declared++;
        if (hand.made) made++;
      }
    }
  }

  const byStrength: StrengthSummary[] = [];
  for (const tier of TIERS) {
    const played = ordered.filter((game) => game.opponents === tier);
    if (played.length === 0) continue;
    byStrength.push({
      tier,
      games: played.length,
      won: played.filter((game) => outcomeOf(game) === 'won').length,
      best: played.reduce<number | null>(
        (top, game) => (top === null ? game.northSouth : Math.max(top, game.northSouth)),
        null,
      ),
      average: Math.round(played.reduce((sum, game) => sum + game.northSouth, 0) / played.length),
    });
  }

  return {
    games: ordered.length,
    hands,
    won, drawn, lost,
    best,
    average: Math.round(total / ordered.length),
    declared,
    made,
    madeShare: declared === 0 ? null : made / declared,
    currentStreak: streak,
    bestStreak,
    byStrength,
    lastPlayed: ordered[ordered.length - 1]!.at,
  };
}

/** True when this score beats every game before it — worth saying out loud. */
export function isPersonalBest(score: number, previous: readonly GameRecord[]): boolean {
  if (previous.length === 0) return false; // a first game is not yet a record
  return previous.every((game) => score > game.northSouth);
}
