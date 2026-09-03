#!/usr/bin/env node
/**
 * server/save-poses.mjs
 *
 * The pose editor's write path back to disk. Plain `node:http`, no Express —
 * this is a local dev tool with exactly one endpoint, so a framework buys
 * nothing.
 *
 * POST /api/save { path: string, data: unknown }
 *   Writes JSON.stringify(data, null, 2) to poses/<path>.
 *   200 { path } on success (path relative to poses/, as resolved).
 *   400 on a malformed request (bad JSON, missing path/data).
 *   403 if `path` resolves outside poses/ (path traversal).
 *
 * Run standalone (`node server/save-poses.mjs`) or via `pnpm editor`, which
 * starts this alongside the Vite dev server (see server/dev.mjs). The Vite
 * dev server proxies /api/* here (see vite.config.ts) so the browser only
 * ever talks to one origin.
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const POSES_ROOT = path.join(REPO_ROOT, "poses");
const PORT = Number(process.env.EDITOR_API_PORT) || 5184;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB is generously more than any pose/track JSON.

/**
 * Resolves `relPath` against poses/ and rejects anything that escapes it.
 *
 * This is the one security-relevant thing in this file: a local save tool
 * that accepts an arbitrary path from the request body is a path-traversal
 * write if unchecked (e.g. "../../../.zshrc"). Resolving to an absolute path
 * and checking the prefix, rather than just rejecting strings containing
 * "..", is deliberate: `library/../../../etc/x` collapses to an outside path
 * under path.resolve and is caught here, whereas a naive "no .." substring
 * check both misses cases and rejects legitimate ones.
 *
 * Note percent-encoding is NOT a traversal risk here and is not decoded:
 * "..%2f..%2fx" contains no path separator, so path.resolve treats the whole
 * thing as one filename and it stays inside poses/. It is rejected by the
 * filename rules below purely because it is junk, not because it escapes.
 */
const resolveInPoses = (relPath) => {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new HttpError(400, "path must be a non-empty string");
  }
  // Constrain the shape of the name as well as its location. Without this the
  // endpoint happily writes files called anything at all inside poses/ — not a
  // security hole, but it lets a typo or a bad request litter the pose library
  // with files the loader will never read.
  if (!/^[A-Za-z0-9._/-]+$/.test(relPath)) {
    throw new HttpError(400, `path "${relPath}" has characters outside [A-Za-z0-9._/-]`);
  }
  if (!relPath.endsWith(".json")) {
    throw new HttpError(400, `path "${relPath}" must end in .json`);
  }
  const resolved = path.resolve(POSES_ROOT, relPath);
  const withSep = POSES_ROOT + path.sep;
  if (resolved !== POSES_ROOT && !resolved.startsWith(withSep)) {
    throw new HttpError(403, `path "${relPath}" escapes poses/`);
  }
  return resolved;
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        reject(new HttpError(400, "empty request body"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });

const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
};

const handleSave = async (req, res) => {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "request body must be a JSON object");
  }
  const { path: relPath, data } = body;
  if (data === undefined) {
    throw new HttpError(400, "missing \"data\"");
  }

  const absolutePath = resolveInPoses(relPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(data, null, 2) + "\n", "utf8");

  sendJson(res, 200, { path: path.relative(POSES_ROOT, absolutePath) });
};

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/save") {
    handleSave(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) {
        console.error("save-poses: unexpected error", error);
      }
      sendJson(res, status, { error: error.message });
    });
    return;
  }
  sendJson(res, 404, { error: `no route for ${req.method} ${req.url}` });
});

server.listen(PORT, () => {
  console.log(`[save-poses] listening on http://localhost:${PORT} (writes under ${POSES_ROOT})`);
});
