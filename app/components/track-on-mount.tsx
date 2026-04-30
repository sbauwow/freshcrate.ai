"use client";

import { useEffect } from "react";
import { track } from "./track";

export default function TrackOnMount({ event, target }: { event: string; target?: string }) {
  useEffect(() => {
    track(event, target);
  }, [event, target]);
  return null;
}
