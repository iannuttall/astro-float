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
 * Edits coming from anywhere else (your editor, git checkout, ...) reload the
 * page as usual — unless an edit session is active. Then the reload would drop
 * whatever the author is typing, so it's swallowed too and the toolbar gets an
 * `astro-float:file-changed` event instead (see `watch.js`). The toolbar opens
 * a session with `POST /session { editing: true }`, every API call refreshes
 * its 60 s TTL, and `{ editing: false }` ends it.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {import('astro').AstroIntegrationLogger} logger
 */
export function createSyncGate(server, logger) {
  const QUIET_WINDOW_MS = 3000;
  const SESSION_TTL_MS = 60_000;
  /** How long after an entry file changes we treat the next full reload as its consequence. */
  const EXTERNAL_CHANGE_MS = 5000;

  let quietUntil = 0;
  let editingUntil = 0;
  let externalChangeUntil = 0;
  /** @type {Array<(ok: boolean) => void>} */
  let waiters = [];

  const settle = (ok) => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(ok);
  };

  const isEditing = () => Date.now() < editingUntil;

  const ws = server.ws;
  const originalSend = ws.send.bind(ws);

  ws.send = (...args) => {
    const payload = args[0];
    const isFullReload =
      payload && typeof payload === "object" && payload.type === "full-reload";

    if (isFullReload) {
      // Astro's data store invalidation sends `path: "*"`; other reloads
      // (SSR-only module updates) don't carry a path. Only the former means
      // "the entry you just saved is now in the store".
      const synced = payload.path === "*";
      if (Date.now() < quietUntil) {
        if (synced) settle(true);
        logger.debug("suppressed full-reload inside Float quiet window");
        return;
      }
      if (isEditing() && Date.now() < externalChangeUntil) {
        if (synced) settle(true);
        logger.debug("suppressed full-reload for an outside change during a Float edit session");
        return;
      }
      if (synced) settle(true);
    }

    return originalSend(...args);
  };

  // When Astro rejects the written entry (schema mismatch, YAML error) it never
  // re-syncs, so no reload arrives and the wait would run to its timeout. The
  // content layer logs that rejection through the logger's shared destination;
  // watching for it answers `synced: false` right away.
  const dest = logger?.options?.dest;
  if (dest && typeof dest.write === "function") {
    const originalWrite = dest.write.bind(dest);
    dest.write = (event) => {
      if (waiters.length && isContentFailure(event)) settle(false);
      return originalWrite(event);
    };
  }

  /** Resolve once Astro re-syncs content (`true`), logs a content error (`false`), or `timeoutMs` passes (`false`). */
  const awaitSync = (timeoutMs) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== done);
        resolve(false);
      }, timeoutMs);
      const done = (ok) => {
        clearTimeout(timer);
        resolve(ok);
      };
      waiters.push(done);
    });

  return {
    /**
     * Open the quiet window and return a promise that resolves once Astro has
     * re-synced content (or after `timeoutMs`, whichever comes first).
     * Resolves to `true` when the sync signal was observed, `false` when Astro
     * reported an error for the content instead or the wait timed out.
     * @param {number} [timeoutMs]
     * @returns {Promise<boolean>}
     */
    expectSync(timeoutMs = 2500) {
      quietUntil = Date.now() + Math.max(QUIET_WINDOW_MS, timeoutMs + 500);
      return awaitSync(timeoutMs);
    },

    /** Wait for the next content sync without opening the quiet window (for changes Float didn't make). */
    awaitSync,

    /** Open the quiet window without waiting on anything. */
    quiet() {
      quietUntil = Date.now() + QUIET_WINDOW_MS;
    },

    /** An entry file just changed: the full reload that follows belongs to it. */
    noteEntryChange() {
      externalChangeUntil = Date.now() + EXTERNAL_CHANGE_MS;
    },

    /** Start (`true`) or end (`false`) the toolbar's edit session. */
    session(editing) {
      editingUntil = editing ? Date.now() + SESSION_TTL_MS : 0;
    },

    /** Any API call while a session is active keeps it alive. */
    touch() {
      if (isEditing()) editingUntil = Date.now() + SESSION_TTL_MS;
    },

    isEditing,
  };
}

/** An error-level log event from the content layer or one of its loaders. */
function isContentFailure(event) {
  if (!event || typeof event !== "object" || event.level !== "error") return false;
  const label = String(event.label ?? "");
  const message = String(event.message ?? "");
  return label === "content" || /loader$/.test(label) || /does not match collection schema|frontmatter/i.test(message);
}
