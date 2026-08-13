/**
 * The screen the app opens on.
 *
 * It used to deal and start playing the moment it loaded, which meant there was
 * never a moment where nothing was happening — no way to put it down and come
 * back, and no way to say "right, a new game" on purpose. Cards were simply in
 * front of you, mid-auction, as though you had walked in halfway through.
 *
 * So: it opens here and waits.
 */

import { button, element } from './dom.js';
import { currentSettings } from './settings.js';
import type { Tier } from '../bots/levels.js';

const TIER_LABEL: Record<Tier, string> = {
  kitchen: 'huiskamer',
  club: 'clubavond',
  tournament: 'wedstrijd',
};

export type HomeHooks = {
  readonly onNewGame: () => void;
  readonly onHowToPlay: () => void;
  /** Present only when a game is already under way. */
  readonly onResume?: () => void;
};

export function renderHome(hooks: HomeHooks): HTMLElement {
  const overlay = element('div', 'welcome home');
  const card = element('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Bridge');

  card.append(element('h1', 'welcome-title', 'Bridge'));
  card.append(element('p', 'welcome-lead',
    'Jij zit zuid, de computer speelt de andere drie handen.'));

  const settings = currentSettings();
  const against = TIER_LABEL[settings.opponents];
  const withPartner = TIER_LABEL[settings.partner];
  card.append(element('p', 'home-setting',
    settings.opponents === settings.partner
      ? `Iedereen speelt op ${against}sterkte. Dat verander je in het menu.`
      : `Tegenstanders op ${against}, je partner op ${withPartner}. Dat verander je in het menu.`));

  const actions = element('div', 'home-actions');
  if (hooks.onResume) {
    actions.append(button('action', 'Verder spelen', hooks.onResume));
    actions.append(button('action quiet', 'Nieuw spel', hooks.onNewGame));
  } else {
    actions.append(button('action', 'Nieuw spel', hooks.onNewGame));
  }
  actions.append(button('action quiet', 'Hoe werkt het?', hooks.onHowToPlay));
  card.append(actions);

  overlay.append(card);
  return overlay;
}
