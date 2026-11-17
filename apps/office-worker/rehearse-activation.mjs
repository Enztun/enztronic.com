// Isolated activation rehearsal only. All SQL is pinned to a NEW cluster on
// 127.0.0.1:55479; this program never opens a production database connection.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {collectInvariants, compareInvariants} from '../backoffice/scripts/recovery/invariant-query.mjs';

const workerRoot=path.dirname(fileURLToPath(import.meta.url));
const app=path.resolve(workerRoot,'../backoffice');
const require=createRequire(path.join(app,'package.json'));
const postgres=require('postgres');
const backup='C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-4e6c38baf8';
const credentialBackup='C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-f3d5f15456';
const base='C:\\Users\\hoyec\\Enztronic-Worker-Preparation';
const id=crypto.randomBytes(6).toString('hex');
const root=path.join(base,'step3-rehearsal-20261108-'+id);
const data=path.join(root,'pgdata');
const port=55479;
const database='backoffice_activation_rehearsal';
const pgBin='C:\\Program Files\\PostgreSQL\\17\\bin';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const literal=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const read=name=>JSON.parse(fs.readFileSync(path.join(backup,name),'utf8'));
const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const adminPassword=fs.readFileSync(path.join(credentialBackup,'protected-configuration/postgres-admin-password.txt'),'utf8').trim();
const appPassword=fs.readFileSync(path.join(credentialBackup,'protected-configuration/postgres-app-password.txt'),'utf8').trim();
const config={host:'127.0.0.1',port,database:'postgres',username:'enztronic_admin',password:adminPassword};
let stage='preflight', sql, started=false, completed=false;
let result={passed:false,productionConnections:0,port,sourceHashes:{}};

function connect(options) {
  if(typeof options==='string') {
    const url=new URL(options);
    if(url.hostname!=='127.0.0.1'||url.port!==String(port)||url.pathname!=='/'+database) throw new Error('Rejected database target');
  } else if(options.host!=='127.0.0.1'||options.port!==port||!['postgres',database].includes(options.database)) throw new Error('Rejected database target');
  return postgres(options,{max:1,prepare:false,idle_timeout:2,connect_timeout:5,onnotice:()=>{}});
}
function environment(connection) {
  const env=Object.fromEntries(['SystemRoot','WINDIR','ComSpec'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  env.TEMP=path.join(root,'temp'); env.TMP=env.TEMP;
  if(connection) Object.assign(env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGDATABASE:connection.database,PGUSER:connection.username,PGPASSWORD:connection.password,PGCONNECT_TIMEOUT:'5'});
  return env;
}
async function occupied() {
  return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});let settled=false;const done=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};socket.setTimeout(1500,()=>done(true));socket.once('connect',()=>done(true));socket.once('error',error=>done(error.code!=='ECONNREFUSED'));});
}
async function run(executable,args,env,name,{cwd=root,timeout=90000,detached=false}={}) {
  const fd=fs.openSync(path.join(root,name),'wx'); let child,timedOut=false;
  try {
    child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:detached?'ignore':['ignore',fd,fd]});
    const timer=setTimeout(()=>{timedOut=true;spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});},timeout);
    let code;
    try {code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});} finally {clearTimeout(timer);}
    if(timedOut||code!==0) {const error=new Error('Owned rehearsal subprocess failed');error.stage=name;error.code=timedOut?'TIMEOUT':String(code);throw error;}
  } finally {fs.closeSync(fd);}
}
async function identity() {
  const [value]=await sql`SELECT inet_server_port() AS port,current_database() AS database,current_setting('data_directory') AS data_directory`;
  if(value.port!==port||path.resolve(value.data_directory).toLowerCase()!==data.toLowerCase()) throw new Error('Isolated cluster identity mismatch');
}
function protectedBusinessComparison(before,after) {
  const changedTables=Object.keys(before.tables).filter(name=>name!=='backoffice.schema_migrations'&&JSON.stringify(before.tables[name])!==JSON.stringify(after.tables[name]));
  const originalMigrationsUnchanged=before.migrations.every(old=>after.migrations.some(current=>JSON.stringify(old)===JSON.stringify(current)));
  const officeMigration=after.migrations.filter(row=>row.filename==='003_office.sql');
  const auditSequenceUnchanged=JSON.stringify(before.sequences)===JSON.stringify(after.sequences);
  const ownerAccessUnchanged=JSON.stringify(before.ownerAccess)===JSON.stringify(after.ownerAccess);
  return {passed:!changedTables.length&&originalMigrationsUnchanged&&officeMigration.length===1&&officeMigration[0].checksum===result.sourceHashes['003_office.sql']&&auditSequenceUnchanged&&ownerAccessUnchanged,
    originalTableCount:Object.keys(before.tables).length,unchangedOriginalBusinessTables:Object.keys(before.tables).length-1-changedTables.length,changedTables,
    originalMigrationsUnchanged,office003RecordedExactlyOnce:officeMigration.length===1,auditSequenceUnchanged,ownerAccessUnchanged};
}

