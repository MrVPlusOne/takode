import { availableParallelism, loadavg } from "node:os";
import { defineConfig } from "vitest/config";

// Set before Vite resolves anything; workers inherit it. Sessions launched by a
// production server otherwise pass NODE_ENV=production, which makes Vite
// externalize node builtins for jsdom files and breaks their loading. React
// 19.2+ also only exports `act` in its development build.
process.env.NODE_ENV = "test";

/**
 * Size the worker pool to the CPU left idle by other processes. Several agents
 * often run the suite at once; each starting cpus-1 workers starves process-
 * and git-heavy tests into timeouts without finishing any sooner overall.
 */
function idleCpuWorkerCount(): number {
  const cpus = availableParallelism();
  const idleCpus = Math.round(cpus - loadavg()[0]);
  return Math.max(1, Math.min(cpus - 1, Math.max(4, idleCpus)));
}

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
    __TAKODE_BUILD_ID__: JSON.stringify("development"),
  },
  test: {
    globals: true,
    // Files opt into jsdom with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      thresholds: {
        global: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
    include: [
      "server/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "bin/**/*.test.ts",
      "scripts/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    setupFiles: ["src/test-setup.ts"],
    globalSetup: ["scripts/vitest-disposable-home.ts"],
    maxWorkers: idleCpuWorkerCount(),
  },
});
