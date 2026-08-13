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

import { RANK_CHARS, cardToString, rankOf, sortHand, suitOf } from '../cards.js';
import type { Card, Suit } from '../cards.js';
import { STRAINS, callToString, contractToString, isLegalCall, legalCalls, tricksRequired } from '../auction.js';
import type { Call } from '../auction.js';
import { SEATS, isVulnerable, nextSeat, partnerOf, sideOf } from '../seats.js';
import type { Seat } from '../seats.js';
import { legalPlays, trickWinner, trumpSuit } from '../play.js';
import type { Trick } from '../play.js';
import { applyCall, applyPlay, chicagoDeal, newGame, resultOf, turnOf } from '../game.js';
import type { Game } from '../game.js';
import { describeResult } from '../score.js';
import { mulberry32 } from '../random.js';
import { heuristicPlay } from '../bots/heuristic.js';
import { decideCall } from '../bidding/index.js';
import { registerServiceWorker, watchInstallability } from './install.js';
import { loadSettings } from './settings.js';
import { SUIT_SYMBOL, element } from './dom.js';
import { closeMenu, renderMenu } from './menu.js';
import { hasSeenWelcome, markWelcomeSeen, renderWelcome } from './welcome.js';
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
const CALL_DELAY = FAST ? 0 : 700;
const CARD_DELAY = FAST ? 0 : 750;
/**
 * How long a completed trick stays on the table. `?pause=3000` to try a longer
 * one — how long she needs to read four cards is a question to settle with her,
 * not a number to guess at, and it wants to be easy to try.
 */
const TRICK_PAUSE = FAST ? 0 : Number(PARAMS.get('pause') ?? 1500);

const SEAT_NAMES: Record<Seat, string> = { N: 'North', E: 'East', S: 'You', W: 'West' };

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
 * Two separate handles, and they must stay separate. They were one, and a tap
 * landing during the pause after a completed trick cancelled the pause itself:
 * `advance` cleared the timer and then returned early because a trick was still
 * showing, so nothing ever cleared it and the deal froze for good.
 */
let botTimer: number | undefined;
let pauseTimer: number | undefined;

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

function advance(): void {
  window.clearTimeout(botTimer);
  render();
  if (session.pendingTrick) return; // the pause timer owns what happens next
  const turn = turnOf(session.game);
  if (turn === null || waitingForHer(session.game)) return;
  botTimer = window.setTimeout(
    botMove,
    session.game.phase === 'auction' ? CALL_DELAY : CARD_DELAY,
  );
}

function botMove(): void {
  const { game } = session;
  if (game.phase === 'auction') {
    const seat = turnOf(game)!;
    const decision = decideCall(game.auction, game.deal.hands[seat], seat);
    session.meanings.set(game.auction.calls.length, decision.meaning);
    session.game = applyCall(game, decision.call);
    advance();
  } else if (game.phase === 'play' && game.play) {
    // Card play is the Kitchen table player. Bidding is still random until
    // phase 4 puts the Acol rule table behind it.
    commitCard(heuristicPlay(game.play));
  }
}

/** Applies a card, then holds a completed trick on the table before moving on. */
function commitCard(card: Card): void {
  const before = session.game.play?.completed.length ?? 0;
  session.game = applyPlay(session.game, card);
  const after = session.game.play?.completed.length ?? 0;

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
    element('span', 'rank', RANK_CHARS[rankOf(card) - 2]!),
    element('span', 'pip', SUIT_SYMBOL[suit]),
  );
  return [index, element('span', 'watermark', SUIT_SYMBOL[suit])];
}

function cardFace(card: Card): HTMLElement {
  const node = element('span', `card suit-${suitOf(card)}`);
  node.append(...cardInnards(card));
  node.setAttribute('aria-label', describeCard(card));
  return node;
}

