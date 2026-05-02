"use client";

import { useEffect } from "react";
import Link from "next/link";
import RenderStatusBeacon from "./components/render-status-beacon";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("page_error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="py-16 max-w-[600px] mx-auto">
      <RenderStatusBeacon status={500} />

      <pre className="text-fm-green text-center text-[11px] leading-tight font-mono mb-6 overflow-x-auto">{`
     _______________
    /              /|
   /   /\\   /\\    / |
  /___/  \\_/  \\__/  |
  |   ______      | |
  |  | 500  |     | |
  |  | OOPS |     | |
  |  |______|     | /
  |____________| | /
  |______________|/
      `}</pre>

      <h2 className="text-[16px] font-bold text-fm-green text-center mb-3">
        crate dropped
      </h2>

      <p className="text-[12px] text-fm-text text-center mb-2 italic">
        &ldquo;An autonomous agent threw an exception and is currently writing a
        post-mortem.&rdquo;
      </p>

      <div className="text-center mb-6">
        <span className="text-[10px] text-fm-text-light">
          HTTP 500 &mdash; the server is the problem this time
        </span>
        {error.digest && (
          <div className="text-[9px] text-fm-text-light mt-1 font-mono">
            digest: {error.digest}
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-center text-[11px]">
        <button
          onClick={() => reset()}
          className="text-fm-link hover:text-fm-link-hover underline"
        >
          retry
        </button>
        <Link href="/" className="text-fm-link hover:text-fm-link-hover">home</Link>
        <Link href="/submit?tab=report" className="text-fm-link hover:text-fm-link-hover">
          report it
        </Link>
      </div>
    </div>
  );
}
