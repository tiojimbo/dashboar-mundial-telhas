import { NextResponse } from "next/server";
import { isDbConfigured, query as dbQuery } from "@/lib/db/postgres";
import { getWhatsappAnuncioColumns, quoteId } from "@/lib/db/whatsapp-anuncio-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

/**
 * GET /api/metrics/daily?days=90
 * Returns daily metrics (date, spend, leads, cpl) for the last N days.
 * Used for "Melhor Dia", "Pior Dia", "Maior Investimento" cards.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get("days") ?? "90", 10) || 90));

  if (!isDbConfigured) {
    return json({ daily: [] });
  }

  const col = getWhatsappAnuncioColumns();
  const q = quoteId;

  try {
    // Spend per day from facebook_ads
    const spendSql = `
      SELECT data::text AS metric_date, COALESCE(SUM(investimento), 0)::double precision AS spend
      FROM rastreio_whats.facebook_ads
      WHERE data >= CURRENT_DATE - $1::integer
      GROUP BY data
      ORDER BY data
    `;
    const { rows: spendRows } = await dbQuery<{ metric_date: string; spend: number }>(spendSql, [days]);

    // Leads per day from whatsapp_anuncio (leads com source_id = de anúncio)
    const leadsSql = `
      SELECT (${q(col.data_criacao)}::date)::text AS metric_date, COUNT(*)::integer AS leads
      FROM rastreio_whats.whatsapp_anuncio
      WHERE ${q(col.source_id)} IS NOT NULL
        AND ${q(col.data_criacao)}::date >= CURRENT_DATE - $1::integer
      GROUP BY (${q(col.data_criacao)}::date)
      ORDER BY metric_date
    `;
    const { rows: leadsRows } = await dbQuery<{ metric_date: string; leads: number }>(leadsSql, [days]);

    const byDate = new Map<string, { spend: number; leads: number }>();
    for (const r of spendRows) {
      const d = r.metric_date?.slice(0, 10);
      if (d) byDate.set(d, { spend: Number(r.spend) || 0, leads: 0 });
    }
    for (const r of leadsRows) {
      const d = r.metric_date?.slice(0, 10);
      if (d) {
        const cur = byDate.get(d) ?? { spend: 0, leads: 0 };
        cur.leads = Number(r.leads) || 0;
        byDate.set(d, cur);
      }
    }

    const daily = Array.from(byDate.entries())
      .map(([date, agg]) => ({
        date,
        spend: agg.spend,
        leads: agg.leads,
        cpl: agg.leads > 0 ? agg.spend / agg.leads : null as number | null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return json({ daily });
  } catch (err) {
    console.error("[api/metrics/daily]", err);
    return json({ daily: [] });
  }
}