function describeCard(card: Card): string {
  const names: Record<Suit, string> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
  const rank = rankOf(card);
  const rankName =
    rank === 14 ? 'ace' : rank === 13 ? 'king' : rank === 12 ? 'queen'
    : rank === 11 ? 'jack' : rank === 10 ? 'ten' : String(rank);
  return `${rankName} of ${names[suitOf(card)]}`;
}

function cardButton(card: Card, playable: boolean, onPlay: (card: Card) => void): HTMLElement {
  const button = element('button', `card suit-${suitOf(card)}`);
  button.type = 'button';
  button.disabled = !playable;
  button.append(...cardInnards(card));
  button.setAttribute('aria-label', describeCard(card));
  if (playable) button.addEventListener('click', () => onPlay(card));
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
    plate.append(element('span', 'role', 'dealer'));
  }
  if (game.phase !== 'auction' && game.play) {
    const { declarer } = game.play.contract;
    if (seat === declarer) plate.append(element('span', 'role', 'declarer'));
    else if (seat === partnerOf(declarer)) plate.append(element('span', 'role', 'dummy'));
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
    const heading = element('strong', undefined, 'The auction');
    message.append(heading, element('span', undefined,
      waitingForHer(game) ? 'Your call.' : `Waiting for ${SEAT_NAMES[turnOf(game)!]}…`));
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
      waitingForHer(game) ? 'Your lead.' : `${SEAT_NAMES[turnOf(game)!]} to lead…`));
    middle.append(message);
  }
  return middle;
}

function renderCompleteMessage(): HTMLElement {
  const result = resultOf(session.game);
  const message = element('div', 'middle-message');
  if (!result || !result.contract || !result.breakdown) {
    message.append(element('strong', undefined, 'Passed out'), element('span', undefined, 'Nobody bid. On to the next.'));
    return message;
  }
  const forUs = result.northSouthScore > 0;
  const headline = headlineFor(session.celebration, forUs);
  if (headline) {
    message.classList.add(`outcome-${session.celebration}`);
    message.append(element('div', 'fanfare', headline));
  }
  message.append(
    element('strong', undefined, contractToString(result.contract)),
    element('span', undefined, `${describeResult(result.breakdown)} — ${result.tricksWon} tricks`),
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

function callLabel(call: Call): string {
  if (call.type !== 'bid') return callToString(call);
  return call.strain === 'NT' ? `${call.level}NT` : `${call.level}${SUIT_SYMBOL[call.strain]}`;
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
      button.setAttribute('aria-label', `${level} ${strain === 'NT' ? 'no trumps' : strain}`);
      if (!button.disabled) button.addEventListener('click', () => onCall(call));
      grid.append(button);
    }
  }

  const row = element('div', 'bid-row');
  const specials: Array<{ call: Call; label: string; className: string }> = [
    { call: { type: 'pass' }, label: 'Pass', className: 'pass' },
    { call: { type: 'double' }, label: 'Double', className: 'dbl' },
    { call: { type: 'redouble' }, label: 'Redouble', className: 'rdbl' },
  ];
  for (const { call, label, className } of specials) {
    const button = element('button', `bid ${className}`, label);
    button.type = 'button';
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
    section.append(element('div', 'headline', 'Passed out'));
  } else {
    const { breakdown } = result;
    const headline = element('div', `headline ${breakdown.made ? 'made' : 'failed'}`,
      `${contractToString(result.contract)} — ${describeResult(breakdown)}`);
    section.append(headline);

    const table = element('table', 'breakdown');
    const rows: Array<[string, number]> = breakdown.made
      ? [
          ['Trick points', breakdown.contractPoints],
          ['Overtricks', breakdown.overtrickPoints],
          [breakdown.gameBonus >= 300 ? 'Game bonus' : 'Part-score', breakdown.gameBonus],
          ['Slam bonus', breakdown.slamBonus],
          ['For the insult', breakdown.insultBonus],
        ]
      : [['Undertricks', -breakdown.penalty]];
    for (const [label, value] of rows) {
      if (value === 0) continue;
      const tr = element('tr');
      tr.append(element('td', undefined, label), element('td', undefined, String(value)));
      table.append(tr);
    }
    const totalRow = element('tr', 'total');
    totalRow.append(
      element('td', undefined, `Score to ${sideOf(result.contract.declarer)}`),
      element('td', undefined, String(breakdown.score)),
    );
    table.append(totalRow);
    section.append(table);
  }

  const next = element('button', 'action', 'Next deal');
  next.type = 'button';
  next.addEventListener('click', nextHand);
  section.append(next);
  return section;
}

