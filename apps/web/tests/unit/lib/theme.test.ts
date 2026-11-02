import { describe, expect, it } from "vitest";
import { loadTheme, resolveTheme, saveTheme, THEME_KEY } from "@/lib/theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("loadTheme", () => {
  it("defaults to system when nothing is stored", () => {
    expect(loadTheme(fakeStorage())).toBe("system");
  });

  it("falls back to system for invalid values", () => {
    expect(loadTheme(fakeStorage({ [THEME_KEY]: "purple" }))).toBe("system");
  });

  it("falls back to system when storage throws or is unavailable", () => {
    expect(loadTheme(throwing)).toBe("system");
    expect(loadTheme(null)).toBe("system");
  });

  it("round-trips every preference", () => {
    for (const pref of ["system", "light", "dark"] as const) {
      const storage = fakeStorage();
      saveTheme(pref, storage);
      expect(storage.data[THEME_KEY]).toBe(pref);
      expect(loadTheme(storage)).toBe(pref);
    }
  });
});

describe("saveTheme", () => {
  it("does not throw when storage throws", () => {
    expect(() => saveTheme("dark", throwing)).not.toThrow();
  });
});

describe("resolveTheme", () => {
  it("follows the system scheme for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the system scheme for explicit choices", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
