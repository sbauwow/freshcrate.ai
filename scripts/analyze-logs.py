#!/usr/bin/env python3
"""
Analyze a Railway log CSV export from freshcrate and print insights.

Usage:
  scripts/analyze-logs.py [path/to/logs.csv]

If no path is given, picks the newest logs.*.csv from ~/Downloads.
Handles two log lines emitted by freshcrate:
  - msg="request"        (DB-logged API hits, includes status + duration)
  - msg="request_in"     (Edge proxy, all routes, no status)
  - msg="traffic_metrics" (periodic /api/metrics dumps from page_views)
"""

from __future__ import annotations

import csv
import collections
import datetime
import glob
import json
import os
import re
import statistics
import sys
from pathlib import Path
from typing import Any, Iterable

csv.field_size_limit(2**24)


def find_default_csv() -> str | None:
    candidates = sorted(
        glob.glob(str(Path.home() / "Downloads" / "logs.*.csv")),
        key=lambda p: os.path.getmtime(p),
        reverse=True,
    )
    return candidates[0] if candidates else None


def bucket_path(p: str) -> str:
    if p == "/":
        return "/"
    if p.startswith("/api/projects/") and p.endswith("/deps"):
        return "/api/projects/<name>/deps"
    if p.startswith("/api/projects/") and p.endswith("/audit"):
        return "/api/projects/<name>/audit"
    if re.match(r"^/api/projects/[^/]+$", p):
        return "/api/projects/<name>"
    if re.match(r"^/api/projects/[^/]+/.+", p):
        return "/api/projects/<name>/<sub>"
    if p.startswith("/projects/"):
        return "/projects/<name>"
    if p.startswith("/api/"):
        return p  # keep distinct API surface
    if p.startswith("/search"):
        return "/search"
    if p.startswith("/tag/"):
        return "/tag/<t>"
    if p.startswith("/category/"):
        return "/category/<c>"
    if p.startswith("/author/"):
        return "/author/<a>"
    if p.startswith("/learn/"):
        return "/learn/<x>"
    return p


def hr() -> None:
    print("─" * 78)


def section(title: str) -> None:
    print()
    hr()
    print(f"  {title}")
    hr()


def topn(c: collections.Counter, n: int = 15, total: int | None = None) -> None:
    for k, v in c.most_common(n):
        pct = f"{v / total * 100:5.1f}%" if total else "       "
        print(f"  {v:6d} {pct} {k}")


def bar(label: str, count: int, scale: float, char: str) -> str:
    return f"{label} {count:4d}  " + char * max(1, int(round(count * scale))) if count else f"{label}    0"


