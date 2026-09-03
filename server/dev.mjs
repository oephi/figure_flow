#!/usr/bin/env node
/**
 * server/dev.mjs
 *
 * `pnpm editor` runs this. It starts the save server (save-poses.mjs) and
 * the Vite dev server together, so one command gives a fully working editor
 * instead of two terminals.
 *
 * Deliberately a tiny hand-rolled orchestrator rather than a `concurrently`
 * dependency: two `child_process.spawn` calls plus a `SIGINT`/`SIGTERM`
 * handler that kills both is the entire feature, and it avoids adding a new
 * package for something this small.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const VITE_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "vite");

const children = [];
let shuttingDown = false;

const spawnChild = (label, command, args) => {
  const child = spawn(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] ${label} exited (${signal ?? code}); shutting down the other process.`);
    shutdown(code ?? 1);
  });
  return child;
};

const shutdown = (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(exitCode ?? 0);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnChild("save-poses", process.execPath, [path.join(REPO_ROOT, "server", "save-poses.mjs")]);
spawnChild("vite", VITE_BIN, []);
