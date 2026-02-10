import { NextResponse } from "next/server";
import { getAdAccountBudget } from "@/lib/meta/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const json = (data: unknown, init: ResponseInit = {}) =>
  NextResponse.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) } });

/**
 * GET /api/meta/budget
 * Returns ad account budget from Meta Marketing API (balance, amount_spent, spend_cap).
 * Uses META_ACCESS_TOKEN and META_AD_ACCOUNT_ID from .env.
 * Values are converted from cents to currency units (e.g. BRL).
 */
export async function GET() {
  const accessToken = process.env.META_ACCESS_TOKEN?.trim();
  const adAccountId = process.env.META_AD_ACCOUNT_ID?.trim();

  if (!accessToken || !adAccountId) {
    return json(
      { error: "Meta Ads credentials not configured (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID)." },
      { status: 503 }
    );
  }

  try {
    const raw = await getAdAccountBudget(adAccountId, accessToken);
    // Override opcional: META_AVAILABLE_BALANCE_OVERRIDE (ex.: 3025) quando a API não reflete o saldo real.
    const overrideStr = process.env.META_AVAILABLE_BALANCE_OVERRIDE?.trim();
    const override =
      overrideStr !== "" ? parseFloat(overrideStr.replace(",", ".")) : undefined;
    const hasOverride = typeof override === "number" && Number.isFinite(override) && override >= 0;

    const div = 100;
    const amount_spent = raw.amount_spent / div;
    const balance = raw.balance != null ? raw.balance / div : null;
    const spend_cap = raw.spend_cap != null ? raw.spend_cap / div : null;
    const fromFunding =
      raw.funding_source_amount != null ? raw.funding_source_amount / div : null;
    // Saldo disponível no Gerenciador de Anúncios = (spend_cap - amount_spent) quando há spend_cap.
    // "balance" na API é "Bill amount due" (valor a pagar), não o saldo disponível.
    const remainingFromCap =
      spend_cap != null && spend_cap > 0 ? Math.max(0, spend_cap - amount_spent) : null;
    const available = hasOverride
      ? override
      : remainingFromCap ?? fromFunding ?? balance;
    return json({
      amount_spent,
      balance,
      spend_cap,
      currency: raw.currency,
      available,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}
