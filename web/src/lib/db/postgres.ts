/**
 * PostgreSQL client for server-side use (API routes only).
 * Uses DATABASE_URL from environment (e.g. EasyPanel Postgres).
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL ?? "";
const host = process.env.DB_HOST ?? "";
const port = Number(process.env.DB_PORT ?? "5432");
const database = process.env.DB_NAME ?? "";
const user = process.env.DB_USER ?? "";
const password = process.env.DB_PASSWORD ?? "";

const hasConnectionString = Boolean(connectionString);
const hasDiscreteConfig = Boolean(host && database && user && password);

export const isDbConfigured = hasConnectionString || hasDiscreteConfig;

if (!isDbConfigured) {
  console.warn(
    "Database env vars missing. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (or DATABASE_URL)."
  );
}

const pool = new Pool(
  hasConnectionString
    ? {
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        host: host || undefined,
        port: Number.isFinite(port) ? port : 5432,
        database: database || undefined,
        user: user || undefined,
        password: password || undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

let tcpProbeDone = false;

async function probeTcpOnce() {
  if (tcpProbeDone || !host || !Number.isFinite(port)) return;
  tcpProbeDone = true;
  try {
    const net = await import("node:net");
    const socket = new net.Socket();
    const startedAt = Date.now();
    socket.setTimeout(2000);
    socket.once("connect", () => socket.destroy());
    socket.once("timeout", () => socket.destroy());
    socket.once("error", () => socket.destroy());
    socket.connect(port, host);
  } catch {
    // ignore probe errors
  }
}

/**
 * Run a parameterized query. Use only in API routes (server-side).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  probeTcpOnce();
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw err;
  }
  try {
    const result = await client.query<T>(text, values);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (err) {
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run multiple queries in a single connection (e.g. for transactions). Caller must release the client.
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export { pool };
