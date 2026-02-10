/**
 * Meta Marketing API client.
 * Used by /api/meta/sync to fetch ads, accounts, and insights.
 * Data is written to meta_campaigns + meta_ads_insights; UTM use /api/ingest.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type MetaClientConfig = {
  accessToken: string;
  adAccountId: string;
};

export type MetaCampaign = {
  id: string;
  account_id: string;
  name: string;
  status: string;
  objective?: string;
  created_time?: string;
};

export type MetaAdSet = {
  id: string;
  campaign_id: string;
  account_id: string;
  name: string;
  status: string;
  created_time?: string;
};

export type MetaAd = {
  id: string;
  ad_set_id: string;
  campaign_id: string;
  account_id: string;
  name: string;
  status: string;
  created_time?: string;
};

export type MetaInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

export type MetaPlatformInsightRow = {
  campaign_id?: string;
  publisher_platform?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

export type MetaApiError = {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

function ensureActPrefix(accountId: string): string {
  const s = String(accountId).trim();
  return s.startsWith("act_") ? s : `act_${s}`;
}

function parseLeadCount(actions: MetaInsightRow["actions"]): number {
  if (!Array.isArray(actions)) return 0;
  const lead = actions.find((a) => (a.action_type || "").toLowerCase() === "lead");
  return lead && lead.value ? parseInt(lead.value, 10) || 0 : 0;
}

function parseConversionValue(actions: MetaInsightRow["actions"]): number {
  if (!Array.isArray(actions)) return 0;
  const purchase = actions.find(
    (a) =>
      (a.action_type || "").toLowerCase().includes("purchase") ||
      (a.action_type || "").toLowerCase().includes("omni_purchase")
  );
  if (purchase && purchase.value) return parseFloat(purchase.value) || 0;
  return 0;
}

function parseWhatsappConversations(actions: MetaInsightRow["actions"]): number {
  if (!Array.isArray(actions)) return 0;
  const targets = new Set([
    "onsite_conversion.messaging_conversation_started_7d",
    "messaging_conversation_started_7d",
    "onsite_conversion.messaging_conversation_started",
    "messaging_conversation_started",
  ]);
  return actions.reduce((acc, a) => {
    const key = (a.action_type || "").toLowerCase();
    if (!targets.has(key)) return acc;
    return acc + (parseInt(a.value, 10) || 0);
  }, 0);
}

/**
 * Fetch JSON from Graph API. Handles 401/403 and rate limits.
 */
async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  const body = (await res.json()) as T | { error: MetaApiError };
  if (!res.ok) {
    const err = (body as { error: MetaApiError }).error;
    const msg = err?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      console.error("[Meta API] Token or permission error:", err);
    }
    if (res.status === 429 || (err?.code === 613)) {
      console.error("[Meta API] Rate limit exceeded:", err);
    }
    throw new Error(msg);
  }
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: MetaApiError }).error;
    throw new Error(err?.message || "Meta API error");
  }
  return body as T;
}

/**
 * Paginate through a Graph API edge (follow "next" in paging.cursors or paging.next).
 */
