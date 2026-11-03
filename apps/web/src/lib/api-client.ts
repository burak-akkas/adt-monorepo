import { importBoardResponseSchema, type ImportBoardRequest, type ImportBoardResponse } from "@adt/contracts";
import type { ZodType } from "zod";

// The browser only talks to its own origin; Next.js forwards /api/... to the API (and adds the internal key).
export const API_BASE_PATH = "/api";

// Dispatched on `window` when the API answers 401, so the app can treat it as a logout.
export const UNAUTHORIZED_EVENT = "adt:unauthorized";

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "validation"
  | "rate-limited"
  | "server"
  | "network"
  | "invalid-response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  // 0 when there was no HTTP response.
  readonly status: number;

  constructor(kind: ApiErrorKind, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const GENERIC_MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: "You need to sign in.",
  forbidden: "You are not allowed to do this.",
  "not-found": "This was not found.",
  conflict: "This conflicts with the current data.",
  validation: "The data was rejected.",
  "rate-limited": "Too many requests. Try again in a moment.",
  server: "The server had a problem. Try again later.",
  network: "The server could not be reached.",
  "invalid-response": "The server sent an unexpected response.",
};

function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 409:
      return "conflict";
    case 400:
    case 422:
      return "validation";
    case 429:
      return "rate-limited";
    default:
      return status >= 500 ? "server" : "validation";
  }
}

async function errorMessage(response: Response, kind: ApiErrorKind): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message) {
      return message;
    }
  } catch {
    // no JSON body: use the generic text
  }
  return GENERIC_MESSAGES[kind];
}

export interface ApiRequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  // Parses a successful body. Without it (or on 204) the result is `undefined`.
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

// `path` is relative to /api, starts with a single "/", and is never an absolute URL.
export async function apiRequest<T = undefined>(path: string, options: ApiRequestOptions<T> = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    throw new Error(`apiRequest needs a path like "/boards", got "${path}"`);
  }
  const { method = "GET", body, schema, signal } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "AbortError") {
      throw error;
    }
    throw new ApiError("network", 0, GENERIC_MESSAGES.network);
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const kind = kindForStatus(response.status);
    throw new ApiError(kind, response.status, await errorMessage(response, kind));
  }
  if (response.status === 204 || !schema) {
    return undefined as T;
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("invalid-response", response.status, GENERIC_MESSAGES["invalid-response"]);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("invalid-response", response.status, GENERIC_MESSAGES["invalid-response"]);
  }
  return parsed.data;
}

// Idempotent: the same importKey returns the board created the first time (`created: false`).
export function importBoard(request: ImportBoardRequest, signal?: AbortSignal): Promise<ImportBoardResponse> {
  return apiRequest("/boards/import", { method: "POST", body: request, schema: importBoardResponseSchema, signal });
}
