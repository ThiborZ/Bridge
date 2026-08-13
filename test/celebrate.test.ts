/**
 * How big a result feels.
 *
 * The boundaries matter more than they look: they are what stops a part-score
 * setting off fireworks, and what makes sure a slam does. They are checked
 * against real scores from the scoring table rather than made-up numbers, so a
 * change to scoring that moves a contract across a boundary shows up here.
 */

import { describe, it, expect } from 'vitest';
import { celebrationFor, headlineFor } from '../src/ui/celebrate.js';
import { scoreContract } from '../src/score.js';
import { bid } from '../src/auction.js';
import type { Contract } from '../src/auction.js';

const contract = (level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT'): Contract => ({
  ...(bid(level, strain) as { level: number; strain: typeof strain }),
  risk: 'none',
  declarer: 'S',
});

/** What her side scores for making it, not vulnerable. */
const madeScore = (level: number, strain: 'C' | 'D' | 'H' | 'S' | 'NT') =>
  scoreContract(contract(level, strain), level + 6, false).score;

describe('how big the result was', () => {
  it('treats a slam as a slam', () => {
    expect(celebrationFor(madeScore(6, 'S'), 6)).toBe('slam');
    expect(celebrationFor(madeScore(7, 'NT'), 7)).toBe('slam');
  });

  it('treats a game as a game', () => {
    // 4S making is 420; 3NT is 400. Both are games, neither is a slam.
    expect(madeScore(4, 'S')).toBe(420);
    expect(celebrationFor(madeScore(4, 'S'), 4)).toBe('game');
    expect(celebrationFor(madeScore(3, 'NT'), 3)).toBe('game');
  });

  it('treats a part-score as a part-score', () => {
    // 2C making is 90 — pleasant, not fireworks.
    expect(madeScore(2, 'C')).toBe(90);
    expect(celebrationFor(madeScore(2, 'C'), 2)).toBe('partscore');
    expect(celebrationFor(madeScore(1, 'NT'), 1)).toBe('partscore');
  });

  it('counts beating their contract the same as making her own', () => {
    // A penalty is her side's score just as much as a contract made. Three off
    // doubled and vulnerable is 800 — that is a slam-sized result.
    const theirs: Contract = { level: 4, strain: 'H', risk: 'doubled', declarer: 'E' };
    const penalty = -scoreContract(theirs, 7, true).score;
    expect(penalty).toBe(800);
    expect(celebrationFor(penalty, 0)).toBe('slam');
  });

  it('says nothing at all about a passed-out hand', () => {
    expect(celebrationFor(0, 0)).toBe('none');
    expect(headlineFor('none', false)).toBeNull();
  });

  it('is quiet about a loss, at any size', () => {
    // No tier below zero produces anything but the one muted outcome, and it
    // never gets a headline. Losing should not be an event.
    for (const score of [-50, -100, -500, -1400]) {
      expect(celebrationFor(score, 0)).toBe('setback');
      expect(headlineFor(celebrationFor(score, 0), false)).toBeNull();
    }
  });

  it('words the headline for who actually won the tricks', () => {
    expect(headlineFor('slam', true)).toBe('Slem!');
    expect(headlineFor('game', true)).toBe('Manche!');
    // The same score, but reached by beating them, reads differently.
    expect(headlineFor('game', false)).toBe('Goed verdedigd');
  });
});
