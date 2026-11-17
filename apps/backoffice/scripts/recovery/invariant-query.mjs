/**
 * Nonsecret SQL building blocks for a production backup/isolated restore check.
 * Importing this file opens no connections and executes no SQL.
 * The caller must use one REPEATABLE READ, READ ONLY transaction per snapshot.
 * These SELECTs return counts, digests, and catalog metadata, never business rows
 * or password verifiers. Store even these inventories in the protected package.
 */

export const expectedTableNames = Object.freeze([
  'audit_events', 'business_profile', 'clients', 'invoice_documents',
  'invoice_email_messages', 'invoice_items', 'invoice_number_counters',
  'invoice_payments', 'invoice_snapshots', 'invoices', 'outbox_events',
  'schema_migrations', 'users',
]);

export const deterministicSessionSql = Object.freeze([
  "SET LOCAL timezone = 'UTC'",
  "SET LOCAL datestyle = 'ISO, YMD'",
  "SET LOCAL intervalstyle = 'postgres'",
  'SET LOCAL extra_float_digits = 3',
  "SET LOCAL bytea_output = 'hex'",
  "SET LOCAL search_path = pg_catalog, public",
  // This does not bypass RLS. It raises an error rather than silently hashing
  // only the rows visible to a caller subject to a row-security policy.
  'SET LOCAL row_security = off',
  "SET LOCAL statement_timeout = '60s'",
  "SET LOCAL lock_timeout = '5s'",
]);

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid recovery identifier');
  return `"${value}"`;
}

export function tableDigestSql(tableName, schemaName = 'backoffice') {
  return `SELECT count(*)::text AS row_count,
    encode(sha256(convert_to(coalesce(string_agg(row_digest, ''
      ORDER BY row_digest COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
    FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
      AS row_digest FROM ${identifier(schemaName)}.${identifier(tableName)} AS t) AS rows`;
}

export function sequenceStateSql(sequenceName, schemaName = 'backoffice') {
  // SELECT only: nextval/setval must never be used to test sequence recovery.
  return `SELECT last_value::text AS last_value, is_called
    FROM ${identifier(schemaName)}.${identifier(sequenceName)}`;
}

