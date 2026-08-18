/**
 * Remembering the game in progress.
 *
 * Nothing but the settings survived a reload, so putting the tablet down and
 * coming back to find the app dropped from memory meant losing the hand *and*
 * the running score of a four-hand game. That is the failure she would have hit
 * first, because it needs no unusual behaviour to trigger — only setting the
 * thing down, which is how a tablet is used.
 *
 * What is stored is the *history*, not the position: the deal's seed, the calls
 * made and the cards played. Deals come from a seed and every engine function is
 * pure, so replaying that history reconstructs the position exactly, in a few
 * hundred bytes rather than a snapshot of fifty-two cards.
 *
 * The replay also validates the save for nothing: `applyCall` and `applyPlay`
 * refuse anything illegal, so a corrupt or stale record throws and is discarded
 * rather than restoring a nonsense table.
 */

import type { Card } from '../cards.js';
import type { Call } from '../auction.js';
import type { Game } from '../game.js';
import { applyCall, applyPlay, chicagoDeal, newGame } from '../game.js';
import type { Tier } from '../bots/levels.js';
import type { HandRecord } from './history.js';
import { TIERS } from '../bots/levels.js';

const STORAGE_KEY = 'bridge.game';

/** Bump when the shape changes; anything else is discarded rather than guessed at. */
const FORMAT = 1;

export type Strengths = { opponents: Tier; partner: Tier };

export type SavedGame = {
  readonly v: number;
  readonly dealId: string;
  readonly handNumber: number;
  readonly calls: readonly Call[];
  readonly cards: readonly Card[];
  readonly totals: { readonly NS: number; readonly EW: number };
  readonly strengths: Strengths;
  /** What each bot bid meant, by position — regenerating it could disagree with
   *  the rules that produced it, so it travels with the game. */
  readonly meanings: ReadonlyArray<readonly [number, string]>;
  /**
   * The hands already finished in this game, for the score record.
   *
   * Optional on purpose: adding it without bumping the format means a save
   * written before this existed still restores. Those games record only the
   * hands played after the restore, which is a worse statistic but not a lost
   * game — and bumping the format would have thrown away whatever hand she had
   * on the table at the moment this shipped.
   */
  readonly hands?: readonly HandRecord[];
};

export type Restored = {
  readonly game: Game;
  readonly handNumber: number;
  readonly totals: { NS: number; EW: number };
  readonly strengths: Strengths;
  readonly meanings: Map<number, string>;
  readonly hands: readonly HandRecord[];
};

/** Every card played so far, in play order. */
export function cardsPlayed(game: Game): Card[] {
  if (!game.play) return [];
  return [
    ...game.play.completed.flatMap((trick) => [...trick.cards]),
    ...game.play.current.cards,
  ];
}

export function serialise(
  game: Game,
  handNumber: number,
  totals: { NS: number; EW: number },
  strengths: Strengths,
  meanings: Map<number, string>,
  hands: readonly HandRecord[] = [],
): SavedGame {
  return {
    v: FORMAT,
    dealId: game.deal.id,
    handNumber,
    calls: [...game.auction.calls],
    cards: cardsPlayed(game),
    totals: { NS: totals.NS, EW: totals.EW },
    strengths,
    meanings: [...meanings.entries()],
    hands: [...hands],
  };
}

function isTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

/** Rebuild by replaying. Returns null for anything that does not add up. */
export function reconstruct(saved: unknown): Restored | null {
  try {
    const record = saved as SavedGame;
    if (!record || record.v !== FORMAT) return null;
    if (typeof record.dealId !== 'string' || !Number.isInteger(record.handNumber)) return null;
    if (!Array.isArray(record.calls) || !Array.isArray(record.cards)) return null;
    if (!isTier(record.strengths?.opponents) || !isTier(record.strengths?.partner)) return null;

    // The seed and the hand number give back the identical deal, dealer and
    // vulnerability; everything after that is replay.
    let game = newGame(chicagoDeal(record.dealId, record.handNumber));
    for (const call of record.calls) game = applyCall(game, call);
    for (const card of record.cards) game = applyPlay(game, card);

    return {
      game,
      handNumber: record.handNumber,
      totals: { NS: Number(record.totals?.NS ?? 0), EW: Number(record.totals?.EW ?? 0) },
      strengths: record.strengths,
      meanings: new Map(record.meanings ?? []),
      // Absent in saves written before the score record existed.
      hands: Array.isArray(record.hands) ? record.hands : [],
    };
  } catch {
    // An illegal call or card means the record does not describe a real game.
    return null;
  }
}

export function saveGame(
  game: Game,
  handNumber: number,
  totals: { NS: number; EW: number },
  strengths: Strengths,
  meanings: Map<number, string>,
  hands: readonly HandRecord[] = [],
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serialise(game, handNumber, totals, strengths, meanings, hands)),
    );
  } catch {
    // Full quota or private browsing: the game simply will not survive a reload.
  }
}

export function loadGame(): Restored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const restored = reconstruct(JSON.parse(raw));
    if (restored === null) clearSavedGame();
    return restored;
  } catch {
    clearSavedGame();
    return null;
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
