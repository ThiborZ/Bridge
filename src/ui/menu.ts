/**
 * The menu.
 *
 * One button, always visible in the corner of the table, holding everything that
 * is not the game itself: how the cards look, how bright it is, which side the
 * bidding sits on, putting Bridge on the home screen, what is still to come, and
 * whether there is a new version.
 *
 * It exists so the panel beside the table can be nothing but the bidding. A
 * settings control sitting next to the auction competes with it for attention
 * every single hand, and she only ever wants it once.
 */

import { SUIT_SYMBOL, button, element } from './dom.js';
import { ROADMAP } from './roadmap.js';
import { installState, askToInstall, dismissInstall, BUILD_ID } from './install.js';
import {
  BRIGHTNESS_STEPS, canStepBrightness, currentSettings, stepBrightness, updateSettings,
} from './settings.js';
import type { DeckColours, PanelSide } from './settings.js';

export type MenuHooks = {
  /** Re-render everything; the menu does not own the page. */
  readonly refresh: () => void;
  readonly showHowToPlay: () => void;
  /** True when a newer version has been fetched and is waiting. */
  readonly updateWaiting: boolean;
  readonly applyUpdate: () => void;
};

let open = false;
let expanded: 'none' | 'roadmap' | 'ios' = 'none';

export function isMenuOpen(): boolean {
  return open;
}

export function closeMenu(): boolean {
  if (!open) return false;
  open = false;
  expanded = 'none';
  return true;
}

/* ------------------------------------------------------------------ pieces */

function deckChoice(refresh: () => void): HTMLElement {
  const group = element('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Kaartkleuren');

  const options: Array<{ deck: DeckColours; label: string }> = [
    { deck: 'two', label: 'Twee kleuren' },
    { deck: 'four', label: 'Vier kleuren' },
  ];

  for (const { deck, label } of options) {
    // A sample of the thing decides this faster than any wording of it.
    const choice = element('button');
    choice.type = 'button';
    choice.dataset.deck = deck;
    choice.setAttribute('aria-pressed', String(currentSettings().deck === deck));
    const pips = element('span', 'pips');
    pips.setAttribute('aria-hidden', 'true');
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      pips.append(element('span', `pip-${suit}`, SUIT_SYMBOL[suit]));
    }
    choice.append(pips, element('span', undefined, label));
    choice.addEventListener('click', () => { if (updateSettings({ deck })) refresh(); });
    group.append(choice);
  }
  return group;
}

function sideChoice(refresh: () => void): HTMLElement {
  const group = element('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Aan welke kant het bieden staat');

  const options: Array<{ side: PanelSide; label: string }> = [
    { side: 'left', label: 'Bieden links' },
    { side: 'right', label: 'Bieden rechts' },
  ];

  for (const { side, label } of options) {
    const choice = element('button');
    choice.type = 'button';
    choice.dataset.side = side;
    choice.setAttribute('aria-pressed', String(currentSettings().panelSide === side));
    choice.append(element('span', 'side-glyph'), element('span', undefined, label));
    choice.addEventListener('click', () => { if (updateSettings({ panelSide: side })) refresh(); });
    group.append(choice);
  }
  return group;
}

function brightnessControl(refresh: () => void): HTMLElement {
  const row = element('div', 'stepper');

  const down = element('button', 'step', '−');
  down.type = 'button';
  down.setAttribute('aria-label', 'Donkerder');
  down.disabled = !canStepBrightness(-1);
  down.addEventListener('click', () => { if (stepBrightness(-1)) refresh(); });

  const level = currentSettings().brightness;
  const gauge = element('div', 'gauge');
  gauge.setAttribute('role', 'img');
  gauge.setAttribute('aria-label', `Helderheid ${level + 1} van ${BRIGHTNESS_STEPS.length}`);
  for (let i = 0; i < BRIGHTNESS_STEPS.length; i++) {
    gauge.append(element('span', i <= level ? 'pip on' : 'pip'));
  }

  const up = element('button', 'step', '+');
  up.type = 'button';
  up.setAttribute('aria-label', 'Helderder');
  up.disabled = !canStepBrightness(1);
  up.addEventListener('click', () => { if (stepBrightness(1)) refresh(); });

  row.append(down, gauge, up);
  return row;
}

function roadmapList(): HTMLElement {
  const list = element('ul', 'roadmap');
  const ordered = [...ROADMAP].sort((a, b) => Number(a.done ?? false) - Number(b.done ?? false));
  for (const item of ordered) {
    const entry = element('li', item.done ? 'done' : undefined);
    entry.append(
      element('span', 'roadmap-title', item.title),
      element('span', 'roadmap-detail', item.detail),
    );
    list.append(entry);
  }
  return list;
}

