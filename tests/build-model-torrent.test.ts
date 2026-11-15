import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildModelTorrent } from "@/lib/build-model-torrent";
import type { TorrentFileInput } from "@/lib/build-model-torrent";
import parseTorrent from "parse-torrent";
import createTorrent from "create-torrent";

/**
 * Behavioral-hash fixtures: deterministic byte patterns so the tests can
 * compute every expected piece hash INDEPENDENTLY (plain crypto over the same
 * pattern with the same piece length) and hold the builder to it.
 */
const PIECE = 16384;
const F1 = patternBuffer(70000); // not piece-aligned: 70000 % 16384 = 4528
const F2 = patternBuffer(5000, 1); // continues the byte stream after F1
const TOTAL = F1.length + F2.length; // 75000 -> 4 full pieces + 9464-byte tail

function patternBuffer(length: number, seed = 0): Buffer {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) buf[i] = (i * 31 + 7 + seed) & 0xff;
  return buf;
}

/** Deliberately odd chunk sizes: pieces must not depend on chunk boundaries. */
function toStream(buf: Buffer, chunkSize = 1000): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= buf.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, buf.length);
      controller.enqueue(buf.subarray(offset, end));
      offset = end;
    },
  });
}

/** Independent reference: sha1 of each piece of the byte-concatenated files. */
function expectedPieces(parts: Buffer[], pieceLength: number): string[] {
  const all = Buffer.concat(parts);
  const hashes: string[] = [];
  for (let off = 0; off < all.length; off += pieceLength) {
    hashes.push(
      createHash("sha1")
        .update(all.subarray(off, Math.min(off + pieceLength, all.length)))
        .digest("hex")
    );
  }
  return hashes;
}

function fixtureFiles(mode: "buffer" | "stream"): TorrentFileInput[] {
  const mk = (buf: Buffer, path: string, url: string): TorrentFileInput =>
    mode === "buffer"
      ? { path, size: buf.length, url, content: () => buf }
      : { path, size: buf.length, url, content: () => toStream(buf) };
  return [
    mk(
      F1,
      "model-00001-of-00002.safetensors",
      "https://huggingface.co/acme/tiny/resolve/main/model-00001-of-00002.safetensors"
    ),
    mk(
      F2,
      "config/nodes.json",
      "https://huggingface.co/acme/tiny/resolve/main/config/nodes.json?download=true"
    ),
  ];
}

function build(mode: "buffer" | "stream" = "buffer") {
  return buildModelTorrent({
    repoId: "acme/tiny",
    displayName: "tiny",
    files: fixtureFiles(mode),
    pieceLengthOverride: PIECE,
  });
}