export const catalogQueries = Object.freeze({
  transaction: `SELECT current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation,
    current_setting('TimeZone') AS timezone,
    current_setting('row_security') AS row_security`,

  database: `SELECT pg_get_userbyid(datdba) AS owner,
    pg_encoding_to_char(encoding) AS encoding, datcollate, datctype,
    datconnlimit, datallowconn, datistemplate
    FROM pg_database WHERE datname = current_database()`,

  extensions: `SELECT e.extname, e.extversion, n.nspname AS schema_name,
    pg_get_userbyid(e.extowner) AS owner
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY e.extname COLLATE "C"`,

  schemas: `SELECT nspname AS schema_name, pg_get_userbyid(nspowner) AS owner
    FROM pg_namespace WHERE nspname IN ('backoffice', 'public')
    ORDER BY nspname COLLATE "C"`,

  relations: `SELECT n.nspname AS schema_name, c.relname AS relation_name,
    c.relkind, c.relpersistence, pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'backoffice' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    ORDER BY c.relname COLLATE "C"`,

  tableNames: `SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND c.relkind IN ('r', 'p')
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`,

  columns: `SELECT c.relname AS table_name, a.attnum AS ordinal,
    a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull, a.attidentity, a.attgenerated,
    CASE WHEN a.attcollation = 0 THEN NULL
      ELSE quote_ident(cn.nspname) || '.' || quote_ident(co.collname) END AS collation,
    pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation
    LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
    WHERE n.nspname = 'backoffice' AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname COLLATE "C", a.attnum`,

  constraints: `SELECT c.relname AS table_name, k.conname AS constraint_name,
    k.contype, k.condeferrable, k.condeferred, k.convalidated,
    pg_get_constraintdef(k.oid, false) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'backoffice'
    ORDER BY c.relname COLLATE "C", k.conname COLLATE "C"`,

  indexes: `SELECT t.relname AS table_name, i.relname AS index_name,
    x.indisunique, x.indisprimary, x.indisvalid, x.indisready,
    pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'backoffice'
    ORDER BY t.relname COLLATE "C", i.relname COLLATE "C"`,

  triggers: `SELECT c.relname AS table_name, t.tgname AS trigger_name,
    t.tgenabled, pg_get_triggerdef(t.oid, false) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'backoffice' AND NOT t.tgisinternal
    ORDER BY c.relname COLLATE "C", t.tgname COLLATE "C"`,

  functions: `SELECT p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
    p.proleakproof, p.provolatile, p.proparallel,
    encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') AS definition_sha256
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'backoffice' AND p.prokind IN ('f', 'p')
    ORDER BY p.proname COLLATE "C", pg_get_function_identity_arguments(p.oid) COLLATE "C"`,

  policies: `SELECT c.relname AS table_name, p.polname AS policy_name,
    p.polpermissive, p.polcmd,
    ARRAY(SELECT role_name FROM (SELECT CASE WHEN r = 0 THEN 'PUBLIC'
      ELSE pg_get_userbyid(r) END AS role_name FROM unnest(p.polroles) r) policy_roles
      ORDER BY role_name COLLATE "C") AS roles,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'backoffice'
    ORDER BY c.relname COLLATE "C", p.polname COLLATE "C"`,

  sequences: `SELECT n.nspname AS schema_name, c.relname AS sequence_name,
    pg_get_userbyid(c.relowner) AS owner,
    format_type(s.seqtypid, NULL) AS data_type,
    s.seqstart::text, s.seqincrement::text, s.seqmax::text,
    s.seqmin::text, s.seqcache::text, s.seqcycle,
    tn.nspname AS owned_table_schema, t.relname AS owned_table,
    a.attname AS owned_column, d.deptype AS dependency_type
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass
      AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass
      AND d.deptype IN ('a', 'i')
    LEFT JOIN pg_class t ON t.oid = d.refobjid
    LEFT JOIN pg_namespace tn ON tn.oid = t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`,

  objectPrivileges: `WITH object_acls AS (
    SELECT 'database'::text AS object_type, '@current_database'::text AS object_name,
      coalesce(datacl, acldefault('d', datdba)) AS acl
      FROM pg_database WHERE datname = current_database()
    UNION ALL SELECT 'schema', quote_ident(nspname), coalesce(nspacl, acldefault('n', nspowner))
      FROM pg_namespace WHERE nspname IN ('backoffice', 'public')
    UNION ALL SELECT CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END,
      quote_ident(n.nspname) || '.' || quote_ident(c.relname),
      coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'backoffice' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    UNION ALL SELECT 'function', quote_ident(n.nspname) || '.' || quote_ident(p.proname)
      || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(p.proacl, acldefault('f', p.proowner))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'backoffice'
    UNION ALL SELECT 'column', quote_ident(n.nspname) || '.' || quote_ident(c.relname)
      || '.' || quote_ident(a.attname), a.attacl
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'backoffice' AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    ) SELECT * FROM (SELECT object_type, object_name, pg_get_userbyid(x.grantor) AS grantor,
      CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
      x.privilege_type, x.is_grantable
      FROM object_acls CROSS JOIN LATERAL aclexplode(acl) x) privileges
      ORDER BY object_type COLLATE "C", object_name COLLATE "C", grantor COLLATE "C",
        grantee COLLATE "C", privilege_type COLLATE "C", is_grantable`,

  defaultPrivileges: `SELECT * FROM (SELECT pg_get_userbyid(d.defaclrole) AS owner,
    coalesce(n.nspname, '@all_schemas') AS schema_name, d.defaclobjtype,
    pg_get_userbyid(x.grantor) AS grantor,
    CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
    x.privilege_type, x.is_grantable
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    WHERE n.nspname IN ('backoffice', 'public') OR d.defaclnamespace = 0) defaults
    ORDER BY owner COLLATE "C", schema_name COLLATE "C", defaclobjtype,
      grantor COLLATE "C", grantee COLLATE "C", privilege_type COLLATE "C", is_grantable`,

  // Public role attributes only. These are an inventory, not a credential backup.
  // A distinct protected process must preserve required role definitions/secrets.
  roles: `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
    rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil::text,
    ARRAY(SELECT split_part(setting, '=', 1) FROM unnest(coalesce(rolconfig, ARRAY[]::text[])) setting
      ORDER BY split_part(setting, '=', 1) COLLATE "C") AS setting_names,
    encode(sha256(convert_to(coalesce((SELECT string_agg(setting, E'\\n'
      ORDER BY setting COLLATE "C") FROM unnest(rolconfig) setting), ''), 'UTF8')), 'hex') AS settings_sha256
    FROM pg_roles ORDER BY rolname COLLATE "C"`,

  roleMemberships: `SELECT * FROM (SELECT pg_get_userbyid(roleid) AS granted_role,
    pg_get_userbyid(member) AS member, pg_get_userbyid(grantor) AS grantor,
    admin_option, inherit_option, set_option
    FROM pg_auth_members) memberships
    ORDER BY granted_role COLLATE "C", member COLLATE "C", grantor COLLATE "C"`,
});

function plain(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, plain(value[key])]));
  }
  return value;
}

function assertReadOnlyTransaction(rows, requireRepeatableRead = true) {
  const transaction = rows[0];
  if (transaction?.read_only !== 'on' ||
      (requireRepeatableRead && transaction.isolation !== 'repeatable read')) {
    throw new Error('Recovery invariant capture requires a REPEATABLE READ READ ONLY transaction');
  }
}

