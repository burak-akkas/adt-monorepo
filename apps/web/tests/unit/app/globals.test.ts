import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../../src/app/globals.css"), "utf8");

function tokens(selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]).sort();
}

describe("design tokens", () => {
  it("defines every token for both light and dark", () => {
    const light = tokens(":root");
    const dark = tokens(':root[data-theme="dark"]');
    expect(light).toContain("--surface");
    expect(dark).toEqual(light);
  });

  it("maps every token to a Tailwind color", () => {
    const theme = css.slice(css.indexOf("@theme inline"), css.indexOf("}", css.indexOf("@theme inline")));
    for (const name of tokens(":root")) {
      expect(theme).toContain(`var(${name})`);
    }
  });
});
