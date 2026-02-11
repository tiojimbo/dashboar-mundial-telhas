"use client";

import { type CSSProperties, useState, useCallback, useEffect, useRef } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Sector,
  type PieSectorDataItem,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

type MetricCardProps = {
  title: string;
  value: string;
  subtitle: string;
  onClick?: () => void;
};

type GoalCard = {
  id: string;
  title: string;
  target: number;
};

type UtmTermRow = { id?: string; utmTerm: string; quantidade: number };
type UtmCampaignRow = { id?: string; utmCampaign: string; quantidade: number };
type MetaCampaignRow = { campaign_id: string; campaign_name: string; quantidade: number; spend: number };
type MetricsAgg = {
  spend: number;
  leads: number;
  opportunities: number;
  sales_count: number;
  revenue: number;
  cost_per_result?: number;
  impressions?: number;
  inline_link_clicks?: number;
  actions?: number;
};
type MetaListItem = { id: string; name: string; quantidade: number; spend: number; impressions?: number; clicks?: number };
type UtmContentRow = { utmContent: string; quantidade: number };

type ConversionRow = {
  clientName: string;
  utmTerm: string;
  utmCampaign: string;
  utmContent: string;
  utmMedium: string;
  utmSource: string;
  saleDate: string;
  value: string;
};

/** Conforme schema rastreio_whats.whatsapp_anuncio (resposta da API) */
type LeadMessageRow = {
  nome: string | null;
  sobrenome: string | null;
  data_criacao: string;
  mensagem: string | null;
  cta: string | null;
  source_url: string | null;
  campanha?: string | null;
  conjunto?: string | null;
  criativo?: string | null;
};

const INITIAL_GOALS: GoalCard[] = [
  { id: "1", title: "Meta mínima", target: 120 },
  { id: "2", title: "Meta boa", target: 150 },
  { id: "3", title: "Meta agressiva", target: 220 },
];

const GOALS_STORAGE_KEY = "dashboard-goals";

function loadGoalsFromStorage(): GoalCard[] {
  if (typeof window === "undefined") return INITIAL_GOALS;
  try {
    const raw = localStorage.getItem(GOALS_STORAGE_KEY);
    if (!raw) return INITIAL_GOALS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_GOALS;
    const goals: GoalCard[] = parsed.filter(
      (g): g is GoalCard =>
        g != null &&
        typeof g === "object" &&
        typeof (g as GoalCard).id === "string" &&
        typeof (g as GoalCard).title === "string" &&
        typeof (g as GoalCard).target === "number"
    );
    return goals.length > 0 ? goals : INITIAL_GOALS;
  } catch {
    return INITIAL_GOALS;
  }
}

function saveGoalsToStorage(goals: GoalCard[]) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
    }
  } catch {
    // ignore
  }
}

const CHART_COLORS = [
  "#0ea5e9", "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899",
  "#10b981", "#6366f1", "#f97316", "#14b8a6", "#a855f7", "#64748b",
];

/** Tooltip do Recharts: nome completo e valor; posicionado à esquerda do gráfico para não sobrepor */
function PieChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value?: number; payload?: { fullName?: string; name?: string; value?: number; fill?: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const data = item?.payload;
  const label = data?.fullName ?? data?.name ?? "—";
  const value = item?.value ?? data?.value ?? 0;
  const fill = data?.fill;
  return (
    <div
      className="pie-tooltip rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg sm:px-4 sm:py-3"
      style={{
        minWidth: 180,
        maxWidth: 380,
        width: "max-content",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        whiteSpace: "normal",
      }}
      suppressHydrationWarning
    >
      <div className="flex items-start gap-2 text-sm">
        {fill != null && (
          <span
            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: fill }}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 font-semibold text-slate-900" style={{ wordBreak: "break-word" }}>
          {label}
        </span>
        <span className="shrink-0 text-slate-600">: {value}</span>
      </div>
    </div>
  );
}

/** Estilo do wrapper do Tooltip: fixo à esquerda do gráfico para não sobrepor a fatia */
const PIE_TOOLTIP_WRAPPER_STYLE: CSSProperties = {
  position: "absolute",
  left: "auto",
  right: "100%",
  marginRight: 8,
  top: "50%",
  transform: "translateY(-50%)",
  outline: "none",
  maxWidth: "min(380px, calc(100vw - 24px))",
  minWidth: 160,
  pointerEvents: "none",
};

/** Fatia ativa: destaque (leve “pop-out”) ao passar o mouse; retorna elemento React (Recharts 3) */
function pieActiveShape(props: PieSectorDataItem) {
  const base = typeof props.outerRadius === "number" ? props.outerRadius : 52;
  return <Sector {...props} outerRadius={base + 10} />;
}

/** Intervalo de atualização automática dos dados (sem recarregar a página) */
const REFRESH_MS = 30000;
const FETCH_OPTIONS: RequestInit = { cache: "no-store" };

const CACHE_KEYS = {
  metrics: "dashboard-cache-metrics",
  metricsDaily: "dashboard-cache-metrics-daily",
  metaCampaigns: "dashboard-cache-meta-campaigns",
  metaAdSets: "dashboard-cache-meta-adsets",
  metaAds: "dashboard-cache-meta-ads",
  leadsToday: "dashboard-cache-leads-today",
  leadsForUtm: "dashboard-cache-leads-utm",
} as const;

