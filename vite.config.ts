import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the pose editor (editor/), a plain React app that shares
 * this repo's node_modules and src/lib/figure/** with the Remotion side —
 * see CLAUDE.md's "Architecture" section for why that sharing is the point.
 *
 * This is NOT a pnpm workspace: editor/ is just another root inside the same
 * single package, pointed at by `root` below. `resolve.alias` isn't needed
 * because everything under editor/ imports src/lib/** with ordinary relative
 * paths, which Vite (and tsc) resolve the same way node would.
 */

const API_PORT = Number(process.env.EDITOR_API_PORT) || 5184;

export default defineConfig({
  root: "editor",
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: true,
    // The save endpoint (server/save-poses.mjs) runs as its own plain
    // node:http process, not inside Vite. Proxying /api keeps the browser on
    // a single origin (http://localhost:5183) so there is no CORS to
    // configure, and the standalone server stays independently curl-able on
    // its own port for testing.
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
