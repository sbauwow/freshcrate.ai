import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { GET as beaconGET } from "@/app/api/beacon/route";
import { GET as metricsGET } from "@/app/api/metrics/route";
import { getGeoConversionBreakdown } from "@/lib/analytics";
import { logRequest } from "@/lib/request-log";
import { createTestDb, _resetDb } from "./setup";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("geo analytics", () => {
  it("captures geo headers on beacon traffic and reports first-touch country sessions", async () => {
    const req = new NextRequest(
      "https://www.freshcrate.ai/api/beacon?p=%2Fprojects%2FAntennaSim&r=https%3A%2F%2Fchatgpt.com%2Fshare%2Fabc123",
      {
        headers: {
          referer: "https://www.freshcrate.ai/projects/AntennaSim",
          "user-agent": "Mozilla/5.0",
          accept: "text/html",
          "sec-fetch-mode": "navigate",
          "cf-ipcountry": "US",
          "x-vercel-ip-country-region": "TX",
          "x-vercel-ip-city": "Austin",
        },
      },
    );

    await beaconGET(req);

    const row = db.prepare("SELECT country, region, city FROM page_views").get() as {
      country: string;
      region: string;
      city: string;
    };

    expect(row).toEqual({ country: "US", region: "TX", city: "Austin" });

    const res = await metricsGET();
    const json = await res.json();

    expect(json.traffic_24h.top_country_sessions[0]).toEqual(
      expect.objectContaining({ country: "US", region: "TX", city: "Austin", sessions: 1 }),
    );
  });

  it("captures geo headers on API request logs", () => {
    const req = new NextRequest("https://www.freshcrate.ai/api/health", {
      headers: {
        "user-agent": "curl/8.4.0",
        "x-forwarded-for": "1.2.3.4",
        "cf-ipcountry": "US",
        "x-vercel-ip-country-region": "TX",
        "x-vercel-ip-city": "Austin",
      },
    });

    logRequest(req, 200, Date.now() - 12);

    const row = db.prepare("SELECT country, region, city FROM request_log").get() as {
      country: string;
      region: string;
      city: string;
    };

    expect(row).toEqual({ country: "US", region: "TX", city: "Austin" });
  });

  it("groups search and outbound conversion by first-touch geography", async () => {
    await beaconGET(new NextRequest("https://www.freshcrate.ai/api/beacon?p=%2Fprojects%2FAntennaSim&e=pageview", {
      headers: {
        referer: "https://www.freshcrate.ai/projects/AntennaSim",
        "user-agent": "Mozilla/5.0",
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        cookie: "fc_sid=11111111-1111-4111-8111-111111111111",
        "cf-ipcountry": "US",
        "x-vercel-ip-country-region": "TX",
        "x-vercel-ip-city": "Austin",
      },
    }));

    await beaconGET(new NextRequest("https://www.freshcrate.ai/api/beacon?p=%2Fsearch%3Fq%3Dagent&e=search", {
      headers: {
        referer: "https://www.freshcrate.ai/search?q=agent",
        "user-agent": "Mozilla/5.0",
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        cookie: "fc_sid=11111111-1111-4111-8111-111111111111",
        "cf-ipcountry": "US",
        "x-vercel-ip-country-region": "TX",
        "x-vercel-ip-city": "Austin",
      },
    }));

    await beaconGET(new NextRequest("https://www.freshcrate.ai/api/beacon?p=%2Fprojects%2FAntennaSim&e=pageview", {
      headers: {
        referer: "https://www.freshcrate.ai/projects/AntennaSim",
        "user-agent": "Mozilla/5.0",
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        cookie: "fc_sid=22222222-2222-4222-8222-222222222222",
        "cf-ipcountry": "GB",
        "x-vercel-ip-country-region": "England",
        "x-vercel-ip-city": "London",
      },
    }));

    await beaconGET(new NextRequest("https://www.freshcrate.ai/api/beacon?p=%2Fout&e=outbound&t=repo:test", {
      headers: {
        referer: "https://www.freshcrate.ai/projects/AntennaSim",
        "user-agent": "Mozilla/5.0",
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        cookie: "fc_sid=22222222-2222-4222-8222-222222222222",
        "cf-ipcountry": "GB",
        "x-vercel-ip-country-region": "England",
        "x-vercel-ip-city": "London",
      },
    }));

    expect(getGeoConversionBreakdown(7, 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ country: "US", region: "TX", city: "Austin", sessions: 1, with_search: 1, with_outbound_or_install: 0 }),
        expect.objectContaining({ country: "GB", region: "England", city: "London", sessions: 1, with_search: 0, with_outbound_or_install: 1 }),
      ]),
    );
  });
});
