import crypto from "node:crypto";
import type {
  OidcHttpClient,
  OidcHttpRequest,
  OidcHttpResponse,
} from "../../src/lib/oidc-http.js";

const WELL_KNOWN = "/.well-known/openid-configuration";

/**
 * An in-process OpenID provider for AUTH-004 tests, injected as the app's
 * `oidcHttp`. It answers discovery for any issuer (so configuration saves
 * pass), publishes one RSA key, and issues id_tokens at its token endpoint
 * after checking the client, redirect URI and PKCE verifier.
 */
export class FakeOidcProvider {
  private readonly keyPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  private readonly grants = new Map<
    string,
    { nonce: string; challenge: string; redirectUri: string; claims: object }
  >();
  /** Next token endpoint answers use this status (400 to refuse). */
  tokenStatus = 200;

  constructor(
    readonly issuer: string,
    readonly clientId: string,
    readonly clientSecret: string,
  ) {}

  readonly http: OidcHttpClient = async (request) => this.handle(request);

  /**
   * The person signs in at the provider: returns the callback query the
   * provider would redirect to. `claims` override the id_token's claims.
   */
  approve(authorizationUrl: string, claims: Record<string, unknown>) {
    const params = new URL(authorizationUrl).searchParams;
    const code = crypto.randomBytes(16).toString("hex");
    this.grants.set(code, {
      nonce: params.get("nonce") ?? "",
      challenge: params.get("code_challenge") ?? "",
      redirectUri: params.get("redirect_uri") ?? "",
      claims,
    });
    return { state: params.get("state") ?? "", code };
  }

  /** Signs RS256 with this provider's key, or another key under its kid. */
  sign(claims: Record<string, unknown>, foreignKey = false): string {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode(claims)}`;
    const key = foreignKey
      ? crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      : this.keyPair.privateKey;
    const signature = crypto.sign("sha256", Buffer.from(input), key);
    return `${input}.${signature.toString("base64url")}`;
  }

  private async handle(request: OidcHttpRequest): Promise<OidcHttpResponse> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith(WELL_KNOWN)) {
      const issuer = request.url.slice(0, -WELL_KNOWN.length);
      return {
        status: 200,
        json: {
          issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          jwks_uri: `${this.issuer}/jwks`,
        },
      };
    }
    if (request.method === "GET" && request.url === `${this.issuer}/jwks`) {
      const jwk = this.keyPair.publicKey.export({ format: "jwk" });
      return {
        status: 200,
        json: { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] },
      };
    }
    if (request.method === "POST" && request.url === `${this.issuer}/token`) {
      return this.token(request);
    }
    throw new Error("unexpected request to the fake provider");
  }

  private token(request: OidcHttpRequest): OidcHttpResponse {
    const refused = { status: 400, json: { error: "invalid_grant" } };
    const form = new URLSearchParams(request.body ?? "");
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );
    const grant = this.grants.get(form.get("code") ?? "");
    const challenge = crypto
      .createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url");
    if (
      this.tokenStatus !== 200 ||
      !grant ||
      request.headers?.["Authorization"] !== `Basic ${basic}` ||
      form.get("redirect_uri") !== grant.redirectUri ||
      challenge !== grant.challenge
    ) {
      return this.tokenStatus !== 200
        ? { status: this.tokenStatus, json: null }
        : refused;
    }
    const now = Math.floor(Date.now() / 1000);
    const { foreignKey, ...claims } = grant.claims as {
      foreignKey?: boolean;
    } & Record<string, unknown>;
    const idToken = this.sign(
      {
        iss: this.issuer,
        aud: this.clientId,
        iat: now,
        exp: now + 300,
        nonce: grant.nonce,
        email_verified: true,
        ...claims,
      },
      foreignKey === true,
    );
    return { status: 200, json: { id_token: idToken, token_type: "Bearer" } };
  }
}