function renderPanel(): HTMLElement {
  const { game } = session;
  const panel = element('aside', 'panel');

  const header = element('section');
  header.append(
    element('div', 'hand-number', `Hand ${session.handNumber}`),
    element('div', 'deal-line',
      `deal ${game.deal.id} · dealer ${game.deal.dealer} · vul ${game.deal.vulnerability.toLowerCase()}`),
  );
  panel.append(header);

  if (game.phase === 'play' && game.play) {
    const { contract } = game.play;
    const status = element('section');
    status.append(
      element('h2', undefined, 'Contract'),
      element('div', 'hand-number', contractToString(contract)),
      element('div', 'hint',
        `${tricksRequired(contract)} tricks needed · ` +
        `N-S ${game.play.tricksWon.NS} · E-W ${game.play.tricksWon.EW}`),
    );
    if (humanSeats(game).length === 0) {
      status.append(element('div', 'hint',
        'You are dummy this hand — your partner plays your cards. Sit back and watch.'));
    } else if (humanSeats(game).length === 2) {
      status.append(element('div', 'hint',
        'You are declarer, so you play dummy’s cards too.'));
    }
    panel.append(status);
  }

  const auctionSection = element('section');
  auctionSection.append(element('h2', undefined, 'Auction'), renderAuctionTable());
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
    const heading = element('h2', undefined, waitingForHer(game) ? 'Your call' : 'Bidding');
    bidding.append(heading);
    if (waitingForHer(game)) bidding.append(renderBiddingBox());
    else bidding.append(element('div', 'hint', `Waiting for ${SEAT_NAMES[turnOf(game)!]}…`));
    panel.append(bidding);
  }

  if (game.phase === 'complete') panel.append(renderResult());

  const tally = element('section');
  tally.append(element('h2', undefined, 'Session'));
  const totals = element('div', 'tally');
  for (const [label, value] of [['North-South', session.totals.NS], ['East-West', session.totals.EW]] as const) {
    const box = element('div');
    box.append(element('span', undefined, label), element('span', undefined, String(value)));
    totals.append(box);
  }
  tally.append(totals);
  panel.append(tally);

  return panel;
}

/** Shown on the very first visit, and whenever asked for from the menu. */
let showingWelcome = !hasSeenWelcome();

function dismissWelcome(): void {
  showingWelcome = false;
  markWelcomeSeen();
  render();
}

function render(): void {
  const table = element('div', 'table');
  table.append(
    renderSeat('N', 'north', false),
    renderSeat('W', 'west', true),
    renderTrick(),
    renderSeat('E', 'east', true),
    renderSeat('S', 'south', false),
  );
  // The menu lives over the table so it stays put whatever the panel is doing.
  table.append(renderMenu({
    refresh: render,
    showHowToPlay: () => { showingWelcome = true; render(); },
    updateWaiting,
    applyUpdate: () => location.reload(),
  }));

  const children: HTMLElement[] = [table, renderPanel()];
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

watchInstallability(render);
registerServiceWorker(() => {
  updateWaiting = true;
  // If she is between hands already, take it now; otherwise the next deal will.
  if (session.game.phase === 'auction' && session.game.auction.calls.length === 0) {
    location.reload();
  } else {
    render();
  }
});
advance();

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