def parse_csv(path: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (api_requests, proxy_in, traffic_metrics) lists of attribute dicts."""
    api, proxy_in, metrics = [], [], []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                a = json.loads(row.get("attributes", "{}") or "{}")
            except json.JSONDecodeError:
                continue
            a["_event_ts"] = row.get("timestamp", "")
            msg = row.get("message")
            if msg == "request":
                api.append(a)
            elif msg == "request_in":
                proxy_in.append(a)
            elif msg == "traffic_metrics":
                metrics.append(a)
    return api, proxy_in, metrics


def report_traffic_split(label: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    section(f"{label}: {len(rows)} rows")
    if rows[0].get("ts") and rows[-1].get("ts"):
        print(f"  window  : {rows[0]['ts']} -> {rows[-1]['ts']}")
    tt = collections.Counter(r.get("traffic_type") for r in rows)
    uaf = collections.Counter(r.get("ua_family") for r in rows)
    methods = collections.Counter(r.get("method") for r in rows)
    surfaces = collections.Counter(r.get("surface") for r in rows if r.get("surface"))
    print(f"\n  traffic_type")
    topn(tt, total=len(rows))
    print(f"\n  ua_family (top 12)")
    topn(uaf, 12, len(rows))
    print(f"\n  method")
    topn(methods, total=len(rows))
    if surfaces:
        print(f"\n  surface (page vs api)")
        topn(surfaces, total=len(rows))


def report_paths(label: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    section(f"{label} — paths")
    bucketed = collections.Counter(bucket_path(r["path"]) for r in rows if r.get("path"))
    print("  bucketed top paths")
    topn(bucketed, 20, len(rows))

    human = [r for r in rows if r.get("traffic_type") == "human_browser"]
    bot = [r for r in rows if r.get("traffic_type") == "crawler_bot"]
    if human:
        print("\n  human_browser bucketed top")
        topn(collections.Counter(bucket_path(r["path"]) for r in human), 12, len(human))
    if bot:
        print("\n  crawler_bot bucketed top")
        topn(collections.Counter(bucket_path(r["path"]) for r in bot), 12, len(bot))

    deps = collections.Counter(r["path"] for r in rows if r.get("path", "").endswith("/deps"))
    proj = collections.Counter(r["path"] for r in rows if r.get("path", "").startswith("/projects/"))
    if deps:
        print(f"\n  deps endpoints unique={len(deps)} total={sum(deps.values())} (top 10)")
        topn(deps, 10)
    if proj:
        print(f"\n  /projects/<name> unique={len(proj)} total={sum(proj.values())} (top 10)")
        topn(proj, 10)


def report_latency(rows: list[dict[str, Any]]) -> None:
    durs = [r["duration_ms"] for r in rows if isinstance(r.get("duration_ms"), (int, float))]
    if not durs:
        return
    section(f"latency (n={len(durs)})")
    durs_sorted = sorted(durs)
    print(f"  min={min(durs)}  p50={statistics.median(durs)}  "
          f"p95={durs_sorted[int(len(durs)*0.95)]}  p99={durs_sorted[int(len(durs)*0.99)]}  "
          f"max={max(durs)}  mean={statistics.mean(durs):.1f}")
    statuses = collections.Counter(r.get("status") for r in rows)
    print("\n  statuses")
    topn(statuses, total=len(rows))
    errs = [r for r in rows if isinstance(r.get("status"), int) and r["status"] >= 400]
    if errs:
        print(f"\n  errors n={len(errs)} top paths")
        topn(collections.Counter(r["path"] for r in errs), 10)
    print("\n  slowest 10")
    for r in sorted(rows, key=lambda x: -(x.get("duration_ms") or 0))[:10]:
        print(f"  {r.get('duration_ms', 0):5d}ms  {(r.get('traffic_type') or '?'):13s} "
              f"{(r.get('ua_family') or '?'):15s} {r.get('path', '')}")


def report_hours(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    hh = collections.Counter()
    bb = collections.Counter()
    for r in rows:
        ts = r.get("ts") or r.get("_event_ts") or ""
        try:
            h = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).hour
        except Exception:
            continue
        if r.get("traffic_type") == "human_browser":
            hh[h] += 1
        elif r.get("traffic_type") == "crawler_bot":
            bb[h] += 1
    if not hh and not bb:
        return
    section("hour-of-day (UTC)  H=human  B=bot")
    peak = max(max(hh.values(), default=0), max(bb.values(), default=0)) or 1
    scale = 60 / peak
    for h in range(24):
        ch = "#" * int(round(hh.get(h, 0) * scale))
        cb = "." * int(round(bb.get(h, 0) * scale))
        print(f"  {h:02d}  H{hh.get(h,0):3d} B{bb.get(h,0):3d}  {ch}{cb}")


def report_metrics(metrics: list[dict[str, Any]]) -> None:
    if not metrics:
        return
    section(f"traffic_metrics snapshots — {len(metrics)} captured")
    last = metrics[-1]
    keys = (
        "ts",
        "requests_24h",
        "errors_24h",
        "avg_duration_ms_24h",
        "page_views_24h",
        "unique_visitors_24h",
        "bot_hits_24h",
        "human_browser_24h",
        "agent_browser_24h",
        "api_client_24h",
        "crawler_bot_24h",
        "top_agent_24h",
        "top_agent_hits_24h",
        "top_referrer_24h",
        "top_referrer_views_24h",
        "top_page_24h",
        "top_page_views_24h",
        "top_4xx_path_24h",
        "top_4xx_hits_24h",
    )
    print("  most recent snapshot:")
    for k in keys:
        if k in last:
            print(f"    {k:28s} {last[k]}")


def report_ips(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    ips = collections.Counter(r.get("ip") for r in rows if r.get("ip"))
    if not ips:
        return
    section("hashed IP concentration (note: salt rotates daily)")
    by_type: dict[str, set[str]] = collections.defaultdict(set)
    for r in rows:
        if r.get("ip"):
            by_type[r.get("traffic_type", "?")].add(r["ip"])
    for t, s in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(s):5d} unique  {t}")
    print("\n  top 10 by request volume")
    for ip, c in ips.most_common(10):
        sample = next((r for r in rows if r.get("ip") == ip), {})
        ua = (sample.get("user_agent") or sample.get("ua_short") or "")[:80]
        print(f"  {c:4d}  {ip}  {ua}")


def insights(api: list[dict[str, Any]], proxy_in: list[dict[str, Any]], metrics: list[dict[str, Any]]) -> None:
    section("insights")
    out: list[str] = []

    if api:
        bot_share = sum(1 for r in api if r.get("traffic_type") == "crawler_bot") / len(api)
        if bot_share > 0.5:
            out.append(f"- {bot_share:.0%} of API hits are crawlers — caching + robots.txt are doing real work.")
        deps_only = sum(1 for r in api if r.get("path", "").endswith("/deps")) / len(api)
        if deps_only > 0.7:
            out.append(f"- {deps_only:.0%} of API hits are /deps. Almost all human deps hits are dep-graph XHR triggered by /projects/<name> visits.")
        err = sum(1 for r in api if isinstance(r.get("status"), int) and r["status"] >= 400)
        if err == 0:
            out.append("- Zero 4xx/5xx in window. No bad clients to chase.")

    if proxy_in:
        page_hits = sum(1 for r in proxy_in if r.get("surface") == "page")
        api_hits = sum(1 for r in proxy_in if r.get("surface") == "api")
        out.append(f"- Proxy logs: {page_hits} page, {api_hits} api — confirms unified visibility is on.")
    elif api:
        out.append("- No request_in lines in this export. Either: (a) proxy not deployed yet, or (b) export filter excludes msg=request_in. If (a), deploy proxy.ts.")

    if metrics:
        last = metrics[-1]
        if last.get("top_page_24h") == "/" and last.get("top_page_views_24h", 0) < 20:
            out.append(f"- Homepage is bottom of long-tail ({last.get('top_page_views_24h')} views/24h). Users land deep on /projects/<name> from search/external links.")
        if last.get("top_referrer_24h") in (None, "None", ""):
            out.append("- No external referrers logged. Add UTM tags to outbound posts to attribute incoming traffic.")
        if last.get("agent_browser_24h", 0) == 0:
            out.append("- agent_browser is 0. No LLM agents identifying as Claude/ChatGPT/Perplexity. GPTBot is the only AI hit and uses crawler_bot.")
        if last.get("crawler_bot_24h", 0) > last.get("human_browser_24h", 0):
            out.append("- Crawlers > humans on the beacon side too. Consider robots tightening or noindex on low-value pages.")

    if not out:
        out.append("(no automatic insights triggered for this window)")
    for line in out:
        print(f"  {line}")


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else find_default_csv()
    if not path:
        print("usage: analyze-logs.py [csv]   (no logs.*.csv in ~/Downloads)", file=sys.stderr)
        return 2
    if not os.path.exists(path):
        print(f"not found: {path}", file=sys.stderr)
        return 2

    print(f"# freshcrate log analyzer")
    print(f"# file: {path}  ({os.path.getsize(path):,} bytes)")
    api, proxy_in, metrics = parse_csv(path)
    print(f"# parsed: {len(api)} api requests, {len(proxy_in)} proxy_in, {len(metrics)} metrics snapshots")

    report_traffic_split("api requests (msg=request)", api)
    report_paths("api requests", api)
    report_latency(api)
    report_ips(api)
    report_hours(api)

    report_traffic_split("proxy ingress (msg=request_in)", proxy_in)
    report_paths("proxy ingress", proxy_in)
    report_hours(proxy_in)

    report_metrics(metrics)
    insights(api, proxy_in, metrics)
    return 0


if __name__ == "__main__":
    sys.exit(main())
