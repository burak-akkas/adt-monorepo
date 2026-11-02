"use client";

import { useEffect, useState } from "react";

// Preloads an image URL and reports whether it can be shown. `true` until a load has failed.
export function useBackgroundImageOk(url: string | undefined): boolean {
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }
    const image = new Image();
    image.onerror = () => setFailed(url);
    image.src = url;
    return () => {
      image.onerror = null;
    };
  }, [url]);

  return failed !== url;
}
