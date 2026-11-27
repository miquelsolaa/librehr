/**
 * Why an OIDC step failed. The callback (AUTH-004) maps each reason to an
 * `SSO_*` code; only reasons reached after the provider authenticated the
 * person (`email_not_verified`, `domain_not_allowed`) are shown as such.
 */
export type OidcFailureReason =
  | "issuer_not_supported"
  | "discovery_failed"
  | "exchange_failed"
  | "token_invalid"
  | "email_not_verified"
  | "domain_not_allowed";

/**
 * A refused OIDC step. The message is a fixed string per reason: it never
 * carries a token, a claim value or a provider error description.
 */
export class OidcError extends Error {
  readonly reason: OidcFailureReason;

  constructor(reason: OidcFailureReason) {
    super(`OIDC ${reason.replaceAll("_", " ")}`);
    this.name = "OidcError";
    this.reason = reason;
  }
}
