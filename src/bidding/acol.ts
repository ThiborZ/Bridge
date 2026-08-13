/**
 * Acol as she plays it: weak no-trump, traditional strong two-bids, Stayman
 * without transfers.
 *
 * The rules are a list, matched top to bottom, first one wins. That ordering is
 * the system — `open-2C` sits above `open-1NT` because a hand with twenty-three
 * points is not a weak no-trump however balanced it is. Reordering this list
 * changes what the bots play.
 *
 * Every rule carries a `meaning`, which is not decoration: she has to be able to
 * read the auction, and a bot whose bids cannot be explained is worse than a bot
 * that bids badly.
 *
 * `tier` is the lowest difficulty that knows the rule, so a weaker bot is weak
 * by *omission* — it passes where a better one would act. Weakness must never be
 * noise; a partner who bids at random is infuriating, one who is too timid is
 * merely weak, and only the second is worth playing with.
 *
 * KNOWN GAPS, deliberately: no Blackwood, no slam machinery beyond bidding one
 * directly, and competitive bidding stops at a simple overcall or takeout
 * double. Everything unmatched falls through to Pass and is counted — see the
 * coverage test, which is what stops the gaps being invisible.
 */

import type { Suit } from '../cards.js';
import { SUITS, cardsOfSuit, rankOf } from '../cards.js';
import type { Auction, Call, Strain } from '../auction.js';
import { DOUBLE, PASS, bid, isLegalCall } from '../auction.js';
import type { Context } from './context.js';
import type { Situation } from './context.js';
import { longSuits, openingSuit, ruleOfTwenty, supportsOtherSuits } from './evaluate.js';

export type Tier = 'kitchen' | 'club' | 'tournament';

export type Rule = {
  readonly id: string;
  readonly situation: Situation;
  readonly tier: Tier;
  readonly meaning: string;
  readonly when: (ctx: Context) => boolean;
  readonly call: (ctx: Context) => Call | null;
};

/* ------------------------------------------------------------------ helpers */

/** The lowest legal bid in a strain, or null if even seven is too low. */
function cheapest(auction: Auction, strain: Strain): Call | null {
  for (let level = 1; level <= 7; level++) {
    const candidate = bid(level, strain);
    if (isLegalCall(auction, candidate)) return candidate;
  }
  return null;
}

/** A bid at exactly this level, if it is legal. */
function exactly(auction: Auction, level: number, strain: Strain): Call | null {
  if (level < 1 || level > 7) return null;
  const candidate = bid(level, strain);
  return isLegalCall(auction, candidate) ? candidate : null;
}

const isMajor = (strain: Strain): boolean => strain === 'H' || strain === 'S';

function support(ctx: Context, strain: Strain): number {
  return strain === 'NT' ? 0 : ctx.suits[strain];
}

/** Our longest suit of at least `minimum`, strongest first. */
function bestSuit(ctx: Context, minimum: number): Suit | null {
  const suits = longSuits(ctx.hand, minimum);
  return suits[0] ?? null;
}

/** Suits we hold four or more of, cheapest first — for bidding up the line. */
function biddableUpTheLine(ctx: Context): Suit[] {
  return SUITS.filter((suit) => ctx.suits[suit] >= 4);
}

/** A suit worth overcalling in: five cards with something in it. */
function decentSuit(ctx: Context): Suit | null {
  for (const suit of longSuits(ctx.hand, 5)) {
    const honours = cardsOfSuit(ctx.hand, suit).filter((card) => rankOf(card) >= 11).length;
    if (honours >= 1) return suit;
  }
  return null;
}

/* ------------------------------------------------------------------ opening */