/** Sequence state is deliberately separate: sequence counters are not MVCC data. */
export async function collectSequenceState(tx) {
  assertReadOnlyTransaction(await tx.unsafe(catalogQueries.transaction), false);
  const definitions = await tx.unsafe(catalogQueries.sequences);
  const sequences = {};
  for (const definition of definitions) {
    const key = `${definition.schema_name}.${definition.sequence_name}`;
    const state = await tx.unsafe(sequenceStateSql(definition.sequence_name, definition.schema_name));
    if (state.length !== 1) throw new Error('Sequence state capture returned an unexpected shape');
    sequences[key] = plain(state[0]);
  }
  return sequences;
}

/**
 * Snapshot business data and nonsecret catalog invariants. The caller owns the
 * transaction/exported snapshot and its lifetime during pg_dump --snapshot.
 */
export async function collectInvariants(tx) {
  if (!tx || typeof tx.unsafe !== 'function') throw new Error('A caller-owned PostgreSQL transaction is required');
  assertReadOnlyTransaction(await tx.unsafe(catalogQueries.transaction));
  for (const statement of deterministicSessionSql) await tx.unsafe(statement);
  const catalog = {};
  for (const [name, query] of Object.entries(catalogQueries)) {
    try { catalog[name] = plain(await tx.unsafe(query)); }
    catch(error) { error.recoveryCatalogGroup = name; throw error; }
  }
  assertReadOnlyTransaction(catalog.transaction);

  const found = new Set(catalog.tableNames.filter(row => row.schema_name === 'backoffice').map(row => row.table_name));
  if (expectedTableNames.some(name => !found.has(name))) {
    throw new Error('Expected production backoffice tables are missing; no partial invariant accepted');
  }

  const tables = {};
  for (const {schema_name, table_name} of catalog.tableNames) {
    const digest = await tx.unsafe(tableDigestSql(table_name, schema_name));
    if (digest.length !== 1) throw new Error('Table digest capture returned an unexpected shape');
    tables[`${schema_name}.${table_name}`] = plain(digest[0]);
  }
  const migrations = plain(await tx.unsafe(`SELECT filename, checksum::text AS checksum,
    applied_at FROM backoffice.schema_migrations ORDER BY filename COLLATE "C"`));
  const ownerAccess = plain((await tx.unsafe(`SELECT count(*)::text AS total_users,
    count(*) FILTER (WHERE archived_at IS NULL)::text AS active_users,
    count(*) FILTER (WHERE archived_at IS NULL AND role = 'admin')::text AS active_admins,
    count(*) FILTER (WHERE archived_at IS NULL AND role = 'sales')::text AS active_sales
    FROM backoffice.users`))[0]);

  return {formatVersion: 1, catalog, tables, sequences: await collectSequenceState(tx), migrations, ownerAccess};
}

function normalizedForComparison(value, omitRestoreOnlyAdmin) {
  const result = plain(value);
  if (!omitRestoreOnlyAdmin || !result.catalog) return result;
  result.catalog.roles = result.catalog.roles.filter(row => row.rolname !== 'recovery_admin');
  result.catalog.roleMemberships = result.catalog.roleMemberships.filter(row =>
    row.member !== 'recovery_admin' && row.granted_role !== 'recovery_admin');
  // Do not filter memberships merely granted BY recovery_admin, object owners,
  // ACL grantors/grantees, or default privileges. Those must match the source.
  return result;
}

/** Return difference names only; full evidence stays in the protected package. */
export function compareInvariants(source, restored) {
  if (source?.formatVersion !== 1 || restored?.formatVersion !== 1) {
    return {passed: false, differences: ['formatVersion']};
  }
  const sourceHasRestoreAdmin = source.catalog?.roles?.some(row => row.rolname === 'recovery_admin');
  const left = normalizedForComparison(source, false);
  const right = normalizedForComparison(restored, !sourceHasRestoreAdmin);
  const differences = [];
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const group of ['tables', 'sequences', 'catalog']) {
    const keys = [...new Set([...Object.keys(left[group] || {}), ...Object.keys(right[group] || {})])].sort();
    for (const key of keys) if (!equal(left[group]?.[key], right[group]?.[key])) differences.push(`${group}.${key}`);
  }
  for (const key of ['migrations', 'ownerAccess']) {
    if (!equal(left[key], right[key])) differences.push(key);
  }
  return {
    passed: differences.length === 0,
    differences,
    comparedTableCount: Object.keys(left.tables || {}).length,
    comparedSequenceCount: Object.keys(left.sequences || {}).length,
    ignoredRestoreOnlyRoles: sourceHasRestoreAdmin ? [] : ['recovery_admin'],
  };
}
