/**
 * Deterministic BitTorrent v1 metainfo builder for HuggingFace model weight
 * sets. Pure construction (no filesystem writes) — the metainfo bytes,
 * infohash and magnet URI are pure functions of the (content, paths, sizes)
 * input.
 *
 * PIECE HASHING (real streamed content — supersedes the 4f7e422 placeholder
 * scheme, pinned by tests/build-model-torrent.test.ts):
 * Each file's `content` source is consumed IN LISTED ORDER and fed through a
 * single SHA-1 hasher chain, cut into `piece length` pieces exactly per the
 * BitTorrent spec: files are byte-concatenated for hashing, so a piece may
 * span a file boundary (file N's tail and file N+1's head share one piece),
 * and the final piece is whatever byte count remains. Chunks are discarded as
 * they are hashed — O(1) memory regardless of model size; no whole-file
 * buffering. Because the emitted hashes are SHA-1 over REAL bytes, clients
 * fetching from the HF web seeds (BEP-19 url-list / magnet ws=) PASS the
 * piece check — the torrent is a self-verifying content distribution path,
 * not just an identifier. Two independent tests compute every expected piece
 * hash from scratch (crypto over the same fixture pattern) and also pin
 * infohash equality with create-torrent hashing the identical bytes.
 *
 * SIZE VERIFICATION: declared `size` drives the piece plan, so streamed bytes
 * must equal it exactly. Over- or under-running rejects the WHOLE build with
 * a "content size mismatch" error naming the file — upstream changed
 * mid-build and pieces would be unreproducible; the caller should refresh
 * metadata and retry. (Mid-stream network failure propagates as-is; an
 * aborted over-long source is reader.cancel()led promptly.)
 *
 * CONTENT SOURCES: `content` is a getter — return a FRESH
 * ReadableStream<Uint8Array> per call (a stream can only be consumed once, so
 * a factory keeps builds retryable — the production HF fetcher lives in the
 * next wave), a Promise of one, or a Buffer (tests / small files). Buffer and
 * chunked-stream deliveries of the same bytes produce byte-identical
 * metainfo. A zero-size file is still consumed: any byte produced is a
 * mismatch.
 *
 * DETERMINISM / SHAPE: sorted-key bencode, always multi-file (info.files of
 * {length, path:[segments]}, info.name = displayName) so the infohash shape
 * is uniform across the catalog, url-list (BEP-19) carries one verbatim web
 * seed per file, no announce/'creation date'/'created by' (which is why
 * create-torrent's output cannot be used directly — it stamps Date.now()),
 * 'encoding' pinned to UTF-8. infoHash is computed directly as
 * sha1(bencode(info)) — tests assert parse-torrent re-derives the same value.
 * repoId is accepted for call-site clarity but deliberately does not enter
 * the metainfo (any info/top-level key would change the infohash).
 *
 * The ~40-line hand-rolled encoder below follows the spec (sorted dict keys,
 * i<n>e integers, length-prefixed UTF-8) and is byte-compatible with the
 * `bencode` v4 package that parse-torrent uses to re-encode the info dict
 * before hashing (all dict keys here are ASCII, so String#sort matches
 * bencode's byte ordering).
 *
 * Piece-length curve mirrors create-torrent's `piece-length` package:
 * max(16 KiB, 2^round(log2(totalKiB))) BYTES (see node_modules/piece-length —
 * the value is a byte count, not KiB), capped at 16 MiB, the largest piece
 * size qBittorrent accepts, for client compatibility. pieceLengthOverride
 * bypasses the curve for callers that need a specific alignment.
 */

import { createHash } from "node:crypto";

export interface TorrentFileInput {
  path: string;
  size: number;
  url: string;
  content: () => Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array> | Buffer;
}

export interface BuiltTorrent {
  infoHash: string;
  metainfo: Buffer;
  magnet: string;
  totalBytes: number;
  fileCount: number;
}

type BencodeValue =
  | number
  | string
  | Uint8Array
  | BencodeValue[]
  | { [key: string]: BencodeValue };

const MAX_PIECE_LENGTH = 16 * 1024 * 1024;
const MIN_PIECE_LENGTH = 16 * 1024;

/** Spec-compliant bencode; dict keys sorted the way bencode v4 sorts them. */
function bencode(value: BencodeValue): Buffer {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`bencode: non-integer value ${value}`);
    }
    return Buffer.from(`i${value}e`, "ascii");
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([Buffer.from(`${bytes.length}:`, "ascii"), bytes]);
  }
  if (value instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return Buffer.concat([Buffer.from(`${bytes.length}:`, "ascii"), bytes]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([
      Buffer.from("l", "ascii"),
      ...value.map(bencode),
      Buffer.from("e", "ascii"),
    ]);
  }
  const parts: Buffer[] = [Buffer.from("d", "ascii")];
  for (const key of Object.keys(value).sort()) {
    const keyBytes = Buffer.from(key, "utf8");
    parts.push(
      Buffer.from(`${keyBytes.length}:`, "ascii"),
      keyBytes,
      bencode(value[key])
    );
  }
  parts.push(Buffer.from("e", "ascii"));
  return Buffer.concat(parts);
}

/**
 * Mirrors the `piece-length` package exactly: max(16384, 1 << (log2(kib)+0.5))
 * over totalKiB, where the shifted value is a BYTE count (16 KiB floor).
 * Capped at 16 MiB for client acceptance.
 */
function pieceLengthFor(totalBytes: number): number {
  const kib = totalBytes < 1024 ? 1 : totalBytes / 1024;
  const unpadded = 1 << ((Math.log2(kib) + 0.5) | 0);
  return Math.min(MAX_PIECE_LENGTH, Math.max(MIN_PIECE_LENGTH, unpadded));
}

