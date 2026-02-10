# Métricas do Facebook Ads no dashboard

Os cards **Impressões**, **Cliques (link)** e **Ações** (e **Investimento** / spend) leem da tabela **`rastreio_whats.facebook_ads`**.

## Colunas necessárias

A tabela precisa ter pelo menos estas colunas (tipos sugeridos):

| Coluna               | Tipo sugerido | Descrição                          |
|----------------------|---------------|------------------------------------|
| `data`               | `date`        | Data do registro (YYYY-MM-DD)      |
| `spend`              | `numeric`     | Gasto (investimento)               |
| `impressions`        | `numeric`/`bigint` | Impressões                    |
| `inline_link_clicks` | `numeric`/`bigint` | Cliques no link (Meta)       |
| `actions`            | `numeric`/`bigint` | Ações (ex.: mensagens)        |

## Exemplo de migração (se as colunas não existirem)

Execute no PostgreSQL, ajustando o schema/tabela se for o caso:

```sql
-- Adicionar colunas de métricas em rastreio_whats.facebook_ads (se ainda não existirem)
ALTER TABLE rastreio_whats.facebook_ads
  ADD COLUMN IF NOT EXISTS spend numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inline_link_clicks numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions numeric DEFAULT 0;
```

## Conferindo no servidor

Se os cards continuarem em 0, verifique no terminal onde o Next.js está rodando: ao acessar a página, a API `/api/metrics` pode registrar avisos como `[api/metrics] facebook_ads column impressions : column "impressions" does not exist`. Isso indica que a coluna não existe ou o nome está diferente (por exemplo `impressoes` em vez de `impressions`).

## Nomes alternativos

Se na sua base as colunas tiverem outros nomes (ex.: `impressoes`, `cliques`, `acoes`), avise para ajustarmos as queries na API de métricas.
