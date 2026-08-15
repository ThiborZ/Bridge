/**
 * The table on screen.
 *
 * She sits South. Three random-legal bots fill the other seats — the same ones
 * the engine is fuzz-tested against, which play terribly and will be replaced in
 * phase 3. The point of this phase is that a whole deal can be played start to
 * finish with a finger, so what the bots choose matters less than that every
 * step of the deal is visible and unhurried.
 *
 * Two pieces of bridge that the screen has to get right, and that are easy to
 * get wrong:
 *
 *   Dummy's cards are played by declarer. If she declares, she plays her own
 *   hand AND her partner's. If her partner declares, she is dummy and plays
 *   nothing at all — that is not a bug, it is the game.
 *
 *   A completed trick has to stay on the table long enough to be read. Sweeping
 *   it away the instant the fourth card lands makes the play impossible to
 *   follow, which is exactly the complaint about the apps she already has.
 */

import { cardToString, sortHand, suitOf } from '../cards.js';
import type { Card, Suit } from '../cards.js';
import { STRAINS, callToString, isLegalCall, legalCalls, tricksRequired } from '../auction.js';
import type { Call } from '../auction.js';
import { SEATS, isVulnerable, nextSeat, partnerOf, sideOf } from '../seats.js';
import type { Seat } from '../seats.js';
import { legalPlays, trickWinner, trumpSuit } from '../play.js';
import type { Trick } from '../play.js';
import { applyCall, applyPlay, chicagoDeal, newGame, resultOf, turnOf } from '../game.js';
import type { Game } from '../game.js';
import { mulberry32 } from '../random.js';
import { chooseCard } from '../bots/levels.js';
import type { Tier } from '../bots/levels.js';
import { decideCall } from '../bidding/index.js';
import { registerServiceWorker, watchInstallability } from './install.js';
import { currentSettings, loadSettings, updateSettings } from './settings.js';
import { SUIT_SYMBOL, button, element } from './dom.js';
import {
  SEAT_COMPASS, SEAT_NAME as SEAT_NAMES, callLabel, callSpoken, cardRankLabel, cardSpoken,
  contractLabel, describeOutcome, tricks, VULNERABILITY,
} from './dutch.js';
import { closeMenu, renderMenu } from './menu.js';
import { markWelcomeSeen, renderWelcome } from './welcome.js';
import { HANDS_PER_GAME, renderFinished, renderSetup } from './screens.js';
import type { Strengths } from './screens.js';
import { clearSavedGame, loadGame, saveGame } from './saved.js';
import { celebrate, celebrationFor, clearCelebration, headlineFor } from './celebrate.js';
import type { Celebration } from './celebrate.js';

const HUMAN: Seat = 'S';

/**
 * The bots pause before acting, and a completed trick is held on the table, so
 * the deal can be followed. `?fast` strips the pauses out — the deal is then
 * unwatchable, which is the point: it is for driving many deals through the
 * interface while testing, not for playing.
 */
const PARAMS = new URLSearchParams(location.search);
const FAST = PARAMS.has('fast');

/**
 * With a mouse, hovering lifts a card before you commit to it — that nudge is
 * the preview. A tablet has no hover, so a tap would be both the preview and
 * the play, on a strip of card about a third of its width where the next card
 * overlaps it. That is under the size a finger can reliably hit, and there is
 * no undo.
 *
 * So on touch it takes two taps: the first lifts the card clear of its
 * neighbours, the second plays it. The lifted card is raised above the others,
 * which also makes the second tap target the whole card rather than a sliver.
 */
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const CALL_DELAY = FAST ? 0 : 700;
const CARD_DELAY = FAST ? 0 : 750;
/**
 * How long a completed trick stays on the table. `?pause=3000` to try a longer
 * one — how long she needs to read four cards is a question to settle with her,
 * not a number to guess at, and it wants to be easy to try.
 */
const TRICK_PAUSE = FAST ? 0 : Number(PARAMS.get('pause') ?? 1500);


