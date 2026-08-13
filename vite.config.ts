import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * A stamp that changes every build. It names the offline cache and is shown in
 * the corner of the panel, which is what makes "is she actually on the new
 * version?" a question you can answer by looking rather than by hoping.
 */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  /*
   * Relative asset paths, so the built page works wherever it is served from —
   * the root locally, and /<repo>/ on GitHub Pages. Hard-coding the repo name
   * here is the usual way this breaks: rename the repo and every asset 404s.
   * There is no client-side routing, so relative paths cost nothing.
   */
  base: './',
  build: {
    outDir: 'dist',
    // She may be on an older tablet; this is the oldest thing the code needs.
    target: 'es2022',
  },
});
