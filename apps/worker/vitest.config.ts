import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // `tsc` emits compiled tests into dist/; without this a run after a build
    // also picks up dist/test/*.int.test.js (vitest 5 no longer skips dist).
    exclude: [...configDefaults.exclude, "dist/**"],
    // Integration tests start and stop a Postgres Testcontainer per file, and
    // `pnpm verify` runs the api and worker suites at the same time. On a
    // loaded machine container start/stop and multi-tenant fixtures exceed
    // the 5 s test and 10 s hook defaults, failing tests whose assertions
    // all pass. Unit tests finish far below these limits.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
