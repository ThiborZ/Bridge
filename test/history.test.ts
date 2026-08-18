/**
 * Score keeping.
 *
 * The summarising is a pure function of the records, so it is tested directly
 * rather than through a browser. The cases that matter are the ones that only
 * show up after weeks of playing: a passed-out hand must not count as a
 * contract she failed, and a streak must break on a draw as well as a loss.
 */

import { describe, it, expect } from 'vitest';
import type { GameRecord, HandRecord } from '../src/ui/history.js';
import { isPersonalBest, outcomeOf, summarise } from '../src/ui/history.js';
import type { Tier } from '../src/bots/levels.js';

function hand(partial: Partial<HandRecord> = {}): HandRecord {
  return {
    declaredByUs: true, made: true, northSouth: 120, level: 2, strain: 'H',
    ...partial,
  };
}

function game(partial: Partial<GameRecord> = {}): GameRecord {
  const hands = partial.hands ?? [hand(), hand(), hand(), hand()];
  const northSouth = partial.northSouth ?? hands.reduce((sum, h) => sum + h.northSouth, 0);
  return {
    v: 1,
    at: 1_000,
    opponents: 'club' as Tier,
    partner: 'club' as Tier,
    northSouth,
    eastWest: partial.eastWest ?? -northSouth,
    ...partial,
    hands,
  };
}

describe('an empty record', () => {
  it('says nothing rather than zero', () => {
    const summary = summarise([]);
    expect(summary.games).toBe(0);
    expect(summary.best).toBeNull();
    expect(summary.madeShare).toBeNull();
    expect(summary.lastPlayed).toBeNull();
  });
});

describe('totals', () => {
  it('counts games won, drawn and lost from her side', () => {
    const summary = summarise([
      game({ at: 1, northSouth: 400, eastWest: 100 }),
      game({ at: 2, northSouth: 100, eastWest: 400 }),
      game({ at: 3, northSouth: 200, eastWest: 200 }),
    ]);
    expect([summary.won, summary.drawn, summary.lost]).toEqual([1, 1, 1]);
    expect(summary.games).toBe(3);
  });

  it('remembers the best game and the average', () => {
    const summary = summarise([
      game({ at: 1, northSouth: 300, eastWest: 0 }),
      game({ at: 2, northSouth: 700, eastWest: 0 }),
      game({ at: 3, northSouth: 200, eastWest: 0 }),
    ]);
    expect(summary.best).toBe(700);
    expect(summary.average).toBe(400);
  });

  it('counts a losing score as the best when every game was a loss', () => {
    // Best means best so far, not "good" — a negative record still has a top.
    const summary = summarise([
      game({ at: 1, northSouth: -300, eastWest: 300 }),
      game({ at: 2, northSouth: -100, eastWest: 100 }),
    ]);
    expect(summary.best).toBe(-100);
  });
});

describe('contracts she declared', () => {
  it('counts only the hands her own side declared', () => {
    const summary = summarise([game({
      hands: [
        hand({ declaredByUs: true, made: true }),
        hand({ declaredByUs: true, made: false }),
        hand({ declaredByUs: false, made: true }),   // theirs, and they made it
        hand({ declaredByUs: false, made: false }),
      ],
    })]);
    expect(summary.declared).toBe(2);
    expect(summary.made).toBe(1);
    expect(summary.madeShare).toBeCloseTo(0.5);
  });

  it('does not count a passed-out hand as a contract she failed', () => {
    // The trap: a hand nobody bid has made === null, and treating that as a
    // failure would quietly drag her record down for doing nothing wrong.
    const summary = summarise([game({
      hands: [
        hand({ declaredByUs: true, made: true }),
        hand({ declaredByUs: null, made: null, northSouth: 0, level: 0, strain: '' }),
      ],
    })]);
    expect(summary.declared).toBe(1);
    expect(summary.made).toBe(1);
    expect(summary.madeShare).toBe(1);
    expect(summary.hands).toBe(2);
  });
});

describe('winning streaks', () => {
  it('counts the run she is on now', () => {
    const summary = summarise([
      game({ at: 1, northSouth: 0, eastWest: 500 }),
      game({ at: 2, northSouth: 500, eastWest: 0 }),
      game({ at: 3, northSouth: 500, eastWest: 0 }),
    ]);
    expect(summary.currentStreak).toBe(2);
    expect(summary.bestStreak).toBe(2);
  });

  it('breaks a streak on a draw, not only on a loss', () => {
    const summary = summarise([
      game({ at: 1, northSouth: 500, eastWest: 0 }),
      game({ at: 2, northSouth: 500, eastWest: 0 }),
      game({ at: 3, northSouth: 200, eastWest: 200 }),
    ]);
    expect(summary.currentStreak).toBe(0);
    expect(summary.bestStreak).toBe(2);
  });

  it('reads the records in the order they were played, not the order given', () => {
    const summary = summarise([
      game({ at: 3, northSouth: 500, eastWest: 0 }),
      game({ at: 1, northSouth: 0, eastWest: 500 }),
      game({ at: 2, northSouth: 500, eastWest: 0 }),
    ]);
    expect(summary.currentStreak).toBe(2);
    expect(summary.lastPlayed).toBe(3);
  });
});

describe('by strength', () => {
  it('splits her record by who she was playing against', () => {
    const summary = summarise([
      game({ at: 1, opponents: 'kitchen', northSouth: 600, eastWest: 0 }),
      game({ at: 2, opponents: 'kitchen', northSouth: 400, eastWest: 0 }),
      game({ at: 3, opponents: 'tournament', northSouth: 100, eastWest: 300 }),
    ]);
    const kitchen = summary.byStrength.find((row) => row.tier === 'kitchen')!;
    const tournament = summary.byStrength.find((row) => row.tier === 'tournament')!;

    expect(kitchen.games).toBe(2);
    expect(kitchen.won).toBe(2);
    expect(kitchen.average).toBe(500);
    expect(tournament.games).toBe(1);
    expect(tournament.won).toBe(0);
  });

  it('leaves out strengths she has never played', () => {
    const summary = summarise([game({ opponents: 'club' })]);
    expect(summary.byStrength.map((row) => row.tier)).toEqual(['club']);
  });

  it('keeps the strengths in order, weakest first', () => {
    const summary = summarise([
      game({ at: 1, opponents: 'tournament' }),
      game({ at: 2, opponents: 'kitchen' }),
      game({ at: 3, opponents: 'club' }),
    ]);
    expect(summary.byStrength.map((row) => row.tier)).toEqual(['kitchen', 'club', 'tournament']);
  });
});

describe('a personal best', () => {
  it('is not claimed for a first game', () => {
    expect(isPersonalBest(500, [])).toBe(false);
  });

  it('needs to beat every game before it, not just the last', () => {
    const before = [game({ at: 1, northSouth: 800 }), game({ at: 2, northSouth: 200 })];
    expect(isPersonalBest(500, before)).toBe(false);
    expect(isPersonalBest(900, before)).toBe(true);
  });

  it('is not claimed for equalling the record', () => {
    expect(isPersonalBest(800, [game({ northSouth: 800 })])).toBe(false);
  });
});

describe('outcomes', () => {
  it('reads won, drawn and lost from the two totals', () => {
    expect(outcomeOf(game({ northSouth: 1, eastWest: 0 }))).toBe('won');
    expect(outcomeOf(game({ northSouth: 0, eastWest: 0 }))).toBe('drawn');
    expect(outcomeOf(game({ northSouth: 0, eastWest: 1 }))).toBe('lost');
  });
});
