import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpsUrl,
  type HostResolver,
} from "../src/lib/outbound-url.js";
import { ValidationError } from "../src/errors/index.js";

// A fake resolver: tests never touch the network.
function resolverFor(table: Record<string, string[]>): HostResolver {
  return vi.fn(async (hostname: string) => {
    const addresses = table[hostname];
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses;
  });
}

const resolve = resolverFor({
  "hooks.example.com": ["93.184.216.34", "2606:2800:220:1::1"],
  "internal.example.com": ["10.0.0.5"],
  "mixed.example.com": ["93.184.216.34", "127.0.0.1"],
  "metadata.example.com": ["169.254.169.254"],
  "mapped.example.com": ["::ffff:192.168.1.10"],
  localhost: ["127.0.0.1", "::1"],
  "empty.example.com": [],
});

async function rejection(url: string, allowPrivate = false) {
  try {
    await assertPublicHttpsUrl(url, { allowPrivate, resolve });
  } catch (err) {
    return err;
  }
  return null;
}

describe("assertPublicHttpsUrl (ADM-006 SSRF guard)", () => {
  it("allows a public https URL", async () => {
    const url = await assertPublicHttpsUrl(
      "https://hooks.example.com/services/x",
      { allowPrivate: false, resolve },
    );
    expect(url.hostname).toBe("hooks.example.com");
  });

  it("allows a public IP literal without resolving it", async () => {
    const spy = resolverFor({});
    await expect(
      assertPublicHttpsUrl("https://93.184.216.34/hook", {
        allowPrivate: false,
        resolve: spy,
      }),
    ).resolves.toBeInstanceOf(URL);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/hook",
    "https://10.0.0.1/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[fd00::1]/hook",
    "https://0x7f.1/hook",
    "https://2130706433/hook",
    "https://internal.example.com/hook",
    "https://mixed.example.com/hook",
    "https://metadata.example.com/hook",
    "https://mapped.example.com/hook",
    "https://empty.example.com/hook",
    "https://unknown.example.com/hook",
    "http://hooks.example.com/hook",
    "ftp://hooks.example.com/hook",
    "file:///etc/passwd",
    "not a url",
  ])("rejects %s with a generic validation error", async (url) => {
    const err = await rejection(url);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe("OUTBOUND_URL_NOT_ALLOWED");
    expect((err as ValidationError).detail).toBe(
      "The URL must be a public https:// address",
    );
  });

  it("allows http and private hosts only with the explicit dev flag", async () => {
    await expect(
      assertPublicHttpsUrl("http://localhost:8025/hook", {
        allowPrivate: true,
        resolve,
      }),
    ).resolves.toBeInstanceOf(URL);
    expect(await rejection("file:///etc/passwd", true)).toBeInstanceOf(
      ValidationError,
    );
  });
});