type Session = {
  handNumber: number;
  game: Game;
  totals: { NS: number; EW: number };
  /** Held on screen after the fourth card so the trick can be read. */
  pendingTrick: Trick | null;
  /**
   * What each bot bid was meant to show, by position in the auction. She has to
   * be able to read the auction, and a bid nobody can explain is worse than a
   * bad one.
   */
  meanings: Map<number, string>;
  /** How the hand just finished, for the effect and the headline. */
  celebration: Celebration;
  rng: () => number;
};

const app = document.getElementById('app')!;
let session: Session = newSession();
loadSettings(); // reads storage and stamps the document; the module holds the state

/**
 * A game has a beginning and an end.
 *
 *   empty    a bare table. Nothing dealt, nobody playing.
 *   setup    choosing who you are playing against, before any cards exist.
 *   playing  four hands, which is one Chicago cycle — the same cycle the
 *            vulnerability already turns on, so a game ends where the scoring
 *            says it should.
 *   finished the final score, until the table is cleared.
 *
 * It used to open mid-auction with cards already dealt, which gave no moment to
 * decide anything and no moment to stop.
 */
type Screen = 'empty' | 'setup' | 'playing' | 'finished';
let screen: Screen = 'empty';

/**
 * Chosen while setting a game up and fixed for the length of that game. The
 * last choice is remembered, so the second game does not start by asking the
 * same question again — it just offers the same answer.
 */
let chosenStrengths: Strengths = {
  opponents: currentSettings().opponents,
  partner: currentSettings().partner,
};
let gameStrengths: Strengths = chosenStrengths;

/**
 * Two separate handles, and they must stay separate. They were one, and a tap
 * landing during the pause after a completed trick cancelled the pause itself:
 * `advance` cleared the timer and then returned early because a trick was still
 * showing, so nothing ever cleared it and the deal froze for good.
 */
let botTimer: number | undefined;
let pauseTimer: number | undefined;

/** On touch, the card lifted and waiting for a second tap to play it. */
let selectedCard: Card | null = null;

function newSession(): Session {
  const rng = mulberry32(Date.now() >>> 0);
  return {
    handNumber: 1,
    game: newGame(chicagoDeal(freshDealId(), 1)),
    totals: { NS: 0, EW: 0 },
    pendingTrick: null,
    meanings: new Map(),
    celebration: 'none',
    rng,
  };
}

function freshDealId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ------------------------------------------------------------------ control */

/** Seats whose cards she plays. Declarer plays dummy's hand as well as their own. */
function humanSeats(game: Game): Seat[] {
  if (game.phase === 'auction') return [HUMAN];
  if (game.phase !== 'play' || !game.play) return [];
  const { declarer } = game.play.contract;
  if (declarer === HUMAN) return [HUMAN, partnerOf(HUMAN)];
  if (partnerOf(declarer) === HUMAN) return []; // she is dummy; her partner plays her cards
  return [HUMAN];
}

/**
 * While a completed trick is being held on the table nobody is waiting for her —
 * which both stops the cards inviting a tap that would be swallowed, and keeps
 * a stray click from re-entering the state machine mid-pause.
 */
function waitingForHer(game: Game): boolean {
  if (session.pendingTrick) return false;
  const turn = turnOf(game);
  return turn !== null && humanSeats(game).includes(turn);
}

/** Dummy is face up once the opening lead has been made. */
function exposedDummy(game: Game): Seat | null {
  if (game.phase !== 'play' || !game.play) return null;
  const played = game.play.completed.length > 0 || game.play.current.cards.length > 0;
  return played ? partnerOf(game.play.contract.declarer) : null;
}

/**
 * Written after every change, so the tablet dropping the app from memory costs
 * nothing. It is a few hundred bytes — the deal's seed plus the calls and cards
 * — so there is no reason to be clever about when.
 */
function remember(): void {
  if (screen !== 'playing') return;
  saveGame(session.game, session.handNumber, session.totals, gameStrengths, session.meanings);
}

