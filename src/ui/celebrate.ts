/**
 * What happens when a hand ends.
 *
 * Scaled to the result: bidding and making a slam should feel different from
 * scraping home in two clubs. The tiers come from the score her side actually
 * won, so beating the opponents in their contract counts just as much as making
 * her own — which is right, because in bridge it is.
 *
 * Losses are deliberately quiet. There is a version of this that rains sad faces
 * on someone who has just gone down three, and it makes a game feel unkind. A
 * plain sentence and a muted colour is enough; she knows what happened.
 *
 * The overlay lives outside the re-rendered tree, so redrawing the panel mid-
 * animation does not restart it.
 */

export type Celebration = 'slam' | 'game' | 'partscore' | 'setback' | 'none';

/** `score` is from her side's point of view, so a penalty they pay is a win. */
export function celebrationFor(score: number, level: number): Celebration {
  if (score === 0) return 'none';
  if (score < 0) return 'setback';
  if (level >= 6 || score >= 500) return 'slam';
  if (score >= 300) return 'game';
  return 'partscore';
}

export function headlineFor(tier: Celebration, madeIt: boolean): string | null {
  switch (tier) {
    case 'slam': return madeIt ? 'Slem!' : 'Dat kostte ze duur';
    case 'game': return madeIt ? 'Manche!' : 'Goed verdedigd';
    case 'partscore': return madeIt ? 'Gemaakt' : 'Hun contract, jouw slagen';
    default: return null;
  }
}

const GLYPHS = ['♠', '♥', '♦', '♣'] as const;
const HOW_MANY: Record<Celebration, number> = {
  slam: 44, game: 26, partscore: 12, setback: 0, none: 0,
};

let overlay: HTMLElement | null = null;

function surface(): HTMLElement {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'celebration';
  overlay.setAttribute('aria-hidden', 'true'); // decorative; the result is announced in text
  document.body.append(overlay);
  return overlay;
}

export function celebrate(tier: Celebration): void {
  const count = HOW_MANY[tier];
  if (count === 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const target = surface();
  target.replaceChildren();

  for (let i = 0; i < count; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip-fall';
    pip.textContent = GLYPHS[i % GLYPHS.length]!;
    // Spread across the table, not the panel, and stagger so they do not march.
    pip.style.setProperty('--x', `${Math.random() * 100}%`);
    pip.style.setProperty('--delay', `${Math.random() * 0.7}s`);
    pip.style.setProperty('--drift', `${(Math.random() - 0.5) * 24}vw`);
    pip.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`);
    pip.style.setProperty('--size', `${1.1 + Math.random() * 1.6}rem`);
    pip.style.setProperty('--life', `${2.2 + Math.random() * 1.4}s`);
    target.append(pip);
  }

  // Clear up once the longest one can have finished.
  window.setTimeout(() => {
    if (overlay?.isConnected) overlay.replaceChildren();
  }, 4500);
}

export function clearCelebration(): void {
  if (overlay?.isConnected) overlay.replaceChildren();
}
