/**
 * The screens around a game: setting one up, and finishing one.
 *
 * The strengths are chosen *here*, not in the settings menu. How well the
 * opponents play is a property of the game you are about to sit down to, the
 * same as who is dealing — not a preference like how bright the screen is.
 * Putting it in the menu made it something you had to remember to check before
 * starting, which is the wrong way round.
 */

import { button, element } from './dom.js';
import { TIERS } from '../bots/levels.js';
import type { Tier } from '../bots/levels.js';

export const HANDS_PER_GAME = 4;

export type Strengths = { opponents: Tier; partner: Tier };

const TIER_NAME: Record<Tier, string> = {
  kitchen: 'Huiskamer',
  club: 'Clubavond',
  tournament: 'Wedstrijd',
};

const TIER_BLURB: Record<Tier, string> = {
  kitchen: 'Speelt op gevoel. Te verslaan door iedereen die oplet.',
  club: 'Rekent de laatste slagen uit. Een stevige tegenstander.',
  tournament: 'Rekent het hele eindspel uit en zit er zelden naast.',
};

function strengthPicker(
  label: string,
  hint: string,
  selected: Tier,
  onPick: (tier: Tier) => void,
): HTMLElement {
  const block = element('div', 'setup-choice');
  block.append(element('div', 'setting-name', label));

  const group = element('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const tier of TIERS) {
    const choice = element('button', undefined, TIER_NAME[tier]);
    choice.type = 'button';
    choice.setAttribute('aria-pressed', String(tier === selected));
    choice.addEventListener('click', () => onPick(tier));
    group.append(choice);
  }
  block.append(group);
  block.append(element('p', 'hint', hint));
  return block;
}

export type SetupHooks = {
  readonly strengths: Strengths;
  readonly onChange: (strengths: Strengths) => void;
  readonly onStart: () => void;
  readonly onCancel?: () => void;
};

export function renderSetup(hooks: SetupHooks): HTMLElement {
  const overlay = element('div', 'welcome setup');
  const card = element('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Nieuw spel');

  card.append(element('h1', 'welcome-title', 'Nieuw spel'));
  card.append(element('p', 'welcome-lead',
    `Vier spellen achter elkaar, dan de eindstand. Jij zit zuid.`));

  card.append(strengthPicker(
    'Tegenstanders',
    TIER_BLURB[hooks.strengths.opponents],
    hooks.strengths.opponents,
    (opponents) => hooks.onChange({ ...hooks.strengths, opponents }),
  ));

  card.append(strengthPicker(
    'Je partner (noord)',
    TIER_BLURB[hooks.strengths.partner],
    hooks.strengths.partner,
    (partner) => hooks.onChange({ ...hooks.strengths, partner }),
  ));

  const actions = element('div', 'home-actions');
  actions.append(button('action', 'Delen maar', hooks.onStart));
  if (hooks.onCancel) actions.append(button('action quiet', 'Toch niet', hooks.onCancel));
  card.append(actions);

  overlay.append(card);
  return overlay;
}

export type FinishedHooks = {
  readonly northSouth: number;
  readonly eastWest: number;
  readonly strengths: Strengths;
  /** True when this beats every game she has played before. */
  readonly record: boolean;
  /** How many games came before this one, for "her second game" and so on. */
  readonly gamesBefore: number;
  readonly onClear: () => void;
};

export function renderFinished(hooks: FinishedHooks): HTMLElement {
  const overlay = element('div', 'welcome finished');
  const card = element('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Eindstand');

  const won = hooks.northSouth > hooks.eastWest;
  const drawn = hooks.northSouth === hooks.eastWest;

  card.append(element('h1', 'welcome-title',
    drawn ? 'Gelijkspel' : won ? 'Gewonnen!' : 'Verloren'));
  card.append(element('p', 'welcome-lead',
    `Vier spellen tegen ${TIER_NAME[hooks.strengths.opponents].toLowerCase()}sterkte.`));

  const table = element('table', 'breakdown final-score');
  for (const [label, value] of [
    ['Noord-Zuid (jij)', hooks.northSouth],
    ['Oost-West', hooks.eastWest],
  ] as const) {
    const row = element('tr');
    row.append(element('td', undefined, label), element('td', undefined, String(value)));
    table.append(row);
  }
  const margin = element('tr', 'total');
  margin.append(
    element('td', undefined, drawn ? 'Verschil' : won ? 'Voorsprong' : 'Achterstand'),
    element('td', undefined, String(Math.abs(hooks.northSouth - hooks.eastWest))),
  );
  table.append(margin);
  card.append(table);

  if (hooks.record) {
    card.append(element('p', 'personal-best', 'Je beste resultaat tot nu toe.'));
  }

  const actions = element('div', 'home-actions');
  actions.append(button('action', 'Tafel opruimen', hooks.onClear));
  card.append(actions);

  overlay.append(card);
  return overlay;
}
