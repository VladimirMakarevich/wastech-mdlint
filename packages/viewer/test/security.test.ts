import { describe, expect, it } from "vitest";

import {
  exposesAbsolutePaths,
  isAllowedHostHeader,
  isForeignRequest,
} from "../src/security.js";

// The copy button's absolute path tells a reader where the checkout lives and under which account.
// On a loopback binding the reader is on this machine; with any other `--host` the page is read from
// elsewhere, and the path must not go with it.
describe("exposesAbsolutePaths", () => {
  it.each(["127.0.0.1", "localhost", "LocalHost", "::1"])(
    "offers absolute paths when bound to %s",
    (host) => {
      expect(exposesAbsolutePaths(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "192.168.1.20", "::", "viewer.lan"])(
    "withholds them when bound to %s",
    (host) => {
      expect(exposesAbsolutePaths(host)).toBe(false);
    },
  );
});

describe("isAllowedHostHeader", () => {
  const bound = { host: "127.0.0.1", port: 4180 };

  it.each([
    "127.0.0.1:4180",
    "localhost:4180",
    "LOCALHOST:4180",
    "[::1]:4180",
    "192.168.1.20:4180",
  ])("accepts %s", (host) => {
    expect(isAllowedHostHeader(host, bound)).toBe(true);
  });

  // A DNS-rebinding page reaches this server under its own name, so any name other than localhost
  // or the configured host is refused even though the request arrived on the right socket.
  it.each([
    ["a foreign name", "attacker.example:4180"],
    ["a name that ends in localhost", "localhost.attacker.example:4180"],
    ["another port", "127.0.0.1:4181"],
    ["no port", "127.0.0.1"],
    ["garbage", "%%%"],
  ])("rejects %s", (_label, host) => {
    expect(isAllowedHostHeader(host, bound)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAllowedHostHeader(undefined, bound)).toBe(false);
  });

  it("accepts the host name the server was bound to", () => {
    expect(
      isAllowedHostHeader("devbox:4180", { host: "devbox", port: 4180 }),
    ).toBe(true);
  });
});

describe("isForeignRequest", () => {
  const host = "127.0.0.1:4180";

  it("allows a request without fetch metadata, as from curl or an old browser", () => {
    expect(isForeignRequest({ host })).toBe(false);
  });

  it("allows this origin", () => {
    expect(
      isForeignRequest({
        host,
        origin: "http://127.0.0.1:4180",
        "sec-fetch-site": "same-origin",
      }),
    ).toBe(false);
  });

  it("allows a navigation from another site, whose response goes to the user", () => {
    expect(
      isForeignRequest({
        host,
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
      }),
    ).toBe(false);
  });

  it.each([
    ["another origin", { origin: "http://attacker.example" }],
    ["an opaque origin", { origin: "null" }],
    ["another port on localhost", { origin: "http://127.0.0.1:3000" }],
    [
      "a cross-site fetch",
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
    ],
    [
      "a same-site no-cors embed",
      { "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors" },
    ],
  ])("refuses %s", (_label, headers) => {
    expect(isForeignRequest({ host, ...headers })).toBe(true);
  });
});
