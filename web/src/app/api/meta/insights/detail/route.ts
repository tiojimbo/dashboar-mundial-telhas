import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

/**
 * GET /api/meta/insights/detail?level=campaign|adset|ad|platform&id=...&date_from=...&date_to=...
 * Returns aggregated metrics for a single item (used by modal). Reads from Postgres.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") || "campaign").toLowerCase();
  const id = searchParams.get("id")?.trim();
  const dateFrom = searchParams.get("date_from")?.trim() || null;
  const dateTo = searchParams.get("date_to")?.trim() || null;
  const objective = (searchParams.get("objective") || "ENGAGEMENT").toUpperCase();
  const status = (searchParams.get("status") || "ACTIVE").toUpperCase();

  if (!id) {
    return json({ error: "Missing id." }, { status: 400 });
  }

  if (!isDbConfigured) {
    return json({
      level,
      id,
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      conversions: 0,
      date_from: dateFrom,
      date_to: dateTo,
    });
  }

  // Este projeto usa apenas rastreio_whats.whatsapp_anuncio; não há tabela facebook_ads.
  return json({
    level,
    id,
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    conversions: 0,
    date_from: dateFrom,
    date_to: dateTo,
  });
}
