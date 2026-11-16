#!/usr/bin/env node

/**
 * freshcrate HF Model Torrent Builder (LOCAL-ONLY)
 *
 * Weekly batch: top-N (default 10) allowlisted models by downloads that have
 * no model_torrents row yet → detail + file-tree checks against the
 * Hugging Face Hub → stream the weight files and hash real piece hashes via
 * lib/build-model-torrent → upsert model_torrents + write models.size_mb.
 * All logic lives in lib/build-model-torrents-job.ts (imported here, so the
 * SQL and the Hub contract can't drift), which means this MUST run under
 * tsx (the lib's "@/..." imports don't resolve under plain node):
 *
 *   npx tsx scripts/build-model-torrents.mjs
 *
 * PROD DATA PATH: production data lives in the Railway /data volume, which
 * this script never touches. Prod builds go through the server endpoint —
 * .github/workflows/build-model-torrents.yml POSTs to
 * /api/cron/build-model-torrents on the Railway app (fire-and-forget: the
 * endpoint answers {queued: N} and streams the weights server-side, so a
 * multi-GB build never blocks a request or needs a runner). This script is
 * a LOCAL-ONLY tool: it reads/writes the local dev DB under ./data and
 * streams from HF for real, so point it at --dry-run first.
 *
 * Usage:
 *   npx tsx scripts/build-model-torrents.mjs                       # 10 models, default caps
 *   BUILD_TORRENTS_LIMIT=25 npx tsx scripts/build-model-torrents.mjs
 *   BUILD_TORRENTS_MAX_MODEL_MB=8000 npx tsx scripts/build-model-torrents.mjs
 *   BUILD_TORRENTS_BUDGET_MS=120000 npx tsx scripts/build-model-torrents.mjs
 *   HF_TOKEN=hf_... npx tsx scripts/build-model-torrents.mjs       # optional, softer rate limits
 *   npx tsx scripts/build-model-torrents.mjs --dry-run             # print config, do nothing
 *
 * Hard deadline: the job checks budgetMs between models (default 240s) and
 * a Promise.race deadline (lib/refresh-deadline.ts, default 9 minutes)
 * guards against a hung Hub call. On deadline fire the partials are printed
 * (each model commits in its own transaction, so partials are durable) and
 * the process exits 1; per-model skips/errors are logged distinctly but do
 * not flip the exit code.
 */

const DRY_RUN = process.argv.includes("--dry-run");

let buildTorrentsForModels;
let selectTorrentCandidates;
let raceWithDeadline;
try {
  ({ buildTorrentsForModels, selectTorrentCandidates } = await import(
    "../lib/build-model-torrents-job.ts"
  ));
  ({ raceWithDeadline } = await import("../lib/refresh-deadline.ts"));
} catch (err) {
  console.error("Fatal error: could not load the TS lib. Run this script under tsx:");
  console.error("  npx tsx scripts/build-model-torrents.mjs");
  console.error(`(${err instanceof Error ? err.message : String(err)})`);
  process.exit(1);
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_MODEL_MB = 20000;
const DEFAULT_BUDGET_MS = 240000;
const DEFAULT_DEADLINE_MS = 9 * 60 * 1000;

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.log(`⚠ ${name}="${raw}" is not a positive integer — using default ${fallback}`);
    return fallback;
  }
  return n;
}

const LIMIT = intFromEnv("BUILD_TORRENTS_LIMIT", DEFAULT_LIMIT);
const MAX_MODEL_MB = intFromEnv("BUILD_TORRENTS_MAX_MODEL_MB", DEFAULT_MAX_MODEL_MB);
const BUDGET_MS = intFromEnv("BUILD_TORRENTS_BUDGET_MS", DEFAULT_BUDGET_MS);
const DEADLINE_MS = intFromEnv("BUILD_TORRENTS_DEADLINE_MS", DEFAULT_DEADLINE_MS);
const HF_TOKEN = process.env.HF_TOKEN || "";

function printConfig() {
  console.log(`   Limit:    ${LIMIT} model(s) per run`);
  console.log(`   Size cap: ${MAX_MODEL_MB} MB per model`);
  console.log(`   Budget:   ${BUDGET_MS}ms between-models budget + ${DEADLINE_MS}ms hard race`);
  console.log(`   Token:    ${HF_TOKEN ? "✓ present" : "✗ none (anonymous HF rate limits)"}`);
  console.log("   Hub:      https://huggingface.co/api/models (+ /resolve/main web seeds)");
}

if (DRY_RUN) {
  console.log("🔄 freshcrate model torrent build (DRY RUN — no fetch, no DB writes)");
  printConfig();
  console.log(
    `Would run: buildTorrentsForModels({ limit: ${LIMIT}, maxModelMb: ${MAX_MODEL_MB}, budgetMs: ${BUDGET_MS}, dryRun: true })` +
      ` under a ${DEADLINE_MS}ms hard deadline`
  );
  process.exit(0);
}

async function main() {
  console.log("🔄 freshcrate model torrent build");
  printConfig();
  console.log();

  let loggedSkips = 0;
  let loggedErrors = 0;
  // First arg is the DB: undefined = the lib opens the app default DB, which
  // locally means the dev DB under ./data (prod path is the Railway endpoint).
  const opts = {
    limit: LIMIT,
    maxModelMb: MAX_MODEL_MB,
    budgetMs: BUDGET_MS,
    token: HF_TOKEN || undefined,
    onProgress: (p) => {
      while (loggedSkips < p.skipped.length) {
        const s = p.skipped[loggedSkips++];
        console.log(`  ⏭ ${s.repo_id}: ${s.reason}`);
      }
      while (loggedErrors < p.errors.length) {
        console.log(`  ⚠ ${p.errors[loggedErrors++]}`);
      }
      console.log(
        `  📦 progress: ${p.built} built, ${p.skipped.length} skipped, ${p.errors.length} error(s)`
      );
    },
  };

  const candidates = selectTorrentCandidates(undefined, { limit: LIMIT, maxModelMb: MAX_MODEL_MB });
  console.log(`  🔍 ${candidates.length} torrentable candidate(s) without a torrent yet`);
  opts.candidates = candidates;

  const outcome = await raceWithDeadline(buildTorrentsForModels(undefined, opts), DEADLINE_MS);

  if (outcome.timedOut) {
    console.log(`\n⏰ Hard deadline (${DEADLINE_MS}ms) fired — killing build, partials below:`);
    console.log("   Partials: (progress callbacks above are the durable record)");
    process.exit(1);
  }

  const result = outcome.value;
  for (const w of result.wouldBuild) {
    console.log(`  🧪 would build: ${w.repo_id} (${w.file_count} files, ${w.total_bytes} bytes)`);
  }
  for (const s of result.skipped) console.log(`  ⏭ ${s.repo_id}: ${s.reason}`);
  for (const e of result.errors) console.log(`  ⚠ ${e}`);
  console.log(
    `\n✅ Done: ${result.built} built of ${result.selected} candidate(s), ` +
      `${result.skipped.length} skipped, ${result.errors.length} error(s)` +
      (result.budgetExhausted ? " — budget exhausted (partial run)" : "") +
      " (skips/errors don't flip the exit code)"
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
