import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as localeGET } from "@/app/api/locale/route";

describe("locale route", () => {
  it("redirects to the public forwarded host instead of localhost", async () => {
    const req = new NextRequest("http://localhost:8080/api/locale?lang=zh-CN&redirect=%2F", {
      headers: {
        host: "localhost:8080",
        "x-forwarded-host": "www.freshcrate.ai",
        "x-forwarded-proto": "https",
      },
    });

    const res = await localeGET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.freshcrate.ai/");
    expect(res.cookies.get("fc_lang")?.value).toBe("zh-CN");
  });
});