function advance(): void {
  window.clearTimeout(botTimer);
  // A card lifted for a second tap must not survive into somebody else's turn.
  selectedCard = null;
  remember();
  render();
  if (screen !== 'playing') return; // nobody plays at an empty or finished table
  if (session.pendingTrick) return; // the pause timer owns what happens next
  const turn = turnOf(session.game);
  if (turn === null || waitingForHer(session.game)) return;
  botTimer = window.setTimeout(
    botMove,
    session.game.phase === 'auction' ? CALL_DELAY : CARD_DELAY,
  );
}

/**
 * How well this seat plays. Her partner is set apart from the opponents, so he
 * can be the one carrying her or the one she has to carry.
 */
function tierFor(seat: Seat): Tier {
  return seat === partnerOf(HUMAN) ? gameStrengths.partner : gameStrengths.opponents;
}

function botMove(): void {
  const { game } = session;
  if (game.phase === 'auction') {
    const seat = turnOf(game)!;
    // The chosen strength governs the bidding too, not just the card play.
    // Without the tier this fell back to the full Acol table, so a Kitchen
    // table opponent bid like a tournament player and only played badly.
    const decision = decideCall(game.auction, game.deal.hands[seat], seat, { tier: tierFor(seat) });
    session.meanings.set(game.auction.calls.length, decision.meaning);
    session.game = applyCall(game, decision.call);
    advance();
  } else if (game.phase === 'play' && game.play) {
    const seat = turnOf(game)!;
    commitCard(chooseCard(game.play, seat, tierFor(seat), session.rng));
  }
}

/** Applies a card, then holds a completed trick on the table before moving on. */
function commitCard(card: Card): void {
  const before = session.game.play?.completed.length ?? 0;
  session.game = applyPlay(session.game, card);
  const after = session.game.play?.completed.length ?? 0;
  // Written here rather than only in `advance`: the card that completes a trick
  // goes on to wait out the pause, and a save taken after that pause would be
  // one card behind what she can see on the table.
  remember();

  if (after > before) {
    session.pendingTrick = session.game.play!.completed[after - 1]!;
    render();
    window.clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(() => {
      session.pendingTrick = null;
      finishHandIfOver();
      advance();
    }, TRICK_PAUSE);
    return;
  }
  advance();
}

function finishHandIfOver(): void {
  if (session.game.phase !== 'complete') return;
  const result = resultOf(session.game);
  if (!result) return;
  session.totals.NS += result.northSouthScore;
  session.totals.EW -= result.northSouthScore;

  // Scaled to what her side won, which is why beating their contract counts too.
  session.celebration = celebrationFor(result.northSouthScore, result.contract?.level ?? 0);
  celebrate(session.celebration);
}

/**
 * Set when a newer version has been fetched in the background. It is applied
 * between hands rather than immediately: reloading while she is looking at
 * thirteen cards would throw the deal away to fix a typo.
 */
let updateWaiting = false;

function applyUpdateIfWaiting(): boolean {
  if (!updateWaiting) return false;
  location.reload();
  return true;
}

function nextHand(): void {
  // Four hands is one Chicago cycle, and the end of a game.
  if (session.handNumber >= HANDS_PER_GAME) {
    window.clearTimeout(botTimer);
    window.clearTimeout(pauseTimer);
    clearCelebration();
    clearSavedGame(); // the game is over; there is nothing to come back to
    screen = 'finished';
    render();
    return;
  }
  if (applyUpdateIfWaiting()) return;
  window.clearTimeout(pauseTimer); // a pause left over from the last trick
  const handNumber = session.handNumber + 1;
  session.handNumber = handNumber;
  session.game = newGame(chicagoDeal(freshDealId(), handNumber));
  session.pendingTrick = null;
  session.meanings.clear();
  session.celebration = 'none';
  clearCelebration();
  advance();
}

/* ------------------------------------------------------------------- render */

/**
 * A card face: the index in the top-left corner, which is the part that stays
 * visible when hands overlap, plus a large watermark pip in the opposite corner
 * so a card lying alone on the table still looks like a card.
 */
