/**
 * Schema fixo da tabela rastreio_whats.whatsapp_anuncio (conforme Query.txt).
 * Colunas reais: telefone, id_transacao, data_criacao, source_id, nome, sobrenome,
 * email, cidade, estado, pais, moeda, valor_venda, item_id, item_name, mensagem,
 * cta, ctwaclid, source_url, thumbnail, status, plataforma, processado.
 */

export type WhatsappAnuncioColumnMap = {
  plataforma: string;
  data_criacao: string;
  source_id: string;
  nome: string;
  sobrenome: string;
  ctwaclid: string;
  mensagem: string;
  cta: string;
  source_url: string;
};

/** Mapeamento fixo conforme o schema enviado (Query.txt). */
export const WHATSAPP_ANUNCIO_COLUMNS: WhatsappAnuncioColumnMap = {
  plataforma: "plataforma",
  data_criacao: "data_criacao",
  source_id: "source_id",
  nome: "nome",
  sobrenome: "sobrenome",
  ctwaclid: "ctwaclid",
  mensagem: "mensagem",
  cta: "cta",
  source_url: "source_url",
};

/** Identificador seguro para SQL (entre aspas duplas). */
export function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Retorna o mapa de colunas fixo (síncrono). */
export function getWhatsappAnuncioColumns(): WhatsappAnuncioColumnMap {
  return WHATSAPP_ANUNCIO_COLUMNS;
}
