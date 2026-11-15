#!/usr/bin/env node

/**
 * freshcrate HF Model Refresh
 *
 * Daily upsert of the Hugging Face models catalog (top downloads pages plus
 * one trending page) into the `models` table, via lib/refresh-models.ts —
 * the same logic the app uses, so the SQL can't drift. Unlike
 * scripts/refresh-releases.mjs (which duplicates SQL inline) this imports the
 * TS lib, which means it MUST run under tsx (the lib's "@/..." imports don't
 * resolve under plain node):
 *
 *   npx tsx scripts/refresh-models.mjs
 *
 * Usage:
 *   node scripts/refresh-models.mjs                     # 3 pages, 9-min deadline
 *   REFRESH_MODELS_PAGES=5 node scripts/refresh-models.mjs
 *   REFRESH_MODELS_DEADLINE_MS=300000 node scripts/refresh-models.mjs
 *   HF_TOKEN=hf_... node scripts/refresh-models.mjs     # optional, softer rate limits
 *   node scripts/refresh-models.mjs --dry-run           # print config, fetch nothing
 *
 * Hard deadline: refresh-releases' shard calls hung past their client timeout
 * on 10-20 and never logged, so the lib grew a Promise.race deadline (see
 * lib/refresh-deadline.ts). The same race wraps this refresh with a default
 * 9-minute budget. On deadline fire the partial {fetched, upserted, errors}
 * are printed (each page commits in its own transaction, so partials are
 * durable) and the process exits 1; it exits 0 only when the deadline did
 * not fire. Per-page fetch errors are logged distinctly but do not flip the
 * exit code — the deadline is the only failure signal here.
 *
 * Runs as a daily cron: .github/workflows/refresh-models.yml.
 */

const DRY_RUN = process.argv.includes("--dry-run");

let refreshModels;
let raceWithDeadline;
try {
  ({ refreshModels } = await import("../lib/refresh-models.ts"));
  ({ raceWithDeadline } = await import("../lib/refresh-deadline.ts"));
} catch (err) {
  console.error("Fatal error: could not load the TS lib. Run this script under tsx:");
  console.error("  npx tsx scripts/refresh-models.mjs");
  console.error(`(${err instanceof Error ? err.message : String(err)})`);
  process.exit(1);
}

const DEFAULT_PAGES = 3;
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

const PAGES = intFromEnv("REFRESH_MODELS_PAGES", DEFAULT_PAGES);
const DEADLINE_MS = intFromEnv("REFRESH_MODELS_DEADLINE_MS", DEFAULT_DEADLINE_MS);
const HF_TOKEN = process.env.HF_TOKEN || "";

// The lib maps a status-0 page to "... network error"; the Wave B review
// flagged that these are undiagnosable in cron logs, so spell out what
// happened to the page.
function describeError(err) {
  return err.replace(/: network error$/, ": network/parse error — page skipped");
}

function printToken() {
  console.log(`   Token: ${HF_TOKEN ? "✓ present" : "✗ none (anonymous HF rate limits)"}`);
}

if (DRY_RUN) {
  console.log("🔄 freshcrate HF model refresh (DRY RUN — no fetch, no DB writes)");
  console.log(`   Pages:    ${PAGES} x 1000-entry downloads pages + 1 trending page`);
  console.log(`   Deadline: ${DEADLINE_MS}ms hard race (lib/refresh-deadline.ts)`);
  printToken();
  console.log(`   Hub:      https://huggingface.co/api/models`);
  console.log(
    `Would run: refreshModels({ pages: ${PAGES}, token: ${HF_TOKEN ? "<redacted>" : "undefined"} })` +
      ` under a ${DEADLINE_MS}ms hard deadline`
  );
  process.exit(0);
}

async function main() {
  console.log("🔄 freshcrate HF model refresh");
  console.log(`   Pages:    ${PAGES} x 1000-entry downloads pages + 1 trending page`);
  console.log(`   Deadline: ${DEADLINE_MS}ms hard race`);
  printToken();
  console.log();

  let lastProgress = null;
  let loggedErrors = 0;
  const onProgress = (p) => {
    lastProgress = p;
    // Log each page error exactly once, the moment it appears.
    while (loggedErrors < p.errors.length) {
      console.log(`  ⚠ ${describeError(p.errors[loggedErrors++])}`);
    }
    console.log(
      `  📄 progress: ${p.fetched} fetched, ${p.upserted} upserted, ${p.errors.length} page error(s)`
    );
  };

  const outcome = await raceWithDeadline(
    refreshModels({ pages: PAGES, token: HF_TOKEN || undefined, onProgress }),
    DEADLINE_MS
  );

  const printPartials = (p) => {
    if (!p) {
      console.log("   Partials: {fetched: 0, upserted: 0, errors: []} (no page completed)");
      return;
    }
    console.log(`   Partials: {fetched: ${p.fetched}, upserted: ${p.upserted}, errors: [`);
    for (const e of p.errors) console.log(`     ${describeError(e)},`);
    console.log("   ]}");
  };

  if (outcome.timedOut) {
    console.log(`\n⏰ Hard deadline (${DEADLINE_MS}ms) fired — killing refresh, partials below:`);
    printPartials(lastProgress);
    process.exit(1);
  }

  const result = outcome.value;
  if (result.errors.length > 0) {
    console.log(`\n⚠ ${result.errors.length} page error(s):`);
    for (const e of result.errors) console.log(`  ⚠ ${describeError(e)}`);
  }
  console.log(
    `\n✅ Done: ${result.fetched} fetched, ${result.upserted} upserted, ` +
      `${result.errors.length} page error(s)` +
      (result.errors.length ? " (errors don't flip the exit code)" : "")
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
