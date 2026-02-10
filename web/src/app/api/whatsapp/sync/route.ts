import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { isDbConfigured, withClient } from "@/lib/db/postgres";
import { getWhatsappAnuncioColumns, quoteId } from "@/lib/db/whatsapp-anuncio-schema";

function telefoneFromLead(platform: string, lead_name: string, message_at: string): string {
  return createHash("md5").update(platform + lead_name + message_at).digest("hex").slice(0, 15);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

type WhatsAppMessage = {
  id: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  context?: {
    referred_product?: {
      catalog_id?: string;
      product_retailer_id?: string;
    };
  };
  referral?: {
    source_type?: string;
    source_id?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid?: string;
  };
};

type Contact = {
  wa_id?: string;
  profile?: {
    name?: string;
  };
};

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

function todaySaoPaulo(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function saoPauloDateRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00-03:00`);
  const end = new Date(`${dateStr}T23:59:59-03:00`);
  return {
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
  };
}

export async function POST(request: Request) {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const phoneId1 = process.env.WHATSAPP_PHONE_NUMBER_ID_1?.trim();
  const phoneId2 = process.env.WHATSAPP_PHONE_NUMBER_ID_2?.trim();

  if (!token) return json({ error: "META_ACCESS_TOKEN not set" }, { status: 500 });
  if (!wabaId) return json({ error: "WHATSAPP_BUSINESS_ACCOUNT_ID not set" }, { status: 500 });
  if (!phoneId1) return json({ error: "WHATSAPP_PHONE_NUMBER_ID_1 not set" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date")?.trim() || todaySaoPaulo();
  const { startUnix, endUnix } = saoPauloDateRange(date);

  const phoneIds = [phoneId1, phoneId2].filter(Boolean);
  const allLeads: Array<{
    platform: string;
    lead_name: string;
    message_at: string;
    ad_creative: string | null;
    campaign_name: string | null;
    audience: string | null;
    source: string;
    updated_at: string;
  }> = [];

  for (const phoneId of phoneIds) {
    try {
      const messages = await graphGet<{
        messages?: WhatsAppMessage[];
        contacts?: Contact[];
      }>(`/${phoneId}`, token, {
        fields: "messages{id,from,timestamp,type,text,context,referral},contacts{wa_id,profile}",
      });

      const msgs = messages.messages || [];
      const contacts = messages.contacts || [];
      const contactMap = contacts.reduce(
        (acc, c) => ({ ...acc, [c.wa_id || ""]: c.profile?.name || "Desconhecido" }),
        {} as Record<string, string>
      );

      for (const msg of msgs) {
        const msgTime = Number(msg.timestamp || 0);
        if (msgTime < startUnix || msgTime > endUnix) continue;

        const from = msg.from || "";
        const leadName = contactMap[from] || "Desconhecido";
        const messageAt = new Date(msgTime * 1000).toISOString();

        const referral = msg.referral;
        const ctwaClid = referral?.ctwa_clid;

        let adId: string | null = null;
        let adsetId: string | null = null;
        let campaignId: string | null = null;

        if (ctwaClid) {
          try {
            const parsed = JSON.parse(Buffer.from(ctwaClid, "base64").toString("utf8"));
            adId = parsed.ad_id || null;
            adsetId = parsed.adset_id || null;
            campaignId = parsed.campaign_id || null;
          } catch {
            // ignore parse error
          }
        }

        allLeads.push({
          platform: "meta",
          lead_name: leadName,
          message_at: messageAt,
          ad_creative: adId,
          campaign_name: campaignId,
          audience: adsetId,
          source: "whatsapp_api",
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: msg, phone_id: phoneId }, { status: 500 });
    }
  }

  if (!allLeads.length) {
    return json({ ok: true, inserted: 0, date });
  }

  const enrichedLeads = allLeads.map((l) => ({
    ...l,
    source: "whatsapp_api",
    updated_at: new Date().toISOString(),
  }));

  if (!isDbConfigured) {
    return json({ error: "Database not configured." }, { status: 500 });
  }

  const col = getWhatsappAnuncioColumns();
  const q = quoteId;
  const cols = ["telefone", "id_transacao", col.data_criacao, col.source_id, col.nome, col.plataforma];
  const setParts = [
    `${q(col.data_criacao)} = EXCLUDED.${q(col.data_criacao)}`,
    `${q(col.source_id)} = EXCLUDED.${q(col.source_id)}`,
    `${q(col.nome)} = EXCLUDED.${q(col.nome)}`,
  ];
  try {
    await withClient(async (client) => {
      for (const row of enrichedLeads) {
        const telefone = telefoneFromLead(row.platform, row.lead_name, row.message_at);
        const idTransacao = `wa-${telefone}-${Date.now()}`;
        const sourceId = (row as { source_id?: string | null }).source_id ?? null;
        const vals = [telefone, idTransacao, row.message_at, sourceId, row.lead_name, row.platform];
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(
          `INSERT INTO rastreio_whats.whatsapp_anuncio (${cols.map(q).join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (telefone) DO UPDATE SET ${setParts.join(", ")}`,
          vals
        );
      }
    });
  } catch (err) {
    console.error("[api/whatsapp/sync] Postgres error:", err);
    return json({ error: err instanceof Error ? err.message : "Database error" }, { status: 500 });
  }

  return json({ ok: true, inserted: enrichedLeads.length, date });
}
