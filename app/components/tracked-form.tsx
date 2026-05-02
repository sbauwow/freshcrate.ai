"use client";

import { FormHTMLAttributes, ReactNode } from "react";
import { track } from "./track";

interface Props extends FormHTMLAttributes<HTMLFormElement> {
  event: string;
  eventTarget?: string;
  children: ReactNode;
}

/**
 * <form> wrapper that fires a `track(event, eventTarget)` beacon on submit.
 * Native navigation/submit still happens — tracking never blocks.
 *
 * Use for GET search/filter forms in server components (the wrapper is the
 * client-side island; surrounding markup stays server-rendered).
 */
export default function TrackedForm({ event, eventTarget, onSubmit, children, ...rest }: Props) {
  return (
    <form
      {...rest}
      onSubmit={(e) => {
        try { track(event, eventTarget); } catch { /* never block */ }
        onSubmit?.(e);
      }}
    >
      {children}
    </form>
  );
}
