/**
 * When Float writes a content file, Astro's content layer re-syncs the entry and
 * then asks the browser to do a full reload. A reload would tear down the editor
 * mid-keystroke, so for a short "quiet window" after each Float save we swallow
 * that reload and let the client re-fetch the page HTML and swap it in place.
 *
 * The swallowed reload doubles as the "content is synced" signal: the save
 * endpoint waits for it before responding, so the client's follow-up fetch is
 * guaranteed to render the new content.
 *
 * Edits coming from anywhere else (your editor, git checkout, ...) fall outside
 * the window and reload the page as usual.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {import('astro').AstroIntegrationLogger} logger
 */
export function createSyncGate(server, logger) {
  const QUIET_WINDOW_MS = 3000;

  let quietUntil = 0;
  /** @type {Array<() => void>} */
  let waiters = [];

  const ws = server.ws;
  const originalSend = ws.send.bind(ws);

  ws.send = (...args) => {
    const payload = args[0];
    const isFullReload =
      payload && typeof payload === "object" && payload.type === "full-reload";

    if (isFullReload && Date.now() < quietUntil) {
      // Astro's data store invalidation sends `path: "*"`; other reloads
      // (SSR-only module updates) don't carry a path. Only the former means
      // "the entry you just saved is now in the store".
      if (payload.path === "*") {
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve();
      }
      logger.debug("suppressed full-reload inside Float quiet window");
      return;
    }

    return originalSend(...args);
  };

  return {
    /**
     * Open the quiet window and return a promise that resolves once Astro has
     * re-synced content (or after `timeoutMs`, whichever comes first).
     * Resolves to `true` when the sync signal was observed.
     * @param {number} [timeoutMs]
     * @returns {Promise<boolean>}
     */
    expectSync(timeoutMs = 2500) {
      quietUntil = Date.now() + Math.max(QUIET_WINDOW_MS, timeoutMs + 500);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w !== done);
          resolve(false);
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve(true);
        };
        waiters.push(done);
      });
    },

    /** Open the quiet window without waiting on anything. */
    quiet() {
      quietUntil = Date.now() + QUIET_WINDOW_MS;
    },
  };
}