async function graphGetAll<T extends { data?: unknown[]; paging?: { next?: string; cursors?: unknown } }>(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<unknown[]> {
  const acc: unknown[] = [];
  let nextUrl: string | null = null;
  const first = await graphGet<T>(path, params, accessToken);
  if (Array.isArray(first.data)) acc.push(...first.data);
  nextUrl = (first as { paging?: { next?: string } }).paging?.next ?? null;
  while (nextUrl) {
    const res = await fetch(nextUrl, { method: "GET", cache: "no-store" });
    const page = (await res.json()) as T;
    if (!res.ok) {
      const err = (page as { error?: MetaApiError }).error;
      throw new Error(err?.message || `HTTP ${res.status}`);
    }
    if (Array.isArray(page.data)) acc.push(...page.data);
    nextUrl = (page as { paging?: { next?: string } }).paging?.next ?? null;
  }
  return acc;
}

/**
 * List ad accounts for the token. Uses META_AD_ACCOUNT_ID when provided; otherwise calls /me/adaccounts.
 */
export async function getAdAccounts(config: MetaClientConfig): Promise<{ id: string; name?: string }[]> {
  const accountId = config.adAccountId?.trim();
  if (accountId) {
    const actId = ensureActPrefix(accountId);
    return [{ id: actId, name: undefined }];
  }
  const raw = await graphGet<{ data?: { id: string; name?: string }[] }>(
    "/me/adaccounts",
    { fields: "id,name" },
    config.accessToken
  );
  return (raw.data || []).map((a) => ({ id: a.id, name: a.name }));
}

export type MetaAdAccountBudget = {
  amount_spent: number;
  balance: number | null;
  spend_cap: number | null;
  currency: string;
  is_prepay_account: boolean;
  /** Saldo da carteira (prepay) quando retornado em funding_source_details; em centavos. Opcional: requer MANAGE. */
  funding_source_amount: number | null;
};

/** Extrai valor em centavos de funding_source_details (objeto ou array). TYPE 2 = FACEBOOK_WALLET, 20 = STORED_BALANCE. */
function parseFundingSourceAmount(details: unknown): number | null {
  const items: Record<string, unknown>[] = [];
  if (details && typeof details === "object") {
    if (Array.isArray(details)) items.push(...details);
    else items.push(details as Record<string, unknown>);
  }
  for (const d of items) {
    const type = typeof d.TYPE === "number" ? d.TYPE : parseInt(String(d.type ?? d.TYPE ?? ""), 10);
    if (type !== 2 && type !== 20) continue;
    let amount: unknown = d.AMOUNT ?? d.amount;
    if (amount == null || amount === "") {
      const display = d.DISPLAY_AMOUNT ?? d.display_amount;
      if (display != null && display !== "") {
        const s = String(display).replace(/\s/g, "");
        const reais =
          /,\d{1,2}$/.test(s) || /,\d{1,2}\s/.test(s)
            ? parseFloat(s.replace(/\./g, "").replace(",", "."))
            : parseFloat(s.replace(/,/g, ""));
        if (Number.isFinite(reais)) return Math.round(reais * 100);
      }
      continue;
    }
    const n = typeof amount === "number" ? amount : parseFloat(String(amount));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Fetch ad account budget/balance from Meta Marketing API.
 * amount_spent, balance, spend_cap are in smallest currency units (e.g. cents); caller should divide by 100 for display.
 * Tenta incluir funding_source_details na primeira chamada; se a API retornar erro (ex.: sem MANAGE), refaz sem esse campo.
 */
export async function getAdAccountBudget(
  adAccountId: string,
  accessToken: string
): Promise<MetaAdAccountBudget> {
  const actId = ensureActPrefix(adAccountId);
  const toNum = (v: string | undefined): number =>
    v != null && v !== "" ? parseFloat(v) || 0 : 0;
  const toNumOrNull = (v: string | undefined): number | null =>
    v != null && v !== "" ? parseFloat(v) ?? null : null;

  const fieldsBase = "amount_spent,balance,spend_cap,currency,is_prepay_account";
  const fieldsWithFunding =
    fieldsBase + ",funding_source_details{AMOUNT,TYPE,DISPLAY_AMOUNT}";

  let raw: {
    amount_spent?: string;
    balance?: string;
    spend_cap?: string;
    currency?: string;
    is_prepay_account?: boolean;
    funding_source_details?: unknown;
  };
  try {
    raw = await graphGet<typeof raw>(`/${actId}`, { fields: fieldsWithFunding }, accessToken);
  } catch {
    raw = await graphGet<typeof raw>(`/${actId}`, { fields: fieldsBase }, accessToken);
  }

  const funding_source_amount = parseFundingSourceAmount(raw.funding_source_details);

  return {
    amount_spent: toNum(raw.amount_spent),
    balance: toNumOrNull(raw.balance),
    spend_cap: toNumOrNull(raw.spend_cap),
    currency: raw.currency ?? "BRL",
    is_prepay_account: raw.is_prepay_account === true,
    funding_source_amount,
  };
}

/**
 * List campaigns for an ad account.
 */
export async function getCampaigns(
  adAccountId: string,
  accessToken: string
): Promise<MetaCampaign[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/campaigns`;
  const raw = await graphGetAll<{ data?: { id: string; name: string; status: string; objective?: string; created_time?: string }[] }>(
    path,
    { fields: "id,name,status,objective,created_time" },
    accessToken
  );
  return (raw as { id: string; name: string; status: string; objective?: string; created_time?: string }[]).map((c) => ({
    id: c.id,
    account_id: actId,
    name: c.name || "",
    status: c.status || "UNKNOWN",
    objective: c.objective,
    created_time: c.created_time,
  }));
}

/**
 * List ad sets for an ad account.
 */
export async function getAdSets(
  adAccountId: string,
  accessToken: string
): Promise<MetaAdSet[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/adsets`;
  const raw = await graphGetAll<{ data?: { id: string; name: string; status: string; campaign_id: string; created_time?: string }[] }>(
    path,
    { fields: "id,name,status,campaign_id,created_time" },
    accessToken
  );
  return (raw as { id: string; name: string; status: string; campaign_id: string; created_time?: string }[]).map((a) => ({
    id: a.id,
    campaign_id: a.campaign_id,
    account_id: actId,
    name: a.name || "",
    status: a.status || "UNKNOWN",
    created_time: a.created_time,
  }));
}

/**
 * List ads for an ad account.
 */
export async function getAds(
  adAccountId: string,
  accessToken: string
): Promise<MetaAd[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/ads`;
  const raw = await graphGetAll<{ data?: { id: string; name: string; status: string; adset_id: string; campaign_id: string; created_time?: string }[] }>(
    path,
    { fields: "id,name,status,adset_id,campaign_id,created_time" },
    accessToken
  );
  return (raw as { id: string; name: string; status: string; adset_id: string; campaign_id: string; created_time?: string }[]).map((a) => ({
    id: a.id,
    ad_set_id: a.adset_id,
    campaign_id: a.campaign_id,
    account_id: actId,
    name: a.name || "",
    status: a.status || "UNKNOWN",
    created_time: a.created_time,
  }));
}

/**
 * Fetch insights at campaign level, day-level breakdown, for the given date range.
 * Returns rows with campaign_id, date_start, date_stop, spend, impressions, clicks, leads (from actions).
 */
export async function getCampaignInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<MetaInsightRow[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/insights`;
  const params: Record<string, string> = {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,actions",
  };
  const raw = await graphGetAll<{ data?: MetaInsightRow[] }>(path, params, accessToken);
  return (raw as MetaInsightRow[]).filter((r) => r.campaign_id && r.date_start);
}

/**
 * Fetch insights at ad set level, day-level breakdown, for the given date range.
 */
export async function getAdSetInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<MetaInsightRow[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/insights`;
  const params: Record<string, string> = {
    level: "adset",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,adset_id,adset_name,date_start,date_stop,spend,impressions,clicks,actions",
  };
  const raw = await graphGetAll<{ data?: MetaInsightRow[] }>(path, params, accessToken);
  return (raw as MetaInsightRow[]).filter((r) => r.adset_id && r.date_start);
}

/**
 * Fetch insights at ad level, day-level breakdown, for the given date range.
 */
export async function getAdInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<MetaInsightRow[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/insights`;
  const params: Record<string, string> = {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,adset_id,ad_id,ad_name,date_start,date_stop,spend,impressions,clicks,actions",
  };
  const raw = await graphGetAll<{ data?: MetaInsightRow[] }>(path, params, accessToken);
  return (raw as MetaInsightRow[]).filter((r) => r.ad_id && r.date_start);
}

/**
 * Fetch insights breakdown by publisher_platform (used for UTM Medium section).
 */
export async function getPlatformInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string
): Promise<MetaPlatformInsightRow[]> {
  const actId = ensureActPrefix(adAccountId);
  const path = `/${actId}/insights`;
  const params: Record<string, string> = {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,date_start,date_stop,spend,impressions,clicks,actions",
    breakdowns: "publisher_platform",
  };
  const raw = await graphGetAll<{ data?: MetaPlatformInsightRow[] }>(path, params, accessToken);
  return (raw as MetaPlatformInsightRow[]).filter((r) => r.publisher_platform && r.date_start);
}

/**
 * Normalize insight rows into DB-ready shape for meta_ads_insights and metric_snapshots.
 */
export function normalizeInsightsForDb(
  rows: MetaInsightRow[]
): {
  insights: Array<{
    campaign_id: string;
    ad_set_id: string;
    ad_id: string;
    metric_date: string;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    whatsapp_conversations: number;
    conversions: number;
  }>;
  dailyTotals: Array<{ metric_date: string; spend: number; leads: number; impressions: number; clicks: number }>;
} {
  const insights: Array<{
    campaign_id: string;
    ad_set_id: string;
    ad_id: string;
    metric_date: string;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    whatsapp_conversations: number;
    conversions: number;
  }> = [];
  const byDate: Record<
    string,
    { spend: number; leads: number; impressions: number; clicks: number }
  > = {};

  for (const r of rows) {
    const campaignId = String(r.campaign_id || "").trim();
    const metricDate = (r.date_start || r.date_stop || "").slice(0, 10);
    if (!campaignId || !metricDate) continue;

    const spend = parseFloat(r.spend || "0") || 0;
    const impressions = parseInt(r.impressions || "0", 10) || 0;
    const clicks = parseInt(r.clicks || "0", 10) || 0;
    const leads = parseLeadCount(r.actions);
    const conversions = parseConversionValue(r.actions);
    const whatsappConversations = parseWhatsappConversations(r.actions);

    insights.push({
      campaign_id: campaignId,
      ad_set_id: r.adset_id?.trim() || "",
      ad_id: r.ad_id?.trim() || "",
      metric_date: metricDate,
      spend,
      impressions,
      clicks,
      leads,
      whatsapp_conversations: whatsappConversations,
      conversions,
    });

    if (!byDate[metricDate]) {
      byDate[metricDate] = { spend: 0, leads: 0, impressions: 0, clicks: 0 };
    }
    byDate[metricDate].spend += spend;
    byDate[metricDate].leads += leads;
    byDate[metricDate].impressions += impressions;
    byDate[metricDate].clicks += clicks;
  }

  const dailyTotals = Object.entries(byDate).map(([metric_date, agg]) => ({
    metric_date,
    ...agg,
  }));

  return { insights, dailyTotals };
}
