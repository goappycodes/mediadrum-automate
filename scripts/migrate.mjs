#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to the Supabase Postgres database.
 *
 * Connection is resolved in this order:
 *   1. SUPABASE_DB_URL                (a full postgres:// connection string)
 *   2. SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD
 *   3. derived from SUPABASE_URL + SUPABASE_DB_PASSWORD  (db.<ref>.supabase.co)
 *
 * Note: db.<ref>.supabase.co is IPv6-only on current Supabase projects. If your
 * network has no IPv6 route, grab the IPv4 pooler string from
 * Supabase -> Project Settings -> Database -> Connection string -> Session pooler
 * and set it as SUPABASE_DB_URL.
 *
 *   node scripts/migrate.mjs              # all migrations
 *   node scripts/migrate.mjs --seed-only  # just 0002_seed.sql
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

function connectionConfig() {
  if (process.env.SUPABASE_DB_URL) {
    return { connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } };
  }

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SUPABASE_DB_URL, or SUPABASE_DB_PASSWORD (plus SUPABASE_URL), in .env.local",
    );
  }

  let host = process.env.SUPABASE_DB_HOST;
  if (!host) {
    const ref = (process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (!ref) throw new Error("Could not derive the database host: set SUPABASE_DB_HOST.");
    host = `db.${ref}.supabase.co`;
  }

  // The session pooler expects the `postgres.<ref>` tenant-qualified username.
  const user = host.includes("pooler.supabase.com")
    ? `postgres.${(process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1]}`
    : "postgres";

  return {
    host,
    port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
    user,
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const seedOnly = process.argv.includes("--seed-only");
  const dir = path.join(root, "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (seedOnly ? f.includes("seed") : true))
    .sort();

  if (files.length === 0) {
    console.log("No migrations to apply.");
    return;
  }

  const client = new pg.Client(connectionConfig());
  await client.connect();
  console.log(`Connected to ${client.host ?? "database"}\n`);

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      process.stdout.write(`  ${file} ... `);
      await client.query(sql);
      console.log("ok");
    }

    const { rows } = await client.query(`
      select
        (select count(*) from sources) as sources,
        (select count(*) from authors) as authors,
        (select count(*) from authors where active) as active_authors
    `);
    console.log(
      `\nDone. ${rows[0].sources} sources, ${rows[0].authors} authors ` +
        `(${rows[0].active_authors} active).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`);
  if (error.code === "ENETUNREACH" || error.code === "ENOTFOUND") {
    console.error(
      "\nThat host is likely IPv6-only and your network has no IPv6 route.\n" +
        "Copy the Session pooler connection string from the Supabase dashboard\n" +
        "(Project Settings -> Database) into SUPABASE_DB_URL and re-run.",
    );
  }
  process.exit(1);
});
