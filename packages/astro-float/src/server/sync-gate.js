import fs from "node:fs/promises";
import path from "node:path";
import { importFromAstro } from "./astro-deps.js";
import { assetImportsForEntry } from "./assets.js";

const DATA_STORE_FILE = path.join(".astro", "data-store.json");
const SYNC_CAP_MS = 30_000;
const SESSION_TTL_MS = 60_000;

/**
 * Coordinate Float writes with Astro's content layer.
 *
 * A Vite `full-reload` does not name the entry or the bytes that Astro loaded.
 * Each operation instead takes a snapshot of Astro's data store before the
 * filesystem mutation. It waits for a later store write that contains the
 * exact file path and Astro digest of the new entry, or no longer contains a
 * deleted entry. Image entries also wait until Astro's generated image map
 * contains every asset recorded in that store entry.
 *
 * `refreshContent` is Astro's public way to ask all loaders to apply the
 * current files. Astro 5, 6, and 7 provide it. The store watcher remains the
 * proof that this entry was applied, so an unrelated refresh cannot satisfy
 * the operation. The watchers are installed before any operation can write.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {import('astro').AstroIntegrationLogger} logger
 * @param {{ root: string, refreshContent?: (options?: any) => Promise<void> }} options
 */
export function createSyncGate(server, logger, { root, refreshContent } = {}) {
  const dataFile = path.join(root, DATA_STORE_FILE);
  const assetFile = path.join(root, ".astro", "content-assets.mjs");
  /** @type {Set<any>} */
  const pending = new Set();
  let editingUntil = 0;

  server.watcher.add(dataFile);
  server.watcher.add(assetFile);
  const changed = (file) => {
    if (file === dataFile || file === assetFile) {
      void checkAll();
    }
  };
  server.watcher.on("add", changed);
  server.watcher.on("change", changed);

  // Astro 5 sends on `server.ws`; Astro 6+ can use the client environment.
  // All reloads stay suppressed during an edit session so an image move or an
  // outside write cannot destroy the draft. `watch.js` sends an exact entry
  // hash after Astro applies an outside content edit.
  for (const channel of hotChannels(server)) {
    const originalSend = channel.send.bind(channel);
    channel.send = (...args) => {
      const payload = args[0];
      const fullReload = payload && typeof payload === "object" && payload.type === "full-reload";
      if (fullReload && (pending.size > 0 || isEditing())) {
        logger.debug("suppressed content full-reload during a Float edit or sync");
        return;
      }
      return originalSend(...args);
    };
  }

  const isEditing = () => Date.now() < editingUntil;

  async function checkAll() {
    await Promise.all([...pending].map((operation) => check(operation)));
  }

  async function check(operation) {
    if (!operation.target || operation.done || operation.matched) return;
    if (operation.checking) {
      operation.recheck = true;
      return operation.checking;
    }
    operation.checking = (async () => {
      do {
        operation.recheck = false;
        try {
          const snapshot = await readStore(root);
          if (operation.requireChange && snapshot.raw === operation.baseline) continue;
          if (!(await matches(root, snapshot.store, operation.target))) continue;
          operation.matched = true;
          operation.resolve(true);
        } catch {
          // Astro writes the store atomically. Retry a transient read or
          // import error on the next concrete event or refresh finish.
        }
      } while (operation.recheck && !operation.done && !operation.matched);
    })();
    try {
      await operation.checking;
    } finally {
      operation.checking = null;
    }
  }

  async function begin(label, { requireChange = true } = {}) {
    const baseline = (await readStore(root)).raw;
    const operation = {
      label,
      baseline,
      requireChange,
      target: null,
      checking: null,
      recheck: false,
      done: false,
      matched: false,
      timer: undefined,
      resolve: undefined,
      pending,
    };
    pending.add(operation);
    return {
      async waitFor(target, { refresh = true } = {}) {
        operation.target = await prepareTarget(root, target);
        const signal = new Promise((resolve) => {
          operation.resolve = resolve;
        });
        const safety = new Promise((_, reject) => {
          operation.timer = setTimeout(() => {
            operation.done = true;
            pending.delete(operation);
            reject(httpError(504, `Astro did not apply ${label} within 30 seconds`));
          }, SYNC_CAP_MS);
        });
        void check(operation);
        try {
          let work;
          if (refresh && typeof refreshContent === "function") {
            const refreshed = refreshContent().then(() => check(operation));
            work = Promise.all([signal, refreshed]);
          } else {
            work = signal;
          }
          await Promise.race([work, safety]);
          return true;
        } catch (err) {
          cancel(operation);
          if (err?.status) throw err;
          throw httpError(500, `Astro could not apply ${label}: ${err?.message ?? err}`);
        } finally {
          clearTimeout(operation.timer);
        }
      },
      cancel: () => cancel(operation),
    };
  }

  return {
    begin,

    /** Ask Astro to finish a full content refresh. Used by deterministic test cleanup. */
    async refresh(label = "the content refresh") {
      if (typeof refreshContent !== "function") throw httpError(501, "this Astro version does not expose refreshContent");
      let timer;
      try {
        await Promise.race([
          refreshContent(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(httpError(504, `Astro did not finish ${label} within 30 seconds`)), SYNC_CAP_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
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

function cancel(operation) {
  if (operation.done) return;
  operation.done = true;
  clearTimeout(operation.timer);
  operation.pending?.delete?.(operation);
  operation.resolve?.(false);
}

async function prepareTarget(root, target) {
  if (target.type !== "entry") return target;
  const source = await fs.readFile(path.resolve(root, target.file), "utf8");
  const xxhash = await importFromAstro(root, "xxhash-wasm");
  const { h64ToString } = await xxhash.default();
  return { ...target, digest: h64ToString(source) };
}

async function readStore(root) {
  let raw;
  try {
    raw = await fs.readFile(path.join(root, DATA_STORE_FILE), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { raw: "", store: new Map() };
    throw err;
  }
  const devalue = await importFromAstro(root, "devalue");
  const store = devalue.parse(raw);
  if (!(store instanceof Map)) throw new Error("Astro data store is not a Map");
  return { raw, store };
}

async function matches(root, store, target) {
  const collection = store.get(target.collection);
  if (target.type === "collection-absent") return !(collection instanceof Map);
  const entry = collection instanceof Map ? collection.get(target.id) : undefined;
  if (target.type === "entry-absent") return entry === undefined;
  if (!entry || entry.filePath !== target.file || entry.digest !== target.digest) return false;
  if (target.oldId && target.oldId !== target.id && collection.get(target.oldId) !== undefined) return false;
  const assets = Array.isArray(entry.assetImports) ? entry.assetImports : [];
  if (!assets.length) return true;
  const imported = await assetImportsForEntry({ root }, target.file);
  return assets.every((asset) => imported.has(asset));
}

/** The distinct objects a full reload may be sent through, in the order Astro uses them. */
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

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
