// Deliberate production BACKUP / isolated RESTORE only. Never migrates or changes production.
// Run each phase explicitly. Secrets and full evidence stay in an ACL-protected owner directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(app, 'package.json'));
const postgres = require('postgres');
const [phase, argument] = process.argv.slice(2);
const base = 'C:\\Users\\hoyec\\Enztronic-Recovery';
const root = path.resolve(argument || '');
const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const restorePort = 55469;
const restoreDb = 'backoffice_recovery_rehearsal';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const json = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const connect = options => postgres(options, { max: 1, prepare: false, idle_timeout: 3, connect_timeout: 10, onnotice: () => {} });
const journal = event => fs.appendFileSync(path.join(root, 'operations.jsonl'), JSON.stringify({ machineUtc: new Date().toISOString(), clientDate: '2026-11-08', ...event }) + '\n');

function guardedRoot() {
  if (!argument || path.dirname(root).toLowerCase() !== base.toLowerCase() || !/^production-prep-20261108-[a-f0-9]+$/.test(path.basename(root))) throw new Error('Refused recovery destination');
  if (fs.realpathSync(root).toLowerCase() !== root.toLowerCase()) throw new Error('Recovery root must not be a link');
  const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$a=Get-Acl -LiteralPath '${root}'; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($s,'S-1-5-18','S-1-5-32-544'); $bad=@($a.Access | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed }); if($bad.Count -ne 0){exit 2}; $parent=Get-Acl -LiteralPath '${base}'; if(-not $parent.AreAccessRulesProtected){exit 3}`], { windowsHide: true, encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Recovery directory ACL validation failed');
}

function productionConfig() {
  process.env.NODE_ENV = 'production';
  const loaded = require('@next/env').loadEnvConfig(app, false, { info() {}, error() {} });
  if (!loaded.loadedEnvFiles.some(file => file.path === '.env.local')) throw new Error('Expected existing production environment');
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Unexpected database protocol');
  if (url.hostname !== '127.0.0.1' || url.port !== '54329' || url.pathname !== '/enztronic_backoffice' || decodeURIComponent(url.username) !== 'enztronic_app') throw new Error('Refused database target');
  if ((process.env.OFFICE_ENABLED || 'false') !== 'false' || (process.env.CLOUDFLARE_ACCESS_DEV_BYPASS || 'false') !== 'false') throw new Error('Production flags changed');
  return { host: '127.0.0.1', port: 54329, database: 'enztronic_backoffice', username: 'enztronic_admin', password: fs.readFileSync(path.join(app, '.runtime/postgres-admin-password.txt'), 'utf8').trim(), appUrl: url.toString(), envFiles: loaded.loadedEnvFiles.map(file => file.path) };
}

function toolEnv(config, readOnly = false) {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'ComSpec'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  if (config) Object.assign(env, { PGHOST: config.host, PGPORT: String(config.port), PGDATABASE: config.database, PGUSER: config.username, PGPASSWORD: config.password, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'enztronic-recovery' });
  if (readOnly) env.PGOPTIONS = '-c default_transaction_read_only=on';
  return env;
}

async function tool(name, args, config, logName, options = {}) {
  // Open synchronously before creating a process; an asynchronous log-stream
  // error must never bypass the owned-cluster cleanup below.
  const fd = fs.openSync(path.join(root, logName), 'wx');
  let code;
  try {
    const child = spawn(path.join(pgBin, name + '.exe'), args, { windowsHide: true, env: toolEnv(config, options.readOnly), stdio: options.detached ? 'ignore' : ['ignore', fd, fd] });
    code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  } finally { fs.closeSync(fd); }
  journal({ stage: logName, exitCode: code });
  if (code !== 0) throw new Error(`PostgreSQL operation failed: ${logName}`);
}

async function portOpen(port = restorePort) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = open => { socket.destroy(); resolve(open); };
    socket.setTimeout(2000, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
  });
}

async function info(tx) {
  const [identity] = await tx`SELECT current_database() AS database, current_user AS role, inet_server_port() AS port, current_setting('data_directory') AS data_directory, current_setting('transaction_read_only') AS read_only, current_setting('server_version') AS version`;
  return identity;
}

async function inventory() {
  const config = productionConfig();
  const sql = connect(config);
  try {
    const details = await sql.begin('isolation level repeatable read read only', async tx => ({
      identity: await info(tx),
      database: (await tx`SELECT pg_get_userbyid(datdba) AS owner, encoding, datcollate, datctype, datlocprovider, datlocale, datacl::text, pg_size_pretty(pg_database_size(oid)) AS size FROM pg_database WHERE datname=current_database()`)[0],
      roles: await tx`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls, rolconfig FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname`,
      tables: await tx`SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY 1,2`,
      migrations: await tx`SELECT filename,checksum FROM backoffice.schema_migrations ORDER BY filename`,
      objectReferences: await tx`SELECT status, count(*)::int AS count FROM backoffice.invoice_documents GROUP BY status ORDER BY status`,
    }));
    if (path.resolve(details.identity.data_directory).toLowerCase() !== path.join(app, '.runtime/postgres-data').toLowerCase()) throw new Error('Unexpected production data directory');
    if (details.migrations.some(row => row.filename === '003_office.sql')) throw new Error('Office migration unexpectedly present');
    json('inventory.json', details);
    console.log(JSON.stringify({ phase, productionDataDirectoryConfirmed: true, databaseSize: details.database.size, roles: details.roles.map(row => row.rolname), tableCount: details.tables.length, migrations: details.migrations.map(row => row.filename), objectReferences: details.objectReferences, officeEnabled: false, authBypass: false }));
  } finally { await sql.end({ timeout: 2 }); }
}

async function invariant(tx) {
  const helper = await import('./invariant-query.mjs');
  return helper.collectInvariants(tx);
}

async function capture() {
  const config = productionConfig();
  const sql = connect(config);
  try {
    await sql.begin('isolation level repeatable read read only', async tx => {
      const identity = await info(tx);
      if (identity.port !== 54329 || path.resolve(identity.data_directory).toLowerCase() !== path.join(app, '.runtime/postgres-data').toLowerCase()) throw new Error('Unexpected production cluster');
      const baseline = await invariant(tx);
      if (baseline.migrations?.some(row => row.filename === '003_office.sql')) throw new Error('Office migration unexpectedly present');
      const [snapshot] = await tx`SELECT pg_export_snapshot() AS id`;
      const roles = await tx`SELECT a.rolname, a.rolsuper, a.rolinherit, a.rolcreaterole, a.rolcreatedb, a.rolcanlogin, a.rolreplication, a.rolconnlimit, a.rolpassword, a.rolvaliduntil, a.rolbypassrls, r.rolconfig FROM pg_authid a JOIN pg_roles r ON r.rolname=a.rolname WHERE a.rolname NOT LIKE 'pg_%' ORDER BY a.rolname`;
      const memberships = await tx`SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, pg_get_userbyid(grantor) AS grantor, admin_option, inherit_option, set_option FROM pg_auth_members WHERE pg_get_userbyid(member) NOT LIKE 'pg_%' ORDER BY 1,2`;
      json('database-roles.private.json', { roles, memberships });
      json('production-baseline.json', baseline);
      json('object-references.private.json', {
        documents: await tx`SELECT id, invoice_id, snapshot_id, kind, status, storage_key, content_type, byte_size::text, content_sha256 FROM backoffice.invoice_documents ORDER BY id`,
        logos: await tx`SELECT logo_storage_key FROM backoffice.business_profile WHERE logo_storage_key IS NOT NULL`,
      });
      const dump = path.join(root, 'production.pgdump');
      if (fs.existsSync(dump)) throw new Error('Backup already exists');
      await tool('pg_dump', ['--format=custom', '--file=' + dump, '--snapshot=' + snapshot.id, '--verbose', '--no-password'], config, 'pg-dump.log', { readOnly: true });
      const helper = await import('./invariant-query.mjs');
      const sequenceStatesAfter = await helper.collectSequenceState(tx);
      json('sequence-after-dump.json', sequenceStatesAfter);
      if(JSON.stringify(sequenceStatesAfter)!==JSON.stringify(baseline.sequences)) throw new Error('Production sequence changed during backup; archive requires separate reconciliation');
      await tool('pg_restore', ['--list', dump], undefined, 'archive-list.txt');
      json('database-backup.json', { clientDate: '2026-11-08', machineUtc: new Date().toISOString(), format: 'custom', consistentExportedSnapshot: true, sha256: hash(fs.readFileSync(dump)), bytes: fs.statSync(dump).size, database: config.database, port: config.port, productionReadOnly: true });
    });
    console.log(JSON.stringify({ phase, productionBackupCreated: true, archiveListed: true, sameSnapshotBaseline: true }));
  } finally { await sql.end({ timeout: 2 }); }
}

async function restore() {
  const directory = path.join(root, 'restore-rehearsal');
  if (fs.existsSync(directory) || await portOpen()) throw new Error('Restore destination or port already exists; no existing resource touched');
  fs.mkdirSync(directory);
  const data = path.join(directory, 'pgdata');
  // Rehearse the backed-up administrator identity as well, only on the NEW cluster.
  const sourceConfig = productionConfig();
  const password = sourceConfig.password;
  const passwordFile = path.join(directory, 'admin-password.private.txt');
  fs.writeFileSync(passwordFile, password + '\n', { flag: 'wx' });
  const config = { host: '127.0.0.1', port: restorePort, database: 'postgres', username: sourceConfig.username, password };
  let startAttempted = false;
  let functionalError;
  let result;
  let sql;
  try {
    await tool('initdb', ['-D', data, '-U', config.username, '--encoding=UTF8', '--locale=C', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--pwfile=' + passwordFile], undefined, 'restore-initdb.log');
    if (await portOpen()) throw new Error('Restore port occupied after initialization; listener untouched');
    startAttempted = true;
    await tool('pg_ctl', ['start', '-D', data, '-l', path.join(directory, 'postgres.log'), '-w', '-t', '30', '-o', '-h 127.0.0.1 -p ' + restorePort], undefined, 'restore-start.log', { detached: true });
    sql = connect(config);
    const identity = await sql.begin('read only', info);
    if (identity.port !== restorePort || path.resolve(identity.data_directory).toLowerCase() !== data.toLowerCase()) throw new Error('Wrong restore cluster identity');
    const { roles, memberships } = readJson('database-roles.private.json');
    for (const role of roles) {
      if (role.rolname.startsWith('pg_')) throw new Error('Refused role collision');
      const flags = [['rolsuper','SUPERUSER'],['rolinherit','INHERIT'],['rolcreaterole','CREATEROLE'],['rolcreatedb','CREATEDB'],['rolcanlogin','LOGIN'],['rolreplication','REPLICATION'],['rolbypassrls','BYPASSRLS']].map(([key, value]) => role[key] ? value : 'NO' + value).join(' ');
      await sql.unsafe(`${role.rolname === config.username ? 'ALTER' : 'CREATE'} ROLE ${quote(role.rolname)} ${flags} CONNECTION LIMIT ${Number(role.rolconnlimit)} PASSWORD ${literal(role.rolpassword)}${role.rolvaliduntil ? ' VALID UNTIL ' + literal(role.rolvaliduntil) : ''}`);
      for (const setting of role.rolconfig || []) {
        const index = setting.indexOf('=');
        await sql.unsafe(`ALTER ROLE ${quote(role.rolname)} SET ${quote(setting.slice(0,index))} TO ${literal(setting.slice(index+1))}`);
      }
    }
    for (const member of memberships) await sql.unsafe(`GRANT ${quote(member.role)} TO ${quote(member.member)} WITH ADMIN ${member.admin_option ? 'TRUE' : 'FALSE'}, INHERIT ${member.inherit_option ? 'TRUE' : 'FALSE'}, SET ${member.set_option ? 'TRUE' : 'FALSE'} GRANTED BY ${quote(member.grantor)}`);
    const original = readJson('inventory.json').database;
    if (!['c','i','b'].includes(original.datlocprovider)) throw new Error('Unsupported source locale provider');
    const provider = { c: 'libc', i: 'icu', b: 'builtin' }[original.datlocprovider];
    const locale = provider === 'libc' ? `LC_COLLATE ${literal(original.datcollate)} LC_CTYPE ${literal(original.datctype)}` : `LOCALE ${literal(original.datlocale)}`;
    await sql.unsafe(`CREATE DATABASE ${quote(restoreDb)} OWNER ${quote(original.owner)} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER ${provider} ${locale}`);
    await sql.end({ timeout: 2 }); sql = undefined;
    config.database = restoreDb;
    // Extension ownership is not emitted as ALTER OWNER by pg_dump. Recreate each
    // explicitly in the original role context before replaying the archive.
    sql = connect(config);
    for (const extension of readJson('production-baseline.json').catalog.extensions) {
      const [existing] = await sql`SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname=${extension.extname}`;
      if(existing) { if(existing.owner!==extension.owner) throw new Error('Restore extension owner differs'); continue; }
      await sql.unsafe('SET ROLE '+quote(extension.owner));
      try { await sql.unsafe(`CREATE EXTENSION ${quote(extension.extname)} WITH SCHEMA ${quote(extension.schema_name)} VERSION ${literal(extension.extversion)}`); }
      finally { await sql.unsafe('RESET ROLE'); }
    }
    await sql.end({timeout:2}); sql=undefined;
    await tool('pg_restore', ['--dbname=' + restoreDb, '--exit-on-error', '--verbose', '--no-password', path.join(root, 'production.pgdump')], config, 'restore-archive.log');
    sql = connect(config);
    const restored = await sql.begin('isolation level repeatable read read only', invariant);
    json('restored-baseline.json', restored);
    const source = readJson('production-baseline.json');
    const comparison = (await import('./invariant-query.mjs')).compareInvariants(source, restored);
    const prod = productionConfig();
    const appUrl = new URL(prod.appUrl);
    appUrl.port = String(restorePort); appUrl.pathname = '/' + restoreDb;
    const appSql = connect(appUrl.toString());
    let appAccess;
    try { appAccess = await appSql.begin('read only', async tx => ({ users: (await tx`SELECT count(*)::int AS count FROM backoffice.users`)[0].count, clients: (await tx`SELECT count(*)::int AS count FROM backoffice.clients`)[0].count, role: (await tx`SELECT current_user AS role`)[0].role })); }
    finally { await appSql.end({ timeout: 2 }); }
    result = { comparison, existingApplicationCredentialWorksOnRestore: appAccess.role === 'enztronic_app', restoredAccessCounts: appAccess, productionTouched: false };
    if (!comparison.passed) throw new Error('Restore invariant comparison failed');
  } catch (error) { functionalError = error; }
  finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
    let stopped = !startAttempted;
    if (startAttempted) {
      const status = spawnSync(path.join(pgBin,'pg_ctl.exe'), ['status','-D',data], { env: toolEnv(), windowsHide: true, encoding: 'utf8' });
      if (status.status === 3) stopped = true;
      else if (status.status === 0) {
        // Shutdown must still run if the disk/log directory cannot accept writes.
        const stop = spawnSync(path.join(pgBin,'pg_ctl.exe'), ['stop','-D',data,'-m','fast','-w','-t','30'], { env:toolEnv(), windowsHide:true, stdio:'ignore', timeout:40000 });
        stopped = stop.status === 0;
      }
    }
    const portClosed = !await portOpen();
    const cleanup = { stopped, portClosed, productionProcessesStopped: false };
    json('restore-result.json', { ...(result || {}), passed: !functionalError && stopped && portClosed, cleanup, failure: functionalError?.message || null });
    if (!stopped || !portClosed) throw new Error('Restore cleanup failed; inspect protected recovery logs');
  }
  if (functionalError) throw functionalError;
  console.log(JSON.stringify({ phase, passed: true, exactInvariantMatch: result.comparison.passed, existingApplicationCredentialWorksOnRestore: result.existingApplicationCredentialWorksOnRestore, temporaryClusterStopped: true, temporaryPortClosed: true }));
}

async function objects() {
  productionConfig();
  const refs = readJson('object-references.private.json');
  const byKey = new Map();
  for (const row of refs.documents) if (row.storage_key) {
    if (!byKey.has(row.storage_key)) byKey.set(row.storage_key, []);
    byKey.get(row.storage_key).push(row);
  }
  for (const logo of refs.logos) if (!byKey.has(logo.logo_storage_key)) byKey.set(logo.logo_storage_key, []);
  const directory = path.join(root, 'private-objects'); fs.mkdirSync(directory);
  const records = [];
  if (byKey.size) {
    const sdk = require('@aws-sdk/client-s3');
    for (const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME']) if (!process.env[name]) throw new Error('Required R2 configuration unavailable');
    const client = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }, maxAttempts: 2 });
    try {
      for (const [key, documents] of byKey) {
        const head = await client.send(new sdk.HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
        const object = await client.send(new sdk.GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, IfMatch: head.ETag }));
        if (Number(object.ContentLength) > 10 * 1024 * 1024) throw new Error('Referenced private object exceeds application limit');
        const bytes = Buffer.from(await object.Body.transformToByteArray());
        const digest = hash(bytes);
        const filename = hash(key) + '.bin';
        fs.writeFileSync(path.join(directory, filename), bytes, { flag: 'wx' });
        const ready = documents.filter(row => row.status === 'ready');
        const matches = ready.every(row => row.content_sha256?.trim() === digest && Number(row.byte_size) === bytes.length && row.content_type === object.ContentType);
        const pdfShape = !ready.length || (bytes.subarray(0,5).toString() === '%PDF-' && bytes.subarray(-1024).includes(Buffer.from('%%EOF')));
        const record = { key, filename, sha256: digest, bytes: bytes.length, contentType: object.ContentType, etag: object.ETag, metadata: object.Metadata, readyReferences: ready.length, matchesDatabase: matches, pdfShape };
        records.push(record);
        if (!matches || !pdfShape) throw new Error('Referenced private object does not match saved database record');
      }
    } finally { client.destroy(); }
  }
  json('private-objects-manifest.private.json', records);
  json('private-objects-result.json', { passed: true, referencedKeys: byKey.size, downloaded: records.length, readyDocuments: refs.documents.filter(row => row.status === 'ready').length, logoReferences: refs.logos.length, coverage: 'Database-referenced keys only; not a bucket-wide orphan inventory', remoteWrites: false });
  console.log(JSON.stringify({ phase, passed: true, referencedKeys: byKey.size, downloaded: records.length, remoteWrites: false }));
}

function copyTree(source, destination, options = {}) {
  if (fs.existsSync(destination)) throw new Error('Recovery copy destination exists');
  const entries = [];
  function copy(from, to, relative) {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) {
      if (options.skipDependencyJunction && path.basename(from) === 'node_modules') return;
      // Resolve only dependencies inside the explicitly selected installed tree.
      if (!options.followLinks) throw new Error('Unexpected link in recovery source');
      const resolved = fs.realpathSync(from);
      if (!resolved.toLowerCase().startsWith(path.resolve(source).toLowerCase() + path.sep)) throw new Error('Dependency link leaves selected tree');
      return copy(resolved, to, relative);
    }
    if (stat.isDirectory()) {
      if (options.omit?.test(path.basename(from))) return;
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from).sort()) copy(path.join(from,name),path.join(to,name),path.join(relative,name));
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
      const sourceHash = hash(fs.readFileSync(from));
      const copiedHash = hash(fs.readFileSync(to));
      if (sourceHash !== copiedHash) throw new Error('Recovery copy hash mismatch');
      entries.push({ path: relative.replaceAll('\\','/'), bytes: stat.size, sha256: copiedHash });
    } else throw new Error('Unexpected recovery source type');
  }
  copy(source,destination,'');
  return entries;
}

async function packageRelease() {
  productionConfig();
  const currentId = fs.readFileSync(path.join(app,'.next/BUILD_ID'),'utf8').trim();
  if (currentId !== 'HMB4cGweGXqsAnyVbpkcG') throw new Error('Unexpected working build');
  const candidate = 'D:\\tmp\\codex-final-correction-20261106\\claude-office-build-20261105-204259\\app';
  const candidateId = fs.readFileSync(path.join(candidate,'.next/BUILD_ID'),'utf8').trim();
  if (candidateId !== 'H2wsHC_p8niGqIW1qcF_K') throw new Error('Unexpected accepted candidate');
  const working = path.join(root,'working-release');
  fs.mkdirSync(working);
  const builtSource = path.join(app,'.runtime/releases/recovery-20261104T092745/app');
  const source = copyTree(builtSource,path.join(working,'app'),{ skipDependencyJunction:true, omit:/^(?:\.next.*|\.env.*|\.runtime|tmp|output|coverage)$/ });
  json('working-source-manifest.json',source);
  const build = copyTree(path.join(app,'.next'),path.join(working,'app/.next'));
  json('working-build-manifest.json',build);
  const accepted = copyTree(candidate,path.join(root,'accepted-candidate/app'),{skipDependencyJunction:true,omit:/^(?:\.env.*|\.runtime|tmp|output|coverage)$/});
  json('accepted-candidate-manifest.json',accepted);
  // A dependency junction alone is not a recovery copy.
  const dependencies = copyTree(path.join(app,'node_modules'),path.join(root,'installed-node-modules'),{followLinks:true});
  json('installed-dependencies-manifest.json',dependencies);
  if(fs.existsSync(path.join(app,'.venv'))) json('python-environment-manifest.json',copyTree(path.join(app,'.venv'),path.join(root,'python-environment'),{followLinks:true}));
  const configuration=path.join(root,'protected-configuration'); fs.mkdirSync(configuration);
  const copied=[];
  const files=[
    [path.join(app,'.env.local'),'backoffice.env.local'],
    ...['postgresql.conf','postgresql.auto.conf','pg_hba.conf','pg_ident.conf'].map(name=>[path.join(app,'.runtime/postgres-data',name),'postgres-'+name]),
    ...['postgres-admin-password.txt','postgres-app-password.txt'].map(name=>[path.join(app,'.runtime',name),name]),
    ...['start-backoffice.ps1','install-startup-task.ps1'].map(name=>[path.join(app,'scripts',name),name]),
    ['C:\\Users\\hoyec\\.cloudflared\\cross-config.yml','cloudflare-cross-config.yml'],
    ['C:\\Users\\hoyec\\.cloudflared\\8bf59711-be6e-4436-8e76-f9822f8f7c9c.json','cloudflare-tunnel-credentials.private.json'],
  ];
  for(const [from,name] of files){ if(!fs.existsSync(from)) throw new Error('Expected recovery configuration missing'); fs.copyFileSync(from,path.join(configuration,name),fs.constants.COPYFILE_EXCL); const digest=hash(fs.readFileSync(from)); if(digest!==hash(fs.readFileSync(path.join(configuration,name))))throw new Error('Configuration copy mismatch'); copied.push({name,source:from,sha256:digest}); }
  json('protected-configuration-manifest.private.json',copied);
  const evidence=copyTree(path.join(app,'docs'),path.join(root,'source-documents'));
  json('source-documents-manifest.json',evidence);
  json('release-package.json',{clientDate:'2026-11-08',machineUtc:new Date().toISOString(),workingBuildId:currentId,acceptedCandidateBuildId:candidateId,workingSourceFiles:source.length,workingBuildFiles:build.length,acceptedCandidateFiles:accepted.length,installedDependencyFiles:dependencies.length,configurationFiles:copied.length,node:process.version,postgresVersion:readJson('inventory.json').identity.version,stalePreviousBuildNotRollback:true,promoted:false,productionConfigurationChanged:false});
  console.log(JSON.stringify({phase,workingBuildId:currentId,acceptedCandidateBuildId:candidateId,installedDependenciesCopied:true,protectedConfigurationCopied:true,promoted:false}));
}

async function rollbackSmoke() {
  productionConfig();
  const port=3133;
  if(await portOpen(port)) throw new Error('Restore smoke port occupied; existing listener untouched');
  const release=readJson('release-package.json');
  const cwd=path.join(root,'working-release/app');
  const modules=path.join(root,'installed-node-modules');
  if(fs.readFileSync(path.join(cwd,'.next/BUILD_ID'),'utf8').trim()!==release.workingBuildId)throw new Error('Unexpected rollback build');
  const url=new URL(process.env.DATABASE_URL);url.port=String(restorePort);url.pathname='/'+restoreDb;
  const env={...toolEnv(),NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NODE_PATH:modules,DATABASE_URL:url.toString(),OFFICE_ENABLED:'false',CLOUDFLARE_ACCESS_DEV_BYPASS:'false',BACKOFFICE_HOST:'127.0.0.1',BACKOFFICE_PORT:String(port)};
  for(const key of ['CLOUDFLARE_ACCESS_TEAM_DOMAIN','CLOUDFLARE_ACCESS_AUDIENCE','CLOUDFLARE_ACCESS_ALLOWED_EMAILS'])env[key]=process.env[key];
  const fd=fs.openSync(path.join(root,'rollback-smoke.log'),'wx');
  let child;let closed;let childError;let functionalError;const checks=[];
  try {
    child=spawn(process.execPath,[path.join(modules,'next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});
    closed=new Promise(resolve=>{child.once('error',error=>{childError=error;});child.once('close',resolve);});
    let ready=false;
    for(let i=0;i<40;i++){
      if(childError||child.exitCode!==null)throw new Error('Restore smoke server exited');
      try{const response=await fetch(`http://127.0.0.1:${port}/robots.txt`,{signal:AbortSignal.timeout(1000)});ready=response.status===200;}catch{}
      if(ready)break;await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error('Restore smoke server not ready');
    async function probe(route,status,headers){
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});const body=await response.text();
      const passed=response.status===status&&(route!=='/'||response.headers.get('location')==='/dashboard')&&(route!=='/api/office'||body.includes('missing_token')||Boolean(headers?.['cf-access-jwt-assertion']));
      checks.push({route,status:response.status,passed});if(!passed)throw new Error('Restore smoke HTTP assertion failed');
    }
    await probe('/',307);await probe('/robots.txt',200);await probe('/api/office',401);
    await probe('/api/office',401,{'cf-access-authenticated-user-email':'untrusted@example.invalid'});
    await probe('/api/office',401,{'cf-access-jwt-assertion':'invalid.invalid.invalid'});
    const manifest=readJson('working-build-manifest.json');
    for(const extension of ['.js','.css','.woff2']){
      const asset=manifest.find(file=>file.path.startsWith('static/')&&file.path.endsWith(extension));if(!asset)throw new Error('Restore smoke static asset missing');
      await probe('/_next/'+asset.path,200);
    }
  }catch(error){functionalError=error;}
  finally{
    if(child&&child.exitCode===null&&child.signalCode===null)child.kill();
    if(closed)await closed;fs.closeSync(fd);
    const closedPort=!await portOpen(port);
    json('rollback-smoke-result.json',{passed:!functionalError&&closedPort,buildId:release.workingBuildId,port,checks,portClosed:closedPort,productionDatabaseUsed:false,officeEnabled:false,developmentBypass:false,authenticatedDashboard:'Requires owner browser; not claimed by this bootstrap/static/auth-denial test',failure:functionalError?.message||null});
    if(!closedPort)throw new Error('Restore smoke cleanup failed');
  }
  if(functionalError)throw functionalError;
  console.log(JSON.stringify({phase,passed:true,checks:checks.length,workingBuildId:release.workingBuildId,portClosed:true,productionDatabaseUsed:false}));
}

