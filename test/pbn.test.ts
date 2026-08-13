import { describe, it, expect } from 'vitest';
import { cardsToString } from '../src/cards.js';
import { handsToPBN, parsePBNHands } from '../src/pbn.js';
import { dealFromSeed } from '../src/game.js';
import { SEATS } from '../src/seats.js';

/** A real deal, in the format the rest of the bridge world writes. */
const SAMPLE =
  'N:AK5.QJ4.T98.7632 QJT.AK32.QJ7.QJT 9876.T98.AK65.AK 432.765.432.9854';

describe('reading a PBN deal', () => {
  it('gives each seat the right thirteen cards', () => {
    const hands = parsePBNHands(SAMPLE);
    for (const seat of SEATS) expect(hands[seat]).toHaveLength(13);
    expect(cardsToString(hands.N)).toBe('SA SK S5 HQ HJ H4 DT D9 D8 C7 C6 C3 C2');
    expect(cardsToString(hands.E)).toBe('SQ SJ ST HA HK H3 H2 DQ DJ D7 CQ CJ CT');
  });

  it('starts from the named seat and goes clockwise', () => {
    const fromEast = parsePBNHands('E:AK5.QJ4.T98.7632 QJT.AK32.QJ7.QJT 9876.T98.AK65.AK 432.765.432.9854');
    expect(cardsToString(fromEast.E)).toBe('SA SK S5 HQ HJ H4 DT D9 D8 C7 C6 C3 C2');
    expect(cardsToString(fromEast.S)).toBe('SQ SJ ST HA HK H3 H2 DQ DJ D7 CQ CJ CT');
  });

  it('accepts the surrounding tag', () => {
    expect(parsePBNHands(`[Deal "${SAMPLE}"]`)).toEqual(parsePBNHands(SAMPLE));
  });

  it('refuses a deal that is not a full pack', () => {
    expect(() => parsePBNHands('N:AK5.QJ4.T98.7632 QJT.AK32.QJ7.QJT 9876.T98.AK65.AK 432.765.432.985'))
      .toThrow(/52 cards/);
    expect(() => parsePBNHands('N:AK5.QJ4.T98.7632 QJT.AK32.QJ7.QJT')).toThrow(/4 hands/);
    expect(() => parsePBNHands('nonsense')).toThrow(/not a PBN deal/);
  });
});

describe('writing a PBN deal', () => {
  it('round-trips', () => {
    expect(handsToPBN(parsePBNHands(SAMPLE))).toBe(SAMPLE);
  });

  it('round-trips a dealt hand from any seat', () => {
    const deal = dealFromSeed('pbn-check', 'S', 'All');
    for (const seat of SEATS) {
      expect(parsePBNHands(handsToPBN(deal.hands, seat))).toEqual(deal.hands);
    }
  });
});
