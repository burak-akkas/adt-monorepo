import { healthResponseSchema } from "@adt/contracts";

export const dynamic = "force-dynamic";

// What the production check polls: the web deploy runs last, so its commit means the whole deploy
// finished, and the API call proves that the web, the API and the database reach each other.
export async function GET() {
  const web = process.env.COMMIT_SHA;
  try {
    const response = await fetch(`${process.env.API_URL}/health`, { cache: "no-store" });
    const api = healthResponseSchema.parse(await response.json());
    return Response.json({ status: api.status, web, api }, { status: response.ok ? 200 : 503 });
  } catch {
    return Response.json({ status: "error", web, api: null }, { status: 503 });
  }
}
