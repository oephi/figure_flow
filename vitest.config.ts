import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // This project's testable code (src/lib/figure) is deliberately pure
    // TypeScript with no DOM/React/Remotion dependency, so plain node is
    // enough — no jsdom/browser environment needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
