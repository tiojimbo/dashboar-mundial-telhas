import { NextResponse } from "next/server";
import { isDbConfigured, query } from "@/lib/db/postgres";

/** Testa apenas a conexão Postgres (sem Supabase). */
export async function GET() {
  const result: {
    postgres: { ok: boolean; configured: boolean; error?: string };
  } = {
    postgres: { ok: false, configured: isDbConfigured },
  };

  if (isDbConfigured) {
    try {
      const { rows, rowCount } = await query("SELECT 1 as ping", []);
      result.postgres.ok = rowCount >= 1 && Array.isArray(rows) && rows.length > 0;
      if (!result.postgres.ok) result.postgres.error = "Unexpected result from SELECT 1";
    } catch (err) {
      result.postgres.error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json(result);
}
