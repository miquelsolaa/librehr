import { describe, expect, it } from "vitest";
import { ipVersion, isPublicIpAddress } from "../src/net/index.js";

describe("isPublicIpAddress (ADM-006 SSRF guard)", () => {
  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4003:80e::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("accepts public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    // IPv4 special-purpose ranges
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.10.20.30",
    "169.254.169.254",
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.10",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6 special-purpose ranges
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "ff02::1",
    "2001:db8::1",
    "100::1",
    "2001::1",
    // IPv4-mapped / embedded forms of private addresses
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1",
    "::127.0.0.1",
    "64:ff9b::a00:1",
    "64:ff9b:1::1",
    "2002:a00:1::1",
    "2002:7f00:1::",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    "",
    "localhost",
    "example.com",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "010.0.0.1",
    "0x7f.0.0.1",
    "2130706433",
    "1::2::3",
    "12345::1",
    "1:2:3:4:5:6:7:8:9",
  ])("treats malformed input %j as not public", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
    expect(ipVersion(address)).toBe(0);
  });

  it("detects the IP version", () => {
    expect(ipVersion("10.0.0.1")).toBe(4);
    expect(ipVersion("::1")).toBe(6);
    expect(ipVersion("::ffff:1.2.3.4")).toBe(6);
  });
});
