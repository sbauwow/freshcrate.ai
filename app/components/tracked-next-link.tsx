"use client";

import Link, { LinkProps } from "next/link";
import { ReactNode, MouseEvent } from "react";
import { track } from "./track";

interface Props extends LinkProps {
  event: string;
  eventTarget?: string;
  className?: string;
  children: ReactNode;
  title?: string;
}

export default function TrackedNextLink({ event, eventTarget, onClick, children, ...rest }: Props) {
  return (
    <Link
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        try { track(event, eventTarget); } catch { /* never block navigation */ }
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );
}
