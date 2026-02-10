This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Origem dos dados

- **Meta (anúncios, contas, relatórios):** dados vêm da **Meta Marketing API** via sync. O backend chama `POST /api/meta/sync` (com `x-ingestion-key` ou `x-meta-sync-key`), que usa `META_ACCESS_TOKEN` e opcionalmente `META_AD_ACCOUNT_ID` para buscar campanhas e insights, e grava em `meta_campaigns`, `meta_ads_insights` e `metric_snapshots` (platform=meta).
- **Kommo e outras fontes:** dados entram pelo **ingest** em `POST /api/ingest` (com `x-ingestion-key`). O payload segue o contrato com `metric_date`, `platform`, `spend`, `leads`, `utm_breakdown`, etc., e é salvo em `metric_snapshots`, `utm_metrics`, `utm_term_metrics` e `conversions`. A integração Kommo permanece usando esse fluxo.
- **Nomes de contato, campanha, conjunto e anúncios:** só chegam via **webhooks** (Meta Lead Ads, Kommo, etc.). Para enviar esses dados ao dashboard, use **n8n** recebendo o webhook, transformando o payload e chamando `POST /api/ingest`. Ver [docs/n8n-ingest-webhooks.md](docs/n8n-ingest-webhooks.md).

## Variáveis de ambiente

Configure em `.env` (e em `.env.example` para referência):

| Variável | Uso |
|----------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do Supabase (leitura pelo client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role do Supabase (backend e sync) |
| `INGESTION_API_KEY` | Chave para proteger `/api/ingest` e opcionalmente `/api/meta/sync` (header `x-ingestion-key`) |
| `META_ACCESS_TOKEN` | Token de acesso do app Meta (Marketing API) |
| `META_AD_ACCOUNT_ID` | (Opcional) ID da conta de anúncios, ex.: `639164224244830` (sem `act_`) |

## Agendar o sync da Meta

Para atualizar os dados da Meta de forma periódica, chame `POST /api/meta/sync` em um cron:

- **Vercel Cron:** o arquivo `vercel.json` já agenda o sync em partes (campaign/adset/ad/platform) em minutos diferentes. Requests disparados pelo Cron chegam com o header `x-vercel-cron: 1`, aceitos pelo endpoint sem necessidade de chave adicional.
- **GitHub Actions / outro cron:** use `curl` ou `fetch` para `POST /api/meta/sync` com o mesmo header, no intervalo desejado (ex.: diário).

Exemplo com `curl`:

```bash
curl -X POST "https://seu-dominio.vercel.app/api/meta/sync" \
  -H "x-ingestion-key: SUA_INGESTION_API_KEY"
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
