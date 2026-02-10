# Integração n8n → Dashboard (nomes de contato, campanha, conjunto e anúncios)

Os **nomes** de contato (lead), campanha, conjunto de anúncios e anúncio só chegam via **webhooks** (ex.: Meta Lead Ads, Kommo, WhatsApp Business). O dashboard não obtém esses nomes pela API de sync da Meta (que traz IDs e insights). Por isso, o fluxo recomendado é:

1. **n8n** recebe o webhook (Meta, Kommo, etc.).
2. **n8n** transforma o payload no formato esperado pelo dashboard.
3. **n8n** chama **POST /api/ingest** do dashboard com os dados enriquecidos (incluindo nomes).

---

## 1. Endpoint do dashboard

| Item | Valor |
|------|--------|
| **URL** | `https://SEU_DOMINIO/api/ingest` (ex.: `https://seu-app.vercel.app/api/ingest`) |
| **Método** | `POST` |
| **Content-Type** | `application/json` |
| **Autenticação** | Header `x-ingestion-key: SEU_INGESTION_API_KEY` (se `INGESTION_API_KEY` estiver definido no `.env`) |

---

## 2. Formato do payload (contrato do /api/ingest)

O body pode ser **um objeto** (um registro), **um array** de objetos, ou um objeto com propriedade **`records`** (array).

Cada **registro** deve ter:

| Campo | Obrigatório | Tipo | Descrição |
|-------|-------------|------|-----------|
| `metric_date` | Sim | string | Data no formato `YYYY-MM-DD` |
| `platform` | Sim | string | Ex.: `meta`, `kommo`, `whatsapp` |
| `source` | Não | string | Origem do dado (ex.: `n8n-webhook-meta`) |
| `spend` | Não | number/string | Gasto (default 0) |
| `leads` | Não | number/string | Quantidade de leads (default 0) |
| `opportunities` | Não | number/string | Oportunidades (default 0) |
| `sales_count` | Não | number/string | Vendas (default 0) |
| `revenue` | Não | number/string | Receita (default 0) |
| `utm_breakdown` | Não | array | Ver abaixo |
| `lead_messages` | Não | array | **Aqui entram os nomes** (contato, campanha, anúncio, etc.) |

### 2.1. `utm_breakdown` (opcional)

Array de objetos:

```json
{
  "utm_campaign": "nome_da_campanha_utm",
  "leads": 1
}
```

### 2.2. `lead_messages` (onde vão os nomes do webhook)

Array de objetos. **É aqui que você envia os nomes** que vêm do webhook (contato, campanha, conjunto, anúncio):

```json
{
  "lead_name": "Nome do contato/lead",
  "message_at": "2025-01-29T14:30:00Z",
  "ad_creative": "Nome do anúncio / creative",
  "campaign_name": "Nome da campanha",
  "audience": "Nome do conjunto de anúncios (ad set)"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `lead_name` | Sim | Nome do contato/lead |
| `message_at` | Sim | Data/hora da mensagem (string, ex. ISO 8601) |
| `ad_creative` | Não | Nome do anúncio / criativo |
| `campaign_name` | Não | Nome da campanha |
| `audience` | Não | Nome do conjunto de anúncios (ad set) |

Os itens de `lead_messages` são gravados na tabela **`whatsapp_leads`** do Supabase (com `platform`, `lead_name`, `message_at`, `campaign_name`, etc.).

---

## 3. O que fazer no n8n

### 3.1. Fluxo geral

1. **Webhook (n8n)**  
   - Crie um workflow com o node **Webhook**.  
   - Configure o webhook para receber POST do provedor (Meta Lead Ads, Kommo, etc.).  
   - Use a URL gerada pelo n8n como URL de callback no provedor.

2. **Transformar o payload**  
   - Use nodes **Code** ou **Set** para mapear os campos do webhook para o formato do ingest:
     - `metric_date`: hoje em `YYYY-MM-DD` ou data extraída do evento.
     - `platform`: ex. `meta`, `kommo`.
     - `source`: ex. `n8n-webhook-meta`.
     - `lead_messages`: array com um item por lead, preenchendo `lead_name`, `message_at`, `campaign_name`, `ad_creative`, `audience` conforme o que o webhook envia.

3. **Chamar o dashboard**  
   - Node **HTTP Request**:
     - **Method**: POST  
     - **URL**: `https://SEU_DOMINIO/api/ingest`  
     - **Headers**: `x-ingestion-key: SEU_INGESTION_API_KEY`  
     - **Body Content Type**: JSON  
     - **Body**: saída do passo de transformação (objeto ou `{ "records": [ ... ] }`).

