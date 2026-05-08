import { describe, it, expect, vi, afterEach } from "vitest";
import { buildResearchSnapshot } from "@/lib/research";

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

afterEach(() => {
  vi.useRealTimers();
});

describe("buildResearchSnapshot", () => {
  it("returns one shared snapshot shape for page/api consumers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("export.arxiv.org")) {
        return Promise.resolve(new Response(sampleXml, { status: 200 }));
      }
      if (url.includes("daily_papers")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                title: "HF Paper",
                paper: { id: "2604.55555", title: "HF Paper", authors: [{ name: "HF Author" }] },
                publishedAt: "2026-04-28T00:00:00Z",
              },
            ]),
            { status: 200 }
          )
        );
      }
      if (url.includes("/api/models")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: "org/model", downloads: 123, pipeline_tag: "text-generation", trendingScore: 9 }]), { status: 200 }));
      }
      if (url.includes("/api/datasets")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: "org/dataset", downloads: 45 }]), { status: 200 }));
      }
      if (url.includes("/api/spaces")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: "org/space", sdk: "gradio", likes: 7, trendingScore: 6 }]), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const snapshotPromise = buildResearchSnapshot(fetchMock as typeof fetch);
    await vi.runAllTimersAsync();
    const snapshot = await snapshotPromise;

    expect(snapshot.papers.length).toBeGreaterThan(0);
    expect(snapshot.categorized_papers.agent_research.length).toBeGreaterThan(0);
    expect(snapshot.hf_papers[0]?.title).toBe("HF Paper");
    expect(snapshot.trending_models[0]?.name).toBe("org/model");
    expect(snapshot.trending_datasets[0]?.name).toBe("org/dataset");
    expect(snapshot.trending_spaces[0]?.name).toBe("org/space");
    expect(snapshot.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
