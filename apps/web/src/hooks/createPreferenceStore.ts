"use client";

import { useCallback, useSyncExternalStore } from "react";

type PreferenceStoreOptions<T> = {
  key: string;
  load: () => T;
  save: (value: T) => void;
  // Snapshot used on the server, so the static export hydrates without a mismatch.
  serverValue: T;
};

// A tiny localStorage-backed external store. The cache and listener set are
// module-level singletons per preference, so every component stays in sync.
export function createPreferenceStore<T>({ key, load, save, serverValue }: PreferenceStoreOptions<T>) {
  const listeners = new Set<() => void>();
  let cache: { value: T } | null = null;

  function getSnapshot(): T {
    cache ??= { value: load() };
    return cache.value;
  }

  function getServerSnapshot(): T {
    return serverValue;
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        cache = null;
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useValue() {
    const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setValue = useCallback((next: T) => {
      cache = { value: next };
      save(next);
      notify();
    }, []);

    return [value, setValue] as const;
  }

  // Tests only: forget the cached value so the next read comes from storage.
  function reset() {
    cache = null;
  }

  return { useValue, reset };
}
