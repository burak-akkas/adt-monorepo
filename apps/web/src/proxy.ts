import { INTERNAL_API_KEY_HEADER } from "@adt/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { readInternalApiKey } from "@/lib/internal-api-key";

// Every /api/* request is forwarded to the API by the rewrite in next.config.ts. Here we drop any key the
// browser sent and add the real one, so only this server can speak with it.
export function proxy(request: NextRequest) {
  let key: string;
  try {
    key = readInternalApiKey();
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_API_KEY_HEADER);
  headers.set(INTERNAL_API_KEY_HEADER, key);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/api/:path*"] };
