import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStorage, readPreference, writePreference } from "@/lib/preference";

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("preference helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("defaultStorage", () => {
    it("returns localStorage in the browser", () => {
      expect(defaultStorage()).toBe(window.localStorage);
    });

    it("returns null when accessing localStorage throws", () => {
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(defaultStorage()).toBeNull();
    });

    it("returns null without a window", () => {
      vi.stubGlobal("window", undefined);
      expect(defaultStorage()).toBeNull();
    });
  });

  describe("readPreference", () => {
    it("passes the raw stored value to parse", () => {
      const storage = { getItem: () => "abc", setItem: () => {} };
      expect(readPreference("k", (raw) => raw?.toUpperCase() ?? "none", "fb", storage)).toBe("ABC");
    });

    it("passes null to parse when the key is absent", () => {
      const storage = { getItem: () => null, setItem: () => {} };
      expect(readPreference("k", (raw) => (raw === null ? "missing" : raw), "fb", storage)).toBe("missing");
    });

    it("reads from localStorage by default", () => {
      localStorage.setItem("pref-test", "x");
      expect(readPreference("pref-test", (raw) => raw, null)).toBe("x");
      localStorage.removeItem("pref-test");
    });

    it("returns the fallback when storage is null", () => {
      expect(readPreference("k", (raw) => raw, "fb", null)).toBe("fb");
    });

    it("returns the fallback when storage throws", () => {
      expect(readPreference("k", (raw) => raw, "fb", throwing)).toBe("fb");
    });

    it("returns the fallback when parse throws", () => {
      const storage = { getItem: () => "x", setItem: () => {} };
      const parse = () => {
        throw new Error("bad");
      };
      expect(readPreference("k", parse, "fb", storage)).toBe("fb");
    });
  });

  describe("writePreference", () => {
    it("stores the raw value", () => {
      const setItem = vi.fn();
      writePreference("k", "v", { getItem: () => null, setItem });
      expect(setItem).toHaveBeenCalledWith("k", "v");
    });

    it("writes to localStorage by default", () => {
      writePreference("pref-test", "y");
      expect(localStorage.getItem("pref-test")).toBe("y");
      localStorage.removeItem("pref-test");
    });

    it("does nothing without storage", () => {
      expect(() => writePreference("k", "v", null)).not.toThrow();
    });

    it("swallows storage errors", () => {
      expect(() => writePreference("k", "v", throwing)).not.toThrow();
    });
  });
});