const OPENING: Rule[] = [
  {
    id: 'open-2C',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '23+ points, or about ten playing tricks. Artificial and forcing — it says nothing about clubs.',
    when: (ctx) => ctx.hcp >= 23 || (ctx.tricks >= 10 && ctx.hcp >= 19),
    call: (ctx) => exactly(ctx.auction, 2, 'C'),
  },
  {
    id: 'open-2NT',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '20–22, balanced.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 20 && ctx.hcp <= 22,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'open-strong-two',
    situation: 'opening',
    tier: 'club',
    meaning: 'A strong two: about eight playing tricks and a good suit. Forcing for one round.',
    when: (ctx) => ctx.tricks >= 8 && ctx.hcp >= 16 && ['D', 'H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'open-preempt-four',
    situation: 'opening',
    tier: 'club',
    meaning: 'Weak with an eight-card suit — bidding to get in the way.',
    when: (ctx) => ctx.hcp >= 5 && ctx.hcp <= 10 && (bestSuit(ctx, 8) !== null),
    call: (ctx) => exactly(ctx.auction, 4, bestSuit(ctx, 8) as Strain),
  },
  {
    id: 'open-preempt-three',
    situation: 'opening',
    tier: 'club',
    meaning: 'Weak with a seven-card suit — bidding to get in the way.',
    when: (ctx) => ctx.hcp >= 5 && ctx.hcp <= 10 && (bestSuit(ctx, 7) !== null),
    call: (ctx) => exactly(ctx.auction, 3, bestSuit(ctx, 7) as Strain),
  },
  {
    id: 'open-1NT',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '12–14, balanced. The weak no-trump.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 12 && ctx.hcp <= 14,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'open-one-of-a-suit',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '12–19. Four-card majors, so this can be a four-card suit.',
    when: (ctx) => ctx.hcp >= 12 || (ctx.hcp >= 11 && ruleOfTwenty(ctx.hand)),
    call: (ctx) => exactly(ctx.auction, 1, openingSuit(ctx.hand) as Strain),
  },
  {
    id: 'open-pass',
    situation: 'opening',
    tier: 'kitchen',
    meaning: 'Not enough to open.',
    when: () => true,
    call: () => PASS,
  },
];

/* ---------------------------------------------------- responding to 1NT etc */

const partnerOpened = (strain: Strain, level = 1) => (ctx: Context) =>
  ctx.partnerOpening !== null && ctx.partnerOpening.strain === strain && ctx.partnerOpening.level === level;

const partnerOpenedASuit = (ctx: Context) =>
  ctx.partnerOpening !== null && ctx.partnerOpening.level === 1 && ctx.partnerOpening.strain !== 'NT';

const RESPONSES: Rule[] = [
  // --- partner opened 1NT (12–14), so game needs about 11–12 opposite -------
  {
    id: 'resp-1NT-stayman',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Stayman: 11+ points, asking for a four-card major.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 11 && (ctx.suits.H >= 4 || ctx.suits.S >= 4),
    call: (ctx) => exactly(ctx.auction, 2, 'C'),
  },
  {
    id: 'resp-1NT-3NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '13–18 balanced. Enough for game opposite a weak no-trump.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 13 && ctx.hcp <= 18,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-1NT-2NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '11–12, inviting game. Opener carries on with a maximum.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 11 && ctx.hcp <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-1NT-weak-takeout',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Weak with a long suit — to play. There are no transfers, so this is natural and final.',
    when: (ctx) =>
      partnerOpened('NT')(ctx) && ctx.hcp <= 10 &&
      ['D', 'H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'resp-1NT-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Not enough opposite 12–14 to look for game, and no suit worth escaping to.',
    when: (ctx) => partnerOpened('NT')(ctx),
    call: () => PASS,
  },

  // --- partner opened 2C, artificial and forcing ---------------------------
  {
    id: 'resp-2C-negative',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Negative: fewer than eight points. Says nothing about diamonds.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp <= 7,
    call: (ctx) => exactly(ctx.auction, 2, 'D'),
  },
  {
    id: 'resp-2C-positive-major',
    situation: 'response',
    tier: 'club',
    meaning: 'Eight or more points with a five-card major.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp >= 8 && ['H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'resp-2C-positive-balanced',
    situation: 'response',
    tier: 'club',
    meaning: 'Eight or more points, balanced.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp >= 8,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },

  // --- partner opened a strong two ----------------------------------------
  {
    id: 'resp-strong-two-negative',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Negative: fewer than eight points.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) && ctx.hcp <= 7,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-strong-two-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Eight or more points with support.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) &&
      ctx.hcp >= 8 && support(ctx, ctx.partnerOpening.strain) >= 3,
    call: (ctx) => exactly(ctx.auction, 3, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-strong-two-3NT',
    situation: 'response',
    tier: 'club',
    meaning: 'Eight or more points without support.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) && ctx.hcp >= 8,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },

  // --- partner opened 2NT (20–22) -----------------------------------------
  {
    id: 'resp-2NT-stayman',
    situation: 'response',
    tier: 'club',
    meaning: 'Stayman over 2NT, asking for a four-card major.',
    when: (ctx) => partnerOpened('NT', 2)(ctx) && ctx.hcp >= 4 && (ctx.suits.H >= 4 || ctx.suits.S >= 4),
    call: (ctx) => exactly(ctx.auction, 3, 'C'),
  },
  {
    id: 'resp-2NT-3NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Four or more points opposite 20–22 is enough for game.',
    when: (ctx) => partnerOpened('NT', 2)(ctx) && ctx.hcp >= 4,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-2NT-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Nothing at all opposite 20–22.',
    when: (ctx) => partnerOpened('NT', 2)(ctx),
    call: () => PASS,
  },

  // --- partner opened a preempt at the three or four level -----------------
  {
    id: 'resp-preempt-game',
    situation: 'response',
    tier: 'club',
    meaning: 'Enough opposite a long weak suit to try for game.',
    when: (ctx) =>
      ctx.partnerOpening !== null && ctx.partnerOpening.level >= 3 &&
      ctx.partnerOpening.strain !== 'NT' &&
      support(ctx, ctx.partnerOpening.strain) >= 2 && ctx.points >= 15,
    call: (ctx) => exactly(ctx.auction, 4, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-preempt-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Partner has already described a weak hand with a long suit. Leave it alone.',
    when: (ctx) => ctx.partnerOpening !== null && ctx.partnerOpening.level >= 3,
    call: () => PASS,
  },

  // --- partner opened one of a suit ---------------------------------------
  {
    id: 'resp-jump-shift',
    situation: 'response',
    tier: 'tournament',
    meaning: '16+ with a good suit of its own. Forcing to game.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.points >= 16 && bestSuit(ctx, 5) !== null,
    call: (ctx) => {
      const suit = bestSuit(ctx, 5)!;
      const cheap = cheapest(ctx.auction, suit);
      return cheap && cheap.type === 'bid' ? exactly(ctx.auction, cheap.level + 1, suit) : null;
    },
  },
  {
    id: 'resp-major-jump-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: '10–12 with four-card support. Inviting game.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 10 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 3, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-major-game-raise',
    situation: 'response',
    tier: 'club',
    meaning: '13+ with four-card support — straight to game.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 13,
    call: (ctx) => exactly(ctx.auction, 4, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-major-simple-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6–9 with support.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 3 && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 2, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-new-suit-one-level',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6+ points and at least four cards. Bid up the line at the one level.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && ctx.points >= 6 &&
      biddableUpTheLine(ctx).some((suit) => exactly(ctx.auction, 1, suit) !== null),
    call: (ctx) => {
      const suit = biddableUpTheLine(ctx).find((candidate) => exactly(ctx.auction, 1, candidate) !== null);
      return suit ? exactly(ctx.auction, 1, suit) : null;
    },
  },
  {
    id: 'resp-3NT',
    situation: 'response',
    tier: 'club',
    meaning: '13–15 balanced, no fit to look for.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.balanced && ctx.points >= 13 && ctx.points <= 15,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-2NT',
    situation: 'response',
    tier: 'club',
    meaning: '11–12 balanced, inviting game.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.balanced && ctx.points >= 11 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-new-suit-two-level',
    situation: 'response',
    tier: 'club',
    meaning: '9+ points and a five-card suit, bid at the two level.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.points >= 9 && bestSuit(ctx, 5) !== null,
    call: (ctx) => {
      const suit = bestSuit(ctx, 5)!;
      return exactly(ctx.auction, 2, suit);
    },
  },
  {
    id: 'resp-minor-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6–9 with four-card support for the minor.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && !isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 2, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-1NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6–9, nothing better to say.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'resp-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Too weak to keep the auction alive.',
    when: (ctx) => ctx.points <= 5,
    call: () => PASS,
  },
  /*
   * Responding after they have overcalled. Every rule above assumes a clear run:
   * 1NT and the one-level suit bids are no longer legal once an opponent has
   * bid, so a perfectly ordinary hand fell through to the fallback. This was the
   * whole of the unmatched auctions the coverage test found — one missing
   * branch, not scattered holes.
   */
  {
    id: 'resp-contested-suit',
    situation: 'response',
    tier: 'club',
    meaning: 'Enough to come in over their overcall, with a suit of our own.',
    when: (ctx) => {
      if (!ctx.contested || ctx.points < 10) return false;
      const suit = bestSuit(ctx, 5);
      if (!suit) return false;
      const call = cheapest(ctx.auction, suit);
      return !!call && call.type === 'bid' && call.level <= 3;
    },
    call: (ctx) => cheapest(ctx.auction, bestSuit(ctx, 5)!),
  },
  {
    id: 'resp-contested-notrump',
    situation: 'response',
    tier: 'club',
    meaning: 'Balanced with values, over their overcall.',
    when: (ctx) => ctx.contested && ctx.balanced && ctx.points >= 10 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-contested-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Their overcall has taken our bid away. Passing is not weakness here.',
    when: (ctx) => ctx.contested,
    call: () => PASS,
  },
];

/* -------------------------------------------------------------- opener again */

const weOpened = (strain: Strain, level = 1) => (ctx: Context) =>
  ctx.ourOpening !== null && ctx.ourOpening.strain === strain && ctx.ourOpening.level === level;

const partnerBid = (ctx: Context): { level: number; strain: Strain } | null =>
  ctx.partnerResponse && ctx.partnerResponse.type === 'bid'
    ? { level: ctx.partnerResponse.level, strain: ctx.partnerResponse.strain }
    : null;

const REBIDS: Rule[] = [
  // --- we opened 1NT ------------------------------------------------------
  {
    id: 'rebid-stayman-hearts',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Four hearts. (With both majors, hearts first.)',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2 && ctx.suits.H >= 4,
    call: (ctx) => exactly(ctx.auction, 2, 'H'),
  },
  {
    id: 'rebid-stayman-spades',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Four spades, but not four hearts.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2 && ctx.suits.S >= 4,
    call: (ctx) => exactly(ctx.auction, 2, 'S'),
  },
  {
    id: 'rebid-stayman-denial',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'No four-card major. Says nothing about diamonds.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2,
    call: (ctx) => exactly(ctx.auction, 2, 'D'),
  },
  {
    id: 'rebid-1NT-accept-invite',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Maximum for the weak no-trump, so game it is.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'NT' && partnerBid(ctx)?.level === 2 && ctx.hcp >= 14,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'rebid-1NT-decline-invite',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Minimum — declining the invitation.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'NT' && partnerBid(ctx)?.level === 2,
    call: () => PASS,
  },
  {
    id: 'rebid-1NT-pass-takeout',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Partner has chosen the contract. Leave it alone.',
    when: (ctx) => weOpened('NT')(ctx),
    call: () => PASS,
  },

  // --- we opened one of a suit -------------------------------------------
  {
    id: 'rebid-support-partner-major-game',
    situation: 'rebid',
    tier: 'club',
    meaning: 'Four-card support and extra values — bidding game.',
    when: (ctx) => {
      const reply = partnerBid(ctx);
      return !!reply && reply.strain !== 'NT' && isMajor(reply.strain) &&
        support(ctx, reply.strain) >= 4 && ctx.points >= 16;
    },
    call: (ctx) => exactly(ctx.auction, 4, partnerBid(ctx)!.strain),
  },
  {
    id: 'rebid-support-partner-major',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Four-card support for partner’s suit.',
    when: (ctx) => {
      const reply = partnerBid(ctx);
      return !!reply && reply.strain !== 'NT' && isMajor(reply.strain) && support(ctx, reply.strain) >= 4;
    },
    call: (ctx) => exactly(ctx.auction, partnerBid(ctx)!.level + 1, partnerBid(ctx)!.strain),
  },
  {
    id: 'rebid-raise-our-suit-to-game',
    situation: 'rebid',
    tier: 'club',
    meaning: 'Partner raised and we have plenty — bidding game.',
    when: (ctx) => {
      const reply = partnerBid(ctx);
      return !!reply && !!ctx.ourOpening && reply.strain === ctx.ourOpening.strain &&
        isMajor(reply.strain) && ctx.points >= 17;
    },
    call: (ctx) => exactly(ctx.auction, 4, ctx.ourOpening!.strain),
  },
  {
    id: 'rebid-own-suit',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'A six-card suit, repeated.',
    when: (ctx) => !!ctx.ourOpening && ctx.ourOpening.strain !== 'NT' && support(ctx, ctx.ourOpening.strain) >= 6,
    call: (ctx) => cheapest(ctx.auction, ctx.ourOpening!.strain),
  },
  {
    id: 'rebid-notrump-strong',
    situation: 'rebid',
    tier: 'club',
    meaning: '17–18 balanced. (12–14 would have opened 1NT.)',
    when: (ctx) => ctx.balanced && ctx.hcp >= 17 && ctx.hcp <= 18,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'rebid-notrump-minimum',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: '15–16 balanced. (12–14 would have opened 1NT.)',
    when: (ctx) => ctx.balanced && ctx.hcp >= 15 && ctx.hcp <= 16,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'rebid-second-suit',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'A second suit of four cards or more.',
    when: (ctx) =>
      !!ctx.ourOpening &&
      biddableUpTheLine(ctx).some(
        (suit) => suit !== ctx.ourOpening!.strain && exactly(ctx.auction, 2, suit) !== null,
      ),
    call: (ctx) => {
      const suit = biddableUpTheLine(ctx).find(
        (candidate) => candidate !== ctx.ourOpening!.strain && exactly(ctx.auction, 2, candidate) !== null,
      );
      return suit ? exactly(ctx.auction, 2, suit) : null;
    },
  },
  {
    id: 'rebid-pass',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Minimum, with nothing more to show.',
    when: () => true,
    call: () => PASS,
  },
];

/* -------------------------------------------------------------- competition */

const COMPETITIVE: Rule[] = [
  {
    id: 'overcall-1NT',
    situation: 'overcall',
    tier: 'club',
    meaning: '15–18 balanced. Stronger than the opening 1NT, because we are bidding over information.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 15 && ctx.hcp <= 18 && exactly(ctx.auction, 1, 'NT') !== null,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'overcall-takeout-double',
    situation: 'overcall',
    tier: 'tournament',
    meaning: 'Opening values, short in their suit, support for the others. Asking partner to choose.',
    when: (ctx) =>
      ctx.hcp >= 12 && ctx.theirSuit !== null &&
      ctx.suits[ctx.theirSuit] <= 2 &&
      supportsOtherSuits(ctx.hand, ctx.theirSuit) &&
      isLegalCall(ctx.auction, DOUBLE),
    call: () => DOUBLE,
  },
  {
    id: 'overcall-suit',
    situation: 'overcall',
    tier: 'club',
    meaning: 'A decent five-card suit and enough to be worth showing.',
    when: (ctx) => {
      const suit = decentSuit(ctx);
      if (!suit || ctx.hcp < 9 || ctx.hcp > 16) return false;
      const call = cheapest(ctx.auction, suit);
      // Only at a level the hand can stand: the one level freely, the two level
      // with something extra.
      return !!call && call.type === 'bid' && (call.level === 1 || (call.level === 2 && ctx.hcp >= 12));
    },
    call: (ctx) => cheapest(ctx.auction, decentSuit(ctx)!),
  },
  {
    id: 'advance-raise',
    situation: 'advance',
    tier: 'club',
    meaning: '6+ points with support for partner’s overcall.',
    when: (ctx) =>
      ctx.partnerLastBid !== null && ctx.partnerLastBid.strain !== 'NT' &&
      support(ctx, ctx.partnerLastBid.strain) >= 3 && ctx.points >= 6 && ctx.points <= 11,
    call: (ctx) => exactly(ctx.auction, ctx.partnerLastBid!.level + 1, ctx.partnerLastBid!.strain),
  },
  {
    id: 'advance-own-suit',
    situation: 'advance',
    tier: 'tournament',
    meaning: 'A suit of our own worth showing.',
    when: (ctx) => ctx.points >= 9 && bestSuit(ctx, 5) !== null,
    call: (ctx) => {
      const call = cheapest(ctx.auction, bestSuit(ctx, 5)!);
      return call && call.type === 'bid' && call.level <= 2 ? call : null;
    },
  },
  {
    id: 'overcall-pass',
    situation: 'overcall',
    tier: 'kitchen',
    meaning: 'Nothing worth coming in on.',
    when: () => true,
    call: () => PASS,
  },
  {
    id: 'advance-pass',
    situation: 'advance',
    tier: 'kitchen',
    meaning: 'Nothing to add to partner’s overcall.',
    when: () => true,
    call: () => PASS,
  },
  {
    /*
     * Where the system stops. Everything past the second round of an
     * uncontested auction, and all of a contested one, passes — deliberately,
     * because the alternative is an unbounded rule table. The coverage test
     * counts how often this fires so the size of the simplification stays
     * visible rather than becoming folklore.
     */
    id: 'later-pass',
    situation: 'later',
    tier: 'kitchen',
    meaning: 'The auction is past what the system covers.',
    when: () => true,
    call: () => PASS,
  },
];

/**
 * The whole system, in the order it is consulted. Openings first is not
 * cosmetic: the situations are disjoint, but reading the file top to bottom
 * should follow the shape of an auction.
 */
export const ACOL: readonly Rule[] = [...OPENING, ...RESPONSES, ...REBIDS, ...COMPETITIVE];

export const TIER_ORDER: readonly Tier[] = ['kitchen', 'club', 'tournament'];

/** Rules a bot of this difficulty knows. Weaker bots know strictly fewer. */
export function rulesFor(tier: Tier): Rule[] {
  const ceiling = TIER_ORDER.indexOf(tier);
  return ACOL.filter((rule) => TIER_ORDER.indexOf(rule.tier) <= ceiling);
}