function getCached<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function setCached(key: string, value: unknown) {
  try {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // ignore
  }
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}
function fmtPercent(n: number): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n)}%`;
}
function fmtDateShort(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export default function Home() {
  const [utmTermModal, setUtmTermModal] = useState<UtmTermRow | null>(null);
  const [utmCampaignModal, setUtmCampaignModal] = useState<UtmCampaignRow | null>(null);
  const [utmContentModal, setUtmContentModal] = useState<UtmContentRow | null>(null);
  const [metricsApi, setMetricsApi] = useState<{ today: MetricsAgg; total: MetricsAgg } | null>(null);
  const [metaCampaignsApi, setMetaCampaignsApi] = useState<{ items: MetaListItem[] } | null>(null);
  const [metaAdSetsApi, setMetaAdSetsApi] = useState<{ items: MetaListItem[] } | null>(null);
  const [metaAdsApi, setMetaAdsApi] = useState<{ items: MetaListItem[] } | null>(null);
  const [metaCampaignsToday, setMetaCampaignsToday] = useState<{ items: MetaListItem[] } | null>(null);
  const [metaAdSetsToday, setMetaAdSetsToday] = useState<{ items: MetaListItem[] } | null>(null);
  const [metaAdsToday, setMetaAdsToday] = useState<{ items: MetaListItem[] } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [leadsToday, setLeadsToday] = useState<LeadMessageRow[] | null>(null);
  const [leadsTodayTotal, setLeadsTodayTotal] = useState<number | null>(null);
  const [leadsModalOpen, setLeadsModalOpen] = useState(false);
  const [leadsTotalModalOpen, setLeadsTotalModalOpen] = useState(false);
  const [leadsTotal, setLeadsTotal] = useState<LeadMessageRow[] | null>(null);
  const [leadsTotalLoading, setLeadsTotalLoading] = useState(false);
  const [goals, setGoals] = useState<GoalCard[]>(INITIAL_GOALS);
  const [leadsForUtm, setLeadsForUtm] = useState<LeadMessageRow[] | null>(null);
  type DailyRow = { date: string; spend: number; leads: number; cpl: number | null };
  const [dailyMetrics, setDailyMetrics] = useState<DailyRow[]>([]);
  type GeneralPeriod = null | "este_mes" | "14dias" | "7dias" | "3dias";
  const [generalPeriod, setGeneralPeriod] = useState<GeneralPeriod>(null);
  const metricsLoadingRef = useRef(false);
  const metaLoadingRef = useRef(false);
  const leadsLoadingRef = useRef(false);

  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    setGoals(loadGoalsFromStorage());
  }, []);

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    saveGoalsToStorage(goals);
  }, [goals]);

  useEffect(() => {
    const cached = getCached<{ today: MetricsAgg; total: MetricsAgg }>(CACHE_KEYS.metrics);
    if (cached?.today != null && cached?.total != null) setMetricsApi(cached);
    let isMounted = true;
    const loadMetrics = async () => {
      if (!isMounted || metricsLoadingRef.current || document.visibilityState === "hidden") return;
      metricsLoadingRef.current = true;
      try {
        const r = await fetch("/api/metrics?platform=meta&objective=ENGAGEMENT&status=ACTIVE", FETCH_OPTIONS);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (isMounted && d.today != null && d.total != null) {
          const data = { today: d.today, total: d.total };
          setMetricsApi(data);
          setCached(CACHE_KEYS.metrics, data);
        }
      } catch {
        // ignore
      } finally {
        metricsLoadingRef.current = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadMetrics();
    };
    loadMetrics();
    const id = setInterval(loadMetrics, REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isMounted = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshTick]);

  useEffect(() => {
    const cached = getCached<DailyRow[]>(CACHE_KEYS.metricsDaily);
    if (Array.isArray(cached) && cached.length > 0) setDailyMetrics(cached);
    let isMounted = true;
    const loadDaily = async () => {
      if (!isMounted || document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/metrics/daily?days=90", FETCH_OPTIONS);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (isMounted && Array.isArray(d.daily)) {
          setDailyMetrics(d.daily);
          setCached(CACHE_KEYS.metricsDaily, d.daily);
        }
      } catch {
        // ignore
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadDaily();
    };
    loadDaily();
    const id = setInterval(loadDaily, REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isMounted = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshTick]);

  useEffect(() => {
    const cachedCampaigns = getCached<{ items: MetaListItem[] }>(CACHE_KEYS.metaCampaigns);
    const cachedAdSets = getCached<{ items: MetaListItem[] }>(CACHE_KEYS.metaAdSets);
    const cachedAds = getCached<{ items: MetaListItem[] }>(CACHE_KEYS.metaAds);
    if (cachedCampaigns?.items != null) setMetaCampaignsApi(cachedCampaigns);
    if (cachedAdSets?.items != null) setMetaAdSetsApi(cachedAdSets);
    if (cachedAds?.items != null) setMetaAdsApi(cachedAds);
    const base = "/api/meta/insights?objective=ENGAGEMENT&status=ACTIVE";
    let isMounted = true;
    const load = async () => {
      if (!isMounted || metaLoadingRef.current || document.visibilityState === "hidden") return;
      metaLoadingRef.current = true;
      try {
        const [campaignRes, adsetRes, adRes] = await Promise.all([
          fetch(`${base}&level=campaign`, FETCH_OPTIONS),
          fetch(`${base}&level=adset`, FETCH_OPTIONS),
          fetch(`${base}&level=ad`, FETCH_OPTIONS),
        ]);
        if (campaignRes.ok) {
          const d = await campaignRes.json();
          if (isMounted && Array.isArray(d.items)) {
            const data = { items: d.items };
            setMetaCampaignsApi(data);
            setCached(CACHE_KEYS.metaCampaigns, data);
          }
        }
        if (adsetRes.ok) {
          const d = await adsetRes.json();
          if (isMounted && Array.isArray(d.items)) {
            const data = { items: d.items };
            setMetaAdSetsApi(data);
            setCached(CACHE_KEYS.metaAdSets, data);
          }
        }
        if (adRes.ok) {
          const d = await adRes.json();
          if (isMounted && Array.isArray(d.items)) {
            const data = { items: d.items };
            setMetaAdsApi(data);
            setCached(CACHE_KEYS.metaAds, data);
          }
        }
      } catch {
        // ignore
      } finally {
        metaLoadingRef.current = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isMounted = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshTick]);

  useEffect(() => {
    const todayStr = (() => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    })();
    const base = `/api/meta/insights?objective=ENGAGEMENT&status=ACTIVE&date_from=${todayStr}&date_to=${todayStr}`;
    let isMounted = true;
    const loadToday = async () => {
      if (!isMounted || document.visibilityState === "hidden") return;
      try {
        const [campaignRes, adsetRes, adRes] = await Promise.all([
          fetch(`${base}&level=campaign`, FETCH_OPTIONS),
          fetch(`${base}&level=adset`, FETCH_OPTIONS),
          fetch(`${base}&level=ad`, FETCH_OPTIONS),
        ]);
        if (campaignRes.ok) {
          const d = await campaignRes.json();
          if (isMounted && Array.isArray(d.items)) setMetaCampaignsToday({ items: d.items });
        }
        if (adsetRes.ok) {
          const d = await adsetRes.json();
          if (isMounted && Array.isArray(d.items)) setMetaAdSetsToday({ items: d.items });
        }
        if (adRes.ok) {
          const d = await adRes.json();
          if (isMounted && Array.isArray(d.items)) setMetaAdsToday({ items: d.items });
        }
      } catch {
        // ignore
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadToday();
    };
    loadToday();
    const id = setInterval(loadToday, REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isMounted = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshTick]);

  useEffect(() => {
    const cached = getCached<{ items: LeadMessageRow[]; total_conversations?: number }>(CACHE_KEYS.leadsToday);
    if (cached?.items != null) {
      setLeadsToday(cached.items);
      if (typeof cached.total_conversations === "number") {
        setLeadsTodayTotal(cached.total_conversations);
      } else {
        setLeadsTodayTotal(cached.items.length);
      }
    }
    let isMounted = true;
    const loadLeads = async () => {
      if (!isMounted || leadsLoadingRef.current || document.visibilityState === "hidden") return;
      leadsLoadingRef.current = true;
      try {
        const res = await fetch("/api/leads?platform=all", FETCH_OPTIONS);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (isMounted && Array.isArray(data.items)) {
          setLeadsToday(data.items);
          const total = typeof data.total_conversations === "number" ? data.total_conversations : data.items.length;
          setLeadsTodayTotal(total);
          setCached(CACHE_KEYS.leadsToday, { items: data.items, total_conversations: total });
        }
      } catch {
        // ignore
      } finally {
        leadsLoadingRef.current = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadLeads();
    };
    loadLeads();
    const id = setInterval(loadLeads, REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      isMounted = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshTick]);

  useEffect(() => {
    const cached = getCached<LeadMessageRow[]>(CACHE_KEYS.leadsForUtm);
    if (Array.isArray(cached)) setLeadsForUtm(cached);
    let isMounted = true;
    const loadLeadsForUtm = async () => {
      if (!isMounted || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/leads?platform=all&date=all", FETCH_OPTIONS);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (isMounted && Array.isArray(data.items)) {
          setLeadsForUtm(data.items);
          setCached(CACHE_KEYS.leadsForUtm, data.items);
        }
      } catch {
        // ignore
      }
    };
    loadLeadsForUtm();
    const id = setInterval(loadLeadsForUtm, REFRESH_MS);
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, [refreshTick]);

  const openTermModal = useCallback((row: UtmTermRow) => setUtmTermModal(row), []);
  const closeTermModal = useCallback(() => setUtmTermModal(null), []);
  const openCampaignModal = useCallback((row: UtmCampaignRow) => setUtmCampaignModal(row), []);
  const closeCampaignModal = useCallback(() => setUtmCampaignModal(null), []);
  const openContentModal = useCallback((row: UtmContentRow) => setUtmContentModal(row), []);
  const closeContentModal = useCallback(() => setUtmContentModal(null), []);

  const leadsFilteredByCriativo = utmTermModal && leadsForUtm
    ? leadsForUtm.filter((l) => ((l.criativo ?? "").toString().trim() || "--") === utmTermModal.utmTerm)
    : [];
  const leadsFilteredByCampanha = utmCampaignModal && leadsForUtm
    ? leadsForUtm.filter((l) => ((l.campanha ?? "").toString().trim() || "--") === utmCampaignModal.utmCampaign)
    : [];
  const leadsFilteredByConjunto = utmContentModal && leadsForUtm
    ? leadsForUtm.filter((l) => ((l.conjunto ?? "").toString().trim() || "--") === utmContentModal.utmContent)
    : [];
  const openLeadsModal = useCallback(() => setLeadsModalOpen(true), []);
  const closeLeadsModal = useCallback(() => setLeadsModalOpen(false), []);

  const openLeadsTotalModal = useCallback(async () => {
    setLeadsTotalModalOpen(true);
    setLeadsTotalLoading(true);
    try {
      const res = await fetch("/api/leads?platform=all&date=all", FETCH_OPTIONS);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setLeadsTotal(data.items);
      else setLeadsTotal([]);
    } catch {
      setLeadsTotal([]);
    } finally {
      setLeadsTotalLoading(false);
    }
  }, []);
  const closeLeadsTotalModal = useCallback(() => setLeadsTotalModalOpen(false), []);

  function aggregateByField(
    leads: LeadMessageRow[] | null,
    field: "campanha" | "conjunto" | "criativo"
  ): { name: string; quantidade: number }[] {
    if (!leads?.length) return [];
    const key = field === "campanha" ? "campanha" : field === "conjunto" ? "conjunto" : "criativo";
    const map = new Map<string, number>();
    for (const lead of leads) {
      const value = (lead[key] ?? "").toString().trim() || "--";
      map.set(value, (map.get(value) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, quantidade]) => ({ name, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade);
  }

  const termAggregated = aggregateByField(leadsForUtm, "criativo");
  const termSectionRows: UtmTermRow[] = termAggregated.map((r) => ({ utmTerm: r.name, quantidade: r.quantidade }));
  const campaignAggregated = aggregateByField(leadsForUtm, "campanha");
  const campaignSectionRowsFromLeads: UtmCampaignRow[] = campaignAggregated.map((r) => ({ utmCampaign: r.name, quantidade: r.quantidade }));
  // Prefer API (facebook_ads) so todas as campanhas do banco aparecem; fallback para agregação por leads
  const campaignSectionRows: UtmCampaignRow[] =
    metaCampaignsApi?.items?.length
      ? metaCampaignsApi.items.map((i) => ({ utmCampaign: i.name, quantidade: i.quantidade }))
      : campaignSectionRowsFromLeads;
  const contentAggregated = aggregateByField(leadsForUtm, "conjunto");
  const contentSectionRows: UtmContentRow[] = contentAggregated.map((r) => ({ utmContent: r.name, quantidade: r.quantidade }));

  const termPieData = termSectionRows.map((r, i) => ({
    name: r.utmTerm.length > 25 ? r.utmTerm.slice(0, 22) + "…" : r.utmTerm,
    fullName: r.utmTerm,
    value: r.quantidade,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const campaignPieDataForSection = campaignSectionRows.map((r, i) => ({
    name: r.utmCampaign.length > 25 ? r.utmCampaign.slice(0, 22) + "…" : r.utmCampaign,
    fullName: r.utmCampaign,
    value: r.quantidade,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const contentPieData = contentSectionRows.map((r, i) => ({
    name: r.utmContent.length > 25 ? r.utmContent.slice(0, 22) + "…" : r.utmContent,
    fullName: r.utmContent,
    value: r.quantidade,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const t = metricsApi?.today ?? { spend: 0, leads: 0, opportunities: 0, sales_count: 0, revenue: 0, cost_per_result: 0, impressions: 0, inline_link_clicks: 0, actions: 0 };
  const tot = metricsApi?.total ?? { spend: 0, leads: 0, opportunities: 0, sales_count: 0, revenue: 0, cost_per_result: 0, impressions: 0, inline_link_clicks: 0, actions: 0 };
  const leadsTodayCount =
    typeof leadsTodayTotal === "number"
      ? leadsTodayTotal
      : leadsToday
      ? leadsToday.length
      : 0;
  const todayCards: MetricCardProps[] = [
    {
      title: "Leads Hoje",
      value: String(leadsTodayCount),
      subtitle: "",
      onClick: openLeadsModal,
    },
    { title: "Investido Hoje", value: fmtMoney(t.spend), subtitle: "" },
    {
      title: "CPL Hoje",
      value: typeof t.cost_per_result === "number" && t.cost_per_result > 0 ? fmtMoney(t.cost_per_result) : t.leads ? fmtMoney(t.spend / t.leads) : "R$ 0,00",
      subtitle: "",
    },
  ];
  const currentLeadsForGoals = tot.leads;

  const todayStr = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  })();

  const getGeneralPeriodRange = (p: GeneralPeriod): { start: string; end: string } | null => {
    if (p == null) return null;
    const today = new Date(`${todayStr}T12:00:00-03:00`);
    const oneDay = 24 * 60 * 60 * 1000;
    const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    if (p === "este_mes") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(start), end: todayStr };
    }
    if (p === "14dias") {
      const start = new Date(today.getTime() - 13 * oneDay);
      return { start: fmt(start), end: todayStr };
    }
    if (p === "7dias") {
      const start = new Date(today.getTime() - 6 * oneDay);
      return { start: fmt(start), end: todayStr };
    }
    const start = new Date(today.getTime() - 2 * oneDay);
    return { start: fmt(start), end: todayStr };
  };

  const periodRange = getGeneralPeriodRange(generalPeriod);
  const dailyInPeriod = periodRange
    ? dailyMetrics.filter((d) => {
        const date = d.date.slice(0, 10);
        return date >= periodRange.start && date <= periodRange.end;
      })
    : dailyMetrics;

  const dailyWithCpl = dailyInPeriod.filter((d) => d.leads > 0 && d.cpl != null);
  const bestDay = dailyWithCpl.length > 0 ? dailyWithCpl.reduce((a, b) => (a.cpl! <= b.cpl! ? a : b)) : null;
  const worstDay = dailyWithCpl.length > 0 ? dailyWithCpl.reduce((a, b) => (a.cpl! >= b.cpl! ? a : b)) : null;
  const maxSpendDay = dailyInPeriod.length > 0 ? dailyInPeriod.reduce((a, b) => (a.spend >= b.spend ? a : b)) : null;

  const periodAgg =
    periodRange && dailyInPeriod.length > 0
      ? dailyInPeriod.reduce(
          (acc, d) => ({ spend: acc.spend + d.spend, leads: acc.leads + d.leads }),
          { spend: 0, leads: 0 }
        )
      : null;
  const totForDisplay = periodAgg
    ? {
        leads: periodAgg.leads,
        spend: periodAgg.spend,
        cost_per_result: periodAgg.leads > 0 ? periodAgg.spend / periodAgg.leads : 0,
      }
    : tot;

  const totalCards: MetricCardProps[] = [
    { title: "Leads totais", value: String(totForDisplay.leads), subtitle: "", onClick: openLeadsTotalModal },
    { title: "Investimento total", value: fmtMoney(totForDisplay.spend), subtitle: "" },
    {
      title: "CPL Geral",
      value: totForDisplay.leads > 0 ? fmtMoney(totForDisplay.cost_per_result ?? 0) : "R$ 0,00",
      subtitle: "",
    },
  ];

  const updateGoal = useCallback((id: string, updates: Partial<Pick<GoalCard, "title" | "target">>) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  }, []);
  const addGoal = useCallback(() => {
    setGoals((prev) => [
      ...prev,
      { id: String(Date.now()), title: "Nova meta", target: 100 },
    ]);
  }, []);
  const removeGoal = useCallback((id: string) => {
    setGoals((prev) => (prev.length <= 1 ? prev : prev.filter((g) => g.id !== id)));
  }, []);

  const campaignSectionTitle = "Campanhas";
  const campaignSectionSubtitle = "";

  return (
    <div className="flex min-h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl justify-center px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-medium sm:gap-2 sm:text-sm">
            <button className="rounded-full bg-white px-3 py-1.5 text-slate-900 shadow-sm sm:px-4 sm:py-2">
              Meta Ads
            </button>
            <button className="rounded-full px-3 py-1.5 text-slate-500 hover:text-slate-900 sm:px-4 sm:py-2">
              Google Ads
            </button>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8 lg:gap-10">
        <section className="space-y-4">
          <SectionHeader title="Métricas de hoje" subtitle="" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {todayCards.map((card) => (
              <MetricCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader title="Métricas gerais" subtitle="" />
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="flex w-max shrink-0 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 sm:w-auto">
              {(
                [
                  { value: "este_mes" as const, label: "Este Mês" },
                  { value: "14dias" as const, label: "Últimos 14 dias" },
                  { value: "7dias" as const, label: "Últimos 7 dias" },
                  { value: "3dias" as const, label: "Últimos 3 dias" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGeneralPeriod((p) => (p === value ? null : value))}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:py-2 sm:text-sm ${
                    generalPeriod === value
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-transparent text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
            <DayMetricCard
              title="Melhor Dia"
              badge="↓ CPL mais baixo"
              badgeClassName="bg-slate-900 text-white"
              day={bestDay}
              order={["cpl", "spend", "leads"]}
            />
            <DayMetricCard
              title="Pior Dia"
              badge="↑ CPL mais alto"
              badgeClassName="bg-red-600 text-white"
              day={worstDay}
              order={["cpl", "spend", "leads"]}
            />
            <DayMetricCard
              title="Maior Investimento"
              badge="$ Mais gasto"
              badgeClassName="bg-slate-500 text-white"
              day={maxSpendDay}
              order={["spend", "cpl", "leads"]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {totalCards.map((card) => (
              <MetricCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title="Metas e progresso" subtitle="" />
          <div className="grid gap-4 md:grid-cols-3">
            {goals.map((goal) => (
              <ProgressCard
                key={goal.id}
                id={goal.id}
                title={goal.title}
                target={goal.target}
                current={currentLeadsForGoals}
                onUpdate={updateGoal}
                onRemove={removeGoal}
                canRemove={goals.length > 1}
              />
            ))}
            <button
              type="button"
              onClick={addGoal}
              className="flex min-h-[140px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 transition-colors active:scale-[0.98] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 sm:min-h-[180px]"
            >
              <span className="text-2xl">+</span>
              <span className="mt-1 text-sm font-medium">Adicionar meta</span>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title="Criativos" subtitle="" />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-end lg:gap-10">
              <div className="flex shrink-0 items-center justify-center overflow-visible pt-2 lg:pt-0 lg:pl-[260px]">
                <div className="relative flex h-48 w-48 cursor-pointer items-center justify-center overflow-visible sm:h-64 sm:w-64 lg:h-72 lg:w-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
                      <Pie
                        data={termPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius="92%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="white"
                      strokeWidth={1}
                      activeShape={pieActiveShape}
                      onClick={(_data, index) => {
                        const row = termSectionRows[index];
                        if (row) openTermModal(row);
                      }}
                    >
                      {termPieData.map((entry, i) => (
                        <Cell key={`term-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                      <Tooltip
                        content={<PieChartTooltip />}
                        wrapperStyle={PIE_TOOLTIP_WRAPPER_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ScrollArea className="h-[260px] min-w-0 flex-1 sm:h-[320px] lg:ml-14 lg:h-[360px] lg:max-w-2xl">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[200px] table-fixed text-left text-sm text-slate-600">
                  <colgroup>
                    <col className="w-full" />
                    <col className="w-24 sm:w-28" />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-3 pr-4 pl-0 text-left">CRIATIVO</th>
                      <th className="whitespace-nowrap py-3 pl-2 pr-5 text-right">QUANTIDADE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termSectionRows.map((row, i) => (
                      <tr
                        key={`${row.utmTerm}-${i}`}
                        onClick={() => openTermModal(row)}
                        className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
                      >
                        <td className="max-w-0 truncate py-3 pr-4 pl-0 font-medium text-slate-900" title={row.utmTerm}>
                          {row.utmTerm}
                        </td>
                        <td className="whitespace-nowrap py-3 pl-2 pr-5 text-right font-semibold text-slate-800">
                          {row.quantidade}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </ScrollArea>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={campaignSectionTitle} subtitle={campaignSectionSubtitle} />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-end lg:gap-10">
              <div className="flex shrink-0 items-center justify-center overflow-visible pt-2 lg:pt-0 lg:pl-[260px]">
                <div className="relative flex h-48 w-48 cursor-pointer items-center justify-center overflow-visible sm:h-64 sm:w-64 lg:h-72 lg:w-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
                      <Pie
                        data={campaignPieDataForSection}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius="92%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="white"
                      strokeWidth={1}
                      activeShape={pieActiveShape}
                      onClick={(_data, index) => {
                        const row = campaignSectionRows[index];
                        if (row) openCampaignModal(row);
                      }}
                    >
                      {campaignPieDataForSection.map((entry, i) => (
                        <Cell key={`campaign-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                      <Tooltip
                        content={<PieChartTooltip />}
                        wrapperStyle={PIE_TOOLTIP_WRAPPER_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ScrollArea className="h-[260px] min-w-0 flex-1 sm:h-[320px] lg:ml-14 lg:h-[360px] lg:max-w-2xl">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[200px] table-fixed text-left text-sm text-slate-600">
                  <colgroup>
                    <col className="w-full" />
                    <col className="w-24 sm:w-28" />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-3 pr-4 pl-0 text-left">CAMPANHAS</th>
                      <th className="whitespace-nowrap py-3 pl-2 pr-5 text-right">QUANTIDADE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignSectionRows.map((row, i) => (
                      <tr
                        key={`${row.utmCampaign}-${i}`}
                        onClick={() => openCampaignModal(row)}
                        className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
                      >
                        <td className="max-w-0 truncate py-3 pr-4 pl-0 font-medium text-slate-900" title={row.utmCampaign}>
                          {row.utmCampaign}
                        </td>
                        <td className="whitespace-nowrap py-3 pl-2 pr-5 text-right font-semibold text-slate-800">
                          {row.quantidade}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </ScrollArea>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title="Conjuntos" subtitle="" />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-end lg:gap-10">
              <div className="flex shrink-0 items-center justify-center overflow-visible pt-2 lg:pt-0 lg:pl-[260px]">
                <div className="relative flex h-48 w-48 cursor-pointer items-center justify-center overflow-visible sm:h-64 sm:w-64 lg:h-72 lg:w-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
                      <Pie
                        data={contentPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius="92%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="white"
                      strokeWidth={1}
                      activeShape={pieActiveShape}
                      onClick={(_data, index) => {
                        const row = contentSectionRows[index];
                        if (row) openContentModal(row);
                      }}
                    >
                      {contentPieData.map((entry, i) => (
                        <Cell key={`content-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                      <Tooltip
                        content={<PieChartTooltip />}
                        wrapperStyle={PIE_TOOLTIP_WRAPPER_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ScrollArea className="h-[260px] min-w-0 flex-1 sm:h-[320px] lg:ml-14 lg:h-[360px] lg:max-w-2xl">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[200px] table-fixed text-left text-sm text-slate-600">
                  <colgroup>
                    <col className="w-full" />
                    <col className="w-24 sm:w-28" />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-3 pr-4 pl-0 text-left">CONJUNTO</th>
                      <th className="whitespace-nowrap py-3 pl-2 pr-5 text-right">QUANTIDADE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contentSectionRows.map((row, i) => (
                      <tr
                        key={`content-${i}`}
                        onClick={() => openContentModal(row)}
                        className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
                      >
                        <td className="max-w-0 truncate py-3 pr-4 pl-0 font-medium text-slate-900" title={row.utmContent}>
                          {row.utmContent}
                        </td>
                        <td className="whitespace-nowrap py-3 pl-2 pr-5 text-right font-semibold text-slate-800">
                          {row.quantidade}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </ScrollArea>
            </div>
          </div>
        </section>

        </main>
      </ScrollArea>

      {utmTermModal && (() => {
        const item = metaAdsApi?.items?.find((i) => (i.name ?? "").trim() === (utmTermModal.utmTerm ?? "").trim());
        const metrics: ModalMetrics | undefined = item ? { spend: item.spend, impressions: item.impressions ?? 0, clicks: item.clicks ?? 0 } : undefined;
        return (
          <LeadsModal
            title="Detalhes"
            selectedLabel="Criativo:"
            selectedValue={utmTermModal.utmTerm}
            leads={leadsFilteredByCriativo}
            onClose={closeTermModal}
            modalMetrics={metrics}
            metricsLevel="ad"
          />
        );
      })()}

      {utmCampaignModal && (() => {
        const item = metaCampaignsApi?.items?.find((i) => (i.name ?? "").trim() === (utmCampaignModal.utmCampaign ?? "").trim());
        const metrics: ModalMetrics | undefined = item ? { spend: item.spend, impressions: item.impressions ?? 0, clicks: item.clicks ?? 0 } : undefined;
        return (
          <LeadsModal
            title="Detalhes"
            selectedLabel="Campanha:"
            selectedValue={utmCampaignModal.utmCampaign}
            leads={leadsFilteredByCampanha}
            onClose={closeCampaignModal}
            modalMetrics={metrics}
            metricsLevel="campaign"
          />
        );
      })()}

      {utmContentModal && (() => {
        const item = metaAdSetsApi?.items?.find((i) => (i.name ?? "").trim() === (utmContentModal.utmContent ?? "").trim());
        const metrics: ModalMetrics | undefined = item ? { spend: item.spend, impressions: item.impressions ?? 0, clicks: item.clicks ?? 0 } : undefined;
        return (
          <LeadsModal
            title="Detalhes"
            selectedLabel="Conjunto:"
            selectedValue={utmContentModal.utmContent}
            leads={leadsFilteredByConjunto}
            onClose={closeContentModal}
            modalMetrics={metrics}
            metricsLevel="adset"
          />
        );
      })()}

      {leadsModalOpen && (
        <LeadsModal
          title="Leads de hoje"
          leads={leadsToday ?? []}
          onClose={closeLeadsModal}
          champions={{
            criativo: championFromItems(metaAdsToday?.items ?? []),
            campanha: championFromItems(metaCampaignsToday?.items ?? []),
            conjunto: championFromItems(metaAdSetsToday?.items ?? []),
          }}
        />
      )}

      {leadsTotalModalOpen && (
        <LeadsModal
          title="Leads totais"
          leads={leadsTotalLoading ? [] : (leadsTotal ?? [])}
          onClose={closeLeadsTotalModal}
          loading={leadsTotalLoading}
          champions={{
            criativo: championFromItems(metaAdsApi?.items ?? []),
            campanha: championFromItems(metaCampaignsApi?.items ?? []),
            conjunto: championFromItems(metaAdSetsApi?.items ?? []),
          }}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h2>
      {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function MetricCard({ title, value, subtitle, onClick }: MetricCardProps) {
  const isClickable = typeof onClick === "function";
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${
        isClickable ? "cursor-pointer transition hover:border-slate-300 hover:shadow-md active:scale-[0.98]" : ""
      }`}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (!isClickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div>
        <p className="text-xs font-semibold text-slate-900">{title}</p>
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-900 sm:mt-3 sm:text-2xl">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

type DayMetricRow = { date: string; spend: number; leads: number; cpl: number | null };
type DayMetricCardProps = {
  title: string;
  badge: string;
  badgeClassName: string;
  day: DayMetricRow | null;
  order: ("cpl" | "spend" | "leads")[];
};

function DayMetricCard({ title, badge, badgeClassName, day, order }: DayMetricCardProps) {
  const labels: Record<"cpl" | "spend" | "leads", string> = {
    cpl: "CPL",
    spend: "Investido",
    leads: "Leads",
  };
  const values = day
    ? {
        cpl: day.cpl != null ? fmtMoney(day.cpl) : "—",
        spend: fmtMoney(day.spend),
        leads: String(day.leads),
      }
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-800 sm:text-sm">{title}</p>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClassName}`}>{badge}</span>
      </div>
      <p className="mt-2 text-lg font-bold text-slate-900 sm:mt-3 sm:text-xl">
        {day ? fmtDateShort(day.date) : "—"}
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        {order.map((key) => (
          <div key={key}>
            <p className="text-xs text-slate-500">{labels[key]}</p>
            <p className="font-semibold text-slate-800">{values ? values[key] : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type ModalMetrics = { spend: number; impressions: number; clicks: number };

type MetricsLevel = "campaign" | "adset" | "ad";

type Champions = { criativo: string; campanha: string; conjunto: string };

type LeadsModalProps = {
  title: string;
  leads: LeadMessageRow[];
  onClose: () => void;
  loading?: boolean;
  /** Rótulo ex.: "Criativo:" - exibido acima do valor na caixa cinza */
  selectedLabel?: string;
  /** Valor exibido na caixa cinza (ex.: nome do criativo/campanha/conjunto) */
  selectedValue?: string;
  /** Métricas reais (Gastos, CPM, CTR, CPC) exibidas abaixo do nome */
  modalMetrics?: ModalMetrics;
  /** Nível para buscar métricas por período (campaign=Campanha, adset=Conjunto, ad=Criativo) */
  metricsLevel?: MetricsLevel;
  /** Campeões (menor CPL e mais leads) para exibir no modal Leads totais */
  champions?: Champions;
};

/**
 * Normaliza timestamp do banco de dados para Date, tratando valores sem timezone como BRT (-03:00).
 * PostgreSQL 'timestamp without time zone' retorna valores como "2026-02-11 09:22:00" ou "2026-02-11T09:22:00.123456".
 */
function parseDbTimestamp(value: string): Date {
  let toParse = value.trim();
  // Se não tem timezone (Z ou +/-HH:MM), assume que é horário de São Paulo (BRT = UTC-3)
  if (!/Z|[+-]\d{2}:?\d{2}$/.test(toParse)) {
    // Remove microssegundos se presentes (ex: .123456)
    toParse = toParse.replace(/\.\d+$/, "");
    // Garante formato ISO com T separador
    toParse = toParse.replace(" ", "T");
    // Adiciona offset de São Paulo
    toParse += "-03:00";
  }
  return new Date(toParse);
}

/** Formata data/hora em horário de São Paulo. Se o valor não tem timezone, trata como BRT (-03:00). */
function fmtDateTime(value: string): string {
  const d = parseDbTimestamp(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function leadDisplayName(lead: LeadMessageRow): string {
  const n = (lead.nome ?? "").trim();
  const s = (lead.sobrenome ?? "").trim();
  return [n, s].filter(Boolean).join(" ") || "--";
}

/** Retorna o item com menor CPL (spend/leads) e, em empate, mais leads. */
function championFromItems(items: MetaListItem[]): string {
  const withLeads = (items ?? []).filter((i) => (i.quantidade ?? 0) > 0);
  if (withLeads.length === 0) return "N/A";
  const sorted = [...withLeads].sort((a, b) => {
    const cplA = a.spend / (a.quantidade || 1);
    const cplB = b.spend / (b.quantidade || 1);
    if (cplA !== cplB) return cplA - cplB;
    return (b.quantidade ?? 0) - (a.quantidade ?? 0);
  });
  const name = sorted[0]?.name?.trim();
  return name || "N/A";
}

type ModalPeriod = "maximo" | "hoje" | "ontem" | "3dias" | "7dias";

function todayBrazil(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function leadDateInBrazil(dataCriacao: string): string {
  try {
    const d = parseDbTimestamp(dataCriacao);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  } catch {
    return dataCriacao.slice(0, 10);
  }
}

function filterLeadsByPeriod(leads: LeadMessageRow[], period: ModalPeriod): LeadMessageRow[] {
  if (period === "maximo") return leads;
  const today = todayBrazil();
  const todayDate = new Date(`${today}T12:00:00-03:00`);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterdayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(todayDate.getTime() - oneDayMs));
  const limitDate =
    period === "3dias"
      ? new Date(todayDate.getTime() - 2 * oneDayMs)
      : new Date(todayDate.getTime() - 6 * oneDayMs); // 7dias

  return leads.filter((lead) => {
    const leadDateStr = leadDateInBrazil(lead.data_criacao);
    if (!leadDateStr) return false;
    if (period === "hoje") return leadDateStr === today;
    if (period === "ontem") return leadDateStr === yesterdayStr;
    const leadDate = new Date(`${leadDateStr}T12:00:00-03:00`);
    return leadDate.getTime() >= limitDate.getTime() && leadDate.getTime() <= todayDate.getTime() + oneDayMs;
  });
}

function periodToDateRange(period: ModalPeriod): { date_from: string; date_to: string } | null {
  if (period === "maximo") return null;
  const today = todayBrazil();
  const todayDate = new Date(`${today}T12:00:00-03:00`);
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (period === "hoje") return { date_from: today, date_to: today };
  if (period === "ontem") {
    const d = new Date(todayDate.getTime() - oneDayMs);
    const y = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    return { date_from: y, date_to: y };
  }
  const fromDate = period === "3dias" ? new Date(todayDate.getTime() - 2 * oneDayMs) : new Date(todayDate.getTime() - 6 * oneDayMs);
  const fromStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(fromDate);
  return { date_from: fromStr, date_to: today };
}

function LeadsModal({ title, leads, onClose, loading = false, selectedLabel, selectedValue, modalMetrics, metricsLevel, champions }: LeadsModalProps) {
  const [period, setPeriod] = useState<ModalPeriod>("maximo");
  const [periodMetrics, setPeriodMetrics] = useState<ModalMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    setPeriod("maximo");
    setPeriodMetrics(null);
  }, [selectedValue]);

  useEffect(() => {
    if (period === "maximo" || !metricsLevel || !selectedValue?.trim()) {
      setPeriodMetrics(null);
      return;
    }
    const range = periodToDateRange(period);
    if (!range) return;
    let cancelled = false;
    setMetricsLoading(true);
    const params = new URLSearchParams({
      level: metricsLevel,
      date_from: range.date_from,
      date_to: range.date_to,
      objective: "ENGAGEMENT",
      status: "ACTIVE",
    });
    fetch(`/api/meta/insights?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { items?: { name?: string; spend?: number; impressions?: number; clicks?: number }[] }) => {
        if (cancelled) return;
        const items = Array.isArray(d?.items) ? d.items : [];
        const item = items.find((i) => (i.name ?? "").trim() === selectedValue.trim());
        setPeriodMetrics({
          spend: item ? Number(item.spend) || 0 : 0,
          impressions: item ? Number(item.impressions) || 0 : 0,
          clicks: item ? Number(item.clicks) || 0 : 0,
        });
      })
      .catch(() => {
        if (!cancelled) setPeriodMetrics({ spend: 0, impressions: 0, clicks: 0 });
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, metricsLevel, selectedValue]);

  const filteredLeads = selectedLabel != null ? filterLeadsByPeriod(leads, period) : leads;

  const effectiveMetrics = period === "maximo" ? modalMetrics : periodMetrics ?? modalMetrics;
  const spend = effectiveMetrics?.spend ?? 0;
  const impressions = effectiveMetrics?.impressions ?? 0;
  const clicks = effectiveMetrics?.clicks ?? 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpc = clicks > 0 ? spend / clicks : null;

  const periodButtons: { value: ModalPeriod; label: string }[] = [
    { value: "maximo", label: "Máximo" },
    { value: "hoje", label: "Hoje" },
    { value: "ontem", label: "Ontem" },
    { value: "3dias", label: "Últimos 3 dias" },
    { value: "7dias", label: "Últimos 7 dias" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[95dvh] w-full max-w-[1400px] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:h-[90vh] sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        {(selectedLabel != null && selectedValue != null) && (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="text-xs font-medium uppercase text-slate-500">{selectedLabel} </span>
                <span className="text-sm font-medium text-slate-900">{selectedValue}</span>
              </span>
              <span className="shrink-0 border-l border-slate-200 pl-3 text-right">
                <span className="text-xs font-medium uppercase text-slate-500">Total de Leads: </span>
                <span className="text-sm font-semibold text-slate-900">{filteredLeads.length}</span>
              </span>
            </div>
            <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {periodButtons.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPeriod(value)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:py-2 sm:text-sm ${
                    period === value
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {(modalMetrics != null || periodMetrics != null || metricsLevel != null) && (
              <div className="mt-3 flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                {metricsLoading ? (
                  <span className="text-slate-500">Carregando métricas…</span>
                ) : (
                  <>
                    <span className="text-slate-500">
                      Gastos (Ads): <span className="font-semibold text-slate-900">{fmtMoney(spend)}</span>
                    </span>
                    <span className="text-slate-500">
                      CPM: <span className="font-semibold text-slate-900">{cpm != null ? fmtMoney(cpm) : "—"}</span>
                    </span>
                    <span className="text-slate-500">
                      CTR: <span className="font-semibold text-slate-900">{ctr != null ? `${ctr.toFixed(6)}%` : "—"}</span>
                    </span>
                    <span className="text-slate-500">
                      CPC: <span className="font-semibold text-slate-900">{cpc != null ? fmtMoney(cpc) : "—"}</span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="p-4 sm:p-6">
            {champions != null && (
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-600">Criativo Campeão:</p>
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-center font-semibold text-emerald-800">
                    {champions.criativo}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-600">Campanha Campeã:</p>
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-center font-semibold text-emerald-800">
                    {champions.campanha}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-600">Conjunto Campeão:</p>
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-center font-semibold text-emerald-800">
                    {champions.conjunto}
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-xl border border-slate-200">
            <table className="w-full min-w-[800px] text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3">NOME</th>
                  <th className="whitespace-nowrap px-4 py-3">DATA E HORA</th>
                  <th className="whitespace-nowrap px-4 py-3">MENSAGEM</th>
                  <th className="whitespace-nowrap px-4 py-3">CTA</th>
                  <th className="whitespace-nowrap px-4 py-3">CAMPANHA</th>
                  <th className="whitespace-nowrap px-4 py-3">CONJUNTO</th>
                  <th className="whitespace-nowrap px-4 py-3">CRIATIVO</th>
                  <th className="whitespace-nowrap px-4 py-3">SOURCE URL</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={8}>
                      Carregando…
                    </td>
                  </tr>
                ) : (
                filteredLeads.map((lead, i) => (
                  <tr key={`${lead.data_criacao}-${i}`} className="border-t border-slate-100 align-top">
                    <td className="max-w-[180px] break-words px-4 py-3 font-medium text-slate-900" title={leadDisplayName(lead)}>
                      {leadDisplayName(lead)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtDateTime(lead.data_criacao)}</td>
                    <td className="max-w-[320px] whitespace-pre-wrap break-words px-4 py-3 text-slate-800" title={lead.mensagem ?? ""}>
                      {lead.mensagem?.trim() ?? "--"}
                    </td>
                    <td className="max-w-[200px] break-words px-4 py-3 text-slate-700" title={lead.cta ?? ""}>
                      {lead.cta || "--"}
                    </td>
                    <td className="max-w-[240px] break-words px-4 py-3 text-slate-700" title={lead.campanha ?? ""}>
                      {lead.campanha || "--"}
                    </td>
                    <td className="max-w-[240px] break-words px-4 py-3 text-slate-700" title={lead.conjunto ?? ""}>
                      {lead.conjunto || "--"}
                    </td>
                    <td className="max-w-[200px] break-words px-4 py-3 text-slate-700" title={lead.criativo ?? ""}>
                      {lead.criativo || "--"}
                    </td>
                    <td className="max-w-[220px] break-all px-4 py-3" title={lead.source_url ?? ""}>
                      {lead.source_url ? (
                        <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
                          {lead.source_url}
                        </a>
                      ) : (
                        "--"
                      )}
                    </td>
                  </tr>
                ))
                )}
                {!loading && !filteredLeads.length && (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={8}>
                      Nenhum lead encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

type ProgressCardProps = {
  id: string;
  title: string;
  target: number;
  current: number;
  onUpdate: (id: string, updates: Partial<Pick<GoalCard, "title" | "target">>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
};

function ProgressCard({ id, title, target, current, onUpdate, onRemove, canRemove }: ProgressCardProps) {
  const safeTarget = Math.max(1, target);
  const percentage = Math.min(100, Math.round((current / safeTarget) * 100));
  const falta = Math.max(0, safeTarget - current);
  const metaBatida = current >= safeTarget;
  const fmtNum = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <button
        type="button"
        onClick={() => onRemove(id)}
        disabled={!canRemove}
        className="absolute right-3 top-3 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Remover meta"
      >
        ×
      </button>
      <h3 className="text-base font-normal text-slate-800">
        <input
          type="text"
          value={title}
          onChange={(e) => onUpdate(id, { title: e.target.value })}
          className="w-full max-w-[80%] bg-transparent outline-none focus:ring-0"
          placeholder="Nome da meta"
          suppressHydrationWarning
        />
      </h3>
      <p className="mt-2 text-xl font-bold text-slate-900 sm:mt-3 sm:text-2xl">
        {fmtNum(current)} / {fmtNum(safeTarget)}
      </p>
      <Progress
        value={percentage}
        className="mt-4 h-3 rounded-full bg-slate-200"
        indicatorClassName="rounded-full bg-violet-500"
      />
      <p className="mt-2 text-sm font-normal text-violet-600">
        {percentage}% da meta
      </p>
      <p className="mt-2 text-sm text-slate-600">
        {metaBatida
          ? "Meta batida!"
          : `Faltam ${fmtNum(falta)} para bater a meta`}
      </p>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <label className="sr-only">Alterar meta</label>
        <input
          type="number"
          min={1}
          value={target}
          onChange={(e) => onUpdate(id, { target: Math.max(1, parseInt(e.target.value, 10) || 0) })}
          className="w-20 rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30"
          title="Alterar meta"
          suppressHydrationWarning
        />
        <span className="text-xs text-slate-400">meta</span>
      </div>
    </div>
  );
}

