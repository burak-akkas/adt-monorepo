import { describe, expect, it } from "vitest";
import {
  backgroundImageCss,
  emptyBoard,
  isValidBackground,
  parseBackgroundColor,
  parseBackgroundImageUrl,
  setBackground,
} from "@/lib/board";

describe("parseBackgroundColor", () => {
  it("accepts #rgb and #rrggbb and normalises to lowercase #rrggbb", () => {
    expect(parseBackgroundColor("#abc")).toEqual({ ok: true, color: "#aabbcc" });
    expect(parseBackgroundColor(" #AABBCC ")).toEqual({ ok: true, color: "#aabbcc" });
  });

  it.each(["", "red", "#12", "#12345", "#gggggg", "aabbcc", "#aabbccdd"])("rejects %j", (text) => {
    expect(parseBackgroundColor(text).ok).toBe(false);
  });
});

describe("parseBackgroundImageUrl", () => {
  it("accepts http and https URLs", () => {
    expect(parseBackgroundImageUrl(" https://example.com/a.jpg ")).toEqual({ ok: true, url: "https://example.com/a.jpg" });
    expect(parseBackgroundImageUrl("http://example.com/a.jpg").ok).toBe(true);
  });

  it.each(["", "   ", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://example.com/a.png", "not a url", "/relative.png"])(
    "rejects %j",
    (text) => {
      const result = parseBackgroundImageUrl(text);
      expect(result.ok).toBe(false);
    },
  );

  it("rejects URLs over 2048 characters", () => {
    expect(parseBackgroundImageUrl(`https://example.com/${"a".repeat(2048)}`).ok).toBe(false);
  });
});

describe("isValidBackground", () => {
  it("accepts a color and an image", () => {
    expect(isValidBackground({ type: "color", value: "#aabbcc" })).toBe(true);
    expect(isValidBackground({ type: "image", url: "https://example.com/a.jpg" })).toBe(true);
  });

  it.each([
    null,
    "red",
    {},
    { type: "color", value: "red" },
    { type: "color", value: "#ABC" },
    { type: "image", url: "javascript:alert(1)" },
    { type: "image" },
    { type: "other", value: "#aabbcc" },
  ])("rejects %j", (value) => {
    expect(isValidBackground(value)).toBe(false);
  });
});

describe("setBackground", () => {
  it("sets a color without mutating the input", () => {
    const board = emptyBoard();
    const next = setBackground(board, { type: "color", value: "#aabbcc" });
    expect(next.background).toEqual({ type: "color", value: "#aabbcc" });
    expect(board.background).toBeUndefined();
  });

  it("replaces one kind with the other", () => {
    const withColor = setBackground(emptyBoard(), { type: "color", value: "#aabbcc" });
    const withImage = setBackground(withColor, { type: "image", url: "https://example.com/a.jpg" });
    expect(withImage.background).toEqual({ type: "image", url: "https://example.com/a.jpg" });
    expect(setBackground(withImage, { type: "color", value: "#112233" }).background).toEqual({ type: "color", value: "#112233" });
  });

  it("removes the key when reset", () => {
    const withColor = setBackground(emptyBoard(), { type: "color", value: "#aabbcc" });
    expect("background" in setBackground(withColor, undefined)).toBe(false);
  });

  it("throws for an invalid background", () => {
    expect(() => setBackground(emptyBoard(), { type: "image", url: "javascript:alert(1)" })).toThrow();
  });
});

describe("backgroundImageCss", () => {
  it("quotes the URL and escapes quotes and backslashes", () => {
    expect(backgroundImageCss("https://example.com/a.jpg")).toBe('url("https://example.com/a.jpg")');
    expect(backgroundImageCss('https://e.com/a"b\\c')).toBe('url("https://e.com/a\\"b\\\\c")');
  });
});
