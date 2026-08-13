/**
 * Duplicate scoring.
 *
 * A pure function of (contract, tricks taken, vulnerability), which is why it
 * gets a test per row rather than a spot check. The numbers below are the
 * standard table; if any of them is wrong the game is quietly wrong forever,
 * so they are worth checking against a printed source rather than against
 * intuition.
 */

import type { Contract, Strain } from './auction.js';
import { tricksRequired } from './auction.js';
import type { Side, Vulnerability } from './seats.js';
import { isVulnerable, sideOf } from './seats.js';

/** Points per trick over book. No-trumps scores 40 for the first, 30 after. */
export function trickValue(strain: Strain): number {
  return strain === 'C' || strain === 'D' ? 20 : 30;
}

/** The part that counts towards game, before any bonuses. */
export function contractPoints(level: number, strain: Strain, risk: Contract['risk']): number {
  const base = trickValue(strain) * level + (strain === 'NT' ? 10 : 0);
  const multiplier = risk === 'doubled' ? 2 : risk === 'redoubled' ? 4 : 1;
  return base * multiplier;
}

export function overtrickValue(strain: Strain, risk: Contract['risk'], vulnerable: boolean): number {
  if (risk === 'none') return trickValue(strain);
  const doubled = vulnerable ? 200 : 100;
  return risk === 'redoubled' ? doubled * 2 : doubled;
}

/**
 * Undoubled: 50 a trick, 100 vulnerable.
 * Doubled not vulnerable: 100, then 200 for the second and third, then 300.
 * Doubled vulnerable: 200, then 300 each.
 * Redoubled: twice the doubled figure.
 */
export function undertrickPenalty(count: number, risk: Contract['risk'], vulnerable: boolean): number {
  if (count <= 0) return 0;
  if (risk === 'none') return (vulnerable ? 100 : 50) * count;

  let total = 0;
  for (let n = 1; n <= count; n++) {
    if (vulnerable) total += n === 1 ? 200 : 300;
    else total += n === 1 ? 100 : n <= 3 ? 200 : 300;
  }
  return risk === 'redoubled' ? total * 2 : total;
}

export type ScoreBreakdown = {
  /** Positive when the contract made, negative when it went down. */
  readonly score: number;
  readonly made: boolean;
  /** Overtricks if it made, undertricks if it did not. */
  readonly by: number;
  readonly contractPoints: number;
  readonly overtrickPoints: number;
  readonly gameBonus: number;
  readonly slamBonus: number;
  readonly insultBonus: number;
  readonly penalty: number;
};

/** Scored from declarer's side. Negative means declarer's side lost that much. */
export function scoreContract(
  contract: Contract,
  tricksWon: number,
  vulnerable: boolean,
): ScoreBreakdown {
  const needed = tricksRequired(contract);
  const empty = {
    contractPoints: 0, overtrickPoints: 0, gameBonus: 0,
    slamBonus: 0, insultBonus: 0, penalty: 0,
  };

  if (tricksWon < needed) {
    const down = needed - tricksWon;
    const penalty = undertrickPenalty(down, contract.risk, vulnerable);
    return { ...empty, score: -penalty, made: false, by: down, penalty };
  }

  const points = contractPoints(contract.level, contract.strain, contract.risk);
  const overtricks = tricksWon - needed;
  const overtrickPoints = overtricks * overtrickValue(contract.strain, contract.risk, vulnerable);
  const gameBonus = points >= 100 ? (vulnerable ? 500 : 300) : 50;
  const slamBonus =
    contract.level === 7 ? (vulnerable ? 1500 : 1000)
    : contract.level === 6 ? (vulnerable ? 750 : 500)
    : 0;
  const insultBonus = contract.risk === 'doubled' ? 50 : contract.risk === 'redoubled' ? 100 : 0;

  return {
    ...empty,
    score: points + overtrickPoints + gameBonus + slamBonus + insultBonus,
    made: true,
    by: overtricks,
    contractPoints: points,
    overtrickPoints,
    gameBonus,
    slamBonus,
    insultBonus,
  };
}

/** As above, but working out vulnerability from the deal and declarer's seat. */
export function scoreDeal(
  contract: Contract,
  tricksWon: number,
  vulnerability: Vulnerability,
): ScoreBreakdown {
  return scoreContract(contract, tricksWon, isVulnerable(sideOf(contract.declarer), vulnerability));
}

/** The same score expressed from one side's point of view, for a running total. */
export function scoreForSide(
  side: Side,
  contract: Contract | null,
  tricksWon: number,
  vulnerability: Vulnerability,
): number {
  if (contract === null) return 0; // passed out
  const score = scoreDeal(contract, tricksWon, vulnerability).score;
  return sideOf(contract.declarer) === side ? score : -score;
}

export function describeResult(breakdown: ScoreBreakdown): string {
  if (breakdown.made) {
    return breakdown.by === 0 ? 'made exactly' : `made with ${breakdown.by} overtrick${breakdown.by > 1 ? 's' : ''}`;
  }
  return `down ${breakdown.by}`;
}
