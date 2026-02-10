import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Meta sync anteriormente gravava em Supabase (meta_campaigns, meta_ads_insights, etc.).
 * Este projeto usa apenas Postgres (rastreio_whats.whatsapp_anuncio). Meta sync desativado.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Meta sync is disabled. This project uses only Postgres (rastreio_whats.whatsapp_anuncio); Supabase was removed.",
    },
    { status: 501 }
  );
}
