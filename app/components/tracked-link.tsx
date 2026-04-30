"use client";

import { AnchorHTMLAttributes } from "react";
import { track } from "./track";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  event: string;
  eventTarget?: string;
}

export default function TrackedLink({ event, eventTarget, onClick, children, ...rest }: Props) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        try { track(event, eventTarget); } catch { /* never block navigation */ }
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