function pathSegments(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new TypeError("buildModelTorrent: file path must contain a segment");
  }
  return segments;
}

function sizeMismatchError(file: TorrentFileInput, detail: string): Error {
  return new Error(
    `buildModelTorrent: content size mismatch for "${file.path}": declared ${file.size} bytes ${detail} (upstream changed mid-build — refresh and retry)`
  );
}

/** Resolve the content member: getter (sync or promise-returning) or value. */
async function resolveContent(
  file: TorrentFileInput,
  index: number
): Promise<ReadableStream<Uint8Array> | Uint8Array> {
  const raw: unknown = typeof file.content === "function" ? file.content() : file.content;
  const source: unknown =
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as PromiseLike<unknown>).then === "function"
      ? await raw
      : raw;
  if (
    typeof source === "object" &&
    source !== null &&
    typeof (source as { getReader?: unknown }).getReader === "function"
  ) {
    return source as ReadableStream<Uint8Array>;
  }
  if (source instanceof Uint8Array) return source;
  throw new TypeError(
    `buildModelTorrent: files[${index}].content must resolve to a ReadableStream or Buffer`
  );
}

/**
 * Stream every file in listed order through one continuous piece hasher —
 * the spec's byte concatenation of info.files. Pieces close exactly on
 * pieceLength; the trailing partial piece (if any) closes after the last
 * byte. Enforces streamed === declared per file; cancels an over-long source
 * immediately. Returns the concatenated 20-byte-hex-per-piece buffer.
 */
async function hashStreamedPieces(
  files: TorrentFileInput[],
  pieceLength: number
): Promise<Buffer> {
  const pieceHashes: Buffer[] = [];
  let current = createHash("sha1");
  let filled = 0;

  const feed = (chunk: Uint8Array): void => {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(pieceLength - filled, bytes.length - offset);
      current.update(bytes.subarray(offset, offset + take));
      filled += take;
      offset += take;
      if (filled === pieceLength) {
        pieceHashes.push(current.digest());
        current = createHash("sha1");
        filled = 0;
      }
    }
  };

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const source = await resolveContent(file, index);
    let streamed = 0;
    if (typeof (source as { getReader?: unknown }).getReader === "function") {
      const reader = (source as ReadableStream<Uint8Array>).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          streamed += value.byteLength;
          if (streamed > file.size) {
            throw sizeMismatchError(file, "but the stream produced more");
          }
          feed(value);
        }
      } finally {
        // No-op once done; on the error/over-size paths it aborts the
        // underlying fetch instead of letting it drain in the background.
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } else {
      const bytes = source as Uint8Array;
      if (bytes.byteLength > file.size) {
        throw sizeMismatchError(file, "but the content buffer is larger");
      }
      if (bytes.byteLength > 0) feed(bytes);
      streamed = bytes.byteLength;
    }
    if (streamed !== file.size) {
      throw sizeMismatchError(file, `but the stream produced ${streamed}`);
    }
  }

  if (filled > 0) pieceHashes.push(current.digest());
  return Buffer.concat(pieceHashes);
}

function validateInput(input: {
  repoId: string;
  displayName: string;
  files: TorrentFileInput[];
  pieceLengthOverride?: number;
}): void {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new TypeError(
      "buildModelTorrent: files must be a non-empty array of { path, size, url, content }"
    );
  }
  if (typeof input.displayName !== "string" || input.displayName.length === 0) {
    throw new TypeError("buildModelTorrent: displayName must be a non-empty string");
  }
  if (
    input.pieceLengthOverride !== undefined &&
    (!Number.isSafeInteger(input.pieceLengthOverride) || input.pieceLengthOverride <= 0)
  ) {
    throw new TypeError(
      "buildModelTorrent: pieceLengthOverride must be a positive integer"
    );
  }
  input.files.forEach((file, i) => {
    if (typeof file.path !== "string" || file.path.length === 0) {
      throw new TypeError(`buildModelTorrent: files[${i}].path must be a non-empty string`);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new TypeError(`buildModelTorrent: files[${i}].size must be a non-negative integer`);
    }
    if (typeof file.url !== "string" || file.url.length === 0) {
      throw new TypeError(`buildModelTorrent: files[${i}].url must be a non-empty string`);
    }
    if (file.content === undefined || file.content === null) {
      throw new TypeError(
        `buildModelTorrent: files[${i}].content must be a stream getter or Buffer`
      );
    }
  });
}

export async function buildModelTorrent(input: {
  repoId: string;
  displayName: string;
  files: TorrentFileInput[];
  comment?: string;
  pieceLengthOverride?: number;
}): Promise<BuiltTorrent> {
  validateInput(input);

  const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
  const pieceLength =
    input.pieceLengthOverride !== undefined
      ? input.pieceLengthOverride
      : pieceLengthFor(totalBytes);

  const info = {
    files: input.files.map((file) => ({
      length: file.size,
      path: pathSegments(file.path),
    })),
    name: input.displayName,
    "piece length": pieceLength,
    pieces: await hashStreamedPieces(input.files, pieceLength),
  };

  const top: { [key: string]: BencodeValue } = { info };
  if (input.comment !== undefined) top.comment = input.comment;
  top.encoding = "UTF-8";
  top["url-list"] = input.files.map((file) => file.url);

  const metainfo = bencode(top);
  const infoHash = createHash("sha1").update(bencode(info)).digest("hex");

  const magnet =
    `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(input.displayName)}` +
    input.files.map((file) => `&ws=${encodeURIComponent(file.url)}`).join("");

  return {
    infoHash,
    metainfo,
    magnet,
    totalBytes,
    fileCount: input.files.length,
  };
}