function cardInnards(card: Card): HTMLElement[] {
  const suit = suitOf(card);
  const index = element('span', 'index');
  index.append(
    // H, V and B — the Dutch court cards, not K, Q and J.
    element('span', 'rank', cardRankLabel(card)),
    element('span', 'pip', SUIT_SYMBOL[suit]),
  );
  return [index, element('span', 'watermark', SUIT_SYMBOL[suit])];
}

function cardFace(card: Card): HTMLElement {
  const node = element('span', `card suit-${suitOf(card)}`);
  node.append(...cardInnards(card));
  node.setAttribute('aria-label', cardSpoken(card));
  return node;
}

function cardButton(card: Card, playable: boolean, onPlay: (card: Card) => void): HTMLElement {
  const chosen = TOUCH && card === selectedCard;
  const button = element('button', `card suit-${suitOf(card)}${chosen ? ' selected' : ''}`);
  button.type = 'button';
  button.disabled = !playable;
  button.append(...cardInnards(card));
  button.setAttribute('aria-label',
    chosen ? `${cardSpoken(card)} — nog een keer tikken om te spelen` : cardSpoken(card));
  if (playable) {
    button.addEventListener('click', () => {
      if (!TOUCH) { onPlay(card); return; }
      if (selectedCard === card) { selectedCard = null; onPlay(card); return; }
      selectedCard = card;
      render();
    });
  }
  return button;
}

function renderHand(seat: Seat, vertical: boolean): HTMLElement {
  const { game } = session;
  const hand = game.phase === 'play' && game.play ? game.play.hands[seat] : game.deal.hands[seat];
  // Once the deal is over every hand turns over, so she can see what everyone
  // held and why it went the way it did.
  const faceUp = seat === HUMAN || seat === exposedDummy(game) || game.phase === 'complete';
  const list = element('ul', `hand${vertical ? ' vertical' : ''}${faceUp ? ' face-up' : ''}`);

  if (!faceUp) {
    for (let i = 0; i < hand.length; i++) {
      const item = element('li');
      item.append(element('span', 'card back'));
      list.append(item);
    }
    list.setAttribute('aria-label', `${SEAT_NAMES[seat]}: ${hand.length} cards`);
    return list;
  }

  const cards = sortHand(hand);
  const herTurn = waitingForHer(game) && turnOf(game) === seat && game.phase === 'play';
  const playable = herTurn && game.play ? new Set(legalPlays(game.play, seat)) : new Set<Card>();
  if (herTurn) list.classList.add('choosable');

  let previousSuit: Suit | null = null;
  for (const card of cards) {
    const item = element('li');
    const suit = suitOf(card);
    if (previousSuit !== null && suit !== previousSuit) item.classList.add('suit-break');
    previousSuit = suit;
    item.append(
      herTurn
        ? cardButton(card, playable.has(card), onPlayCard)
        : cardFace(card),
    );
    list.append(item);
  }
  return list;
}

function nameplate(seat: Seat): HTMLElement {
  const { game } = session;
  const plate = element('div', 'nameplate');
  const turn = turnOf(game);
  if (turn === seat && !session.pendingTrick) plate.classList.add('to-play');
  if (isVulnerable(sideOf(seat), game.deal.vulnerability)) plate.classList.add('vulnerable');

  plate.append(element('span', undefined, SEAT_NAMES[seat]));
  if (seat === game.deal.dealer && game.phase === 'auction') {
    plate.append(element('span', 'role', 'gever'));
  }
  if (game.phase !== 'auction' && game.play) {
    const { declarer } = game.play.contract;
    if (seat === declarer) plate.append(element('span', 'role', 'leider'));
    else if (seat === partnerOf(declarer)) plate.append(element('span', 'role', 'blinde'));
  }
  return plate;
}

function renderSeat(seat: Seat, area: string, vertical: boolean): HTMLElement {
  const box = element('div', `seat seat-${area}`);
  const parts = [nameplate(seat), renderHand(seat, vertical)];
  // North's plate above the cards, South's below, so both read outward.
  box.append(...(seat === 'S' ? parts.reverse() : parts));
  return box;
}

