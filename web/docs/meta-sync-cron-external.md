# Sync da Meta via Cron Externo

O sync dos dados da Meta Ads é feito chamando as rotas `/api/meta/sync`. Como o plano Hobby do Vercel não permite crons frequentes, usamos um serviço externo gratuito para disparar essas chamadas.

## Opção 1: GitHub Actions (recomendado)

O workflow em `.github/workflows/meta-sync-cron.yml` roda automaticamente **a cada hora** (no minuto 5 UTC).

### Configuração

1. No repositório no GitHub: **Settings** → **Secrets and variables** → **Actions**
2. Em **Variables**, clique em **New repository variable**
3. Crie a variável:
   - **Name:** `VERCEL_APP_URL`
   - **Value:** `https://seu-app.vercel.app` (URL do seu deploy no Vercel, sem barra no final)

Exemplo: `https://dashboar-mundial-telhas-ncva.vercel.app`

### Execução manual

Em **Actions** → **Meta Ads Sync (Cron)** → **Run workflow**

---

## Opção 2: Cron-job.org

O [Cron-job.org](https://cron-job.org) é gratuito e permite agendar chamadas HTTP.

### Configuração

1. Crie uma conta em [cron-job.org](https://cron-job.org)
2. Crie 4 jobs (ou 1 job chamando as 4 URLs em sequência):

| Job | URL | Schedule (exemplo) |
|-----|-----|--------------------|
| Sync campaign | `https://SEU_APP.vercel.app/api/meta/sync?levels=campaign&days=1` | `5 * * * *` (todo hora, min 5) |
| Sync adset | `https://SEU_APP.vercel.app/api/meta/sync?levels=adset&days=1` | `10 * * * *` |
| Sync ad | `https://SEU_APP.vercel.app/api/meta/sync?levels=ad&days=1` | `15 * * * *` |
| Sync platform | `https://SEU_APP.vercel.app/api/meta/sync?levels=platform&days=1` | `20 * * * *` |

3. Configure **Request Method:** GET
4. Defina o fuso horário desejado (os exemplos acima usam UTC)

---

## Endpoints de sync

| Parâmetro | Descrição |
|-----------|-----------|
| `levels=campaign` | Sincroniza nível campanha |
| `levels=adset` | Sincroniza nível conjunto de anúncios |
| `levels=ad` | Sincroniza nível anúncio |
| `levels=platform` | Sincroniza nível plataforma |
| `days=1` | Período de dados (em dias) |
