import type { Board, BoardBackground } from "./types";
import { MAX_BACKGROUND_URL_LENGTH } from "./types";

export type BackgroundColorResult = { ok: true; color: string } | { ok: false; error: string };

export type BackgroundImageResult = { ok: true; url: string } | { ok: false; error: string };

// Accepts `#rgb` or `#rrggbb` and normalises to lowercase `#rrggbb`.
export function parseBackgroundColor(input: string): BackgroundColorResult {
  const trimmed = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short) {
    return { ok: true, color: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` };
  }
  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return { ok: true, color: trimmed };
  }
  return { ok: false, error: "Enter a color like #336699." };
}

// Accepts http(s) URLs only (at most MAX_BACKGROUND_URL_LENGTH characters) and returns the normalised URL.
export function parseBackgroundImageUrl(input: string): BackgroundImageResult {
  const trimmed = input.trim();
  const error = "Enter a valid image URL starting with http:// or https://.";
  if (!trimmed || trimmed.length > MAX_BACKGROUND_URL_LENGTH) {
    return { ok: false, error };
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error };
    }
    const href = url.href;
    return href.length > MAX_BACKGROUND_URL_LENGTH ? { ok: false, error } : { ok: true, url: href };
  } catch {
    return { ok: false, error };
  }
}

export function isValidBackground(value: unknown): value is BoardBackground {
  const b = value as Record<string, unknown> | null;
  if (typeof b !== "object" || b === null) {
    return false;
  }
  if (b.type === "color") {
    return typeof b.value === "string" && /^#[0-9a-f]{6}$/.test(b.value);
  }
  return b.type === "image" && typeof b.url === "string" && parseBackgroundImageUrl(b.url).ok;
}

// Sets the board background (replacing any other kind) or, with `undefined`, removes it.
export function setBackground(board: Board, background: BoardBackground | undefined): Board {
  if (background !== undefined && !isValidBackground(background)) {
    throw new Error("Invalid board background");
  }
  const next = { ...board };
  delete next.background;
  return background === undefined ? next : { ...next, background };
}

// The CSS `url("…")` for an image background; the URL is http(s) only and its quotes and backslashes are escaped.
export function backgroundImageCss(url: string): string {
  return `url("${url.replace(/[\\"]/g, "\\$&")}")`;
}
