import { communityLicense } from "./community.js";
import type { EditionBundle } from "./types.js";

/**
 * The only Community file that loads `ee/` (ADR 0004; lint-enforced). The
 * specifier is a variable so the API still type-checks and runs when `ee/` is
 * removed: the instance then runs as Community.
 */
const EE_MODULE = "@librehr/ee";

export interface LoadEditionOptions {
  /** LIBREHR_LICENSE_KEY. */
  licenseKey?: string | undefined;
  /** LIBREHR_LICENSE_PUBLIC_KEY; env.ts refuses it in production. */
  publicKeyPem?: string | undefined;
  /** Called once when a key is configured but not usable (no PII). */
  warn?: ((message: string, status: string) => void) | undefined;
}

interface EeModule {
  createEeExtensions: (options: {
    licenseKey?: string | undefined;
    publicKeyPem?: string | undefined;
  }) => EditionBundle;
}

function isEeModule(value: unknown): value is EeModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { createEeExtensions?: unknown }).createEeExtensions ===
      "function"
  );
}

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * Resolves the edition at boot (LIC-001/002). Never throws and never makes a
 * network call: without `ee/` or a valid key it returns Community.
 */
export async function loadEdition(
  options: LoadEditionOptions = {},
): Promise<EditionBundle> {
  let mod: unknown;
  try {
    mod = await import(EE_MODULE);
  } catch (err) {
    if (!isModuleNotFound(err)) {
      options.warn?.("Business edition module failed to load", "error");
    }
    return { license: communityLicense(), extensions: [] };
  }
  if (!isEeModule(mod)) {
    options.warn?.("Business edition module has an unexpected shape", "error");
    return { license: communityLicense(), extensions: [] };
  }

  let bundle: EditionBundle;
  try {
    bundle = mod.createEeExtensions({
      licenseKey: options.licenseKey,
      publicKeyPem: options.publicKeyPem,
    });
  } catch {
    options.warn?.("Business edition module failed to start", "error");
    return { license: communityLicense(), extensions: [] };
  }
  const status = bundle.license.licenseStatus;
  if (status === "invalid" || status === "expired") {
    options.warn?.(
      "Licence key is not usable; running as Community edition",
      status,
    );
  }
  return bundle;
}
