# Next Steps

Last updated: 2026-05-02

Live worklist for the analytics + observability push that started 2026-05-02. Drop closed items as they ship.

---

## Shipped

- `60eed48` admin redirects from `x-forwarded-host` (no more localhost:8080)
- `d374760` GoogleOther + `Google-*` agents reclassified as `crawler_bot`
- `d374760` `cleanAuthor()` strips `<email>` from `/author/<slug>` URLs (5 link sites + sitemap dedupe + insert path)
- `d374760` `request_log` analytics on `/admin/analytics` (status mix / top errors / slowest paths — API only)
- `d1e3a5b` emoji fallback fonts in `globals.css` for Linux without `noto-fonts-emoji`
- `7190231` 70 tracked actions across the site (outbound, install, search, submit) + `TrackedForm` wrapper. Convention: `eventTarget = <kind>:<id>[@<context>]`
- `f527763` 410 Gone for phantom `/projects/<name>/{docs,…}/*` paths + `robots.txt` rules
- `f527763` `render_404` / `render_500` beacons from `not-found.tsx` + new `app/error.tsx`, surfaced in admin analytics

## Open follow-ups

### Post-deploy verification (one-shot)

- [ ] **Re-pull Railway logs in 24h** and confirm GoogleOther rows now show `traffic_type: crawler_bot`. The 2026-05-02 morning window (981 GoogleOther hits, all `human_browser`) entirely predates the fix.
- [ ] **Run author cleanup on prod DB** once a redeploy includes `f527763`:
  ```
  node scripts/clean-authors.mjs --dry      # preview
  node scripts/clean-authors.mjs            # apply
  ```
- [ ] **Resubmit sitemap** to Google Search Console after the cleanup so old `/author/Name%20%3Cemail%40...` URLs deindex. The 410 gate already covers the phantom-doc class.
- [ ] **Watch `/admin/analytics`** for the new event types (`outbound:*`, `install:*`, `search:*`, `submit:*`, `render_404`, `render_500`) appearing under "Top event targets" + "Page-render status".

### Bugs still open

- [ ] **`app/random/route.ts:15-18`** — same forwarded-host bug class as the admin redirects (`request.nextUrl.clone()` resolves origin to internal `localhost:8080`). Patch with the `externalUrl()` helper from `lib/admin-auth.ts`.
- [ ] **Chrome/105 fingerprint** still classified as `human_browser`. Decide whether to add a stale-Chrome-version heuristic to `lib/traffic-classification.ts` (anything below current major − 5 = scraper) or leave it.

### Observability gaps still standing

- [ ] **SSR errors that crash before React mounts** still aren't logged — `app/error.tsx` only fires its beacon if the boundary itself renders. For full server-side capture, register an OpenTelemetry SDK in `instrumentation.ts` (heavy lift) or accept the gap.
- [ ] **Per-traffic-type breakdown** in `getStatusBreakdown()` and the new render-status helpers — split counts by `traffic_type` so we can see if errors skew toward bots vs humans.
- [ ] **Drop the `Crawler` regex catch-all** below the named patterns in `traffic-classification.ts` so PerplexityBot, GPTBot, etc. surface in the UA family breakdown instead of being lumped into "Crawler".

### Future tracking work

- [ ] **`copy` event type** has no firing site — there's no install-command copy button on project pages yet. Add one (commands appear at `/agent-edition`) and fire `track('copy', 'install:<bundle>')`.
- [ ] **`share` event type** also unused — no share UI exists.
