import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { classifyTraffic } from "@/lib/traffic-classification";

const CHROME_133 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const CHROME_103 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36";

function build(headers: Record<string, string>): NextRequest {
  const h = new Headers(headers);
  return new NextRequest("https://www.freshcrate.ai/", { headers: h });
}

describe("classifyTraffic — declared bots", () => {
  it("classifies Amazonbot as crawler_bot", () => {
    const r = build({ "user-agent": "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)" });
    expect(classifyTraffic(r, "page")).toEqual(expect.objectContaining({ trafficType: "crawler_bot", uaFamily: "Amazonbot" }));
  });

  it("classifies Bingbot as crawler_bot", () => {
    const r = build({ "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" });
    expect(classifyTraffic(r, "page")).toEqual(expect.objectContaining({ trafficType: "crawler_bot", uaFamily: "Bingbot" }));
  });
});

describe("classifyTraffic — SpoofedChromeUA", () => {
  it("flags Chrome UA missing both sec-ch-ua and sec-fetch-mode", () => {
    const r = build({ "user-agent": CHROME_133, accept: "text/html" });
    expect(classifyTraffic(r, "page")).toEqual({
      trafficType: "crawler_bot",
      uaFamily: "SpoofedChromeUA",
      host: "",
    });
  });

  it("flags stale Chrome UA missing both sec-* headers", () => {
    const r = build({ "user-agent": CHROME_103, accept: "text/html" });
    expect(classifyTraffic(r, "page").trafficType).toBe("crawler_bot");
  });

  it("does NOT flag real Chrome (sends both sec-ch-ua and sec-fetch-mode)", () => {
    const r = build({
      "user-agent": CHROME_133,
      accept: "text/html",
      "sec-ch-ua": '"Chromium";v="133", "Not(A:Brand";v="24"',
      "sec-fetch-mode": "navigate",
    });
    expect(classifyTraffic(r, "page").trafficType).toBe("human_browser");
  });

  it("does NOT flag a Chrome UA that sends only sec-fetch-mode (privacy extension stripped sec-ch-ua)", () => {
    const r = build({
      "user-agent": CHROME_133,
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    });
    expect(classifyTraffic(r, "page").trafficType).toBe("human_browser");
  });

  it("does NOT flag a Chrome UA that sends only sec-ch-ua", () => {
    const r = build({
      "user-agent": CHROME_133,
      accept: "text/html",
      "sec-ch-ua": '"Chromium";v="133"',
    });
    expect(classifyTraffic(r, "page").trafficType).toBe("human_browser");
  });

  it("does NOT misclassify a Googlebot UA that happens to mention Chrome", () => {
    const r = build({
      "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36",
    });
    expect(classifyTraffic(r, "page").uaFamily).toBe("Googlebot");
  });
});

describe("classifyTraffic — well-formed clients still pass", () => {
  it("classifies curl as api_client", () => {
    const r = build({ "user-agent": "curl/8.4.0" });
    expect(classifyTraffic(r, "api")).toEqual(expect.objectContaining({ trafficType: "api_client", uaFamily: "curl" }));
  });

  it("classifies a non-Chrome browser UA as human_browser via Mozilla/", () => {
    const r = build({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      accept: "text/html",
    });
    expect(classifyTraffic(r, "page").trafficType).toBe("human_browser");
  });
});
