/**
 * "Add to home screen".
 *
 * She should not have to know that a web page can become an app, so the game
 * offers it rather than waiting to be found in a browser menu.
 *
 * There are two entirely different mechanisms behind one button, and the second
 * one is the reason this file exists:
 *
 *   Android and desktop Chrome fire `beforeinstallprompt`. Holding on to that
 *   event lets us show our own button and install for real when it is tapped.
 *
 *   iPhone and iPad cannot. Safari has no install API at all — no page can add
 *   itself to the home screen, and no amount of code changes that. All that can
 *   be done there is to say clearly where the button is. So on iOS the same
 *   button opens instructions instead, and they have to be good enough to follow
 *   without help.
 */

/** The event Chrome fires; not in the DOM typings. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let dismissed = false;
let onChange: () => void = () => {};

export type InstallState =
  | { kind: 'installed' }        // already on the home screen; say nothing
  | { kind: 'prompt' }           // a real install is available
  | { kind: 'instructions-ios' } // tell her where the Share button is
  | { kind: 'open-in-safari' }   // an in-app browser: it cannot be done here at all
  | { kind: 'none' };            // nothing useful to offer

export function watchInstallability(notify: () => void): void {
  onChange = notify;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser shows its own bar, which she is likely to dismiss.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    onChange();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    onChange();
  });
}

function runningAsApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS's own, older flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(agent) ||
    // An iPad on recent iOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * A browser embedded inside another app — a link tapped in Messenger, WhatsApp,
 * Instagram, Gmail.
 *
 * This matters more than it looks: **"Add to Home Screen" does not exist in an
 * in-app browser at all.** It is a Safari feature, and these are not Safari.
 * Detecting the case is the difference between showing instructions that cannot
 * be followed and telling somebody the one thing that actually helps — open it
 * in Safari first.
 *
 * Sniffing the user agent is unreliable in general; here it only decides which
 * *advice* to print, so being wrong costs a confusing sentence rather than a
 * broken feature.
 */
function isInAppBrowser(): boolean {
  const agent = navigator.userAgent;
  return /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|MicroMessenger|Twitter|Snapchat|Pinterest|GSA\/|DuckDuckGo/.test(agent);
}

function isSafariProper(): boolean {
  const agent = navigator.userAgent;
  // Chrome and Firefox on iOS are Safari underneath but put the flow elsewhere.
  return /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent) && !isInAppBrowser();
}

export function installState(): InstallState {
  if (runningAsApp()) return { kind: 'installed' };
  if (dismissed) return { kind: 'none' };
  if (deferred) return { kind: 'prompt' };
  if (isIos() && isInAppBrowser()) return { kind: 'open-in-safari' };
  if (isIos() && isSafariProper()) return { kind: 'instructions-ios' };
  return { kind: 'none' };
}

/** Returns false if the browser refused, so the caller can fall back to words. */
export async function askToInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'dismissed') dismissed = true;
    onChange();
    return outcome === 'accepted';
  } catch {
    onChange();
    return false;
  }
}

export function dismissInstall(): void {
  dismissed = true;
  onChange();
}

/**
 * The build this page came from. Shown in the panel and used to name the cache.
 *
 * Guarded rather than read straight, because it is injected by the bundler at
 * build time: if that injection is ever missing — a stale dev server, a config
 * change not picked up — reading it bare throws while the module is still being
 * imported, and the whole game fails to start over a version string.
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * The build date, written the way somebody would say it: "14 augustus, 19:20".
 * This is the version she can read out, and the one you can check against.
 */
export const BUILD_WHEN: string = (() => {
  if (typeof __BUILD_DATE__ !== 'string') return 'onbekend';
  const when = new Date(__BUILD_DATE__);
  if (Number.isNaN(when.getTime())) return 'onbekend';
  return new Intl.DateTimeFormat('nl-NL', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(when);
})();

export type UpdateCheck = 'nieuw' | 'actueel' | 'onbekend';

/**
 * Ask the browser, right now, whether there is a newer version.
 *
 * The automatic check covers almost everything — on launch, and every time she
 * comes back to the app. But "almost" is not something you can say down a
 * telephone. This is the button that answers it on demand, so the instruction
 * can be "open the menu and press Controleer op updates" rather than a
 * description of how to clear a browser cache.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return 'onbekend';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'onbekend';
    await registration.update();

    const pending = registration.installing ?? registration.waiting;
    if (!pending) return 'actueel';
    if (pending.state === 'installed') return 'nieuw';

    // It is still downloading; wait for it to settle rather than guess.
    return await new Promise<UpdateCheck>((resolve) => {
      const settle = () => {
        if (pending.state === 'installed') resolve('nieuw');
        else if (pending.state === 'redundant') resolve('actueel');
      };
      pending.addEventListener('statechange', settle);
      // Offline or a slow connection should not leave the button spinning.
      window.setTimeout(() => resolve('onbekend'), 8000);
    });
  } catch {
    // update() throws when there is no connection — which is not "up to date".
    return 'onbekend';
  }
}

/**
 * Registering the worker is what makes the browser consider the page
 * installable at all. Only in a built site: in development it would serve
 * yesterday's code back from the cache and waste an afternoon.
 *
 * Updating is the part that needs care. An offline-first app that caches too
 * eagerly pins itself to an old version for ever, so:
 *
 *   The worker's URL carries the build id, so a new build is a new worker
 *   rather than a byte-identical file the browser may skip re-fetching.
 *   `updateViaCache: 'none'` stops the worker script itself being served from
 *   the HTTP cache.
 *
 *   The page is checked for a new version on launch and whenever she comes back
 *   to it, so an app that lives on a home screen for a month still updates.
 *
 *   The new version is *not* applied the moment it arrives. `onUpdateReady`
 *   hands that decision to the caller, which waits for the end of a hand —
 *   reloading mid-deal would throw away the cards in front of her.
 */
export function registerServiceWorker(onUpdateReady: () => void = () => {}): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // A controller already present means this page is being served by an existing
  // worker, so a change of controller later is a genuine update rather than the
  // very first registration taking hold.
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`./sw.js?v=${encodeURIComponent(BUILD_ID)}`, { updateViaCache: 'none' })
      .then((registration) => {
        void registration.update();
        // Home-screen apps are resumed rather than reloaded; check again then.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update();
        });
      })
      .catch(() => {
        // Offline support is a bonus; the game works without it.
      });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) onUpdateReady();
    });
  });
}
