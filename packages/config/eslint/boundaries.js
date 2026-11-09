// Import boundaries from AGENTS.md section 2:
//   web    -> contracts, ui, i18n
//   api    -> core, db, contracts
//   worker -> core, db, emails
//   core   -> nothing internal, and no I/O libraries
//
// Every rule is a `patterns` entry with an anchored regex so that subpath
// imports (`@librehr/db/schema`) and relative reach-arounds
// (`../../packages/db/src`) are blocked as well as the bare package name.
// `@librehr/config` (lint/ts/tailwind presets) and `@librehr/testing`
// (factories for tests) are tooling, not layers, so they are not restricted.

/** Internal runtime layers: package suffix -> workspace directory. */
const LAYERS = {
  api: "apps/api",
  web: "apps/web",
  worker: "apps/worker",
  core: "packages/core",
  db: "packages/db",
  contracts: "packages/contracts",
  ui: "packages/ui",
  i18n: "packages/i18n",
  emails: "packages/emails",
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Patterns that forbid importing `layer` by package name, subpath or relative path. */
function forbidLayer(from, layer) {
  const message = `${from} must not import ${layer} (AGENTS.md section 2 dependency direction)`;
  return [
    { regex: `^@librehr/${escape(layer)}(/.*)?$`, message },
    { regex: `^(\\.\\.?/)+(.*/)?${escape(LAYERS[layer])}(/.*)?$`, message },
  ];
}

/** Forbid every internal layer except `self` and the explicitly allowed ones. */
function onlyAllow(self, allowed) {
  return Object.keys(LAYERS)
    .filter((layer) => layer !== self && !allowed.includes(layer))
    .flatMap((layer) => forbidLayer(self, layer));
}

const NO_IO = "core must be pure domain logic without I/O";

// Node built-ins that do I/O or touch the process/environment. Bare and
// `node:`-prefixed specifiers are both covered by the regexes below.
const NODE_IO_BUILTINS = [
  "fs",
  "path",
  "os",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "child_process",
  "cluster",
  "worker_threads",
  "process",
  "readline",
  "stream",
  "zlib",
  "vm",
  "inspector",
  "perf_hooks",
  "async_hooks",
];

// Third-party libraries that do database, network, logging or queue I/O.
const IO_LIBRARIES = [
  "pg",
  "pg-.*",
  "postgres",
  "drizzle-orm",
  "drizzle-kit",
  "pino",
  "pino-.*",
  "pg-boss",
  "ioredis",
  "redis",
  "nodemailer",
  "undici",
  "node-fetch",
  "axios",
  "hono",
  "@hono/.*",
  "better-auth",
  "minio",
  "@aws-sdk/.*",
  "@smithy/.*",
];

const coreIoPatterns = [
  {
    // node:crypto is deliberately allowed: hashing/HMAC/random bytes are pure
    // computations that core needs (identity/totp.ts, time/hash-chain.ts,
    // time/kiosk.ts, time/exports.ts, webhooks/signer.ts) and they do no I/O.
    regex: `^node:(?!crypto$).+$`,
    message: `${NO_IO}: only node:crypto is allowed among Node built-ins`,
  },
  {
    regex: `^(${NODE_IO_BUILTINS.join("|")})(/.*)?$`,
    message: `${NO_IO}: Node built-ins other than node:crypto are not allowed`,
  },
  {
    regex: `^(${IO_LIBRARIES.join("|")})(/.*)?$`,
    message: `${NO_IO}: database, network, logging and queue libraries belong in db/api/worker`,
  },
];

const restrict = (patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

/** Flat-config blocks enforcing the boundaries; consumed by base.js. */
export const boundaryConfigs = [
  {
    files: ["packages/core/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: restrict([...onlyAllow("core", []), ...coreIoPatterns]),
  },
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: restrict(onlyAllow("web", ["contracts", "ui", "i18n"])),
  },
  {
    files: ["apps/api/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: restrict(onlyAllow("api", ["core", "db", "contracts"])),
  },
  {
    files: ["apps/worker/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: restrict(onlyAllow("worker", ["core", "db", "emails"])),
  },
];
