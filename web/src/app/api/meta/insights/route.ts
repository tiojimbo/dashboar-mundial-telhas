import { NextResponse } from "next/server";
import { isDbConfigured, query } from "@/lib/db/postgres";
import { getWhatsappAnuncioColumns, quoteId } from "@/lib/db/whatsapp-anuncio-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

type InsightRow = { id: string; name: string; quantidade: number; spend: number; impressions: number; clicks: number };

/**
 * GET /api/meta/insights?level=campaign|adset|ad&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 * Returns breakdowns from rastreio_whats.facebook_ads (campaign/adset/ad) with lead counts from whatsapp_anuncio.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") || "campaign").toLowerCase();
  const dateFrom = searchParams.get("date_from")?.trim() || null;
  const dateTo = searchParams.get("date_to")?.trim() || null;
  const objective = (searchParams.get("objective") || "ENGAGEMENT").toUpperCase();
  const status = (searchParams.get("status") || "ACTIVE").toUpperCase();

  if (!isDbConfigured) {
    return json({ level, items: [], date_from: dateFrom, date_to: dateTo, objective, status });
  }

  const validLevel = level === "campaign" || level === "adset" || level === "ad";
  if (!validLevel) {
    return json({ level, items: [], date_from: dateFrom, date_to: dateTo, objective, status });
  }

  const col = getWhatsappAnuncioColumns();
  const q = quoteId;
  const wa = "wa";
  const fa = "fa";
  const dataCol = q(col.data_criacao);
  const sourceIdCol = q(col.source_id);

  // Filtro de data opcional em facebook_ads.data
  const dateConditions: string[] = [];
  const params: (string | number)[] = [];
  if (dateFrom) {
    params.push(dateFrom);
    dateConditions.push(`${fa}.data >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    dateConditions.push(`${fa}.data <= $${params.length}`);
  }
  const dateWhere = dateConditions.length ? `AND ${dateConditions.join(" AND ")}` : "";

  // Nome do grupo e coluna para quantidade (leads distintos por (source_id, data))
  let groupByCol: string;
  let nameCol: string;
  if (level === "campaign") {
    groupByCol = `${fa}.campanha`;
    nameCol = "campanha";
  } else if (level === "adset") {
    groupByCol = `${fa}.conjunto_anuncio`;
    nameCol = "conjunto_anuncio";
  } else {
    groupByCol = `${fa}.anuncio`;
    nameCol = "anuncio";
  }

  // Quantidade = contagem de leads (whatsapp_anuncio) distintos que batem com este grupo
  const fa2Col = `${fa}.${q(nameCol)}`;
  const quantidadeSubquery = `(
    SELECT COUNT(*)::int FROM (
      SELECT DISTINCT ${wa}.${sourceIdCol}, (${wa}.${dataCol})::date
      FROM rastreio_whats.whatsapp_anuncio AS ${wa}
      INNER JOIN rastreio_whats.facebook_ads AS fa2
        ON fa2.source_id = ${wa}.${sourceIdCol} AND fa2.data = (${wa}.${dataCol})::date
        AND fa2.${q(nameCol)} = ${fa2Col}
    ) lead_keys
  )`;

  const sql = `
    SELECT
      COALESCE(TRIM(${groupByCol}), '') AS id,
      COALESCE(TRIM(${groupByCol}), '—') AS name,
      ${quantidadeSubquery} AS quantidade,
      COALESCE(SUM(${fa}.investimento), 0)::double precision AS spend,
      COALESCE(SUM(${fa}.impressoes), 0)::bigint AS impressions,
      COALESCE(SUM(${fa}.cliques_no_link), 0)::bigint AS clicks
    FROM rastreio_whats.facebook_ads AS ${fa}
    WHERE (${groupByCol} IS NOT NULL AND TRIM(${groupByCol}) <> '') ${dateWhere}
    GROUP BY ${groupByCol}
    ORDER BY spend DESC NULLS LAST, name
  `;

  try {
    const { rows } = await query<{ id: string; name: string; quantidade: number; spend: number; impressions: string | number; clicks: string | number }>(sql, params);
    const items: InsightRow[] = rows.map((r) => ({
      id: r.id || r.name,
      name: r.name || "—",
      quantidade: Number(r.quantidade) || 0,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
    }));
    return json({
      level,
      items,
      date_from: dateFrom,
      date_to: dateTo,
      objective,
      status,
    });
  } catch (err) {
    console.warn("[api/meta/insights]", err);
    return json({
      level,
      items: [],
      date_from: dateFrom,
      date_to: dateTo,
      objective,
      status,
    });
  }
}
