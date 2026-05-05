import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { GET as beaconGET } from "@/app/api/beacon/route";
import { GET as metricsGET } from "@/app/api/metrics/route";
import { createTestDb, _resetDb } from "./setup";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("beacon attribution", () => {
  it("captures explicit external referrer host even when the request referer is same-origin", async () => {
    const req = new NextRequest(
      "https://www.freshcrate.ai/api/beacon?p=%2Fprojects%2FAntennaSim%3Futm_source%3Dchatgpt.com%26utm_medium%3Dreferral%26utm_campaign%3Dlaunch&r=https%3A%2F%2Fchatgpt.com%2Fshare%2Fabc123",
      {
        headers: {
          referer: "https://www.freshcrate.ai/projects/AntennaSim?utm_source=chatgpt.com&utm_medium=referral&utm_campaign=launch",
          "user-agent": "Mozilla/5.0",
          accept: "text/html",
          "sec-fetch-mode": "navigate",
        },
      },
    );

    await beaconGET(req);

    const row = db.prepare("SELECT path, referrer, utm_source, utm_medium, utm_campaign FROM page_views").get() as {
      path: string;
      referrer: string;
      utm_source: string;
      utm_medium: string;
      utm_campaign: string;
    };

    expect(row).toEqual({
      path: "/projects/AntennaSim",
      referrer: "chatgpt.com",
      utm_source: "chatgpt.com",
      utm_medium: "referral",
      utm_campaign: "launch",
    });
  });

  it("accepts explicit carried UTM params for later pageviews without querystring UTM", async () => {
    const req = new NextRequest(
      "https://www.freshcrate.ai/api/beacon?p=%2Flearn&us=chatgpt.com&um=referral&uc=launch&r=https%3A%2F%2Fchatgpt.com%2Fshare%2Fabc123",
      {
        headers: {
          referer: "https://www.freshcrate.ai/learn",
          "user-agent": "Mozilla/5.0",
          accept: "text/html",
          "sec-fetch-mode": "navigate",
        },
      },
    );

    await beaconGET(req);

    const row = db.prepare("SELECT path, referrer, utm_source, utm_medium, utm_campaign FROM page_views").get() as {
      path: string;
      referrer: string;
      utm_source: string;
      utm_medium: string;
      utm_campaign: string;
    };

    expect(row).toEqual({
      path: "/learn",
      referrer: "chatgpt.com",
      utm_source: "chatgpt.com",
      utm_medium: "referral",
      utm_campaign: "launch",
    });
  });
});

describe("metrics attribution summary", () => {
  it("reports session-first referrer/source rollups for the last 24h", async () => {
    db.prepare(
      "INSERT INTO page_views (path, referrer, ip_hash, user_agent, is_bot, host, traffic_type, ua_family, session_id, event_type, event_target, utm_source, utm_medium, utm_campaign, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    ).run(
      "/projects/AntennaSim",
      "chatgpt.com",
      "ip1",
      "Mozilla/5.0",
      0,
      "www.freshcrate.ai",
      "human_browser",
      "Browser",
      "sess-1",
      "pageview",
      "",
      "chatgpt.com",
      "referral",
      "launch",
    );
    db.prepare(
      "INSERT INTO page_views (path, referrer, ip_hash, user_agent, is_bot, host, traffic_type, ua_family, session_id, event_type, event_target, utm_source, utm_medium, utm_campaign, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    ).run(
      "/learn",
      "",
      "ip1",
      "Mozilla/5.0",
      0,
      "www.freshcrate.ai",
      "human_browser",
      "Browser",
      "sess-1",
      "pageview",
      "",
      "",
      "",
      "",
    );

    const res = await metricsGET();
    const json = await res.json();

    expect(json.traffic_24h.top_referrer_sessions[0]).toEqual(
      expect.objectContaining({ referrer: "chatgpt.com", sessions: 1 }),
    );
    expect(json.traffic_24h.top_source_sessions[0]).toEqual(
      expect.objectContaining({ source: "chatgpt.com", medium: "referral", campaign: "launch", sessions: 1 }),
    );
  });
});
