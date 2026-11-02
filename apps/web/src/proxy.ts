import { INTERNAL_API_KEY_HEADER, VISITOR_IP_HEADER } from "@adt/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { readInternalApiKey } from "@/lib/internal-api-key";
import { FORWARDING_HEADERS, readVisitorIp } from "@/lib/visitor-ip";

// Every /api/* request is forwarded to the API by the rewrite in next.config.ts. Here we drop any key the
// browser sent and add the real one, so only this server can speak with it. The same goes for the visitor's
// address: the API rate limits by it, so it only ever gets the one we set from what the platform reports.
export function proxy(request: NextRequest) {
  let key: string;
  try {
    key = readInternalApiKey();
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const headers = new Headers(request.headers);
  const visitorIp = readVisitorIp(headers);
  headers.delete(INTERNAL_API_KEY_HEADER);
  headers.set(INTERNAL_API_KEY_HEADER, key);
  headers.delete(VISITOR_IP_HEADER);
  for (const name of FORWARDING_HEADERS) headers.delete(name);
  if (visitorIp) headers.set(VISITOR_IP_HEADER, visitorIp);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/api/:path*"] };