function installSection(refresh: () => void): HTMLElement | null {
  const state = installState();
  if (state.kind === 'installed' || state.kind === 'none') return null;

  const section = element('section', 'menu-section');
  section.append(element('h3', undefined, 'Op je beginscherm'));

  if (state.kind === 'prompt') {
    section.append(element('p', 'hint',
      'Zet Bridge op je beginscherm, dan opent het als een app en werkt het ook zonder wifi.'));
    section.append(button('action', 'Op beginscherm zetten', () => { void askToInstall(); }));
  } else {
    section.append(button('action', 'Op beginscherm zetten', () => {
      expanded = expanded === 'ios' ? 'none' : 'ios';
      refresh();
    }));
    if (expanded === 'ios') {
      const steps = element('ol', 'steps');
      for (const text of [
        'Tik op de deelknop — het vierkantje met het pijltje eruit.',
        'Scroll omlaag en tik op “Zet op beginscherm”.',
        'Tik op “Voeg toe”. Bridge staat dan op je beginscherm als elke andere app.',
      ]) steps.append(element('li', undefined, text));
      section.append(steps);
      section.append(element('p', 'hint',
        'Dit moet in Safari — andere browsers op een iPad hebben deze knop niet.'));
    }
  }
  section.append(button('action quiet', 'Nu even niet', () => { dismissInstall(); refresh(); }));
  return section;
}

/**
 * What to do about a new version — which is nothing, and saying so is the point.
 * "An update is available" with no instruction is a small anxiety; this says it
 * is already downloaded and will be used for the next hand.
 */
function updateSection(hooks: MenuHooks): HTMLElement | null {
  if (!hooks.updateWaiting) return null;
  const section = element('section', 'menu-section update');
  section.append(element('h3', undefined, 'Er is een nieuwe versie'));
  section.append(element('p', 'hint',
    'Die is al binnengehaald. Bij het volgende spel wordt hij vanzelf gebruikt — je hoeft dus niets te doen. ' +
    'Je kunt ook nu overstappen, maar dan vervalt het spel dat voor je ligt.'));
  section.append(button('action', 'Nu overstappen', hooks.applyUpdate));
  return section;
}

/* ------------------------------------------------------------------- menu */

export function renderMenu(hooks: MenuHooks): HTMLElement {
  // The stylesheet moves the table aside when there is room, so an open menu
  // never covers a hand — which matters when that hand is an exposed dummy.
  document.documentElement.dataset.menu = open ? 'open' : 'closed';

  const root = element('div', 'menu');

  const toggle = element('button', 'menu-button', '');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Menu sluiten' : 'Menu');
  toggle.append(element('span', 'bars'), element('span', 'menu-label', 'Menu'));
  if (hooks.updateWaiting) {
    const badge = element('span', 'badge');
    badge.setAttribute('aria-label', 'Er is een nieuwe versie');
    toggle.append(badge);
  }
  toggle.addEventListener('click', () => {
    open = !open;
    if (!open) expanded = 'none';
    hooks.refresh();
  });
  root.append(toggle);

  if (!open) return root;

  const panel = element('div', 'menu-panel');

  panel.append(button('action quiet wide', 'Hoe werkt het?', () => {
    closeMenu();
    hooks.showHowToPlay();
  }));

  const update = updateSection(hooks);
  if (update) panel.append(update);

  const cards = element('section', 'menu-section');
  cards.append(element('h3', undefined, 'Kaarten'));
  cards.append(deckChoice(hooks.refresh));
  cards.append(element('p', 'hint',
    'Bij vier kleuren krijgen ruiten en klaveren een eigen kleur. Dat scheelt bij het uit elkaar houden van de kleuren in een waaier.'));
  panel.append(cards);

  const layout = element('section', 'menu-section');
  layout.append(element('h3', undefined, 'Indeling'));
  layout.append(sideChoice(hooks.refresh));
  layout.append(element('p', 'hint', 'Het menu gaat naar de kant waar het bieden niet staat.'));
  panel.append(layout);

  const light = element('section', 'menu-section');
  light.append(element('h3', undefined, 'Helderheid'));
  light.append(brightnessControl(hooks.refresh));
  light.append(element('p', 'hint',
    'Dit maakt het spel lichter of donkerder. De helderheid van de tablet zelf zit in het bedieningspaneel.'));
  panel.append(light);

  const install = installSection(hooks.refresh);
  if (install) panel.append(install);

  const coming = element('section', 'menu-section');
  coming.append(button('action quiet wide',
    expanded === 'roadmap' ? 'Verberg wat er nog komt' : 'Wat komt er nog', () => {
      expanded = expanded === 'roadmap' ? 'none' : 'roadmap';
      hooks.refresh();
    }));
  if (expanded === 'roadmap') coming.append(roadmapList());
  panel.append(coming);

  panel.append(element('div', 'build-stamp', `versie ${BUILD_ID}`));

  root.append(panel);
  return root;
}
