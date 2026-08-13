/**
 * Every scoreable position — 7 levels x 5 strains x 3 risks x 14 trick counts x
 * 2 vulnerabilities, 2,940 in all — checked against properties rather than
 * against remembered numbers.
 *
 * The row-by-row table in score.test.ts says "this contract scores 470". These
 * say "doubling a contract you make can never cost you", "taking one more trick
 * can never score less", and "the parts must add up to the whole" — the kind of
 * statement that catches a transposed digit in a row nobody thought to write out.
 */

import { describe, it, expect } from 'vitest';
import { STRAINS } from '../src/auction.js';
import type { Contract, Risk, Strain } from '../src/auction.js';
import { contractPoints, scoreContract, scoreForSide, trickValue, undertrickPenalty } from '../src/score.js';

const LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
const RISKS: readonly Risk[] = ['none', 'doubled', 'redoubled'];
const VULNERABILITIES = [false, true] as const;
const TRICK_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

function contract(level: number, strain: Strain, risk: Risk): Contract {
  return { level, strain, risk, declarer: 'N' };
}

type Position = { level: number; strain: Strain; risk: Risk; vulnerable: boolean; tricks: number };

function everyPosition(): Position[] {
  const positions: Position[] = [];
  for (const level of LEVELS)
    for (const strain of STRAINS)
      for (const risk of RISKS)
        for (const vulnerable of VULNERABILITIES)
          for (const tricks of TRICK_COUNTS)
            positions.push({ level, strain, risk, vulnerable, tricks });
  return positions;
}

const POSITIONS = everyPosition();

describe('across every scoreable position', () => {
  it('covers 2,940 of them', () => {
    expect(POSITIONS).toHaveLength(7 * 5 * 3 * 14 * 2);
  });

  it('never scores zero, and never scores a fraction', () => {
    for (const p of POSITIONS) {
      const { score } = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).not.toBe(0);
    }
  });

  it('makes the contract exactly when it takes six plus the level', () => {
    for (const p of POSITIONS) {
      const result = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      const shouldMake = p.tricks >= p.level + 6;
      expect(result.made).toBe(shouldMake);
      expect(Math.sign(result.score)).toBe(shouldMake ? 1 : -1);
      expect(result.by).toBe(shouldMake ? p.tricks - (p.level + 6) : p.level + 6 - p.tricks);
    }
  });

  it('adds its parts up to its total', () => {
    for (const p of POSITIONS) {
      const r = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      const parts = r.contractPoints + r.overtrickPoints + r.gameBonus + r.slamBonus + r.insultBonus;
      expect(r.score).toBe(r.made ? parts : -r.penalty);
      // Nothing may leak across the made/failed boundary.
      if (r.made) expect(r.penalty).toBe(0);
      else expect(parts).toBe(0);
    }
  });

  it('never scores less for taking one more trick', () => {
    for (const level of LEVELS)
      for (const strain of STRAINS)
        for (const risk of RISKS)
          for (const vulnerable of VULNERABILITIES) {
            const scores = TRICK_COUNTS.map(
              (tricks) => scoreContract(contract(level, strain, risk), tricks, vulnerable).score,
            );
            for (let i = 1; i < scores.length; i++) {
              expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
            }
          }
  });

  it('rewards doubling a contract that makes, and punishes one that fails', () => {
    for (const p of POSITIONS) {
      const plain = scoreContract(contract(p.level, p.strain, 'none'), p.tricks, p.vulnerable).score;
      const doubled = scoreContract(contract(p.level, p.strain, 'doubled'), p.tricks, p.vulnerable).score;
      const redoubled = scoreContract(contract(p.level, p.strain, 'redoubled'), p.tricks, p.vulnerable).score;
      if (p.tricks >= p.level + 6) {
        expect(doubled).toBeGreaterThan(plain);
        expect(redoubled).toBeGreaterThan(doubled);
      } else {
        expect(doubled).toBeLessThan(plain);
        expect(redoubled).toBeLessThan(doubled);
      }
    }
  });

  it('costs more, and pays more, when vulnerable', () => {
    for (const p of POSITIONS) {
      const safe = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, false).score;
      const exposed = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, true).score;
      if (p.tricks >= p.level + 6) expect(exposed).toBeGreaterThanOrEqual(safe);
      else expect(exposed).toBeLessThan(safe);
    }
  });
});

