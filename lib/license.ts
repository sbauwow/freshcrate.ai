/**
 * License normalization. Long custom licenses (full pasted text, vendor EULAs)
 * blow out the homepage and stats tables, so anything that isn't a recognized
 * SPDX-style identifier collapses to "non-standard" with the original kept
 * intact for the project detail page.
 */

const SPDX_PREFIXES = /^(MIT|ISC|BSD|Apache|Unlicense|0BSD|CC0|GPL|AGPL|MPL|LGPL|EPL|EUPL|CDDL|Artistic|Zlib|WTFPL|NPOSL|OFL|Python|Ruby|PHP|PostgreSQL|NCSA|UPL|BSL|Beerware|Public ?Domain|NOASSERTION|None|Other)\b/i;
const KNOWN_BARE = new Set([
  "Unknown", "NOASSERTION", "None", "Other", "Proprietary", "Custom",
]);

export type LicenseKind = "permissive" | "copyleft" | "weak-copyleft" | "unknown" | "non-standard";

export interface LicenseInfo {
  /** What to render in lists/badges (≤ 30 chars). */
  display: string;
  /** Color/fit category for badge styling. */
  kind: LicenseKind;
  /** True if the raw value didn't match any known SPDX identifier. */
  isNonStandard: boolean;
  /** Original raw value, untouched, for detail pages and tooltips. */
  raw: string;
}

/**
 * Compact a possibly-pasted-full-text license value into something safe to
 * render in a row or badge. Anything over 30 characters or with newlines /
 * heavy punctuation collapses to "non-standard".
 */
export function classifyLicense(raw: string | null | undefined): LicenseInfo {
  const value = (raw ?? "").trim();
  if (!value) {
    return { display: "Unknown", kind: "unknown", isNonStandard: false, raw: "" };
  }

  const looksLikeFullText =
    value.length > 30 ||
    /[\r\n]/.test(value) ||
    (value.match(/\s/g)?.length ?? 0) > 4;

  if (looksLikeFullText) {
    return { display: "non-standard", kind: "non-standard", isNonStandard: true, raw: value };
  }

  if (KNOWN_BARE.has(value)) {
    const kind: LicenseKind = value === "Proprietary" || value === "Custom" ? "non-standard" : "unknown";
    return { display: value, kind, isNonStandard: kind === "non-standard", raw: value };
  }

  if (!SPDX_PREFIXES.test(value)) {
    return { display: "non-standard", kind: "non-standard", isNonStandard: true, raw: value };
  }

  if (/^MIT|^ISC|^BSD|^Apache|^Unlicense|^0BSD|^CC0|^Zlib|^WTFPL|^Artistic|^OFL|^NCSA|^UPL|^Python|^Ruby|^PHP|^PostgreSQL/i.test(value)) {
    return { display: value, kind: "permissive", isNonStandard: false, raw: value };
  }
  if (/^GPL|^AGPL|^MPL/i.test(value)) {
    return { display: value, kind: "copyleft", isNonStandard: false, raw: value };
  }
  if (/^LGPL|^EPL|^EUPL|^CDDL/i.test(value)) {
    return { display: value, kind: "weak-copyleft", isNonStandard: false, raw: value };
  }
  return { display: value, kind: "unknown", isNonStandard: false, raw: value };
}

/** Tailwind class string for a given license kind. */
export function licenseKindClass(kind: LicenseKind): string {
  switch (kind) {
    case "permissive": return "bg-green-100 text-green-800";
    case "copyleft": return "bg-yellow-100 text-yellow-800";
    case "weak-copyleft": return "bg-blue-100 text-blue-800";
    case "non-standard": return "bg-orange-50 text-orange-700";
    case "unknown":
    default: return "bg-gray-200 text-gray-700";
  }
}
