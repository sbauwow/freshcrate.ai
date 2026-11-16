import { describe, it, expect } from "vitest";
import { TORRENTABLE_LICENSES, isTorrentable } from "@/lib/model-torrent-policy";

/**
 * Policy matrix for the torrent allowlist. Licenses arrive normalized
 * lowercase in models.license (written by refresh-models from the HF
 * license:* tag), so the allowlist is exact lowercase strings and the
 * matcher lowercases defensively only.
 */
describe("TORRENTABLE_LICENSES", () => {
  it("contains exactly the agreed permissive/open-license strings", () => {
    expect([...TORRENTABLE_LICENSES]).toEqual([
      "mit",
      "apache-2.0",
      "bsd-2-clause",
      "bsd-3-clause",
      "wtfpl",
      "cc-by-4.0",
      "cc-by-sa-4.0",
      "cc0-1.0",
      "openrail",
      "bigscience-openrail-m",
      "artistic-2.0",
    ]);
  });
});

describe("isTorrentable", () => {
  it("allows every allowlisted license when not gated", () => {
    for (const license of TORRENTABLE_LICENSES) {
      expect(isTorrentable({ license, gated: 0 })).toEqual({ ok: true });
    }
  });

  it("denies 'unknown' with a reason", () => {
    const d = isTorrentable({ license: "unknown", gated: 0 });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/unknown/i);
  });

  it("denies an empty or missing license like unknown", () => {
    expect(isTorrentable({ license: "", gated: 0 }).ok).toBe(false);
    expect(isTorrentable({ gated: 0 }).ok).toBe(false);
  });

  it("denies non-allowlisted licenses and names the license in the reason", () => {
    for (const license of ["llama2", "cc-by-nc-4.0", "gpl-3.0", "agpl-3.0", "openrail++", "other"]) {
      const d = isTorrentable({ license, gated: 0 });
      expect(d.ok).toBe(false);
      expect(d.reason).toContain(license);
    }
  });

  it("denies gated models regardless of license (gated=1 or true)", () => {
    const byFlag = isTorrentable({ license: "mit", gated: 1 });
    expect(byFlag.ok).toBe(false);
    expect(byFlag.reason).toMatch(/gated/i);

    const byBool = isTorrentable({ license: "apache-2.0", gated: true });
    expect(byBool.ok).toBe(false);
    expect(byBool.reason).toMatch(/gated/i);
  });

  it("gated beats license in the reason (gated is checked first)", () => {
    const d = isTorrentable({ license: "unknown", gated: 1 });
    expect(d.reason).toMatch(/gated/i);
  });

  it("lowercases defensively but keeps the allowlist exact", () => {
    expect(isTorrentable({ license: "MIT", gated: 0 })).toEqual({ ok: true });
    expect(isTorrentable({ license: "  mit  ", gated: 0 })).toEqual({ ok: true });
    // Not on the list in any casing:
    expect(isTorrentable({ license: "Llama2", gated: 0 }).ok).toBe(false);
  });
});
