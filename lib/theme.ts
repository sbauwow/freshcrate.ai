export type Theme = "modern" | "retro";

export const THEMES: Theme[] = ["modern", "retro"];
export const DEFAULT_THEME: Theme = "retro";
export const THEME_COOKIE = "fc_theme";

export function normalizeTheme(raw: string | null | undefined): Theme {
  if (!raw) return DEFAULT_THEME;
  return raw.trim().toLowerCase() === "modern" ? "modern" : "retro";
}
