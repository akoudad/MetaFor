import { getProviderStatus } from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getProviderStatus(), { headers: { "Cache-Control": "no-store" } });
}
