import { NextResponse } from "next/server";
import { isDbConfigured, query as dbQuery } from "@/lib/db/postgres";
import { getWhatsappAnuncioColumns, quoteId } from "@/lib/db/whatsapp-anuncio-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

function today(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + 1);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const emptyAgg = {
  spend: 0,
  leads: 0,
  opportunities: 0,
  sales_count: 0,
  revenue: 0,
  cost_per_result: 0,
  /** facebook_ads */
  impressions: 0,
  inline_link_clicks: 0,
  actions: 0,
};

/**
 * GET /api/metrics?platform=meta&date_from=...&date_to=...
 * Returns aggregated metrics. Reads from Postgres (metric_snapshots or meta_ads_insights).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform")?.trim() || "meta";
  const dateFrom = searchParams.get("date_from")?.trim() || null;
  const dateTo = searchParams.get("date_to")?.trim() || null;
  const objective = (searchParams.get("objective") || "ENGAGEMENT").toUpperCase();
  const status = (searchParams.get("status") || "ACTIVE").toUpperCase();

  const todayStr = today();

  if (platform !== "meta") {
    return json({ error: "Only platform=meta is supported for now." }, { status: 400 });
  }

  if (!isDbConfigured) {
    return json({
      today: emptyAgg,
      total: emptyAgg,
      platform,
      date_from: dateFrom,
      date_to: dateTo,
      objective,
      status,
    });
  }

  const useSnapshots = objective === "ALL" && status === "ALL";

  const todayStart = `${todayStr}T00:00:00-03:00`;
  const todayEnd = `${nextDay(todayStr)}T00:00:00-03:00`;
  let leadsTodayFromWhats = 0;
  let leadsTotalFromWhats = 0;
  try {
    const col = getWhatsappAnuncioColumns();
    const q = quoteId;
    // Conta leads por data; não filtra por plataforma para bater com a listagem (platform=all).
    const todayQuery = `SELECT COUNT(*)::text AS count FROM rastreio_whats.whatsapp_anuncio
       WHERE ${q(col.data_criacao)} >= $1 AND ${q(col.data_criacao)} < $2 AND ${q(col.source_id)} IS NOT NULL`;
    const totalQuery = `SELECT COUNT(*)::text AS count FROM rastreio_whats.whatsapp_anuncio WHERE ${q(col.source_id)} IS NOT NULL`;
    const { rows: todayLeadsRows } = await dbQuery<{ count: string }>(todayQuery, [todayStart, todayEnd]);
    leadsTodayFromWhats = Number(todayLeadsRows[0]?.count ?? 0);
    const { rows: totalLeadsRows } = await dbQuery<{ count: string }>(totalQuery, []);
    leadsTotalFromWhats = Number(totalLeadsRows[0]?.count ?? 0);
  } catch {
    // ignore
  }

  let fbToday = { spend: 0, impressions: 0, inline_link_clicks: 0, actions: 0 };
  let fbTotal = { spend: 0, impressions: 0, inline_link_clicks: 0, actions: 0 };

  const fbTable = "rastreio_whats.facebook_ads";
  const tryFbCol = async (col: string): Promise<{ today: number; total: number }> => {
    const out = { today: 0, total: 0 };
    try {
      const todaySql = `SELECT COALESCE(SUM(${col}), 0)::text AS v FROM ${fbTable} WHERE data = $1`;
      const { rows: rToday } = await dbQuery<{ v: string }>(todaySql, [todayStr]);
      if (rToday[0]) out.today = Number(rToday[0].v ?? 0);
      const totalSql = `SELECT COALESCE(SUM(${col}), 0)::text AS v FROM ${fbTable}`;
      const { rows: rTotal } = await dbQuery<{ v: string }>(totalSql, []);
      if (rTotal[0]) out.total = Number(rTotal[0].v ?? 0);
    } catch (err) {
      console.warn("[api/metrics] facebook_ads column", col, ":", err instanceof Error ? err.message : String(err));
    }
    return out;
  };

  const investimentoRes = await tryFbCol("investimento");
  fbToday.spend = investimentoRes.today;
  fbTotal.spend = investimentoRes.total;
  const impRes = await tryFbCol("impressoes");
  fbToday.impressions = impRes.today;
  fbTotal.impressions = impRes.total;
  const clicksRes = await tryFbCol("cliques_no_link");
  fbToday.inline_link_clicks = clicksRes.today;
  fbTotal.inline_link_clicks = clicksRes.total;
  const mensagensRes = await tryFbCol("mensagens_iniciadas");
  fbToday.actions = mensagensRes.today;
  fbTotal.actions = mensagensRes.total;

  try {
    if (useSnapshots) {
      const { rows: todaySnapRows } = await dbQuery<{
        spend: string | number;
        leads: string | number;
        opportunities: string | number;
        sales_count: string | number;
        revenue: string | number;
      }>(
        "SELECT spend, leads, opportunities, sales_count, revenue FROM rastreio_whats.metric_snapshots WHERE platform = $1 AND metric_date = $2",
        [platform, todayStr]
      );
      let rangeSql = "SELECT spend, leads, opportunities, sales_count, revenue FROM rastreio_whats.metric_snapshots WHERE platform = $1";
      const rangeParams: (string | number)[] = [platform];
      if (dateFrom) {
        rangeParams.push(dateFrom);
        rangeSql += ` AND metric_date >= $${rangeParams.length}`;
      }
      if (dateTo) {
        rangeParams.push(dateTo);
        rangeSql += ` AND metric_date <= $${rangeParams.length}`;
      }
      const { rows: rangeSnapRows } = await dbQuery<{
        spend: string | number;
        leads: string | number;
        opportunities: string | number;
        sales_count: string | number;
        revenue: string | number;
      }>(rangeSql, rangeParams);

      const agg = (rows: typeof todaySnapRows) =>
        rows.reduce<typeof emptyAgg>(
          (acc, r) => ({
            ...acc,
            spend: acc.spend + Number(r.spend ?? 0),
            leads: acc.leads + Number(r.leads ?? 0),
            opportunities: acc.opportunities + Number(r.opportunities ?? 0),
            sales_count: acc.sales_count + Number(r.sales_count ?? 0),
            revenue: acc.revenue + Number(r.revenue ?? 0),
          }),
          { ...emptyAgg }
        );

      const todaySnap = agg(todaySnapRows);
      const totalSnap = agg(rangeSnapRows);
      todaySnap.leads = leadsTodayFromWhats;
      totalSnap.leads = leadsTotalFromWhats;
      todaySnap.spend = fbToday.spend || todaySnap.spend;
      totalSnap.spend = fbTotal.spend || totalSnap.spend;
      todaySnap.impressions = fbToday.impressions;
      totalSnap.impressions = fbTotal.impressions;
      todaySnap.inline_link_clicks = fbToday.inline_link_clicks;
      totalSnap.inline_link_clicks = fbTotal.inline_link_clicks;
      todaySnap.actions = fbToday.actions;
      totalSnap.actions = fbTotal.actions;
      todaySnap.cost_per_result = fbToday.actions > 0 ? fbToday.spend / fbToday.actions : 0;
      totalSnap.cost_per_result = fbTotal.actions > 0 ? fbTotal.spend / fbTotal.actions : 0;
      return json({
        today: todaySnap,
        total: totalSnap,
        platform,
        date_from: dateFrom,
        date_to: dateTo,
        objective,
        status,
      });
    }

    // Métricas de leads: whatsapp_anuncio. Métricas Meta: facebook_ads (spend, impressions, inline_link_clicks, actions).
    return json({
      today: {
        ...emptyAgg,
        leads: leadsTodayFromWhats,
        spend: fbToday.spend,
        impressions: fbToday.impressions,
        inline_link_clicks: fbToday.inline_link_clicks,
        actions: fbToday.actions,
        cost_per_result: fbToday.actions > 0 ? fbToday.spend / fbToday.actions : 0,
      },
      total: {
        ...emptyAgg,
        leads: leadsTotalFromWhats,
        spend: fbTotal.spend,
        impressions: fbTotal.impressions,
        inline_link_clicks: fbTotal.inline_link_clicks,
        actions: fbTotal.actions,
        cost_per_result: fbTotal.actions > 0 ? fbTotal.spend / fbTotal.actions : 0,
      },
      platform,
      date_from: dateFrom,
      date_to: dateTo,
      objective,
      status,
    });
  } catch (err) {
    console.error("[api/metrics] Postgres error:", err);
    return json({
      today: {
        ...emptyAgg,
        leads: leadsTodayFromWhats,
        spend: fbToday.spend,
        impressions: fbToday.impressions,
        inline_link_clicks: fbToday.inline_link_clicks,
        actions: fbToday.actions,
        cost_per_result: fbToday.actions > 0 ? fbToday.spend / fbToday.actions : 0,
      },
      total: {
        ...emptyAgg,
        leads: leadsTotalFromWhats,
        spend: fbTotal.spend,
        impressions: fbTotal.impressions,
        inline_link_clicks: fbTotal.inline_link_clicks,
        actions: fbTotal.actions,
        cost_per_result: fbTotal.actions > 0 ? fbTotal.spend / fbTotal.actions : 0,
      },
      platform,
      date_from: dateFrom,
      date_to: dateTo,
      objective,
      status,
    });
  }
}