describe("buildModelTorrent", () => {
  it("produces a lowercase 40-hex v1 infohash with sizes and a parseable metainfo", async () => {
    const t = await build();
    expect(t.infoHash).toMatch(/^[0-9a-f]{40}$/);
    expect(t.totalBytes).toBe(TOTAL);
    expect(t.fileCount).toBe(2);

    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.infoHash).toBe(t.infoHash);
    expect(parsed.name).toBe("tiny");
  });

  it("hashes REAL content: emitted pieces equal independently computed sha1s (full, cross-file, partial)", async () => {
    const t = await build("stream");
    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.pieceLength).toBe(PIECE);
    // 75000 bytes / 16384 -> 4 full pieces + a 9464-byte final partial piece
    expect(parsed.pieces).toHaveLength(5);
    const expected = expectedPieces([F1, F2], PIECE);
    expect(expected).toHaveLength(5);
    expect(parsed.pieces).toEqual(expected);
    // and they must NOT be the old all-zero placeholder scheme
    expect(parsed.pieces).not.toEqual(
      expectedPieces([Buffer.alloc(TOTAL)], PIECE)
    );
  });

  it("concatenates bytes across the file boundary per spec: file1's straddling piece continues into file2", async () => {
    const t = await build();
    const parsed = await parseTorrent(t.metainfo);
    const boundaryIndex = Math.floor(F1.length / PIECE); // piece 4 straddles both files
    const take = Math.min(F2.length, (boundaryIndex + 1) * PIECE - F1.length);
    const expected = createHash("sha1")
      .update(
        Buffer.concat([
          F1.subarray(boundaryIndex * PIECE),
          F2.subarray(0, take),
        ])
      )
      .digest("hex");
    expect(parsed.pieces[boundaryIndex]).toBe(expected);
  });

  it("is deterministic: same content yields identical metainfo bytes and infohash across builds and delivery modes", async () => {
    const a = await build("buffer");
    const b = await build("buffer");
    const streamed = await build("stream");
    expect(a.infoHash).toBe(b.infoHash);
    expect(Buffer.compare(a.metainfo, b.metainfo)).toBe(0);
    // Buffer source vs 1000-byte-chunked ReadableStream source: same pieces
    expect(streamed.infoHash).toBe(a.infoHash);
  });

  it("infoHash equals sha1 over the exact bencoded info bytes parse-torrent re-derives", async () => {
    const t = await build("stream");
    const parsed = await parseTorrent(t.metainfo);
    const ours = createHash("sha1").update(parsed.infoBuffer).digest("hex");
    expect(t.infoHash).toBe(ours);
    expect(parsed.infoHash).toBe(ours);
  });

  it("round-trips every file path and size through parse-torrent", async () => {
    const t = await build();
    const parsed = await parseTorrent(t.metainfo);
    const info = parsed.info as { files: { length: number; path: Uint8Array[] }[] };
    expect(info.files).toHaveLength(2);
    // bencode decodes strings to raw UTF-8 byte arrays; decode segments for comparison
    const infoFiles = info.files.map((f) => ({
      length: f.length,
      path: f.path.map((seg) => Buffer.from(seg).toString("utf8")),
    }));
    expect(infoFiles[0]).toEqual({
      length: F1.length,
      path: ["model-00001-of-00002.safetensors"],
    });
    expect(infoFiles[1]).toEqual({ length: F2.length, path: ["config", "nodes.json"] });
    expect(
      parsed.files.map((f) => ({ path: f.path, length: f.length }))
    ).toEqual([
      { path: "tiny/model-00001-of-00002.safetensors", length: F1.length },
      { path: "tiny/config/nodes.json", length: F2.length },
    ]);
    expect(parsed.length).toBe(TOTAL);
  });

  it("carries one verbatim web seed per file in the BEP-19 url-list", async () => {
    const t = await build();
    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.urlList).toEqual(fixtureFiles("buffer").map((f) => f.url));
  });

  it("builds the pinned magnet format: btih + dn + one ws per file, in order", async () => {
    const t = await build();
    const expected =
      `magnet:?xt=urn:btih:${t.infoHash}&dn=${encodeURIComponent("tiny")}` +
      fixtureFiles("buffer")
        .map((f) => `&ws=${encodeURIComponent(f.url)}`)
        .join("");
    expect(t.magnet).toBe(expected);

    const parsedFromMagnet = await parseTorrent(t.magnet);
    expect(parsedFromMagnet.infoHash).toBe(t.infoHash);
  });

  it("uses the multi-file info shape even for a single file", async () => {
    const t = await buildModelTorrent({
      repoId: "acme/tiny",
      displayName: "tiny",
      pieceLengthOverride: PIECE,
      files: [fixtureFiles("buffer")[0]],
    });
    const parsed = await parseTorrent(t.metainfo);
    const info = parsed.info as { files?: unknown[]; length?: number };
    expect(Array.isArray(info.files)).toBe(true);
    expect(info.length).toBeUndefined();
    expect(t.fileCount).toBe(1);
    expect(t.totalBytes).toBe(F1.length);
    expect(parsed.pieces).toEqual(expectedPieces([F1], PIECE));
  });

  it("rejects an empty files array", async () => {
    await expect(
      buildModelTorrent({ repoId: "acme/tiny", displayName: "tiny", files: [] })
    ).rejects.toThrow(/files/);
  });

  it("rejects the whole build when a stream yields FEWER bytes than declared (truncation)", async () => {
    const short = F1.subarray(0, F1.length - 1);
    await expect(
      buildModelTorrent({
        repoId: "acme/tiny",
        displayName: "tiny",
        pieceLengthOverride: PIECE,
        files: [
          {
            path: "a.bin",
            size: F1.length,
            url: "https://x/a",
            content: () => toStream(short, 997),
          },
          { path: "b.bin", size: F2.length, url: "https://x/b", content: () => F2 },
        ],
      })
    ).rejects.toThrow(/size mismatch.*a\.bin/);
  });

  it("rejects the whole build when a stream yields MORE bytes than declared (upstream changed)", async () => {
    const long = Buffer.concat([F1, Buffer.from([1])]);
    await expect(
      buildModelTorrent({
        repoId: "acme/tiny",
        displayName: "tiny",
        pieceLengthOverride: PIECE,
        files: [
          {
            path: "a.bin",
            size: F1.length,
            url: "https://x/a",
            content: () => toStream(long, 10000),
          },
        ],
      })
    ).rejects.toThrow(/size mismatch.*a\.bin/);
  });

  it("rejects a zero-size file whose content yields bytes", async () => {
    await expect(
      buildModelTorrent({
        repoId: "acme/tiny",
        displayName: "tiny",
        pieceLengthOverride: PIECE,
        files: [
          { path: "empty.marker", size: 0, url: "https://x/e", content: () => Buffer.alloc(1) },
        ],
      })
    ).rejects.toThrow(/size mismatch.*empty\.marker/);
  });

  it("includes zero-length files in the info dict without contributing piece bytes", async () => {
    const t = await buildModelTorrent({
      repoId: "acme/tiny",
      displayName: "tiny",
      pieceLengthOverride: PIECE,
      files: [
        { path: "model.safetensors", size: F1.length, url: "https://x/f", content: () => F1 },
        { path: "empty.marker", size: 0, url: "https://x/e", content: () => Buffer.alloc(0) },
      ],
    });
    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.pieces).toEqual(expectedPieces([F1], PIECE));
    const info = parsed.info as { files: { length: number; path: Uint8Array[] }[] };
    expect(info.files[1].length).toBe(0);
    expect(info.files[1].path.map((s) => Buffer.from(s).toString("utf8"))).toEqual(["empty.marker"]);
    expect(t.totalBytes).toBe(F1.length);
  });

  it("propagates mid-stream fetch errors as a build rejection", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(F1.subarray(0, 1000));
        controller.error(new Error("cdn connection reset"));
      },
    });
    await expect(
      buildModelTorrent({
        repoId: "acme/tiny",
        displayName: "tiny",
        pieceLengthOverride: PIECE,
        files: [
          {
            path: "a.bin",
            size: F1.length,
            url: "https://x/a",
            content: () => stream,
          },
        ],
      })
    ).rejects.toThrow(/cdn connection reset/);
  });

  it("matches create-torrent's REAL-hash infohash for identical content and piece length", async () => {
    const t = await build();
    const named = (buf: Buffer, name: string) => {
      (buf as Buffer & { name?: string }).name = name;
      return buf;
    };
    const reference = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        [
          named(F1, "model-00001-of-00002.safetensors"),
          named(F2, "config/nodes.json"),
        ],
        { name: "tiny", announce: [], pieceLength: PIECE },
        (err, buf) => (err ? reject(err) : resolve(buf as Buffer))
      );
    });
    const theirs = await parseTorrent(reference);
    expect(theirs.infoHash).toBe(t.infoHash);
  });

  it("keeps the create-torrent piece-length curve (piece-length pkg: bytes, 16 KiB floor) with the 16 MiB cap", async () => {
    const curved = await buildModelTorrent({
      repoId: "acme/tiny",
      displayName: "tiny",
      files: fixtureFiles("buffer"),
    });
    const parsedCurve = await parseTorrent(curved.metainfo);
    // node_modules/piece-length: max(16384, 1 << floor(log2(75000/1024)+0.5)) = 16384
    expect(parsedCurve.pieceLength).toBe(16 * 1024);
    expect(parsedCurve.pieceLength).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it("honors pieceLengthOverride and hashes to that alignment", async () => {
    const t = await buildModelTorrent({
      repoId: "acme/tiny",
      displayName: "tiny",
      pieceLengthOverride: 32768,
      files: fixtureFiles("buffer"),
    });
    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.pieceLength).toBe(32768);
    // 75000 bytes / 32768 -> 2 full pieces + 17768-byte tail
    expect(parsed.pieces).toHaveLength(3);
    expect(parsed.pieces).toEqual(expectedPieces([F1, F2], 32768));
  });

  it("rejects a non-positive pieceLengthOverride", async () => {
    await expect(
      buildModelTorrent({
        repoId: "acme/tiny",
        displayName: "tiny",
        pieceLengthOverride: 0,
        files: fixtureFiles("buffer"),
      })
    ).rejects.toThrow(/pieceLengthOverride/);
  });

  it("carries an optional comment through the metainfo", async () => {
    const t = await buildModelTorrent({
      repoId: "acme/tiny",
      displayName: "tiny",
      files: fixtureFiles("buffer"),
      comment: "weights via HF web seeds",
    });
    const parsed = await parseTorrent(t.metainfo);
    expect(parsed.comment).toBe("weights via HF web seeds");
  });
});
