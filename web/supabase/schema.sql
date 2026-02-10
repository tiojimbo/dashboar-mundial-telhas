create extension if not exists "pgcrypto";

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'unknown',
  payload jsonb not null,
  status text not null default 'received',
  error text,
  received_at timestamptz not null default now()
);

create table if not exists public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id text,
  metric_date date not null,
  platform text not null,
  spend numeric(12, 2) not null default 0,
  leads integer not null default 0,
  opportunities integer not null default 0,
  sales_count integer not null default 0,
  revenue numeric(12, 2) not null default 0,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists metric_snapshots_unique
  on public.metric_snapshots (metric_date, platform);

create index if not exists metric_snapshots_date_idx
  on public.metric_snapshots (metric_date);

create table if not exists public.utm_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  platform text not null,
  utm_campaign text not null,
  leads integer not null default 0,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists utm_metrics_unique
  on public.utm_metrics (metric_date, platform, utm_campaign);

create index if not exists utm_metrics_date_idx
  on public.utm_metrics (metric_date);

create table if not exists public.utm_term_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  platform text not null,
  utm_term text not null,
  leads integer not null default 0,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists utm_term_metrics_unique
  on public.utm_term_metrics (metric_date, platform, utm_term);

create index if not exists utm_term_metrics_date_idx
  on public.utm_term_metrics (metric_date);

create table if not exists public.conversions (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  utm_term text not null,
  utm_campaign text not null,
  utm_content text,
  utm_medium text,
  utm_source text,
  sale_date date not null,
  value numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists conversions_utm_term_idx on public.conversions (utm_term);
create index if not exists conversions_utm_campaign_idx on public.conversions (utm_campaign);
create index if not exists conversions_sale_date_idx on public.conversions (sale_date);

-- Meta Marketing API tables (data from /api/meta/sync; Kommo/UTM use ingest + utm_*)
create table if not exists public.meta_campaigns (
  id text primary key,
  account_id text not null,
  name text not null,
  status text not null default 'ACTIVE',
  objective text,
  created_time timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_ad_sets (
  id text primary key,
  campaign_id text not null,
  account_id text not null,
  name text not null,
  status text not null default 'ACTIVE',
  created_time timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_ads (
  id text primary key,
  ad_set_id text not null,
  campaign_id text not null,
  account_id text not null,
  name text not null,
  status text not null default 'ACTIVE',
  created_time timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_ads_insights (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  ad_set_id text not null default '',
  ad_id text not null default '',
  metric_date date not null,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads integer not null default 0,
  whatsapp_conversations integer not null default 0,
  conversions numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_platform_insights (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null default '',
  platform text not null,
  metric_date date not null,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_leads (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  lead_name text not null,
  message_at timestamptz not null,
  ad_creative text,
  campaign_name text,
  audience text,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_ads_insights_unique
  on public.meta_ads_insights (campaign_id, ad_set_id, ad_id, metric_date);
create index if not exists meta_ads_insights_metric_date_idx on public.meta_ads_insights (metric_date);
create index if not exists meta_ads_insights_campaign_id_idx on public.meta_ads_insights (campaign_id);
create index if not exists meta_ads_insights_ad_set_id_idx on public.meta_ads_insights (ad_set_id);
create index if not exists meta_ads_insights_ad_id_idx on public.meta_ads_insights (ad_id);

create unique index if not exists meta_platform_insights_unique
  on public.meta_platform_insights (campaign_id, platform, metric_date);
create index if not exists meta_platform_insights_metric_date_idx on public.meta_platform_insights (metric_date);

create unique index if not exists whatsapp_leads_unique
  on public.whatsapp_leads (platform, lead_name, message_at, campaign_name);
create index if not exists whatsapp_leads_message_at_idx on public.whatsapp_leads (message_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_metric_snapshots_updated_at on public.metric_snapshots;
create trigger set_metric_snapshots_updated_at
before update on public.metric_snapshots
for each row
execute function public.set_updated_at();

drop trigger if exists set_utm_metrics_updated_at on public.utm_metrics;
create trigger set_utm_metrics_updated_at
before update on public.utm_metrics
for each row
execute function public.set_updated_at();

drop trigger if exists set_utm_term_metrics_updated_at on public.utm_term_metrics;
create trigger set_utm_term_metrics_updated_at
before update on public.utm_term_metrics
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_campaigns_updated_at on public.meta_campaigns;
create trigger set_meta_campaigns_updated_at
before update on public.meta_campaigns
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_ad_sets_updated_at on public.meta_ad_sets;
create trigger set_meta_ad_sets_updated_at
before update on public.meta_ad_sets
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_ads_updated_at on public.meta_ads;
create trigger set_meta_ads_updated_at
before update on public.meta_ads
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_ads_insights_updated_at on public.meta_ads_insights;
create trigger set_meta_ads_insights_updated_at
before update on public.meta_ads_insights
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_platform_insights_updated_at on public.meta_platform_insights;
create trigger set_meta_platform_insights_updated_at
before update on public.meta_platform_insights
for each row
execute function public.set_updated_at();

drop trigger if exists set_whatsapp_leads_updated_at on public.whatsapp_leads;
create trigger set_whatsapp_leads_updated_at
before update on public.whatsapp_leads
for each row
execute function public.set_updated_at();

alter table public.metric_snapshots enable row level security;
alter table public.utm_metrics enable row level security;
alter table public.utm_term_metrics enable row level security;
alter table public.conversions enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_ad_sets enable row level security;
alter table public.meta_ads enable row level security;
alter table public.meta_ads_insights enable row level security;
alter table public.meta_platform_insights enable row level security;
alter table public.whatsapp_leads enable row level security;

create policy "Public read metrics"
  on public.metric_snapshots
  for select
  using (true);

create policy "Public read utm metrics"
  on public.utm_metrics
  for select
  using (true);

create policy "Public read utm term metrics"
  on public.utm_term_metrics
  for select
  using (true);

create policy "Public read conversions"
  on public.conversions
  for select
  using (true);

create policy "Public read meta campaigns"
  on public.meta_campaigns
  for select
  using (true);

create policy "Public read meta ad sets"
  on public.meta_ad_sets
  for select
  using (true);

create policy "Public read meta ads"
  on public.meta_ads
  for select
  using (true);

create policy "Public read meta ads insights"
  on public.meta_ads_insights
  for select
  using (true);

create policy "Public read meta platform insights"
  on public.meta_platform_insights
  for select
  using (true);

create policy "Public read whatsapp leads"
  on public.whatsapp_leads
  for select
  using (true);
