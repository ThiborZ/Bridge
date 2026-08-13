/**
 * The things she can change, and remembering them.
 *
 * One record, one source of truth. An earlier arrangement had the deck choice
 * and the brightness each keeping their own copy of "the settings", which is a
 * bug waiting for the first setting that touches both.
 *
 * A note on brightness: no web page can touch the device's backlight — there is
 * no such API, and anything claiming to is dimming itself. This lightens or
 * darkens the page, which is what actually helps against glare in a sunny room
 * or a bright screen at night.
 *
 * Themes are not here yet. The palette is already a set of tokens on :root and
 * this file already stamps `data-theme`, so adding one is a block of variables
 * rather than a rewrite.
 */

const STORAGE_KEY = 'bridge.settings';

export type DeckColours = 'two' | 'four';
export type Theme = 'felt';
/** Which side the bidding panel sits on; the menu takes the other. */
export type PanelSide = 'left' | 'right';

/** Coarse steps with a clear gauge beat a slider she has to aim at. */
export const BRIGHTNESS_STEPS = [0.55, 0.7, 0.85, 1, 1.15, 1.3] as const;
const DEFAULT_BRIGHTNESS = 3; // 1.0 — the design as drawn

export type Settings = {
  readonly deck: DeckColours;
  /** Index into BRIGHTNESS_STEPS. */
  readonly brightness: number;
  readonly theme: Theme;
  readonly panelSide: PanelSide;
};

const DEFAULTS: Settings = {
  deck: 'four', brightness: DEFAULT_BRIGHTNESS, theme: 'felt', panelSide: 'right',
};

let current: Settings = DEFAULTS;

export function currentSettings(): Settings {
  return current;
}

function sanitise(stored: Partial<Settings> | null): Settings {
  if (!stored) return DEFAULTS;
  const deck: DeckColours = stored.deck === 'two' ? 'two' : 'four';
  const brightness =
    typeof stored.brightness === 'number' &&
    Number.isInteger(stored.brightness) &&
    stored.brightness >= 0 &&
    stored.brightness < BRIGHTNESS_STEPS.length
      ? stored.brightness
      : DEFAULT_BRIGHTNESS;
  const panelSide: PanelSide = stored.panelSide === 'left' ? 'left' : 'right';
  return { deck, brightness, theme: 'felt', panelSide };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    current = sanitise(raw ? (JSON.parse(raw) as Partial<Settings>) : null);
  } catch {
    // A blocked or corrupt store is not a reason to fail to start.
    current = DEFAULTS;
  }
  applySettings();
  return current;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private browsing, a full quota — the setting just will not persist.
  }
}

/** Puts the settings on the document, where the stylesheet can see them. */
export function applySettings(settings: Settings = current): void {
  const root = document.documentElement;
  root.dataset.deck = settings.deck;
  root.dataset.theme = settings.theme;
  root.dataset.panel = settings.panelSide;
  root.style.setProperty('--screen-brightness', String(BRIGHTNESS_STEPS[settings.brightness]));
}

/** Merge, apply and persist. Returns true if anything actually changed. */
export function updateSettings(patch: Partial<Settings>): boolean {
  const next = sanitise({ ...current, ...patch });
  const same =
    next.deck === current.deck &&
    next.brightness === current.brightness &&
    next.theme === current.theme &&
    next.panelSide === current.panelSide;
  if (same) return false;
  current = next;
  applySettings();
  save();
  return true;
}

export function canStepBrightness(direction: -1 | 1): boolean {
  const next = current.brightness + direction;
  return next >= 0 && next < BRIGHTNESS_STEPS.length;
}

export function stepBrightness(direction: -1 | 1): boolean {
  if (!canStepBrightness(direction)) return false;
  return updateSettings({ brightness: current.brightness + direction });
}