function renderTrick(): HTMLElement {
  const { game, pendingTrick } = session;
  const middle = element('div', 'middle');

  if (game.phase === 'auction') {
    const message = element('div', 'middle-message');
    const heading = element('strong', undefined, 'Het bieden');
    message.append(heading, element('span', undefined,
      waitingForHer(game) ? 'Jij bent aan de beurt.' : `Wachten op ${SEAT_NAMES[turnOf(game)!]}…`));
    middle.append(message);
    return middle;
  }

  if (game.phase === 'complete' && !pendingTrick) {
    middle.append(renderCompleteMessage());
    return middle;
  }

  const trick = pendingTrick ?? game.play!.current;
  const winner = pendingTrick ? trickWinner(pendingTrick, trumpSuit(game.play!.contract)) : null;
  const area = element('div', 'trick');
  trick.cards.forEach((card, index) => {
    const seat = nextSeat(trick.leader, index);
    const slot = element('div', `played-${seat}`);
    const face = cardFace(card);
    if (seat === winner) face.classList.add('winner');
    slot.append(face);
    area.append(slot);
  });
  middle.append(area);

  if (trick.cards.length === 0 && !pendingTrick) {
    const message = element('div', 'middle-message');
    message.append(element('span', undefined,
      waitingForHer(game) ? 'Jij komt uit.' : `${SEAT_NAMES[turnOf(game)!]} komt uit…`));
    middle.append(message);
  }

  // Says what the lifted card is waiting for, since nothing else on a tablet does.
  if (selectedCard !== null) {
    const confirm = element('div', 'tap-again');
    confirm.append(element('span', undefined,
      `${cardSpoken(selectedCard)} — tik er nog een keer op om hem te spelen`));
    middle.append(confirm);
  }
  return middle;
}

function renderCompleteMessage(): HTMLElement {
  const result = resultOf(session.game);
  const message = element('div', 'middle-message');
  if (!result || !result.contract || !result.breakdown) {
    message.append(element('strong', undefined, 'Gepast'), element('span', undefined, 'Niemand bood. Door naar het volgende spel.'));
    return message;
  }
  const forUs = result.northSouthScore > 0;
  const headline = headlineFor(session.celebration, forUs);
  if (headline) {
    message.classList.add(`outcome-${session.celebration}`);
    message.append(element('div', 'fanfare', headline));
  }
  message.append(
    element('strong', undefined, contractLabel(result.contract)),
    element('span', undefined, `${describeOutcome(result.breakdown)} — ${tricks(result.tricksWon)}`),
  );
  return message;
}

/* -------------------------------------------------------------------- panel */

