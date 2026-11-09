import { computeEventHashV2 } from "@librehr/core";
import type { TimeChainSigner } from "@librehr/db";

/**
 * Public development key, used only outside production when the caller did
 * not pass one (tests, local scripts). It matches the API env default.
 * Production must pass `TIME_CHAIN_KEY` from the validated env.
 */
const DEV_TIME_CHAIN_KEY =
  "dev_time_chain_key_must_be_changed_in_production_32";

/**
 * Resolves the HMAC key of the time-event chain (TIM-002). Throws in
 * production when no key is configured rather than signing with a public one.
 */
export function resolveTimeChainKey(key: string | undefined): string {
  if (key) return key;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("TIME_CHAIN_KEY must be configured in production");
  }
  return DEV_TIME_CHAIN_KEY;
}

/** Signer for `TimeRepository.appendEvent`, bound to the chain key. */
export function createTimeChainSigner(key: string): TimeChainSigner {
  return (link) => computeEventHashV2(key, link);
}