### 3.2. Exemplo de payload mínimo (um lead com nomes)

Envio de um único registro com um lead e nomes de campanha/conjunto/anúncio:

```json
{
  "source": "n8n-webhook-meta",
  "metric_date": "2025-01-29",
  "platform": "meta",
  "leads": 1,
  "lead_messages": [
    {
      "lead_name": "João Silva",
      "message_at": "2025-01-29T14:30:00Z",
      "campaign_name": "Campanha Black Friday",
      "audience": "Conjunto Brasil 25-45",
      "ad_creative": "Anúncio Vídeo WhatsApp"
    }
  ]
}
```

### 3.3. Exemplo de mapeamento (Meta Lead Ads → ingest)

O webhook da Meta para Lead Ads envia um objeto com estrutura própria. No n8n, você pode usar um node **Code** para algo como (adaptar aos campos reais do seu webhook):

```javascript
// Exemplo: entrada = body do webhook Meta Lead Ads
const webhook = $input.first().json?.body ?? $input.first().json ?? {};
const now = new Date();
const metricDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

const leadName = webhook.leadgen?.field_data
  ?.find(f => f.name === 'full_name')?.values?.[0]
  ?? webhook.leadgen?.lead_id
  ?? 'Lead';

const campaignName = webhook.ad?.campaign?.name ?? null;
const adSetName = webhook.ad?.adset?.name ?? null;
const adName = webhook.ad?.name ?? null;

return [{
  json: {
    source: "n8n-webhook-meta",
    metric_date: metricDate,
    platform: "meta",
    leads: 1,
    lead_messages: [{
      lead_name: leadName,
      message_at: now.toISOString(),
      campaign_name: campaignName,
      audience: adSetName,
      ad_creative: adName,
    }],
  },
}];
```

Ajuste os caminhos (`webhook.leadgen`, `webhook.ad`, etc.) conforme a documentação atual do [Meta Lead Ads Webhooks](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving).

### 3.4. Kommo (ou outro CRM)

Se o webhook for do Kommo (novo contato/lead), mapeie:

- Nome do contato → `lead_name`
- Data do evento → `message_at`
- Se tiver campanha/conjunto/anúncio em campos customizados, use-os em `campaign_name`, `audience`, `ad_creative`.

Depois monte o mesmo formato de registro e chame **POST /api/ingest** com **x-ingestion-key**.

---

## 4. Resumo do que você precisa

| Onde | O que fazer |
|------|-------------|
| **Dashboard** | Nada além do que já existe: **POST /api/ingest** já aceita `lead_messages` com `lead_name`, `campaign_name`, `ad_creative`, `audience`. |
| **n8n** | 1) Webhook recebendo eventos do provedor (Meta, Kommo, etc.). 2) Transformar o body do webhook para o formato acima. 3) HTTP Request POST para `https://SEU_DOMINIO/api/ingest` com header `x-ingestion-key`. |
| **Provedor (Meta/Kommo)** | Configurar a URL do webhook do n8n como URL de callback e garantir que o payload inclua os nomes (campanha, ad set, ad, lead) quando disponíveis. |

Assim, os nomes de contato, campanha, conjunto e anúncios passam a ser enviados ao dashboard **via n8n**, usando o ingest já existente.
