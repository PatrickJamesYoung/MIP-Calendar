import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = import.meta.dirname;

/**
 * Vitest smoke-test configuration.
 *
 * These tests are pure-Node unit tests over library helpers — they never
 * touch the Next.js runtime, Supabase, or Resend. They exist to catch
 * refactor regressions in the helpers that most of the rest of the app
 * depends on (auth, rate limiting, HTML escaping, event normalization,
 * ingest verdict parsing).
 *
 * Run: `npm test` or `npm run test`
 */
export default defineConfig({
  test: {
    globals: false, // require explicit imports; keeps intent obvious
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});
