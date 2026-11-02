"use client";

import { healthResponseSchema } from "@adt/contracts";
import { useEffect, useState } from "react";

type State = "checking" | "up" | "down";

const messages: Record<State, string> = {
  checking: "Checking the API…",
  up: "API and database are up",
  down: "The API or the database is down",
};

export function ApiStatus() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let current = true;
    fetch("/api/health")
      .then(async (response) => healthResponseSchema.parse(await response.json()).status === "ok")
      .catch(() => false)
      .then((up) => {
        if (current) setState(up ? "up" : "down");
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <p role="status" className="mt-4 text-zinc-600 dark:text-zinc-400">
      {messages[state]}
    </p>
  );
}
