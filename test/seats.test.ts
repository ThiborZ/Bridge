/**
 * Seats and the vulnerability cycles.
 *
 * These had no direct tests at all: the fuzz harness used chicagoDealer and
 * chicagoVulnerability on every deal but never asserted what they returned, so a
 * wrong cycle would have sailed through ten thousand deals unnoticed and quietly
 * scored every hand against the wrong column.
 */

import { describe, it, expect } from 'vitest';
import {
  SEATS, arePartners, areOpponents, chicagoDealer, chicagoVulnerability,
  duplicateDealer, duplicateVulnerability, isVulnerable, nextSeat, opposingSide,
  partnerOf, seatsOfSide, sideOf,
} from '../src/seats.js';
import type { Vulnerability } from '../src/seats.js';

describe('going round the table', () => {
  it('runs clockwise North, East, South, West', () => {
    expect(SEATS).toEqual(['N', 'E', 'S', 'W']);
    expect(nextSeat('N')).toBe('E');
    expect(nextSeat('E')).toBe('S');
    expect(nextSeat('S')).toBe('W');
    expect(nextSeat('W')).toBe('N');
  });

  it('comes back round after four steps', () => {
    for (const seat of SEATS) {
      expect(nextSeat(seat, 4)).toBe(seat);
      expect(nextSeat(seat, 2)).toBe(partnerOf(seat));
      expect(nextSeat(nextSeat(seat, 3))).toBe(seat);
    }
  });

  it('sits partners opposite each other', () => {
    expect(partnerOf('N')).toBe('S');
    expect(partnerOf('S')).toBe('N');
    expect(partnerOf('E')).toBe('W');
    expect(partnerOf('W')).toBe('E');
    for (const seat of SEATS) expect(partnerOf(partnerOf(seat))).toBe(seat);
  });

  it('knows partners from opponents', () => {
    for (const a of SEATS)
      for (const b of SEATS) {
        expect(arePartners(a, b)).toBe(sideOf(a) === sideOf(b));
        expect(areOpponents(a, b)).toBe(!arePartners(a, b));
      }
    expect(arePartners('N', 'N')).toBe(true);
    expect(areOpponents('N', 'E')).toBe(true);
  });

  it('groups the sides consistently', () => {
    expect(seatsOfSide('NS')).toEqual(['N', 'S']);
    expect(seatsOfSide('EW')).toEqual(['E', 'W']);
    expect(opposingSide('NS')).toBe('EW');
    expect(opposingSide('EW')).toBe('NS');
    for (const side of ['NS', 'EW'] as const)
      for (const seat of seatsOfSide(side)) expect(sideOf(seat)).toBe(side);
  });
});

describe('who is vulnerable', () => {
  const cases: Array<[Vulnerability, boolean, boolean]> = [
    ['None', false, false],
    ['NS', true, false],
    ['EW', false, true],
    ['All', true, true],
  ];
  it.each(cases)('with %s, NS=%s and EW=%s', (vulnerability, ns, ew) => {
    expect(isVulnerable('NS', vulnerability)).toBe(ns);
    expect(isVulnerable('EW', vulnerability)).toBe(ew);
  });
});

describe('the Chicago cycle', () => {
  it('deals N, E, S, W and repeats', () => {
    expect([1, 2, 3, 4, 5, 6].map(chicagoDealer)).toEqual(['N', 'E', 'S', 'W', 'N', 'E']);
  });

  it('is nobody, then the dealer\'s side twice, then everybody', () => {
    expect([1, 2, 3, 4].map(chicagoVulnerability)).toEqual(['None', 'EW', 'NS', 'All']);
  });

  it('makes the dealer\'s own side vulnerable on hands two and three', () => {
    for (const hand of [2, 3, 6, 7, 10, 11]) {
      const dealer = chicagoDealer(hand);
      expect(chicagoVulnerability(hand)).toBe(sideOf(dealer));
      expect(isVulnerable(sideOf(dealer), chicagoVulnerability(hand))).toBe(true);
      expect(isVulnerable(opposingSide(sideOf(dealer)), chicagoVulnerability(hand))).toBe(false);
    }
  });

  it('repeats every four hands', () => {
    for (let hand = 1; hand <= 20; hand++) {
      expect(chicagoVulnerability(hand + 4)).toBe(chicagoVulnerability(hand));
      expect(chicagoDealer(hand + 4)).toBe(chicagoDealer(hand));
    }
  });
});

describe('the duplicate cycle', () => {
  it('follows the standard sixteen-board table', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(duplicateVulnerability))
      .toEqual([
        'None', 'NS', 'EW', 'All',
        'NS', 'EW', 'All', 'None',
        'EW', 'All', 'None', 'NS',
        'All', 'None', 'NS', 'EW',
      ]);
  });

  it('uses each of the four states exactly four times per cycle', () => {
    const counts = new Map<Vulnerability, number>();
    for (let board = 1; board <= 16; board++) {
      const vulnerability = duplicateVulnerability(board);
      counts.set(vulnerability, (counts.get(vulnerability) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([4, 4, 4, 4]);
  });

  it('gives each seat the deal four times per cycle', () => {
    const dealers = Array.from({ length: 16 }, (_, i) => duplicateDealer(i + 1));
    for (const seat of SEATS) expect(dealers.filter((d) => d === seat)).toHaveLength(4);
  });

  it('repeats every sixteen boards', () => {
    for (let board = 1; board <= 40; board++) {
      expect(duplicateVulnerability(board + 16)).toBe(duplicateVulnerability(board));
    }
  });
});
