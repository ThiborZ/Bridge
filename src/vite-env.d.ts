/// <reference types="vite/client" />

/**
 * Injected by vite.config.ts — the git sha, or a timestamp outside a repo.
 * Declared as possibly undefined so reading it bare is a type error: it only
 * exists if the bundler put it there.
 */
declare const __BUILD_ID__: string | undefined;

/** When the build was made, as an ISO string. Same guard as above. */
declare const __BUILD_DATE__: string | undefined;