describe('the bonuses', () => {
  it('pays the game bonus exactly when the contract is worth 100 or more', () => {
    for (const p of POSITIONS) {
      const r = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      if (!r.made) continue;
      const worth = contractPoints(p.level, p.strain, p.risk);
      const expected = worth >= 100 ? (p.vulnerable ? 500 : 300) : 50;
      expect(r.gameBonus).toBe(expected);
    }
  });

  it('pays a slam bonus only at the six and seven levels', () => {
    for (const p of POSITIONS) {
      const r = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      if (!r.made) continue;
      if (p.level <= 5) expect(r.slamBonus).toBe(0);
      if (p.level === 6) expect(r.slamBonus).toBe(p.vulnerable ? 750 : 500);
      if (p.level === 7) expect(r.slamBonus).toBe(p.vulnerable ? 1500 : 1000);
    }
  });

  it('pays for the insult only when doubled or redoubled', () => {
    for (const p of POSITIONS) {
      const r = scoreContract(contract(p.level, p.strain, p.risk), p.tricks, p.vulnerable);
      if (!r.made) continue;
      expect(r.insultBonus).toBe(p.risk === 'none' ? 0 : p.risk === 'doubled' ? 50 : 100);
    }
  });

  it('charges no-trumps ten extra for the first trick only', () => {
    for (const level of LEVELS) {
      expect(contractPoints(level, 'NT', 'none')).toBe(30 * level + 10);
      expect(contractPoints(level, 'S', 'none')).toBe(30 * level);
      expect(contractPoints(level, 'C', 'none')).toBe(20 * level);
    }
  });

  it('multiplies the contract by two when doubled and four when redoubled', () => {
    for (const level of LEVELS)
      for (const strain of STRAINS) {
        const plain = contractPoints(level, strain, 'none');
        expect(contractPoints(level, strain, 'doubled')).toBe(plain * 2);
        expect(contractPoints(level, strain, 'redoubled')).toBe(plain * 4);
      }
  });
});

describe('overtricks', () => {
  it('are worth the trick value undoubled, and a flat rate when doubled', () => {
    for (const strain of STRAINS)
      for (const vulnerable of VULNERABILITIES) {
        const overtricks = 2;
        const tricks = 1 + 6 + overtricks;
        const plain = scoreContract(contract(1, strain, 'none'), tricks, vulnerable);
        expect(plain.overtrickPoints).toBe(overtricks * trickValue(strain));

        const doubled = scoreContract(contract(1, strain, 'doubled'), tricks, vulnerable);
        expect(doubled.overtrickPoints).toBe(overtricks * (vulnerable ? 200 : 100));

        const redoubled = scoreContract(contract(1, strain, 'redoubled'), tricks, vulnerable);
        expect(redoubled.overtrickPoints).toBe(overtricks * (vulnerable ? 400 : 200));
      }
  });
});

describe('the penalty ladder, in full', () => {
  it('grows with every undertrick and is never negative', () => {
    for (const risk of RISKS)
      for (const vulnerable of VULNERABILITIES) {
        expect(undertrickPenalty(0, risk, vulnerable)).toBe(0);
        for (let n = 1; n <= 13; n++) {
          expect(undertrickPenalty(n, risk, vulnerable)).toBeGreaterThan(
            undertrickPenalty(n - 1, risk, vulnerable),
          );
        }
      }
  });

  it('is exactly twice as much redoubled as doubled, at every depth', () => {
    for (const vulnerable of VULNERABILITIES)
      for (let n = 1; n <= 13; n++) {
        expect(undertrickPenalty(n, 'redoubled', vulnerable))
          .toBe(undertrickPenalty(n, 'doubled', vulnerable) * 2);
      }
  });

  it('steps 100 / 200 / 200 / 300... doubled and not vulnerable', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      undertrickPenalty(i + 1, 'doubled', false) - undertrickPenalty(i, 'doubled', false));
    expect(steps).toEqual([100, 200, 200, 300, 300, 300]);
  });

  it('steps 200 / 300 / 300... doubled and vulnerable', () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      undertrickPenalty(i + 1, 'doubled', true) - undertrickPenalty(i, 'doubled', true));
    expect(steps).toEqual([200, 300, 300, 300, 300, 300]);
  });

  it('steps flat undoubled', () => {
    expect(undertrickPenalty(13, 'none', false)).toBe(650);
    expect(undertrickPenalty(13, 'none', true)).toBe(1300);
  });
});

describe('the two sides always see equal and opposite scores', () => {
  it('mirrors the score for the defending side', () => {
    for (const p of POSITIONS) {
      const declared = contract(p.level, p.strain, p.risk); // declarer N, so side NS
      const vulnerability = p.vulnerable ? 'NS' : 'EW';
      const forNS = scoreForSide('NS', declared, p.tricks, vulnerability);
      const forEW = scoreForSide('EW', declared, p.tricks, vulnerability);
      expect(forNS).toBe(-forEW);
      expect(forNS).toBe(scoreContract(declared, p.tricks, p.vulnerable).score);
    }
  });

  it('scores a passed-out deal as nothing for either side', () => {
    expect(scoreForSide('NS', null, 0, 'All')).toBe(0);
    expect(scoreForSide('EW', null, 0, 'All')).toBe(0);
  });
});