function renderAuctionTable(): HTMLElement {
  const { auction } = session.game;
  const table = element('table', 'auction');
  const head = element('thead');
  const headRow = element('tr');
  for (const seat of SEATS) headRow.append(element('th', undefined, seat));
  head.append(headRow);
  table.append(head);

  const body = element('tbody');
  const offset = SEATS.indexOf(auction.dealer);
  const cells: (Call | null)[] = [...Array(offset).fill(null), ...auction.calls];
  const turnIndex = cells.length;
  // Room for the call that is about to be made, but only while one still is.
  const pending = session.game.phase === 'auction' ? 1 : 0;
  const rows = Math.max(1, Math.ceil((cells.length + pending) / 4));

  for (let row = 0; row < rows; row++) {
    const tr = element('tr');
    for (let column = 0; column < 4; column++) {
      const index = row * 4 + column;
      const call = cells[index];
      if (index === turnIndex && session.game.phase === 'auction') tr.classList.add('current');
      if (call === null || call === undefined) {
        tr.append(element('td', 'empty', '·'));
        continue;
      }
      const cell = element('td', callClass(call), callLabel(call));
      const meaning = session.meanings.get(index - offset);
      if (meaning) {
        cell.title = meaning;
        cell.setAttribute('aria-label', `${callToString(call)} — ${meaning}`);
      }
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}

function callClass(call: Call): string {
  if (call.type === 'bid') return `strain-${call.strain}`;
  return call.type === 'pass' ? '' : 'penalty';
}

function renderBiddingBox(): HTMLElement {
  const box = element('div', 'bidding-box');
  const { auction } = session.game;
  const legal = new Set(legalCalls(auction).map(callToString));

  const grid = element('div', 'bid-grid');
  for (let level = 1; level <= 7; level++) {
    for (const strain of STRAINS) {
      const call: Call = { type: 'bid', level, strain };
      const button = element('button', `bid strain-${strain}`, callLabel(call));
      button.type = 'button';
      button.disabled = !legal.has(callToString(call));
      button.setAttribute('aria-label', callSpoken(call));
      if (!button.disabled) button.addEventListener('click', () => onCall(call));
      grid.append(button);
    }
  }

  const row = element('div', 'bid-row');
  const specials: Array<{ call: Call; className: string }> = [
    { call: { type: 'pass' }, className: 'pass' },
    { call: { type: 'double' }, className: 'dbl' },
    { call: { type: 'redouble' }, className: 'rdbl' },
  ];
  for (const { call, className } of specials) {
    const button = element('button', `bid ${className}`, callLabel(call));
    button.type = 'button';
    button.setAttribute('aria-label', callSpoken(call));
    button.disabled = !isLegalCall(auction, call);
    if (!button.disabled) button.addEventListener('click', () => onCall(call));
    row.append(button);
  }

  box.append(grid, row);
  return box;
}

function renderResult(): HTMLElement {
  const section = element('section', 'result');
  const result = resultOf(session.game);
  if (!result) return section;

  if (!result.contract || !result.breakdown) {
    section.append(element('div', 'headline', 'Gepast'));
  } else {
    const { breakdown } = result;
    const headline = element('div', `headline ${breakdown.made ? 'made' : 'failed'}`,
      `${contractLabel(result.contract)} — ${describeOutcome(breakdown)}`);
    section.append(headline);

    const table = element('table', 'breakdown');
    const rows: Array<[string, number]> = breakdown.made
      ? [
          ['Slagpunten', breakdown.contractPoints],
          ['Overslagen', breakdown.overtrickPoints],
          [breakdown.gameBonus >= 300 ? 'Manchebonus' : 'Deelscore', breakdown.gameBonus],
          ['Slembonus', breakdown.slamBonus],
          ['Voor het doublet', breakdown.insultBonus],
        ]
      : [['Down', -breakdown.penalty]];
    for (const [label, value] of rows) {
      if (value === 0) continue;
      const tr = element('tr');
      tr.append(element('td', undefined, label), element('td', undefined, String(value)));
      table.append(tr);
    }
    const totalRow = element('tr', 'total');
    totalRow.append(
      element('td', undefined, `Voor ${sideOf(result.contract.declarer) === 'NS' ? 'N-Z' : 'O-W'}`),
      element('td', undefined, String(breakdown.score)),
    );
    table.append(totalRow);
    section.append(table);
  }

  const last = session.handNumber >= HANDS_PER_GAME;
  section.append(button('action', last ? 'Eindstand' : 'Volgend spel', nextHand));
  return section;
}

function renderPanel(): HTMLElement {
  const { game } = session;
  const panel = element('aside', 'panel');

  if (!tableIsSet()) {
    const idle = element('section');
    idle.append(element('h2', undefined, 'Geen spel bezig'));
    idle.append(element('div', 'hint',
      'Een spel is vier gevers lang. Daarna zie je de eindstand en ruim je de tafel op.'));
    panel.append(idle);
    return panel;
  }

  const header = element('section');
  header.append(
    element('div', 'hand-number', `Spel ${session.handNumber} van ${HANDS_PER_GAME}`),
    element('div', 'deal-line',
      `spel ${game.deal.id} · gever ${SEAT_COMPASS[game.deal.dealer]} · kwetsbaar ${VULNERABILITY[game.deal.vulnerability]}`),
  );
  panel.append(header);

  if (game.phase === 'play' && game.play) {
    const { contract } = game.play;
    const status = element('section');
    status.append(
      element('h2', undefined, 'Contract'),
      element('div', 'hand-number', contractLabel(contract)),
      element('div', 'hint',
        `${tricksRequired(contract)} slagen nodig · ` +
        `N-Z ${game.play.tricksWon.NS} · O-W ${game.play.tricksWon.EW}`),
    );
    if (humanSeats(game).length === 0) {
      status.append(element('div', 'hint',
        'Jij bent deze hand de blinde — je partner speelt jouw kaarten. Achteroverleunen en kijken dus.'));
    } else if (humanSeats(game).length === 2) {
      status.append(element('div', 'hint',
        'Jij bent leider, dus je speelt ook de kaarten van de blinde.'));
    }
    panel.append(status);
  }

  const auctionSection = element('section');
  auctionSection.append(element('h2', undefined, 'Biedverloop'), renderAuctionTable());
  // The most recent bot call, in words. Hovering any call shows its own.
  const lastIndex = game.auction.calls.length - 1;
  const lastMeaning = session.meanings.get(lastIndex);
  if (lastMeaning && game.phase === 'auction') {
    const seat = SEATS[(SEATS.indexOf(game.auction.dealer) + lastIndex) % 4]!;
    // The suit symbol, matching the grid — "1S" in this font reads as "15".
    auctionSection.append(element('div', 'hint',
      `${SEAT_NAMES[seat]}: ${callLabel(game.auction.calls[lastIndex]!)} — ${lastMeaning}`));
  }
  panel.append(auctionSection);

  if (game.phase === 'auction') {
    const bidding = element('section');
    const heading = element('h2', undefined, waitingForHer(game) ? 'Jouw bod' : 'Bieden');
    bidding.append(heading);
    if (waitingForHer(game)) bidding.append(renderBiddingBox());
    else bidding.append(element('div', 'hint', `Wachten op ${SEAT_NAMES[turnOf(game)!]}…`));
    panel.append(bidding);
  }

  if (game.phase === 'complete') panel.append(renderResult());

  const tally = element('section');
  tally.append(element('h2', undefined, 'Deze avond'));
  const totals = element('div', 'tally');
  for (const [label, value] of [['Noord-Zuid', session.totals.NS], ['Oost-West', session.totals.EW]] as const) {
    const box = element('div');
    box.append(element('span', undefined, label), element('span', undefined, String(value)));
    totals.append(box);
  }
  tally.append(totals);
  panel.append(tally);

  return panel;
}

/**
 * What is on screen. It opens on `home` and waits to be told to start, rather
 * than dealing the moment it loads.
 */
let showingWelcome = false;

function dismissWelcome(): void {
  showingWelcome = false;
  markWelcomeSeen();
  render();
}

function openSetup(): void {
  window.clearTimeout(botTimer);
  window.clearTimeout(pauseTimer);
  screen = 'setup';
  render();
}

function beginGame(): void {
  window.clearTimeout(botTimer);
  window.clearTimeout(pauseTimer);
  clearCelebration();
  session = newSession();
  gameStrengths = chosenStrengths;
  updateSettings(chosenStrengths); // remembered as the default for next time
  screen = 'playing';
  advance();
}

/** Back to a bare table, with nothing dealt. */
function clearTable(): void {
  window.clearTimeout(botTimer);
  window.clearTimeout(pauseTimer);
  clearCelebration();
  clearSavedGame();
  session = newSession();
  screen = 'empty';
  render();
}

/**
 * Pick up where she left off. Only a game that was actually in progress is
 * restored — a finished or unstarted one has nothing worth coming back to.
 */
function restoreSavedGame(): boolean {
  const saved = loadGame();
  if (saved === null) return false;
  if (saved.game.phase === 'complete' && saved.handNumber >= HANDS_PER_GAME) {
    clearSavedGame();
    return false;
  }
  session = {
    ...newSession(),
    handNumber: saved.handNumber,
    game: saved.game,
    totals: saved.totals,
    meanings: saved.meanings,
  };
  gameStrengths = saved.strengths;
  chosenStrengths = saved.strengths;
  screen = 'playing';
  return true;
}

const tableIsSet = (): boolean => screen === 'playing' || screen === 'finished';

function render(): void {
  /*
   * The phase drives the phone layout. During the auction the felt is three
   * face-down hands and an empty middle — worth nothing — while the bidding box
   * sits below the fold, so on a narrow screen the space is given to the cards
   * she is bidding on and to the box. During the play the table is the game.
   */
  document.documentElement.dataset.phase = screen === 'playing' ? session.game.phase : 'idle';

  const table = element('div', 'table');
  if (tableIsSet()) {
    table.append(
      renderSeat('N', 'north', false),
      renderSeat('W', 'west', true),
      renderTrick(),
      renderSeat('E', 'east', true),
      renderSeat('S', 'south', false),
    );
  } else {
    // A bare table: no hands, no nameplates, nothing dealt.
    const middle = element('div', 'middle');
    const message = element('div', 'middle-message empty-table');
    message.append(element('strong', undefined, 'De tafel is leeg'));
    message.append(element('span', undefined,
      'Begin een nieuw spel — hieronder, of via het menu linksboven.'));
    const start = element('div', 'empty-actions');
    start.append(button('action', 'Nieuw spel', openSetup));
    message.append(start);
    middle.append(message);
    table.append(middle);
  }
  // The menu lives over the table so it stays put whatever the panel is doing.
  table.append(renderMenu({
    refresh: render,
    showHowToPlay: () => { showingWelcome = true; render(); },
    onNewGame: openSetup,
    updateWaiting,
    applyUpdate: () => location.reload(),
    // Reloading throws away the hand in front of her, so only when there isn't one.
    safeToReload: screen !== 'playing',
  }));

  const children: HTMLElement[] = [table, renderPanel()];

  if (screen === 'setup') {
    children.push(renderSetup({
      strengths: chosenStrengths,
      onChange: (strengths) => { chosenStrengths = strengths; render(); },
      onStart: beginGame,
      onCancel: screen === 'setup' && tableIsSet() ? undefined : () => { screen = 'empty'; render(); },
    }));
  }
  if (screen === 'finished') {
    children.push(renderFinished({
      northSouth: session.totals.NS,
      eastWest: session.totals.EW,
      strengths: gameStrengths,
      onClear: clearTable,
    }));
  }
  if (showingWelcome) children.push(renderWelcome(dismissWelcome));
  app.replaceChildren(...children);
}

/* ------------------------------------------------------------------ actions */

function onCall(call: Call): void {
  if (!waitingForHer(session.game)) return;
  session.game = applyCall(session.game, call);
  finishHandIfOver();
  advance();
}

function onPlayCard(card: Card): void {
  if (!waitingForHer(session.game)) return;
  commitCard(card);
}

// Tapping the table, or Escape, closes the menu — the usual expectations.
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.menu')) return;
  if (closeMenu()) render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && closeMenu()) render();
});

// A game left in progress comes straight back; otherwise a bare table.
if (restoreSavedGame()) advance();
else render();

watchInstallability(render);
registerServiceWorker(() => {
  updateWaiting = true;
  // Safe to take now only if there is no game to lose; otherwise the next deal
  // picks it up. A restored game counts as one to lose.
  if (screen !== 'playing') location.reload();
  else render();
});

// Exposed so the browser console can drive a hand without clicking through it,
// and preview an end-of-hand effect without waiting to be dealt a slam.
Object.assign(window as unknown as Record<string, unknown>, {
  bridge: {
    state: () => session,
    describe: () => ({
      phase: session.game.phase,
      turn: turnOf(session.game),
      hers: waitingForHer(session.game),
      hand: sortHand(session.game.deal.hands.S).map(cardToString).join(' '),
    }),
    preview: (tier: Celebration) => {
      session.celebration = tier;
      clearCelebration();
      celebrate(tier);
      render();
      return tier;
    },
  },
});
