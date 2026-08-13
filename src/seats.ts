/** Seats, partnerships, and who is vulnerable on which hand. */

export const SEATS = ['N', 'E', 'S', 'W'] as const;
export type Seat = (typeof SEATS)[number];

export const SIDES = ['NS', 'EW'] as const;
export type Side = (typeof SIDES)[number];

export type Vulnerability = 'None' | 'NS' | 'EW' | 'All';

export function seatIndex(seat: Seat): number {
  return SEATS.indexOf(seat);
}

/** Clockwise: N -> E -> S -> W -> N. */
export function nextSeat(seat: Seat, steps = 1): Seat {
  return SEATS[(seatIndex(seat) + steps) % 4]!;
}

export function partnerOf(seat: Seat): Seat {
  return nextSeat(seat, 2);
}

export function sideOf(seat: Seat): Side {
  return seatIndex(seat) % 2 === 0 ? 'NS' : 'EW';
}

export function areOpponents(a: Seat, b: Seat): boolean {
  return sideOf(a) !== sideOf(b);
}

export function arePartners(a: Seat, b: Seat): boolean {
  return sideOf(a) === sideOf(b);
}

export function seatsOfSide(side: Side): [Seat, Seat] {
  return side === 'NS' ? ['N', 'S'] : ['E', 'W'];
}

export function opposingSide(side: Side): Side {
  return side === 'NS' ? 'EW' : 'NS';
}

export function isVulnerable(side: Side, vulnerability: Vulnerability): boolean {
  return vulnerability === 'All' || vulnerability === side;
}

/**
 * Chicago, the four-deal cycle: nobody vulnerable, then the dealer's side twice,
 * then everybody. Hand numbers are 1-based and the cycle repeats.
 */
export function chicagoDealer(handNumber: number): Seat {
  return SEATS[(handNumber - 1) % 4]!;
}

export function chicagoVulnerability(handNumber: number): Vulnerability {
  const position = (handNumber - 1) % 4;
  if (position === 0) return 'None';
  if (position === 3) return 'All';
  return sideOf(chicagoDealer(handNumber));
}

/** The standard duplicate cycle, for if she turns out to prefer club scoring. */
const DUPLICATE_VULNERABILITY: readonly Vulnerability[] = [
  'None', 'NS', 'EW', 'All',
  'NS', 'EW', 'All', 'None',
  'EW', 'All', 'None', 'NS',
  'All', 'None', 'NS', 'EW',
];

export function duplicateDealer(boardNumber: number): Seat {
  return SEATS[(boardNumber - 1) % 4]!;
}

export function duplicateVulnerability(boardNumber: number): Vulnerability {
  return DUPLICATE_VULNERABILITY[(boardNumber - 1) % 16]!;
}
