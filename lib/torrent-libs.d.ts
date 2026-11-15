// Ambient declarations for the ESM-only webtorrent packages used by
// lib/build-model-torrent.ts and its tests. Neither package ships bundled
// types, and there are no DefinitelyTyped equivalents for these major
// versions. Surfaces only what the repo actually consumes.

declare module "parse-torrent" {
  export interface ParsedTorrentFile {
    path: string;
    name: string;
    length: number;
    offset: number;
  }

  export interface ParsedTorrent {
    info: Record<string, unknown>;
    infoBuffer: Uint8Array;
    infoHash: string;
    infoHashBuffer: Uint8Array;
    name: string;
    announce: string[];
    urlList: string[];
    comment?: string;
    created?: Date;
    createdBy?: string;
    private?: boolean;
    files: ParsedTorrentFile[];
    length: number;
    pieceLength: number;
    lastPieceLength: number;
    pieces: string[];
  }

  export default function parseTorrent(
    torrentId: string | Uint8Array | Record<string, unknown>
  ): Promise<ParsedTorrent>;
}

declare module "create-torrent" {
  export interface CreateTorrentOptions {
    name?: string;
    comment?: string;
    createdBy?: string;
    announce?: string[];
    announceList?: string[][];
    urlList?: string[];
    pieceLength?: number;
    maxPieceLength?: number;
    private?: boolean | number;
    info?: Record<string, unknown>;
    onProgress?: (hashedLength: number, estimatedTorrentLength: number) => void;
  }

  export default function createTorrent(
    input: Uint8Array | string | Array<Uint8Array | string>,
    opts: CreateTorrentOptions,
    cb: (err: Error | null, torrent: Buffer | undefined) => void
  ): void;
}
