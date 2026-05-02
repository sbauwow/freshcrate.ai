# Next Steps

Last updated: 2026-05-02

Open follow-ups from the 2026-05-02 log-analysis session (commits `60eed48` admin redirect fix + `d374760` GoogleOther/author/request_log).

---

## Post-deploy actions (after merging `feature/apex-www-redirect`)

- [ ] **Open PR** for `feature/apex-www-redirect` → `main`. Branch contains the admin-redirect fix, GoogleOther classifier patch, author email-stripping, and the new admin analytics sections — none are on prod yet.
- [ ] **Run author cleanup on prod DB**: after Railway redeploy,
  ```
  node scripts/clean-authors.mjs --dry      # preview
  node scripts/clean-authors.mjs            # apply
  ```
  Rewrites `projects.author` to drop `<email>` and `(homepage)` chunks. New inserts are already cleaned by `lib/queries.ts:insertProject`.
- [ ] **Verify admin redirect**: hit `/admin/analytics`, submit `FRESHCRATE_ADMIN_TOKEN`, confirm bounce lands on `https://www.freshcrate.ai/admin/analytics` (not `localhost:8080`). Confirm logout redirect too.
- [ ] **Resubmit sitemap** to Google Search Console once author URLs settle — old `/author/Name%20%3Cemail%40...` URLs should drop out and 404. Optionally add a 410 for the `<` pattern in `next.config.ts` to speed deindex.

## Bugs still open

- [ ] **`app/random/route.ts:15-18`** has the same forwarded-host bug class as the admin redirects (uses `request.nextUrl.clone()` whose origin = internal `localhost:8080`). Patch with the `externalUrl()` helper from `lib/admin-auth.ts` or build `NextResponse.redirect` from `x-forwarded-host`.
- [ ] **404 surge from bots crawling stale doc paths** (`/projects/docs/*.md`, `/projects/SETUP.md`, `/projects/.github/CODE_OF_CONDUCT.md`, …). Suspected source: README/sitemap leak. Audit what's emitting these links and either 410 them or stop generating.
- [ ] **Chrome/105 fingerprint (62 hits in 32 min)** still classified as `human_browser`. Decide whether to add a stale-Chrome-version heuristic to `lib/traffic-classification.ts` (anything below current major − 5 = likely scraper) or leave it.

## Observability gaps

- [ ] **Page renders aren't in `request_log`** — `logRequest()` is only called from API routes, so the new admin sections (status mix, top errors, slowest paths) only show API traffic. Page 4xx/5xx are invisible. Options:
  - Use Next.js `instrumentation.ts` to wrap every request with timing + status.
  - Or add a wrapper in `proxy.ts` that defers logging until after `NextResponse.next()` resolves and reads the status from the response.
- [ ] **Proxy log only emits `request_in`** (no status, no duration). The Railway log we analyzed (`logs.1777684579453.csv`) couldn't tell us a single 4xx/5xx. Once page-render logging is wired, re-pull a window and look at error rate by path.

## Nice-to-haves

- [ ] Per-traffic-type breakdown in `getStatusBreakdown()` — split `2xx/4xx/5xx` by `traffic_type` so we can see if errors skew toward bots vs humans.
- [ ] Drop the `Crawler` regex catch-all (`bot|crawler|spider|scraper|lighthouse`) below the named patterns so Perplexity, GPTBot, etc. surface in the UA family breakdown instead of getting lumped into "Crawler".