try {
  if(path.dirname(root)!==base||fs.existsSync(root)||await occupied()) throw new Error('Rehearsal destination or port is already occupied');
  fs.mkdirSync(root);
  const acl=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p='${root}';$s=[Security.Principal.WindowsIdentity]::GetCurrent().User;$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetAccessRuleProtection($true,$false);foreach($v in @($s.Value,'S-1-5-18','S-1-5-32-544')){$i=[Security.Principal.SecurityIdentifier]::new($v);$r=[Security.AccessControl.FileSystemAccessRule]::new($i,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$a.AddAccessRule($r)};Set-Acl -LiteralPath $p -AclObject $a`],{windowsHide:true,stdio:'ignore'});
  if(acl.status!==0) throw new Error('Protected rehearsal ACL creation failed');
  fs.mkdirSync(path.join(root,'temp')); fs.mkdirSync(path.join(root,'worker-logs'));
  const archive=path.join(backup,'production.pgdump');
  if(sha(fs.readFileSync(archive))!==read('database-backup.json').sha256) throw new Error('Backup archive checksum mismatch');
  for(const name of ['001_init.sql','002_users_and_ownership.sql','003_office.sql']) result.sourceHashes[name]=sha(fs.readFileSync(path.join(app,'database/migrations',name)));
  for(const [name,file] of Object.entries({workerEntry:path.join(workerRoot,'src/index.ts'),roleTemplate:path.join(workerRoot,'office-role.example.sql'),migrationRunner:path.join(app,'scripts/migrate.mjs')})) result.sourceHashes[name]=sha(fs.readFileSync(file));
  const source=read('production-baseline.json');
  if(source.migrations.length!==2||source.migrations.some(row=>result.sourceHashes[row.filename]!==row.checksum)) throw new Error('Original migration source differs from verified backup');
  save('source-hashes.json',result.sourceHashes);
  const pwFile=path.join(root,'admin-password.private.txt');fs.writeFileSync(pwFile,adminPassword+'\n',{flag:'wx'});
  stage='initdb';await run(path.join(pgBin,'initdb.exe'),['-D',data,'-U',config.username,'--encoding=UTF8','--locale=C','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+pwFile],environment(),'initdb.log');
  if(await occupied()) throw new Error('Rehearsal port occupied before startup');
  started=true;stage='cluster-start';await run(path.join(pgBin,'pg_ctl.exe'),['start','-D',data,'-l',path.join(root,'postgres.log'),'-w','-t','30','-o','-h 127.0.0.1 -p '+port],environment(),'cluster-start.log',{detached:true,timeout:40000});
  sql=connect(config);await identity();
  const privateRoles=read('database-roles.private.json');
  stage='original-role-restore';
  for(const role of privateRoles.roles) {
    if(role.rolname.startsWith('pg_'))throw new Error('Refused built-in role modification');
    const flags=[['rolsuper','SUPERUSER'],['rolinherit','INHERIT'],['rolcreaterole','CREATEROLE'],['rolcreatedb','CREATEDB'],['rolcanlogin','LOGIN'],['rolreplication','REPLICATION'],['rolbypassrls','BYPASSRLS']].map(([key,name])=>role[key]?name:'NO'+name).join(' ');
    await sql.unsafe(`${role.rolname===config.username?'ALTER':'CREATE'} ROLE ${quote(role.rolname)} ${flags} CONNECTION LIMIT ${Number(role.rolconnlimit)} PASSWORD ${literal(role.rolpassword)}${role.rolvaliduntil?' VALID UNTIL '+literal(role.rolvaliduntil):''}`);
    for(const setting of role.rolconfig||[]) {const index=setting.indexOf('=');await sql.unsafe(`ALTER ROLE ${quote(role.rolname)} SET ${quote(setting.slice(0,index))} TO ${literal(setting.slice(index+1))}`);}
  }
  for(const member of privateRoles.memberships) await sql.unsafe(`GRANT ${quote(member.role)} TO ${quote(member.member)} WITH ADMIN ${member.admin_option?'TRUE':'FALSE'}, INHERIT ${member.inherit_option?'TRUE':'FALSE'}, SET ${member.set_option?'TRUE':'FALSE'} GRANTED BY ${quote(member.grantor)}`);
  const db=read('inventory.json').database;
  const provider={c:'libc',i:'icu',b:'builtin'}[db.datlocprovider];if(!provider)throw new Error('Unsupported restore locale');
  const locale=provider==='libc'?`LC_COLLATE ${literal(db.datcollate)} LC_CTYPE ${literal(db.datctype)}`:`LOCALE ${literal(db.datlocale)}`;
  await sql.unsafe(`CREATE DATABASE ${quote(database)} OWNER ${quote(db.owner)} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER ${provider} ${locale}`);
  await sql.end({timeout:2});config.database=database;sql=connect(config);await identity();
  for(const extension of source.catalog.extensions) {
    const [existing]=await sql`SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname=${extension.extname}`;
    if(existing){if(existing.owner!==extension.owner)throw new Error('Extension owner differs');continue;}
    await sql.unsafe('SET ROLE '+quote(extension.owner));
    try{await sql.unsafe(`CREATE EXTENSION ${quote(extension.extname)} WITH SCHEMA ${quote(extension.schema_name)} VERSION ${literal(extension.extversion)}`);}finally{await sql.unsafe('RESET ROLE');}
  }
  await sql.end({timeout:2});sql=undefined;
  stage='archive-restore';await run(path.join(pgBin,'pg_restore.exe'),['--dbname='+database,'--exit-on-error','--verbose','--no-password',archive],environment(config),'archive-restore.log');
  sql=connect(config);await identity();
  const before=await sql.begin('isolation level repeatable read read only',collectInvariants);save('before-migration.json',before);
  result.restoreComparison=compareInvariants(source,before);if(!result.restoreComparison.passed)throw new Error('Restored source baseline differs');

  stage='checksum-aware-migration';
  const appUrl=new URL('postgresql://127.0.0.1:'+port+'/'+database);appUrl.username='enztronic_app';appUrl.password=appPassword;
  const migrateEnv={...environment(),DATABASE_URL:appUrl.toString(),NODE_ENV:'production',OFFICE_ENABLED:'false',CLOUDFLARE_ACCESS_DEV_BYPASS:'false'};
  const npmCmd=process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe';
  await run(npmCmd,['/d','/s','/c','npm.cmd run db:migrate'],{...migrateEnv,PATH:process.env.PATH},'migration.log',{cwd:app,timeout:60000});
  const afterMigration=await sql.begin('isolation level repeatable read read only',collectInvariants);save('after-migration.json',afterMigration);
  result.migrationComparison=protectedBusinessComparison(before,afterMigration);if(!result.migrationComparison.passed)throw new Error('Migration altered a protected invariant');

  stage='isolated-worker-role';
  const cap='office_rehearsal_caps_'+id,login='office_rehearsal_login_'+id,password=crypto.randomBytes(32).toString('hex');
  await sql.unsafe(`CREATE ROLE ${quote(cap)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await sql.unsafe(`CREATE ROLE ${quote(login)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD ${literal(password)}`);
  await sql.unsafe(fs.readFileSync(path.join(workerRoot,'office-role.example.sql'),'utf8').replaceAll('enztronic_office_runtime',cap));
  await sql.unsafe(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(cap)}`);
  await sql.unsafe(`GRANT ${quote(cap)} TO ${quote(login)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
  const workerUrl=new URL('postgresql://127.0.0.1:'+port+'/'+database);workerUrl.username=login;workerUrl.password=password;
  const limited=connect(workerUrl.toString());
  try {
    const entry=fs.readFileSync(path.join(workerRoot,'src/index.ts'),'utf8');
    const match=entry.match(/const \[capabilities\] = await sql`([\s\S]+?)`;/);if(!match)throw new Error('Worker preflight source was not found');
    const [capabilities]=await limited.unsafe(match[1]);
    result.workerPreflight=capabilities;if(Object.values(capabilities).some(value=>value!==false))throw new Error('Limited worker preflight rejected');
    const [workerIdentity]=await limited`SELECT current_user=session_user AS direct_login, current_user AS role`;
    if(!workerIdentity.direct_login||workerIdentity.role!==login)throw new Error('Worker login context differs');
    let denied=0;
    for(const table of Object.keys(before.tables)) {
      const [schema,name]=table.split('.');
      try{await limited.unsafe(`SELECT * FROM ${quote(schema)}.${quote(name)} LIMIT 0`);throw new Error('Protected business read was allowed');}
      catch(error){if(error.code!=='42501')throw error;denied++;}
    }
    result.workerBoundary={directLogin:true,protectedBusinessReadsDenied:denied,capabilityRole:cap,loginRole:login,capabilitySetRoleAllowed:false};
  } finally {await limited.end({timeout:2});}

  stage='actual-worker-one-pass';
  const guard=path.join(root,'rehearsal-network-guard.mjs');
  fs.writeFileSync(guard,`import net from 'node:net';import tls from 'node:tls';import dgram from 'node:dgram';import {syncBuiltinESMExports} from 'node:module';const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const a=args[0];const options=typeof a==='object'?a:{port:a,host:typeof args[1]==='string'?args[1]:'localhost'};if(Number(options.port)!==55479||!['127.0.0.1','localhost'].includes(options.host||'localhost'))throw new Error('rehearsal_network_forbidden');return connect.apply(this,args)};tls.connect=()=>{throw new Error('rehearsal_network_forbidden')};dgram.createSocket=()=>{throw new Error('rehearsal_network_forbidden')};globalThis.fetch=()=>{throw new Error('rehearsal_network_forbidden')};syncBuiltinESMExports();\n`,{flag:'wx'});
  await run(process.execPath,['--import',new URL('file:///'+guard.replaceAll('\\','/')).href,'--import',new URL('file:///'+path.join(workerRoot,'node_modules/tsx/dist/loader.mjs').replaceAll('\\','/')).href,path.join(workerRoot,'src/index.ts'),'--once'],
    {...environment(),OFFICE_ENABLED:'true',OFFICE_DEMO_WORKER:'true',OFFICE_WORKER_DATABASE_URL:workerUrl.toString(),OFFICE_WORKER_CONCURRENCY:'1',OFFICE_WORKER_LOG_DIRECTORY:path.join(root,'worker-logs'),TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'},'worker-one-pass.log',{cwd:workerRoot,timeout:30000});
  const events=fs.readFileSync(path.join(root,'worker-logs/office-worker.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const [heartbeat]=await sql`SELECT count(*)::int AS workers,bool_and(stopping) AS all_stopped FROM backoffice.office_workers`;
  result.workerOnePass={started:events.some(row=>row.event==='started'),stopped:events.some(row=>row.event==='stopped'&&row.reason==='single_pass'),heartbeatRecorded:heartbeat.workers===1,heartbeatStopped:heartbeat.all_stopped===true};
  if(Object.values(result.workerOnePass).some(value=>value!==true))throw new Error('Worker lifecycle was not fully verified');
  const after=await sql.begin('isolation level repeatable read read only',collectInvariants);save('after-worker.json',after);
  result.finalProtectedComparison=protectedBusinessComparison(before,after);if(!result.finalProtectedComparison.passed)throw new Error('Worker altered a protected invariant');
  result.migrations=after.migrations.map(row=>({filename:row.filename,checksum:row.checksum}));
  result.noOwnerImpersonation=true;result.noTaskSubmission=true;result.externalProvidersUsed=false;completed=true;
} catch(error) {
  result.failure={stage,subprocess:error.stage||null,code:String(error.code||error.name||'unknown')};
} finally {
  if(sql)await sql.end({timeout:2}).catch(()=>{});
  let stopped=!started;
  if(started) {
    const status=spawnSync(path.join(pgBin,'pg_ctl.exe'),['status','-D',data],{windowsHide:true,stdio:'ignore',timeout:10000});
    if(status.status===3)stopped=true;
    else if(status.status===0){const stop=spawnSync(path.join(pgBin,'pg_ctl.exe'),['stop','-D',data,'-m','fast','-w','-t','30'],{windowsHide:true,stdio:'ignore',timeout:40000});stopped=stop.status===0;}
  }
  result.cleanup={ownedClusterStopped:stopped,portClosed:!await occupied(),productionProcessesStopped:false};
  result.passed=completed&&result.cleanup.ownedClusterStopped&&result.cleanup.portClosed;
  if(fs.existsSync(root))save('rehearsal-result.json',result);
  console.log(JSON.stringify({passed:result.passed,evidenceDirectory:root,...(result.failure?{failure:result.failure}:{}),cleanup:result.cleanup}));
  if(!result.passed)process.exitCode=1;
}
