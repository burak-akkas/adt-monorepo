export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

// localStorage, or null on the server or when access is blocked.
export function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Reads `key` and hands the raw value (null when absent) to `parse`.
// Any storage error yields `fallback`.
export function readPreference<T>(
  key: string,
  parse: (raw: string | null) => T,
  fallback: T,
  storage: PreferenceStorage | null = defaultStorage(),
): T {
  try {
    if (!storage) return fallback;
    return parse(storage.getItem(key));
  } catch {
    return fallback;
  }
}

export function writePreference(
  key: string,
  raw: string,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(key, raw);
  } catch {
    // Storage may be full or blocked; the choice just won't persist.
  }
}
