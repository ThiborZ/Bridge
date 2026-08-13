/**
 * The start screen.
 *
 * She plays bridge, so this does not explain bridge. It explains *this* — where
 * to tap, what lights up, and the one thing about the game that looks like a
 * fault and is not: that when her partner declares, she is dummy and does not
 * play at all.
 *
 * Shown once, then never again unless asked for from the menu. A screen that
 * greets you every single time is a screen you learn to dismiss without reading.
 */

import { button, element } from './dom.js';

const STORAGE_KEY = 'bridge.welcomed';

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'yes';
  } catch {
    // If storage is unavailable, showing it once per visit is the safer failure.
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'yes');
  } catch {
    // Nothing to do; it will simply be offered again next time.
  }
}

type Point = { readonly heading: string; readonly body: string };

const POINTS: readonly Point[] = [
  {
    heading: 'You sit South',
    body: 'Your cards are along the bottom. The computer plays the other three hands, including your partner North.',
  },
  {
    heading: 'Bidding',
    body: 'When it is your turn, the bidding box appears on the right — tap a call. Everyone at the table plays Acol: weak no-trump, strong twos, Stayman and no transfers. Rest your finger on any call in the auction to see what it showed.',
  },
  {
    heading: 'Playing',
    body: 'Tap a card to play it. Only the cards you are allowed to play are lit; the rest are dimmed, so you cannot revoke by accident.',
  },
  {
    heading: 'Dummy',
    body: 'If you are declarer you play your partner’s cards as well as your own. If your partner declares, you are dummy and he plays yours — so there is nothing for you to do that hand. That is the game, not a fault.',
  },
  {
    heading: 'Finished tricks',
    body: 'A completed trick stays on the table for a moment, with the winning card ringed, before it is gathered up.',
  },
  {
    heading: 'The menu',
    body: 'Top left. Card colours, brightness, putting Bridge on your home screen, and what is still to come.',
  },
];

export function renderWelcome(onStart: () => void): HTMLElement {
  const overlay = element('div', 'welcome');
  const card = element('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'How this works');

  card.append(element('h1', 'welcome-title', 'Bridge'));
  card.append(element('p', 'welcome-lead',
    'A game of contract bridge against the computer. Here is how this one works.'));

  const list = element('ul', 'welcome-points');
  for (const point of POINTS) {
    const item = element('li');
    item.append(
      element('span', 'welcome-heading', point.heading),
      element('span', 'welcome-body', point.body),
    );
    list.append(item);
  }
  card.append(list);

  card.append(button('action', 'Start playing', onStart));
  overlay.append(card);
  return overlay;
}
