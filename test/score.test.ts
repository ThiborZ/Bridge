import { describe, it, expect } from 'vitest';
import type { Contract, Strain, Risk } from '../src/auction.js';
import { scoreContract, undertrickPenalty } from '../src/score.js';

function contract(level: number, strain: Strain, risk: Risk = 'none'): Contract {
  return { level, strain, risk, declarer: 'N' };
}

/**
 * One row per line of the scoring table. These numbers are the whole reason
 * this file exists — if any of them is wrong, every hand she ever plays is
 * scored wrong and nothing will visibly break.
 */
describe('contracts that make', () => {
  const rows: Array<[string, number, Strain, Risk, number, boolean, number]> = [
    // description                    level strain  risk          tricks vul  score
    ['1NT exactly',                       1, 'NT', 'none',            7, false,   90],
    ['2S exactly',                        2, 'S',  'none',            8, false,  110],
    ['3C exactly',                        3, 'C',  'none',            9, false,  110],
    ['3NT exactly',                       3, 'NT', 'none',            9, false,  400],
    ['3NT exactly, vulnerable',           3, 'NT', 'none',            9, true,   600],
    ['4H exactly',                        4, 'H',  'none',           10, false,  420],
    ['4H exactly, vulnerable',            4, 'H',  'none',           10, true,   620],
    ['4H with an overtrick',              4, 'H',  'none',           11, false,  450],
    ['5C exactly',                        5, 'C',  'none',           11, false,  400],
    ['5C exactly, vulnerable',            5, 'C',  'none',           11, true,   600],
    ['6S exactly',                        6, 'S',  'none',           12, false,  980],
    ['6S exactly, vulnerable',            6, 'S',  'none',           12, true,  1430],
    ['7NT exactly',                       7, 'NT', 'none',           13, false, 1520],
    ['7NT exactly, vulnerable',           7, 'NT', 'none',           13, true,  2220],
    ['1NT doubled',                       1, 'NT', 'doubled',         7, false,  180],
    ['2S doubled — a part-score into game', 2, 'S', 'doubled',        8, false,  470],
    ['2S doubled, vulnerable',            2, 'S',  'doubled',         8, true,   670],
    ['4H doubled, vulnerable',            4, 'H',  'doubled',        10, true,   790],
    ['4H doubled with an overtrick',      4, 'H',  'doubled',        11, false,  690],
    ['4H doubled with an overtrick, vul', 4, 'H',  'doubled',        11, true,   990],
    ['1NT redoubled',                     1, 'NT', 'redoubled',       7, false,  560],
    ['1NT redoubled with an overtrick',   1, 'NT', 'redoubled',       8, false,  760],
  ];

  it.each(rows)('%s scores %d', (_label, level, strain, risk, tricks, vulnerable, expected) => {
    const result = scoreContract(contract(level, strain, risk), tricks, vulnerable);
    expect(result.made).toBe(true);
    expect(result.score).toBe(expected);
  });
});

describe('contracts that go down', () => {
  const rows: Array<[string, Risk, number, boolean, number]> = [
    // description                risk         tricks vul   score
    ['undoubled, one off',       'none',           9, false,  -50],
    ['undoubled, one off, vul',  'none',           9, true,  -100],
    ['undoubled, three off',     'none',           7, false, -150],
    ['undoubled, three off, vul','none',           7, true,  -300],
    ['doubled, one off',         'doubled',        9, false, -100],
    ['doubled, two off',         'doubled',        8, false, -300],
    ['doubled, three off',       'doubled',        7, false, -500],
    ['doubled, four off',        'doubled',        6, false, -800],
    ['doubled, five off',        'doubled',        5, false, -1100],
    ['doubled, one off, vul',    'doubled',        9, true,  -200],
    ['doubled, two off, vul',    'doubled',        8, true,  -500],
    ['doubled, three off, vul',  'doubled',        7, true,  -800],
    ['redoubled, one off',       'redoubled',      9, false, -200],
    ['redoubled, two off',       'redoubled',      8, false, -600],
    ['redoubled, one off, vul',  'redoubled',      9, true,  -400],
    ['redoubled, two off, vul',  'redoubled',      8, true, -1000],
  ];

  // Every row is 4S, needing ten tricks.
  it.each(rows)('%s scores %d', (_label, risk, tricks, vulnerable, expected) => {
    const result = scoreContract(contract(4, 'S', risk), tricks, vulnerable);
    expect(result.made).toBe(false);
    expect(result.score).toBe(expected);
  });
});

describe('the penalty ladder', () => {
  it('steps 100, 300, 500, 800, 1100 when doubled and not vulnerable', () => {
    const ladder = [1, 2, 3, 4, 5].map((n) => undertrickPenalty(n, 'doubled', false));
    expect(ladder).toEqual([100, 300, 500, 800, 1100]);
  });

  it('steps 200, 500, 800, 1100 when doubled and vulnerable', () => {
    const ladder = [1, 2, 3, 4].map((n) => undertrickPenalty(n, 'doubled', true));
    expect(ladder).toEqual([200, 500, 800, 1100]);
  });

  it('doubles the doubled ladder when redoubled', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(undertrickPenalty(n, 'redoubled', false)).toBe(undertrickPenalty(n, 'doubled', false) * 2);
      expect(undertrickPenalty(n, 'redoubled', true)).toBe(undertrickPenalty(n, 'doubled', true) * 2);
    }
  });
});

describe('the breakdown adds up', () => {
  it('separates the parts of a doubled slam', () => {
    const result = scoreContract(contract(6, 'H', 'doubled'), 12, true);
    expect(result).toMatchObject({
      contractPoints: 360, // 6 x 30, doubled
      gameBonus: 500,
      slamBonus: 750,
      insultBonus: 50,
      overtrickPoints: 0,
    });
    expect(result.score).toBe(360 + 500 + 750 + 50);
  });

  it('gives only the part-score bonus below 100 contract points', () => {
    expect(scoreContract(contract(2, 'D'), 8, false)).toMatchObject({ gameBonus: 50, score: 90 });
  });

  it('treats a doubled part-score worth 100 or more as game', () => {
    // 2S doubled is 120 contract points, which is game even though it is a part-score.
    expect(scoreContract(contract(2, 'S', 'doubled'), 8, false).gameBonus).toBe(300);
  });
});
