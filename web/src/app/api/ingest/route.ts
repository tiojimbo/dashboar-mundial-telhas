import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { isDbConfigured, withClient } from "@/lib/db/postgres";
import { getWhatsappAnuncioColumns, quoteId } from "@/lib/db/whatsapp-anuncio-schema";

function telefoneFromLead(platform: string, lead_name: string, message_at: string): string {
  return createHash("md5").update(platform + lead_name + message_at).digest("hex").slice(0, 15);
}

export const runtime = "nodejs";

/**
 * POST /api/ingest
 * Recebe payloads de fontes externas (n8n, etc.) e grava no Postgres:
 * ingestion_jobs, metric_snapshots, utm_metrics, whatsapp_leads.
 */

type UtmBreakdownItem = {
  utm_campaign: string;
  leads: number | string;
};

type LeadMessageItem = {
  lead_name: string;
  message_at: string;
  ad_creative?: string;
  campaign_name?: string;
  audience?: string;
};

type IngestRecord = {
  source?: string;
  metric_date: string;
  platform: string;
  spend?: number | string;
  leads?: number | string;
  opportunities?: number | string;
  sales_count?: number | string;
  revenue?: number | string;
  utm_breakdown?: UtmBreakdownItem[];
  lead_messages?: LeadMessageItem[];
};

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const normalizeNumber = (value: number | string | undefined, field: string) => {
  const normalized = value ?? 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${field}.`);
  }
  return parsed;
};

const normalizeRecord = (record: IngestRecord) => {
  if (!record || typeof record !== "object") {
    throw new Error("Record must be an object.");
  }
  if (!record.metric_date || !dateRegex.test(record.metric_date)) {
    throw new Error("metric_date must be in YYYY-MM-DD format.");
  }
  if (!record.platform || typeof record.platform !== "string") {
    throw new Error("platform is required.");
  }
  const source =
    typeof record.source === "string" && record.source.trim().length > 0
      ? record.source.trim()
      : "unknown";
  return {
    source,
    metric_date: record.metric_date,
    platform: record.platform.trim(),
    spend: normalizeNumber(record.spend, "spend"),
    leads: normalizeNumber(record.leads, "leads"),
    opportunities: normalizeNumber(record.opportunities, "opportunities"),
    sales_count: normalizeNumber(record.sales_count, "sales_count"),
    revenue: normalizeNumber(record.revenue, "revenue"),
    utm_breakdown: Array.isArray(record.utm_breakdown) ? record.utm_breakdown : [],
    lead_messages: Array.isArray(record.lead_messages) ? record.lead_messages : [],
  };
};

export async function POST(request: Request) {
  const ingestionKey = process.env.INGESTION_API_KEY;
  if (ingestionKey) {
    const providedKey = request.headers.get("x-ingestion-key");
    if (!providedKey || providedKey !== ingestionKey) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawRecords = Array.isArray(body)
    ? body
    : Array.isArray((body as { records?: unknown[] })?.records)
      ? (body as { records: unknown[] }).records
      : [body];

  if (!rawRecords.length) {
    return NextResponse.json({ error: "No records found." }, { status: 400 });
  }

  let records: ReturnType<typeof normalizeRecord>[];
  try {
    records = rawRecords.map((item) => normalizeRecord(item as IngestRecord));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }

  if (!isDbConfigured) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const now = new Date().toISOString();
  const metricsRows = records.map((r) => ({
    metric_date: r.metric_date,
    platform: r.platform,
    spend: r.spend,
    leads: r.leads,
    opportunities: r.opportunities,
    sales_count: r.sales_count,
    revenue: r.revenue,
    source: r.source,
    updated_at: now,
  }));

  const utmRows = records.flatMap((record) =>
    record.utm_breakdown
      .filter(
        (item) =>
          item &&
          typeof item.utm_campaign === "string" &&
          item.utm_campaign.trim().length > 0
      )
      .map((item) => ({
        metric_date: record.metric_date,
        platform: record.platform,
        utm_campaign: item.utm_campaign.trim(),
        leads: normalizeNumber(item.leads, "utm_breakdown.leads"),
        source: record.source,
        updated_at: now,
      }))
  );

  const leadRows = records.flatMap((record) =>
    record.lead_messages
      .filter(
        (item) =>
          item &&
          typeof item.lead_name === "string" &&
          item.lead_name.trim().length > 0 &&
          typeof item.message_at === "string" &&
          item.message_at.trim().length > 0
      )
      .map((item) => ({
        platform: record.platform,
        lead_name: item.lead_name.trim(),
        message_at: item.message_at.trim(),
        ad_creative: typeof item.ad_creative === "string" ? item.ad_creative.trim() : null,
        campaign_name: typeof item.campaign_name === "string" ? item.campaign_name.trim() : null,
        audience: typeof item.audience === "string" ? item.audience.trim() : null,
        source: record.source,
        updated_at: now,
      }))
  );

  try {
    const result = await withClient(async (client) => {
      const jobRes = await client.query<{ id: string }>(
        `INSERT INTO rastreio_whats.ingestion_jobs (source, payload, status)
         VALUES ($1, $2, 'received')
         RETURNING id`,
        [records[0]?.source ?? "unknown", JSON.stringify(body)]
      );
      const jobId = jobRes.rows[0]?.id;
      if (!jobId) throw new Error("Failed to insert ingestion_jobs row.");

      for (const row of metricsRows) {
        await client.query(
          `INSERT INTO rastreio_whats.metric_snapshots (metric_date, platform, spend, leads, opportunities, sales_count, revenue, source, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (metric_date, platform) DO UPDATE SET
             spend = EXCLUDED.spend,
             leads = EXCLUDED.leads,
             opportunities = EXCLUDED.opportunities,
             sales_count = EXCLUDED.sales_count,
             revenue = EXCLUDED.revenue,
             source = EXCLUDED.source,
             updated_at = EXCLUDED.updated_at`,
          [
            row.metric_date,
            row.platform,
            row.spend,
            row.leads,
            row.opportunities,
            row.sales_count,
            row.revenue,
            row.source,
            row.updated_at,
          ]
        );
      }

      for (const row of utmRows) {
        await client.query(
          `INSERT INTO rastreio_whats.utm_metrics (metric_date, platform, utm_campaign, leads, source, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (metric_date, platform, utm_campaign) DO UPDATE SET
             leads = EXCLUDED.leads,
             source = EXCLUDED.source,
             updated_at = EXCLUDED.updated_at`,
          [row.metric_date, row.platform, row.utm_campaign, row.leads, row.source, row.updated_at]
        );
      }

      const col = getWhatsappAnuncioColumns();
      const q = quoteId;
      const cols = ["telefone", "id_transacao", col.data_criacao, col.source_id, col.nome, col.plataforma];
      const setParts = [
        `${q(col.data_criacao)} = EXCLUDED.${q(col.data_criacao)}`,
        `${q(col.source_id)} = EXCLUDED.${q(col.source_id)}`,
        `${q(col.nome)} = EXCLUDED.${q(col.nome)}`,
      ];
      for (const row of leadRows) {
        const telefone = telefoneFromLead(row.platform, row.lead_name, row.message_at);
        const idTransacao = `ingest-${telefone}-${Date.now()}`;
        const vals = [telefone, idTransacao, row.message_at, null, row.lead_name, row.platform];
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(
          `INSERT INTO rastreio_whats.whatsapp_anuncio (${cols.map(q).join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (telefone) DO UPDATE SET ${setParts.join(", ")}`,
          vals
        );
      }

      await client.query(
        `UPDATE rastreio_whats.ingestion_jobs SET status = 'processed' WHERE id = $1`,
        [jobId]
      );

      return { jobId };
    });

    return NextResponse.json({
      ok: true,
      metrics_upserted: metricsRows.length,
      utm_upserted: utmRows.length,
      job_id: result.jobId,
    });
  } catch (err) {
    console.error("[api/ingest] Postgres error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 }
    );
  }
}
