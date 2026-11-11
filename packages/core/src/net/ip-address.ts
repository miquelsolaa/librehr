/**
 * Pure IP address parsing and classification used to stop server-side request
 * forgery (SSRF) on outbound calls such as webhooks. No I/O: DNS resolution
 * happens in the apps, which pass every resolved address through
 * {@link isPublicIpAddress}.
 */

type Bytes = readonly number[];

function parseIpv4(input: string): Bytes | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // Strict dotted-decimal only: no octal, hex or shortened forms.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIpv6(input: string): Bytes | null {
  // Drop a zone id (fe80::1%eth0); it does not change the range.
  const address = input.split("%")[0] ?? "";
  if (address.length === 0 || !/^[0-9a-fA-F:.]+$/.test(address)) return null;

  let tail: number[] = [];
  let body = address;
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".")) {
    const v4 = parseIpv4(address.slice(lastColon + 1));
    if (!v4) return null;
    tail = [...v4];
    body = address.slice(0, lastColon + 1) + "0:0";
  }

  const halves = body.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const groups: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!head || !rest) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** CIDR membership on byte arrays of equal length. */
function inRange(bytes: Bytes, prefix: Bytes, bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const mask = 0x80 >> (i & 7);
    if (((bytes[byte] ?? 0) & mask) !== ((prefix[byte] ?? 0) & mask)) {
      return false;
    }
  }
  return true;
}

// Not routable on the public internet, or reaching the host itself.
const BLOCKED_V4: ReadonlyArray<readonly [Bytes, number]> = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // RFC 1918
  [[100, 64, 0, 0], 10], // CGNAT (RFC 6598)
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12], // RFC 1918
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // RFC 1918
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. broadcast
];

const BLOCKED_V6: ReadonlyArray<readonly [Bytes, number]> = [
  [[0x01, 0x00], 64], // discard-only 100::/64
  [[0x20, 0x01, 0x00, 0x00], 32], // Teredo (embeds an obfuscated IPv4)
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0xfc], 7], // unique local fc00::/7
  [[0xfe, 0x80], 10], // link-local fe80::/10
  [[0xfe, 0xc0], 10], // deprecated site-local
  [[0xff], 8], // multicast
];

function isPublicV4(bytes: Bytes): boolean {
  return !BLOCKED_V4.some(([prefix, bits]) => inRange(bytes, prefix, bits));
}

function isPublicV6(bytes: Bytes): boolean {
  const zeros = (from: number, to: number) =>
    bytes.slice(from, to).every((b) => b === 0);

  // ::/96 covers :: (unspecified), ::1 (loopback) and the deprecated
  // IPv4-compatible form; none of them is a public destination.
  if (zeros(0, 12)) return false;
  // IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d reach the IPv4
  // address they embed, so classify that address.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicV4(bytes.slice(12));
  }
  if (inRange(bytes, [0x00, 0x64, 0xff, 0x9b], 32) && zeros(4, 12)) {
    return isPublicV4(bytes.slice(12));
  }
  // Local-use NAT64 64:ff9b:1::/48 translates into private networks.
  if (inRange(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)) return false;
  // 6to4 2002:a.b.c.d::/48 embeds an IPv4 address in bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPublicV4(bytes.slice(2, 6));
  }
  return !BLOCKED_V6.some(([prefix, bits]) => inRange(bytes, prefix, bits));
}

/** Returns 4 or 6 for a syntactically valid literal, or 0 otherwise. */
export function ipVersion(address: string): 0 | 4 | 6 {
  if (parseIpv4(address)) return 4;
  if (parseIpv6(address)) return 6;
  return 0;
}

/**
 * True only for a valid IP literal in globally routable unicast space.
 * Loopback, private (RFC 1918), CGNAT, link-local (incl. 169.254.169.254),
 * unique-local, multicast, reserved and documentation ranges are rejected,
 * as are IPv4-mapped, NAT64 and 6to4 forms of them. Anything that does not
 * parse is not public.
 *
 * @example
 * isPublicIpAddress("93.184.216.34"); // true
 * isPublicIpAddress("::ffff:10.0.0.1"); // false
 */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIpv6(address);
  if (v6) return isPublicV6(v6);
  return false;
}
