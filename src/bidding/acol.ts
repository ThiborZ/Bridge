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
    meaning: '23+ punten, of ongeveer tien speelslagen. Conventioneel en forcing — het zegt niets over klaveren.',
    when: (ctx) => ctx.hcp >= 23 || (ctx.tricks >= 10 && ctx.hcp >= 19),
    call: (ctx) => exactly(ctx.auction, 2, 'C'),
  },
  {
    id: 'open-2NT',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '20–22, regelmatige verdeling.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 20 && ctx.hcp <= 22,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'open-strong-two',
    situation: 'opening',
    tier: 'club',
    meaning: 'Een sterke twee: ongeveer acht speelslagen en een goede kleur. Eén ronde forcing.',
    when: (ctx) => ctx.tricks >= 8 && ctx.hcp >= 16 && ['D', 'H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'open-preempt-four',
    situation: 'opening',
    tier: 'club',
    meaning: 'Zwak met een achtkaart — een bod om de tegenpartij dwars te zitten.',
    when: (ctx) => ctx.hcp >= 5 && ctx.hcp <= 10 && (bestSuit(ctx, 8) !== null),
    call: (ctx) => exactly(ctx.auction, 4, bestSuit(ctx, 8) as Strain),
  },
  {
    id: 'open-preempt-three',
    situation: 'opening',
    tier: 'club',
    meaning: 'Zwak met een zevenkaart — een bod om de tegenpartij dwars te zitten.',
    when: (ctx) => ctx.hcp >= 5 && ctx.hcp <= 10 && (bestSuit(ctx, 7) !== null),
    call: (ctx) => exactly(ctx.auction, 3, bestSuit(ctx, 7) as Strain),
  },
  {
    id: 'open-1NT',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '12–14, regelmatige verdeling. De zwakke SA.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 12 && ctx.hcp <= 14,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'open-one-of-a-suit',
    situation: 'opening',
    tier: 'kitchen',
    meaning: '12–19. Er worden vierkaarts hoge kleuren geboden, dus dit kan een vierkaart zijn.',
    when: (ctx) => ctx.hcp >= 12 || (ctx.hcp >= 11 && ruleOfTwenty(ctx.hand)),
    call: (ctx) => exactly(ctx.auction, 1, openingSuit(ctx.hand) as Strain),
  },
  {
    id: 'open-pass',
    situation: 'opening',
    tier: 'kitchen',
    meaning: 'Te weinig om te openen.',
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
    meaning: 'Stayman: 11+ punten, vraagt naar een vierkaart hoge kleur.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 11 && (ctx.suits.H >= 4 || ctx.suits.S >= 4),
    call: (ctx) => exactly(ctx.auction, 2, 'C'),
  },
  {
    id: 'resp-1NT-3NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '13–18 met regelmatige verdeling. Tegenover een zwakke SA genoeg voor de manche.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 13 && ctx.hcp <= 18,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-1NT-2NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '11–12, nodigt uit voor de manche. Met een maximum gaat de openaar door.',
    when: (ctx) => partnerOpened('NT')(ctx) && ctx.hcp >= 11 && ctx.hcp <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-1NT-weak-takeout',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Zwak met een lange kleur — om te spelen. Er worden geen transfers gespeeld, dus dit is natuurlijk en eindbod.',
    when: (ctx) =>
      partnerOpened('NT')(ctx) && ctx.hcp <= 10 &&
      ['D', 'H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'resp-1NT-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Tegenover 12–14 te weinig voor de manche, en geen kleur om naar uit te wijken.',
    when: (ctx) => partnerOpened('NT')(ctx),
    call: () => PASS,
  },

  // --- partner opened 2C, artificial and forcing ---------------------------
  {
    id: 'resp-2C-negative',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Negatief: minder dan acht punten. Zegt niets over ruiten.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp <= 7,
    call: (ctx) => exactly(ctx.auction, 2, 'D'),
  },
  {
    id: 'resp-2C-positive-major',
    situation: 'response',
    tier: 'club',
    meaning: 'Acht punten of meer, met een vijfkaart hoge kleur.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp >= 8 && ['H', 'S'].includes(bestSuit(ctx, 5) ?? ''),
    call: (ctx) => exactly(ctx.auction, 2, bestSuit(ctx, 5) as Strain),
  },
  {
    id: 'resp-2C-positive-balanced',
    situation: 'response',
    tier: 'club',
    meaning: 'Acht punten of meer, regelmatige verdeling.',
    when: (ctx) => partnerOpened('C', 2)(ctx) && ctx.hcp >= 8,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },

  // --- partner opened a strong two ----------------------------------------
  {
    id: 'resp-strong-two-negative',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Negatief: minder dan acht punten.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) && ctx.hcp <= 7,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-strong-two-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Acht punten of meer, met steun.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) &&
      ctx.hcp >= 8 && support(ctx, ctx.partnerOpening.strain) >= 3,
    call: (ctx) => exactly(ctx.auction, 3, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-strong-two-3NT',
    situation: 'response',
    tier: 'club',
    meaning: 'Acht punten of meer, zonder steun.',
    when: (ctx) =>
      ctx.partnerOpening?.level === 2 && ['D', 'H', 'S'].includes(ctx.partnerOpening.strain) && ctx.hcp >= 8,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },

  // --- partner opened 2NT (20–22) -----------------------------------------
  {
    id: 'resp-2NT-stayman',
    situation: 'response',
    tier: 'club',
    meaning: 'Stayman op 2SA, vraagt naar een vierkaart hoge kleur.',
    when: (ctx) => partnerOpened('NT', 2)(ctx) && ctx.hcp >= 4 && (ctx.suits.H >= 4 || ctx.suits.S >= 4),
    call: (ctx) => exactly(ctx.auction, 3, 'C'),
  },
  {
    id: 'resp-2NT-3NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Vier punten of meer tegenover 20–22 is genoeg voor de manche.',
    when: (ctx) => partnerOpened('NT', 2)(ctx) && ctx.hcp >= 4,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-2NT-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Helemaal niets tegenover 20–22.',
    when: (ctx) => partnerOpened('NT', 2)(ctx),
    call: () => PASS,
  },

  // --- partner opened a preempt at the three or four level -----------------
  {
    id: 'resp-preempt-game',
    situation: 'response',
    tier: 'club',
    meaning: 'Genoeg tegenover een lange zwakke kleur om de manche te proberen.',
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
    meaning: 'Partner heeft al een zwakke hand met een lange kleur laten zien. Laat maar staan.',
    when: (ctx) => ctx.partnerOpening !== null && ctx.partnerOpening.level >= 3,
    call: () => PASS,
  },

  // --- partner opened one of a suit ---------------------------------------
  {
    id: 'resp-jump-shift',
    situation: 'response',
    tier: 'tournament',
    meaning: '16+ met een eigen goede kleur. Manche-forcing.',
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
    meaning: '10–12 met vierkaarts steun. Nodigt uit voor de manche.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 10 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 3, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-major-game-raise',
    situation: 'response',
    tier: 'club',
    meaning: '13+ met vierkaarts steun — meteen naar de manche.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 13,
    call: (ctx) => exactly(ctx.auction, 4, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-major-simple-raise',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6–9 met steun.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 3 && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 2, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-new-suit-one-level',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6+ punten en minstens vier kaarten. Op eenniveau de laagste kleur eerst.',
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
    meaning: '13–15 met regelmatige verdeling, geen fit om naar te zoeken.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.balanced && ctx.points >= 13 && ctx.points <= 15,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'resp-2NT',
    situation: 'response',
    tier: 'club',
    meaning: '11–12 met regelmatige verdeling, nodigt uit voor de manche.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.balanced && ctx.points >= 11 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-new-suit-two-level',
    situation: 'response',
    tier: 'club',
    meaning: '9+ punten en een vijfkaart, geboden op tweeniveau.',
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
    meaning: '6–9 met vierkaarts steun voor de lage kleur.',
    when: (ctx) =>
      partnerOpenedASuit(ctx) && !isMajor(ctx.partnerOpening!.strain) &&
      support(ctx, ctx.partnerOpening!.strain) >= 4 && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 2, ctx.partnerOpening!.strain),
  },
  {
    id: 'resp-1NT',
    situation: 'response',
    tier: 'kitchen',
    meaning: '6–9, niets beters te melden.',
    when: (ctx) => partnerOpenedASuit(ctx) && ctx.points >= 6 && ctx.points <= 9,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'resp-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Te zwak om het bieden gaande te houden.',
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
    meaning: 'Genoeg om over hun volgbod heen te bieden, met een eigen kleur.',
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
    meaning: 'Regelmatige verdeling met waarden, over hun volgbod heen.',
    when: (ctx) => ctx.contested && ctx.balanced && ctx.points >= 10 && ctx.points <= 12,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'resp-contested-pass',
    situation: 'response',
    tier: 'kitchen',
    meaning: 'Hun volgbod heeft ons bod weggenomen. Passen is hier geen zwakte.',
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
    meaning: 'Vier harten. (Met beide hoge kleuren eerst harten.)',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2 && ctx.suits.H >= 4,
    call: (ctx) => exactly(ctx.auction, 2, 'H'),
  },
  {
    id: 'rebid-stayman-spades',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Vier schoppen, maar geen vier harten.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2 && ctx.suits.S >= 4,
    call: (ctx) => exactly(ctx.auction, 2, 'S'),
  },
  {
    id: 'rebid-stayman-denial',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Geen vierkaart hoge kleur. Zegt niets over ruiten.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'C' && partnerBid(ctx)?.level === 2,
    call: (ctx) => exactly(ctx.auction, 2, 'D'),
  },
  {
    id: 'rebid-1NT-accept-invite',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Maximum voor de zwakke SA, dus op naar de manche.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'NT' && partnerBid(ctx)?.level === 2 && ctx.hcp >= 14,
    call: (ctx) => exactly(ctx.auction, 3, 'NT'),
  },
  {
    id: 'rebid-1NT-decline-invite',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Minimum — de uitnodiging afgeslagen.',
    when: (ctx) => weOpened('NT')(ctx) && partnerBid(ctx)?.strain === 'NT' && partnerBid(ctx)?.level === 2,
    call: () => PASS,
  },
  {
    id: 'rebid-1NT-pass-takeout',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Partner heeft het contract gekozen. Laat maar staan.',
    when: (ctx) => weOpened('NT')(ctx),
    call: () => PASS,
  },

  // --- we opened one of a suit -------------------------------------------
  {
    id: 'rebid-support-partner-major-game',
    situation: 'rebid',
    tier: 'club',
    meaning: 'Vierkaarts steun en extra waarden — op naar de manche.',
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
    meaning: 'Vierkaarts steun voor de kleur van partner.',
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
    meaning: 'Partner heeft verhoogd en wij hebben ruim genoeg — op naar de manche.',
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
    meaning: 'Een zeskaart, nog een keer geboden.',
    when: (ctx) => !!ctx.ourOpening && ctx.ourOpening.strain !== 'NT' && support(ctx, ctx.ourOpening.strain) >= 6,
    call: (ctx) => cheapest(ctx.auction, ctx.ourOpening!.strain),
  },
  {
    id: 'rebid-notrump-strong',
    situation: 'rebid',
    tier: 'club',
    meaning: '17–18 met regelmatige verdeling. (Met 12–14 was 1SA geopend.)',
    when: (ctx) => ctx.balanced && ctx.hcp >= 17 && ctx.hcp <= 18,
    call: (ctx) => exactly(ctx.auction, 2, 'NT'),
  },
  {
    id: 'rebid-notrump-minimum',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: '15–16 met regelmatige verdeling. (Met 12–14 was 1SA geopend.)',
    when: (ctx) => ctx.balanced && ctx.hcp >= 15 && ctx.hcp <= 16,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'rebid-second-suit',
    situation: 'rebid',
    tier: 'kitchen',
    meaning: 'Een tweede kleur van vier kaarten of meer.',
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
    meaning: 'Minimum, niets meer te laten zien.',
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
    meaning: '15–18 met regelmatige verdeling. Sterker dan de 1SA-opening, omdat we over informatie heen bieden.',
    when: (ctx) => ctx.balanced && ctx.hcp >= 15 && ctx.hcp <= 18 && exactly(ctx.auction, 1, 'NT') !== null,
    call: (ctx) => exactly(ctx.auction, 1, 'NT'),
  },
  {
    id: 'overcall-takeout-double',
    situation: 'overcall',
    tier: 'tournament',
    meaning: 'Openingskracht, kort in hun kleur, steun voor de andere. Vraagt partner te kiezen.',
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
    meaning: 'Een behoorlijke vijfkaart en genoeg om te laten zien.',
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
    meaning: '6+ punten met steun voor het volgbod van partner.',
    when: (ctx) =>
      ctx.partnerLastBid !== null && ctx.partnerLastBid.strain !== 'NT' &&
      support(ctx, ctx.partnerLastBid.strain) >= 3 && ctx.points >= 6 && ctx.points <= 11,
    call: (ctx) => exactly(ctx.auction, ctx.partnerLastBid!.level + 1, ctx.partnerLastBid!.strain),
  },
  {
    id: 'advance-own-suit',
    situation: 'advance',
    tier: 'tournament',
    meaning: 'Een eigen kleur die het waard is om te laten zien.',
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
    meaning: 'Niets om mee tussen te komen.',
    when: () => true,
    call: () => PASS,
  },
  {
    id: 'advance-pass',
    situation: 'advance',
    tier: 'kitchen',
    meaning: 'Niets toe te voegen aan het volgbod van partner.',
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
    meaning: 'Het bieden is voorbij wat het systeem afdekt.',
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
