import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

let lastSyncAt = 0;
const MIN_INTERVAL_MS = 60000;

export async function POST(request: Request) {
  const now = Date.now();
  if (now - lastSyncAt < MIN_INTERVAL_MS) {
    return json(
      { error: "Sync recently triggered. Please wait a minute and try again." },
      { status: 429 }
    );
  }
  lastSyncAt = now;

  const origin = new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  const levels = params.get("levels") || "campaign,adset,ad,platform";
  const days = params.get("days") || "";
  const campaignRange = params.get("campaign_range") || "lifetime";

  const syncUrl = new URL("/api/meta/sync", origin);
  syncUrl.searchParams.set("levels", levels);
  if (days) syncUrl.searchParams.set("days", days);
  if (campaignRange) syncUrl.searchParams.set("campaign_range", campaignRange);

  const secret = process.env.INGESTION_API_KEY || process.env.META_SYNC_SECRET;
  const headers: HeadersInit = {};
  if (secret) {
    headers["x-ingestion-key"] = secret;
  }

  try {
    const res = await fetch(syncUrl.toString(), { method: "POST", headers, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return json(body || { error: `Sync failed (HTTP ${res.status}).` }, { status: res.status });
    }

    const whatsappUrl = new URL("/api/whatsapp/sync", origin);
    const whatsappRes = await fetch(whatsappUrl.toString(), { method: "POST", headers, cache: "no-store" });
    const whatsappBody = await whatsappRes.json().catch(() => null);

    return json({ meta: body, whatsapp: whatsappBody ?? {} });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}
