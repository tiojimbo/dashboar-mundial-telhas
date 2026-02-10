import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

async function graphGet<T>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  url.searchParams.set("access_token", token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`);
  }
  return body as T;
}

export async function GET() {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN not set" }, { status: 500 });
  }

  try {
    const actId = process.env.META_AD_ACCOUNT_ID?.trim();
    if (!actId) {
      return NextResponse.json({ error: "META_AD_ACCOUNT_ID not set" }, { status: 500 });
    }
    
    const act = actId.startsWith("act_") ? actId : `act_${actId}`;

    // Get ad account info
    const adAccount = await graphGet<{
      id?: string;
      name?: string;
      business?: { id?: string; name?: string };
    }>(`/${act}`, token, { fields: "id,name,business" });

    const businessId = adAccount.business?.id;
    if (!businessId) {
      return NextResponse.json({
        ok: false,
        error: "No business ID found in ad account",
        ad_account: adAccount,
      }, { status: 404 });
    }

    // Try multiple paths to get WABA
    const attempts: Array<{ method: string; error?: string; waba_id?: string }> = [];

    // Method 1: client_whatsapp_business_accounts
    try {
      const wabas = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
        `/${businessId}/client_whatsapp_business_accounts`,
        token
      );
      if (wabas.data && wabas.data.length) {
        const wabaId = wabas.data[0].id;
        attempts.push({ method: "client_whatsapp_business_accounts", waba_id: wabaId });
        const phones = await graphGet<{ data?: Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }> }>(
          `/${wabaId}/phone_numbers`,
          token
        );
        return NextResponse.json({
          ok: true,
          waba_id: wabaId,
          business_id: businessId,
          phone_numbers: (phones.data || []).map((p) => ({
            phone_number_id: p.id,
            display_phone_number: p.display_phone_number,
            verified_name: p.verified_name,
            quality_rating: p.quality_rating,
          })),
          instructions: "Copy the phone_number_id values above and add to .env as WHATSAPP_PHONE_NUMBER_ID_1 and WHATSAPP_PHONE_NUMBER_ID_2",
        });
      }
    } catch (err) {
      attempts.push({ method: "client_whatsapp_business_accounts", error: err instanceof Error ? err.message : String(err) });
    }

    // Method 2: owned_whatsapp_business_accounts
    try {
      const wabas = await graphGet<{ data?: Array<{ id: string }> }>(
        `/${businessId}/owned_whatsapp_business_accounts`,
        token
      );
      if (wabas.data && wabas.data.length) {
        const wabaId = wabas.data[0].id;
        attempts.push({ method: "owned_whatsapp_business_accounts", waba_id: wabaId });
        const phones = await graphGet<{ data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }> }>(
          `/${wabaId}/phone_numbers`,
          token
        );
        return NextResponse.json({
          ok: true,
          waba_id: wabaId,
          business_id: businessId,
          phone_numbers: (phones.data || []).map((p) => ({
            phone_number_id: p.id,
            display_phone_number: p.display_phone_number,
            verified_name: p.verified_name,
          })),
          instructions: "Copy the phone_number_id values above and add to .env",
        });
      }
    } catch (err) {
      attempts.push({ method: "owned_whatsapp_business_accounts", error: err instanceof Error ? err.message : String(err) });
    }

    return NextResponse.json({
      ok: false,
      business_id: businessId,
      attempts,
      message: "Could not auto-detect WhatsApp phone numbers. Please add manually: WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_PHONE_NUMBER_ID_1, WHATSAPP_PHONE_NUMBER_ID_2 in .env. Find them at: https://business.facebook.com/latest/whatsapp_manager or https://developers.facebook.com/apps (your app → WhatsApp → API Setup)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
