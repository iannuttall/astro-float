/**
 * When Lee writes a content file, Astro's content layer re-syncs the entry and
 * then asks the browser to do a full reload. A reload would tear down the editor
 * mid-keystroke, so for a short "quiet window" after each Lee save we swallow
 * that reload and let the client re-fetch the page HTML and swap it in place.
 *
 * The swallowed reload doubles as the "content is synced" signal: the save
 * endpoint waits for it before responding, so the client's follow-up fetch is
 * guaranteed to render the new content.
 *
 * Edits coming from anywhere else (your editor, git checkout, ...) reload the
 * page as usual — unless an edit session is active. Then the reload would drop
 * whatever the author is typing, so it's swallowed too and the toolbar gets an
 * `astro-lee:file-changed` event instead (see `watch.js`). The toolbar opens
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

  // Astro 5's content layer sends the reload on `server.ws`; Astro 6+ sends it
  // on the client environment's hot channel (`server.environments.client.hot`),
  // which may or may not be the same object as `server.ws` depending on the
  // Vite version. Wrap every distinct channel so the reload is caught wherever
  // it is sent; `settle` is idempotent, so a message that passes through two of
  // them counts once.
  for (const channel of hotChannels(server)) {
    const originalSend = channel.send.bind(channel);
    channel.send = (...args) => {
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
          logger.debug("suppressed full-reload inside Lee quiet window");
          return;
        }
        if (isEditing() && Date.now() < externalChangeUntil) {
          if (synced) settle(true);
          logger.debug("suppressed full-reload for an outside change during a Lee edit session");
          return;
        }
        if (synced) settle(true);
      }

      return originalSend(...args);
    };
  }

  // When Astro rejects the written entry (schema mismatch, YAML error) it never
  // re-syncs, so no reload arrives and the wait would run to its timeout. The
  // content layer logs that rejection through the logger's shared destination;
  // watching for it answers `synced: false` right away.
  // (Astro 5 calls the option `dest`, Astro 6+ `destination`; see `watchLogDestination`.)
  watchLogDestination(logger, (event) => {
    if (waiters.length && isContentFailure(event)) settle(false);
  });

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

    /** Wait for the next content sync without opening the quiet window (for changes Lee didn't make). */
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

/**
 * See every log event Astro writes, whichever destination is current.
 *
 * Integration loggers are forks that share one `options` object with Astro's
 * root logger, so wrapping the destination there catches the content layer's
 * errors too. Astro 5 calls the option `dest`, Astro 6+ `destination`; and
 * Astro can swap the destination after `astro:server:setup` (Astro 7 does when
 * it tees logs to `.astro/dev.log`), so the option is turned into an accessor
 * that wraps whatever is set later as well.
 *
 * @param {any} logger
 * @param {(event: any) => void} onEvent
 */
function watchLogDestination(logger, onEvent) {
  const options = logger?.options;
  if (!options || typeof options !== "object") return;
  const key = "dest" in options ? "dest" : "destination";
  const wrap = (dest) => {
    if (!dest || typeof dest.write !== "function") return dest;
    return Object.create(dest, {
      write: {
        configurable: true,
        writable: true,
        value: (event) => {
          try {
            onEvent(event);
          } catch {
            /* never let the watcher break logging */
          }
          return dest.write(event);
        },
      },
    });
  };
  let wrapped = wrap(options[key]);
  try {
    Object.defineProperty(options, key, {
      configurable: true,
      enumerable: true,
      get: () => wrapped,
      set: (dest) => {
        wrapped = wrap(dest);
      },
    });
  } catch {
    // Frozen options: wrap the current destination only.
    try {
      options[key] = wrapped;
    } catch {
      /* read-only; the save falls back to its timeout */
    }
  }
}

/** The distinct objects a full-reload may be sent through, in the order Astro uses them. */
function hotChannels(server) {
  const seen = new Set();
  const out = [];
  for (const candidate of [server.environments?.client?.hot, server.ws, server.hot]) {
    if (!candidate || typeof candidate.send !== "function" || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** An error-level log event from the content layer or one of its loaders. */
function isContentFailure(event) {
  if (!event || typeof event !== "object" || event.level !== "error") return false;
  const label = String(event.label ?? "");
  const message = String(event.message ?? "");
  return label === "content" || /loader$/.test(label) || /does not match collection schema|frontmatter/i.test(message);
}
