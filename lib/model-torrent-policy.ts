/**
 * Torrent allowlist policy for Hugging Face models (plan Task 10).
 *
 * freshcrate never distributes a torrent of a gated or restricted-license
 * model — the allowlist below is the single source of truth, shared by the
 * batch builder (lib/build-model-torrents-job.ts), the cron route's
 * candidate pre-filter, and the /torrent download route's 403 explanation.
 *
 * License strings are EXACT: models.license is written by refresh-models
 * from the HF `license:*` tag, already normalized lowercase, so the list is
 * lowercase and matched exactly (the matcher lowercases input defensively,
 * but nothing upstream should rely on that).
 */

export const TORRENTABLE_LICENSES = [
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
] as const;

export interface TorrentPolicyInput {
  /** Normalized lowercase license from models.license ('unknown' when absent). */
  license?: string | null;
  /** models.gated flag: 1 (or true) means gated — never torrentable. */
  gated?: number | boolean | null;
}

export interface TorrentPolicyDecision {
  ok: boolean;
  /** Human-readable rejection reason; undefined when ok. */
  reason?: string;
}

/** Decide whether a model may get a torrent. Gated wins over license so the
 * reason names the stronger blocker (the UI surfaces it verbatim). */
export function isTorrentable(input: TorrentPolicyInput): TorrentPolicyDecision {
  if (input.gated === 1 || input.gated === true) {
    return {
      ok: false,
      reason: "gated model — weights require accepting upstream terms, so freshcrate hosts no torrent",
    };
  }
  const license = (input.license ?? "").trim().toLowerCase();
  if (!license || license === "unknown") {
    return { ok: false, reason: "unknown license — no allowlisted license tag on the repo" };
  }
  if (!(TORRENTABLE_LICENSES as readonly string[]).includes(license)) {
    return {
      ok: false,
      reason: `license "${license}" is not on the torrentable allowlist`,
    };
  }
  return { ok: true };
}
