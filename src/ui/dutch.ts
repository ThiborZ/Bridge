/**
 * Alles wat op het scherm staat, in het Nederlands.
 *
 * De motor zelf blijft Engels: `contractToString` en `describeResult` daar zijn
 * voor tests en foutopsporing, niet voor haar. Door de Nederlandse tekst hier te
 * maken blijft de motor taalvrij en blijven die tests staan.
 *
 * Bridgetermen zijn de Nederlandse: sans atout (SA), kleur voor suit, leider,
 * blinde, slag, manche, slem, kwetsbaar. "Stayman" blijft Stayman.
 */

import type { Card, Suit } from '../cards.js';
import { RANK_CHARS, rankOf, suitOf } from '../cards.js';
import type { Call, Contract, Strain } from '../auction.js';
import type { Seat } from '../seats.js';
import type { ScoreBreakdown } from '../score.js';
import { SUIT_SYMBOL } from './dom.js';

export const SEAT_NAME: Record<Seat, string> = {
  N: 'Noord', E: 'Oost', S: 'Jij', W: 'West',
};

/** Voor zinnen waarin "Jij" raar staat, zoals "Noord speelt de kaarten van Zuid". */
export const SEAT_COMPASS: Record<Seat, string> = {
  N: 'Noord', E: 'Oost', S: 'Zuid', W: 'West',
};

export const SUIT_NAME: Record<Suit, string> = {
  C: 'klaveren', D: 'ruiten', H: 'harten', S: 'schoppen',
};

/** SA, niet NT. */
export function strainLabel(strain: Strain): string {
  return strain === 'NT' ? 'SA' : SUIT_SYMBOL[strain];
}

export function callLabel(call: Call): string {
  switch (call.type) {
    case 'pass': return 'Pas';
    case 'double': return 'Dbl';
    case 'redouble': return 'Rdbl';
    case 'bid': return `${call.level}${strainLabel(call.strain)}`;
  }
}

/** Uitgeschreven, voor schermlezers en knoplabels. */
export function callSpoken(call: Call): string {
  switch (call.type) {
    case 'pass': return 'passen';
    case 'double': return 'doubleren';
    case 'redouble': return 'redoubleren';
    case 'bid':
      return `${call.level} ${call.strain === 'NT' ? 'sans atout' : SUIT_NAME[call.strain]}`;
  }
}

export function contractLabel(contract: Contract): string {
  const suffix = contract.risk === 'doubled' ? ' dbl' : contract.risk === 'redoubled' ? ' rdbl' : '';
  return `${contract.level}${strainLabel(contract.strain)}${suffix} door ${SEAT_COMPASS[contract.declarer]}`;
}

const RANK_NAME: Record<string, string> = {
  A: 'aas', K: 'heer', Q: 'vrouw', J: 'boer', T: 'tien',
};

/** Kleur eerst, dan de kaart: "ruiten vrouw", niet "vrouw ruiten". */
export function cardSpoken(card: Card): string {
  const character = RANK_CHARS[rankOf(card) - 2]!;
  return `${SUIT_NAME[suitOf(card)]} ${RANK_NAME[character] ?? character}`;
}

export function cardRankLabel(card: Card): string {
  const character = RANK_CHARS[rankOf(card) - 2]!;
  // Nederlandse kaartnamen: H voor heer, V voor vrouw, B voor boer.
  return ({ K: 'H', Q: 'V', J: 'B' } as Record<string, string>)[character] ?? character;
}

export function describeOutcome(breakdown: ScoreBreakdown): string {
  if (breakdown.made) {
    if (breakdown.by === 0) return 'precies gemaakt';
    return `gemaakt met ${breakdown.by} overslag${breakdown.by > 1 ? 'en' : ''}`;
  }
  return `${breakdown.by} down`;
}

export const VULNERABILITY: Record<string, string> = {
  None: 'niemand', NS: 'N-Z', EW: 'O-W', All: 'allebei',
};

/** Meervoud waar het Nederlands het anders doet dan het Engels. */
export function tricks(count: number): string {
  return `${count} slag${count === 1 ? '' : 'en'}`;
}
