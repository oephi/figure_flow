/**
 * Client for the local save endpoint (server/save-poses.mjs).
 *
 * The dev server proxies /api/* to the standalone save server (see
 * vite.config.ts), so this fetches a same-origin path — no CORS handling
 * needed, and no base URL to configure per-environment.
 */

export interface SaveResult {
  ok: boolean;
  /** Path actually written, relative to poses/, on success. */
  path?: string;
  error?: string;
}

/**
 * Writes `data` to `poses/<path>` via the local save server.
 *
 * `path` must stay inside `poses/`; the server re-validates this
 * independently (never trust the client), so a rejected traversal attempt
 * comes back as `{ ok: false, error }` rather than throwing.
 */
export async function savePose(path: string, data: unknown): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, data }),
    });
  } catch (error) {
    return { ok: false, error: `network error: ${String(error)}` };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = (body ?? {}) as { path?: string; error?: string };

  if (!response.ok) {
    return { ok: false, error: parsed.error ?? `HTTP ${response.status}` };
  }
  return { ok: true, path: parsed.path };
}
