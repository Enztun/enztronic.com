import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run back-office migrations');
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(scriptDirectory, '..', 'database', 'migrations');
const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 10,
  connect_timeout: 10,
  prepare: false,
  onnotice: () => undefined,
});

try {
  await sql`SELECT pg_advisory_lock(hashtext('enztronic-backoffice-migrations'))`;
  await sql`CREATE SCHEMA IF NOT EXISTS backoffice`;
  await sql`
    CREATE TABLE IF NOT EXISTS backoffice.schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
    .sort();

  for (const filename of filenames) {
    const source = await readFile(join(migrationDirectory, filename), 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    const [applied] = await sql`
      SELECT checksum FROM backoffice.schema_migrations WHERE filename = ${filename}
    `;

    if (applied) {
      if (applied.checksum !== checksum) {
        throw new Error(`Applied migration was modified: ${filename}`);
      }
      console.log(`skip ${filename}`);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`
        INSERT INTO backoffice.schema_migrations (filename, checksum)
        VALUES (${filename}, ${checksum})
      `;
    });
    console.log(`applied ${filename}`);
  }
} finally {
  try {
    await sql`SELECT pg_advisory_unlock(hashtext('enztronic-backoffice-migrations'))`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
