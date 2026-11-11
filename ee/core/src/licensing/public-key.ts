/**
 * Public half of the LibreHR licence signing key (Ed25519, SPKI PEM).
 *
 * `null` until the steward generates the production keypair offline
 * (docs/adr/0004-open-core-licensing.md). While it is null every key is
 * rejected and instances run as Community: the check fails closed.
 */
export const LIBREHR_LICENSE_PUBLIC_KEY_PEM: string | null = null;
