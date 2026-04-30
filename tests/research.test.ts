import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchArxivSections, parseArxivXml } from "@/lib/research";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2604.12345v1</id>
    <published>2026-04-28T00:00:00Z</published>
    <title>Test Paper Title</title>
    <summary>Useful abstract text.</summary>
    <author><name>Jane Doe</name></author>
  </entry>
</feed>`;

describe("research helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses arXiv xml into linked papers", () => {
    const papers = parseArxivXml(sampleXml);
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      title: "Test Paper Title",
      url: "http://arxiv.org/abs/2604.12345v1",
      source: "arXiv",
      authors: "Jane Doe et al.",
      pwc_url: "https://paperswithcode.com/paper/2604.12345",
    });
  });

  it("fetches arXiv sections sequentially instead of fan-out parallel", async () => {
    vi.useFakeTimers();

    const calls: string[] = [];
    let firstResolve: ((response: Response) => void) | undefined;

    const fetchMock = vi.fn((input: string | URL | Request) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Promise<Response>((resolve) => {
          firstResolve = resolve;
        });
      }
      return Promise.resolve(new Response(sampleXml, { status: 200 }));
    });

    const promise = fetchArxivSections(fetchMock as typeof fetch);
    await Promise.resolve();

    expect(calls).toHaveLength(1);

    firstResolve?.(new Response(sampleXml, { status: 200 }));
    await vi.runAllTimersAsync();

    const sections = await promise;
    expect(calls).toHaveLength(8);
    expect(sections.agentResearch).toHaveLength(1);
    expect(sections.llmModels).toHaveLength(1);
  });

  it("retries arXiv after 429 and still returns papers", async () => {
    vi.useFakeTimers();

    let firstAttempts = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("all%3Aagent%20AND%20cat%3Acs.AI")) {
        firstAttempts += 1;
        if (firstAttempts === 1) {
          return Promise.resolve(new Response("rate limited", { status: 429 }));
        }
        return Promise.resolve(new Response(sampleXml, { status: 200 }));
      }
      return Promise.resolve(new Response(sampleXml, { status: 200 }));
    });

    const promise = fetchArxivSections(fetchMock as typeof fetch);
    await vi.runAllTimersAsync();
    const sections = await promise;

    expect(firstAttempts).toBe(2);
    expect(sections.agentResearch).toHaveLength(1);
  });
});
