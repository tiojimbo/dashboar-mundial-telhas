import { NextResponse } from "next/server";
import { isDbConfigured, query } from "@/lib/db/postgres";
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

/**
 * Linha: whatsapp_anuncio + facebook_ads (campanha, conjunto_anuncio, anuncio).
 * facebook_ads tem: source_id, data, campanha, conjunto_anuncio, anuncio.
 */
type LeadRow = {
  nome: string | null;
  sobrenome: string | null;
  data_criacao: string;
  source_id: string | number | null;
  ctwaclid: string | null;
  plataforma: string | null;
  mensagem: string | null;
  cta: string | null;
  source_url: string | null;
  campanha: string | null;
  conjunto_anuncio: string | null;
  anuncio: string | null;
};

/**
 * GET /api/leads?platform=meta|all&date=YYYY-MM-DD|all
 * Lista registros de rastreio_whats.whatsapp_anuncio com source_id preenchido.
 * date=all: retorna todos os leads (sem filtro de data). Caso contrário filtra pelo dia.
 * platform=all ou vazio: não filtra por plataforma (exibe todos os leads).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platformParam = searchParams.get("platform")?.trim().toLowerCase();
  const platform = platformParam === "all" || !platformParam ? null : platformParam;
  const dateParam = searchParams.get("date")?.trim().toLowerCase();
  const allDates = dateParam === "all";
  const date = allDates ? today() : (dateParam || today());
  const dateEnd = nextDay(date);
  const startIso = `${date}T00:00:00-03:00`;
  const endIso = `${dateEnd}T00:00:00-03:00`;

  if (!isDbConfigured) {
    return json({
      date: allDates ? "all" : date,
      platform: platform ?? "all",
      total_conversations: 0,
      items: [],
    });
  }

  try {
    const col = getWhatsappAnuncioColumns();
    const q = quoteId;
    const wa = "wa";
    const fa = "fa";
    const selectList = [
      `${wa}.${q(col.nome)}`,
      `${wa}.${q(col.sobrenome)}`,
      `${wa}.${q(col.data_criacao)}`,
      `${wa}.${q(col.source_id)}`,
      `${wa}.${q(col.ctwaclid)}`,
      `${wa}.${q(col.plataforma)}`,
      `${wa}.${q(col.mensagem)}`,
      `${wa}.${q(col.cta)}`,
      `${wa}.${q(col.source_url)}`,
      `${fa}.campanha`,
      `${fa}.conjunto_anuncio`,
      `${fa}.anuncio`,
    ].join(", ");

    const conditions: string[] = [`${wa}.${q(col.source_id)} IS NOT NULL`];
    const params: (string | number)[] = [];
    if (!allDates) {
      conditions.push(`${wa}.${q(col.data_criacao)} >= $1 AND ${wa}.${q(col.data_criacao)} < $2`);
      params.push(startIso, endIso);
    }
    if (platform !== null) {
      conditions.push(`${wa}.${q(col.plataforma)} = $${params.length + 1}`);
      params.push(platform);
    }

    const result = await query<LeadRow>(
      `SELECT ${selectList}
       FROM rastreio_whats.whatsapp_anuncio AS ${wa}
       LEFT JOIN rastreio_whats.facebook_ads AS ${fa}
         ON ${fa}.source_id = ${wa}.${q(col.source_id)}
         AND ${fa}.data = (${wa}.${q(col.data_criacao)})::date
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${wa}.${q(col.data_criacao)} DESC`,
      params
    );

    const rows = result.rows.map((r) => ({
      nome: r.nome ?? null,
      sobrenome: r.sobrenome ?? null,
      data_criacao: r.data_criacao,
      source_id: r.source_id ?? null,
      ctwaclid: r.ctwaclid ?? null,
      plataforma: r.plataforma ?? null,
      mensagem: r.mensagem ?? null,
      cta: r.cta ?? null,
      source_url: r.source_url ?? null,
      campanha: r.campanha ?? null,
      conjunto: r.conjunto_anuncio ?? null,
      criativo: r.anuncio ?? null,
    }));

    return json({
      date: allDates ? "all" : date,
      platform: platform ?? "all",
      total_conversations: rows.length,
      items: rows,
    });
  } catch (err) {
    console.error("[api/leads] Postgres error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 }
    );
  }
}