async function verify() {
  const config=productionConfig();const sql=connect(config);
  let comparison;let ownerAccess;
  try{
    const after=await sql.begin('isolation level repeatable read read only',async tx=>{
      const result=await invariant(tx);
      const users=await tx`SELECT email,role,archived_at IS NULL AS active FROM backoffice.users`;
      const allowed=new Set((process.env.CLOUDFLARE_ACCESS_ALLOWED_EMAILS||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
      ownerAccess={activeAllowedAdmins:users.filter(user=>user.active&&user.role==='admin'&&allowed.has(user.email.trim().toLowerCase())).length,allAllowlistedIdentitiesProvisioned:[...allowed].every(email=>users.some(user=>user.active&&user.email.trim().toLowerCase()===email)),allowlistCount:allowed.size};
      return result;
    });
    comparison=(await import('./invariant-query.mjs')).compareInvariants(readJson('production-baseline.json'),after);
    json('production-after.json',after);
  }finally{await sql.end({timeout:2});}
  const configDifferences=[];
  for(const file of readJson('protected-configuration-manifest.private.json'))if(hash(fs.readFileSync(file.source))!==file.sha256)configDifferences.push(file.name);
  const buildDifferences=[];
  for(const file of readJson('working-build-manifest.json')){
    if(hash(fs.readFileSync(path.join(app,'.next',file.path)))!==file.sha256||hash(fs.readFileSync(path.join(root,'working-release/app/.next',file.path)))!==file.sha256)buildDifferences.push(file.path);
  }
  const responses=[];
  for(const [route,expected] of [['/',307],['/robots.txt',200],['/api/office',401]]){
    const response=await fetch('http://127.0.0.1:3100'+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});await response.arrayBuffer();responses.push({route,status:response.status,passed:response.status===expected});
  }
  const edge=await fetch('https://admin.enztronic.com/dashboard',{redirect:'manual',signal:AbortSignal.timeout(20000)});await edge.arrayBuffer();
  const edgeRedirect=edge.headers.get('location');const edgeHost=edgeRedirect?new URL(edgeRedirect,'https://admin.enztronic.com').hostname:null;
  const edgeWorking=[302,303,307].includes(edge.status)&&Boolean(edgeHost?.endsWith('.cloudflareaccess.com'));
  const passed=comparison.passed&&!configDifferences.length&&!buildDifferences.length&&responses.every(response=>response.passed)&&ownerAccess.activeAllowedAdmins>0&&ownerAccess.allAllowlistedIdentitiesProvisioned&&edgeWorking&&!await portOpen()&&!await portOpen(3133);
  json('final-verification.json',{passed,clientDate:'2026-11-08',machineUtc:new Date().toISOString(),comparison,ownerAccess,configDifferences,buildDifferences,localResponses:responses,publicAccessGate:{status:edge.status,redirectsToCloudflareAccess:edgeWorking},workingBuildId:fs.readFileSync(path.join(app,'.next/BUILD_ID'),'utf8').trim(),officeEnabled:false,developmentBypass:false,restorePortClosed:!await portOpen(),smokePortClosed:!await portOpen(3133),productionMutations:false});
  if(!passed)throw new Error('Production preservation verification failed');
  console.log(JSON.stringify({phase,passed,businessAndAccessUnchanged:comparison.passed,localServiceWorking:true,cloudflareAccessGateWorking:edgeWorking,configurationUnchanged:true,workingBuildPreserved:true,temporaryPortsClosed:true}));
}

guardedRoot();
try {
  journal({ phase, state: 'started' });
  if (phase === 'inventory') await inventory();
  else if (phase === 'capture') await capture();
  else if (phase === 'restore') await restore();
  else if (phase === 'objects') await objects();
  else if (phase === 'package') await packageRelease();
  else if (phase === 'rollback-smoke') await rollbackSmoke();
  else if (phase === 'verify') await verify();
  else throw new Error('Specify inventory, capture, restore, objects, package, rollback-smoke or verify');
  journal({ phase, state: 'completed' });
} catch (error) {
  journal({ phase, state: 'failed', code: error.code || error.name, catalogGroup:error.recoveryCatalogGroup || null });
  fs.appendFileSync(path.join(root,'errors.private.jsonl'),JSON.stringify({phase,code:error.code,message:error.message,catalogGroup:error.recoveryCatalogGroup})+'\n');
  // Do not print SQL, connection URLs, provider keys or raw child output.
  console.error(JSON.stringify({ phase, failed: true, code: error.code || error.name, catalogGroup:error.recoveryCatalogGroup || null, detail: /^(Refused|Unexpected|Expected|Production|Office|Restore|Recovery|Referenced|PostgreSQL|Required|Unsupported|Wrong|Backup|Specify)/.test(error.message) ? error.message : 'Operation failed; see protected logs' }));
  process.exitCode = 1;
}
