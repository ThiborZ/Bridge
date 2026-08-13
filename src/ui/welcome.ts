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
    heading: 'Jij zit zuid',
    body: 'Jouw kaarten liggen onderaan. De computer speelt de andere drie handen, ook die van je partner noord.',
  },
  {
    heading: 'Bieden',
    body: 'Als jij aan de beurt bent verschijnt de biedbox ernaast — tik op een bod. Aan tafel wordt Acol gespeeld: zwakke SA, sterke tweeën, Stayman en geen transfers. Houd je vinger op een bod in het biedverloop om te zien wat het betekende.',
  },
  {
    heading: 'Spelen',
    body: 'Tik op een kaart om hem te spelen. Alleen de kaarten die je mág spelen lichten op, de rest is gedimd. Verzaken kan dus niet per ongeluk.',
  },
  {
    heading: 'De blinde',
    body: 'Ben jij leider, dan speel je ook de kaarten van je partner. Speelt je partner het contract, dan ben jij de blinde en speelt hij jouw kaarten — dan heb je die hand niets te doen. Dat hoort zo; er is niets stuk.',
  },
  {
    heading: 'Gespeelde slagen',
    body: 'Een volle slag blijft even liggen, met een gouden rand om de kaart die hem wint, voordat hij wordt opgeruimd.',
  },
  {
    heading: 'Het menu',
    body: 'Linksboven. Kaartkleuren, helderheid, Bridge op je beginscherm zetten, en wat er nog aan komt.',
  },
];

export function renderWelcome(onStart: () => void): HTMLElement {
  const overlay = element('div', 'welcome');
  const card = element('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Hoe dit werkt');

  card.append(element('h1', 'welcome-title', 'Bridge'));
  card.append(element('p', 'welcome-lead',
    'Een spelletje bridge tegen de computer. Zo werkt dit spel.'));

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

  card.append(button('action', 'Beginnen', onStart));
  overlay.append(card);
  return overlay;
}
