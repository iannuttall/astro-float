import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { CONTENT_DIR, copyTree, deleteDeferred, REPO, waitForContentSync } from "./content";

/** Start the demo's `astro dev` on a free port and snapshot the content it serves. */
export default async function globalSetup() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "astro-float-e2e-"));
  copyTree(CONTENT_DIR, path.join(backup, "content"));

  const logDir = path.join(REPO, "test-results");
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.createWriteStream(path.join(logDir, "astro-dev.log"), { flags: "a" });
  const dev: ChildProcess = spawn("pnpm", ["--filter", "demo", "exec", "astro", "dev", "--port", String(port), "--host", "127.0.0.1"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  dev.stdout?.pipe(log);
  dev.stderr?.pipe(log);

  await waitForServer(base, dev);
  // `astro dev` syncs content at start-up; make sure the pages serve before the first test asks.
  await waitForContentSync(base, 8_000).catch(() => {});

  process.env.FLOAT_BASE_URL = base;
  process.env.FLOAT_BACKUP = backup;

  return async () => {
    dev.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (dev.exitCode === null) dev.kill("SIGKILL");
    log.end();
    deleteDeferred();
    fs.rmSync(backup, { recursive: true, force: true });
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(base: string, dev: ChildProcess) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (dev.exitCode !== null) throw new Error(`astro dev exited with ${dev.exitCode} (see test-results/astro-dev.log)`);
    try {
      const res = await fetch(base + "/");
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("astro dev did not answer within 90s (see test-results/astro-dev.log)");
}
