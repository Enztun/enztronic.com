// Explicit owner-authorized activation phases. No authentication bypass or owner tokens.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {collectInvariants, compareInvariants} from '../backoffice/scripts/recovery/invariant-query.mjs';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../backoffice');
const require=createRequire(path.join(app,'package.json'));
const postgres=require('postgres');
const [phase,rootArgument]=process.argv.slice(2);
const root=path.resolve(rootArgument||'');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const digest=file=>sha(fs.readFileSync(file));
const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const db=options=>postgres(options,{max:1,prepare:false,connect_timeout:10,idle_timeout:3,onnotice:()=>{}});
const workerConfig='C:\\ProgramData\\EnztronicOffice\\configuration\\pending.json';
const candidate='D:\\tmp\\codex-final-correction-20261106\\claude-office-build-20261105-204259\\app';
if(path.dirname(root).toLowerCase()!=='c:\\users\\hoyec\\enztronic-recovery'||!/^production-prep-20261108-[a-f0-9]{10}$/.test(path.basename(root))||fs.realpathSync(root).toLowerCase()!==root.toLowerCase())throw new Error('Refused activation root');
const context=read(path.join(root,'activation-context.json'));
const expectedRelease=path.join(app,'.runtime/releases','office-activation-20261108-'+path.basename(root).slice(-10));
if(!context.ownerAuthorizedStep3And4||path.resolve(context.releaseRoot).toLowerCase()!==expectedRelease.toLowerCase())throw new Error('Missing scoped activation authority');
const rehearsal=read('C:\\Users\\hoyec\\Enztronic-Worker-Preparation\\step3-rehearsal-20261108-cdc2bff0feba\\rehearsal-result.json');
if(!rehearsal.passed||!rehearsal.cleanup.portClosed||rehearsal.sourceHashes['003_office.sql']!==context.migration003Sha256)throw new Error('Rehearsal gate failed');

function config(){
  process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||decodeURIComponent(url.username)!=='enztronic_app'||(process.env.CLOUDFLARE_ACCESS_DEV_BYPASS||'false')!=='false')throw new Error('Production identity/authentication gate failed');
  return {appUrl:url.toString(),admin:{host:'127.0.0.1',port:54329,database:'enztronic_backoffice',username:'enztronic_admin',password:fs.readFileSync(path.join(app,'.runtime/postgres-admin-password.txt'),'utf8').trim()}};
}
function childEnv(extra={}){const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','ComSpec'])if(process.env[key])env[key]=process.env[key];return {...env,...extra};}
async function run(command,args,env,logName){
  const fd=fs.openSync(path.join(root,logName),'wx');let code;
  try{const child=spawn(command,args,{cwd:app,env,windowsHide:true,stdio:['ignore',fd,fd]});code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{fs.closeSync(fd);}
  if(code!==0)throw new Error('Activation command failed: '+logName);
}
function files(directory,relative=''){
  return fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
    if(entry.isSymbolicLink())throw new Error('Build links are forbidden');const name=path.join(relative,entry.name);
    return entry.isDirectory()?files(directory,name):[{path:name.replaceAll('\\','/'),bytes:fs.statSync(path.join(directory,name)).size,sha256:digest(path.join(directory,name))}];
  });
}
function protectedComparison(before,after){
  const changes=Object.keys(before.tables).filter(name=>name!=='backoffice.schema_migrations'&&JSON.stringify(before.tables[name])!==JSON.stringify(after.tables[name]));
  const oldMigrationsPreserved=before.migrations.every(original=>after.migrations.some(row=>JSON.stringify(row)===JSON.stringify(original)));
  const additions=after.migrations.filter(row=>!before.migrations.some(old=>old.filename===row.filename));
  const expected003=additions.length===1&&additions[0].filename==='003_office.sql'&&additions[0].checksum.trim()===context.migration003Sha256;
  return {passed:changes.length===0&&oldMigrationsPreserved&&expected003&&JSON.stringify(before.sequences)===JSON.stringify(after.sequences)&&JSON.stringify(before.ownerAccess)===JSON.stringify(after.ownerAccess),changedProtectedTables:changes,protectedTableCount:Object.keys(before.tables).length-1,originalMigrationsPreserved:oldMigrationsPreserved,onlyExpected003Added:expected003,auditSequenceUnchanged:JSON.stringify(before.sequences)===JSON.stringify(after.sequences),ownerAccessUnchanged:JSON.stringify(before.ownerAccess)===JSON.stringify(after.ownerAccess)};
}
async function sourceIdentity(sql){
  const [identity]=await sql`SELECT current_database() AS database,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  if(identity.database!=='enztronic_backoffice'||identity.port!==54329||path.resolve(identity.directory).toLowerCase()!==path.join(app,'.runtime/postgres-data').toLowerCase())throw new Error('Wrong production cluster');
}
async function snapshot(sql){return sql.begin('isolation level repeatable read read only',collectInvariants);}
async function checkBoundary(url){
  const sql=db(url);try{
    const source=fs.readFileSync('C:\\ProgramData\\EnztronicOffice\\runtime\\apps\\office-worker\\src\\index.ts','utf8');
    const query=source.match(/const \[capabilities\] = await sql`([\s\S]*?)`;/)?.[1];if(!query)throw new Error('Actual worker preflight unavailable');
    const [capabilities]=await sql.unsafe(query);if(Object.values(capabilities).some(value=>value!==false))throw new Error('Worker role failed capability preflight');
    const tables=Object.keys(read(path.join(root,'production-baseline.json')).tables);let denied=0;
    for(const table of tables){try{await sql.unsafe('SELECT 1 FROM '+table.split('.').map(quote).join('.')+' LIMIT 0');throw new Error('Worker can read protected table');}catch(error){if(error.code!=='42501')throw error;denied++;}}
    const [identity]=await sql`SELECT current_user AS current_user,session_user AS session_user`;
    if(identity.current_user!=='enztronic_office_worker'||identity.session_user!==identity.current_user)throw new Error('Wrong worker login');
    return {passed:true,capabilities,deniedProtectedReads:denied,directLogin:true};
  }finally{await sql.end({timeout:2});}
}

async function stage(){
  config();if(process.env.OFFICE_ENABLED==='true')throw new Error('Office must remain disabled while staging');
  if(!read(path.join(root,'restore-result.json')).passed)throw new Error('Fresh backup restore has not passed');
  const before=read(path.join(root,'production-baseline.json'));const prior=read('C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-f3d5f15456\\production-baseline.json');
  if(!compareInvariants(prior,before).passed)throw new Error('Fresh production baseline differs from rehearsed recovery point');
  if(digest(path.join(app,'database/migrations/003_office.sql'))!==context.migration003Sha256||digest(path.join(candidate,'database/migrations/003_office.sql'))!==context.migration003Sha256)throw new Error('Migration changed since rehearsal');
  const expected=read('C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-f3d5f15456\\accepted-candidate-manifest.json').filter(file=>file.path.startsWith('.next/')).map(file=>({...file,path:file.path.slice(6)}));
  const build=path.join(candidate,'.next');
  if(fs.readFileSync(path.join(build,'BUILD_ID'),'utf8').trim()!==context.acceptedBuildId)throw new Error('Wrong accepted build');
  const actual=files(build);const normalized=list=>JSON.stringify([...list].sort((a,b)=>a.path.localeCompare(b.path)));
  if(normalized(actual)!==normalized(expected))throw new Error('Accepted build changed since verified copy');
  const target=path.join(context.releaseRoot,'candidate-build');if(fs.existsSync(target))throw new Error('Staging destination exists');
  fs.cpSync(build,target,{recursive:true,errorOnExist:true,force:false});
  if(normalized(files(target))!==normalized(expected))throw new Error('Staged build copy mismatch');
  fs.writeFileSync(path.join(context.releaseRoot,'validated-build-files.json'),JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
  save('staged-build.json',{passed:true,buildId:context.acceptedBuildId,fileCount:expected.length,manifestSha256:sha(JSON.stringify(expected)),candidateBuild:target,productionUntouched:true});
  console.log(JSON.stringify({phase,passed:true,fileCount:expected.length,buildId:context.acceptedBuildId}));
}
async function migrate(){
  const c=config();if(process.env.OFFICE_ENABLED==='true')throw new Error('Office must remain disabled for migration');
  if(!read(path.join(root,'staged-build.json')).passed)throw new Error('Missing validated staged release');
  const sql=db(c.admin);try{
    await sourceIdentity(sql);const before=await snapshot(sql);
    if(!compareInvariants(read(path.join(root,'production-baseline.json')),before).passed)throw new Error('Production changed since backup');
    const names=fs.readdirSync(path.join(app,'database/migrations')).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    if(JSON.stringify(names)!==JSON.stringify(['001_init.sql','002_users_and_ownership.sql','003_office.sql']))throw new Error('Unexpected migration files');
    for(const name of names)if(digest(path.join(app,'database/migrations',name))!==rehearsal.sourceHashes[name])throw new Error('Migration source changed');
    await run('cmd.exe',['/d','/c','npm','run','db:migrate'],childEnv({DATABASE_URL:c.appUrl,NODE_ENV:'production',OFFICE_ENABLED:'false',CLOUDFLARE_ACCESS_DEV_BYPASS:'false'}),'production-migration.log');
    const after=await snapshot(sql);const comparison=protectedComparison(before,after);save('after-migration.private.json',after);save('migration-result.json',{passed:comparison.passed,comparison,sourceHashes:rehearsal.sourceHashes});
    if(!comparison.passed)throw new Error('Protected production invariants failed after migration');
    console.log(JSON.stringify({phase,passed:true,originalBusinessTablesUnchanged:comparison.protectedTableCount,migration003Applied:true}));
  }finally{await sql.end({timeout:2});}
}
async function provision(){
  const c=config();if(process.env.OFFICE_ENABLED==='true'||!read(path.join(root,'migration-result.json')).passed)throw new Error('Role provisioning gate failed');
  const sql=db(c.admin);try{
    await sourceIdentity(sql);const [collision]=await sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('enztronic_office_runtime','enztronic_office_worker')`;
    if(collision.n!==0)throw new Error('Existing Office database roles will not be replaced');
    const password=crypto.randomBytes(36).toString('hex');const url=new URL(c.appUrl);url.username='enztronic_office_worker';url.password=password;
    save('worker-database-secret.private.json',{url:url.toString(),login:'enztronic_office_worker',capability:'enztronic_office_runtime'});
    await sql.begin(async tx=>{
      await tx.unsafe('CREATE ROLE enztronic_office_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await tx.unsafe('CREATE ROLE enztronic_office_worker LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6 PASSWORD '+literal(password));
      const template=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'office-role.example.sql');if(digest(template)!==rehearsal.sourceHashes.roleTemplate)throw new Error('Rehearsed role template changed');
      await tx.unsafe(fs.readFileSync(template,'utf8'));
      await tx.unsafe('GRANT enztronic_office_runtime TO enztronic_office_worker WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
      await tx.unsafe('GRANT CONNECT ON DATABASE enztronic_backoffice TO enztronic_office_worker');
    });
    const boundary=await checkBoundary(url.toString());
    const after=await snapshot(sql);const comparison=protectedComparison(read(path.join(root,'production-baseline.json')),after);
    if(!comparison.passed)throw new Error('Protected invariants changed during role provisioning');
    const value={OFFICE_ENABLED:'true',OFFICE_DEMO_WORKER:'true',OFFICE_WORKER_CONCURRENCY:'1',OFFICE_WORKER_DATABASE_URL:url.toString()};
    const temporary=workerConfig+'.activation-'+path.basename(root).slice(-10);fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,workerConfig);
    save('role-result.json',{passed:true,boundary,comparison,configurationPrepared:true,windowsWorkerStillDisabled:true});
    console.log(JSON.stringify({phase,passed:true,protectedReadsDenied:boundary.deniedProtectedReads,leastPrivilege:true,workerNotStarted:true}));
  }finally{await sql.end({timeout:2});}
}
async function verify(requireWorker=true,resultName='activation-verification.json'){
  const c=config();if(process.env.OFFICE_ENABLED!=='true')throw new Error('Office is not enabled');
  const sql=db(c.admin);try{
    await sourceIdentity(sql);const after=await snapshot(sql);const comparison=protectedComparison(read(path.join(root,'production-baseline.json')),after);
    const [{agent_count}]=await sql`SELECT count(*)::int AS agent_count FROM backoffice.office_agents WHERE enabled`;
    const workers=await sql`SELECT id,adapter,NOT stopping AS active,extract(epoch FROM clock_timestamp()-heartbeat_at)::float8 AS heartbeat_age_seconds FROM backoffice.office_workers ORDER BY heartbeat_at DESC`;
    const taskCounts=await sql`SELECT mode,state,count(*)::int AS count FROM backoffice.office_tasks GROUP BY mode,state ORDER BY mode,state`;
    const latest=workers.find(worker=>worker.active&&worker.heartbeat_age_seconds<60);
    const secret=read(path.join(root,'worker-database-secret.private.json'));const boundary=await checkBoundary(secret.url);
    const responses=[];for(const [route,expected,headers] of [['/',307,{}],['/robots.txt',200,{}],['/api/office',401,{}],['/api/office',401,{'cf-access-authenticated-user-email':'untrusted@example.invalid'}],['/api/office',401,{'cf-access-jwt-assertion':'invalid.invalid.invalid'}]]){
      const response=await fetch('http://127.0.0.1:3100'+route,{redirect:'manual',headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();responses.push({route,status:response.status,passed:response.status===expected});
    }
    const publicAccess=await fetch('https://admin.enztronic.com/dashboard',{redirect:'manual',signal:AbortSignal.timeout(20000)});await publicAccess.arrayBuffer();const configuredIssuer=new URL(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN.includes('://')?process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN:'https://'+process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN).origin;const accessGate=publicAccess.status===302&&new URL(publicAccess.headers.get('location'),'https://admin.enztronic.com').origin===configuredIssuer;
    const website=await fetch('https://www.enztronic.com/',{redirect:'follow',signal:AbortSignal.timeout(20000)});await website.arrayBuffer();
    const buildId=fs.readFileSync(path.join(app,'.next/BUILD_ID'),'utf8').trim();
    const passed=comparison.passed&&agent_count===7&&(!requireWorker||Boolean(latest))&&responses.every(item=>item.passed)&&accessGate&&website.status===200&&buildId===context.acceptedBuildId;
    const result={passed,fullActivationComplete:passed&&Boolean(latest),comparison,boundary,enabledAgentProfiles:agent_count,workerOnline:Boolean(latest),workers,taskCounts,localResponses:responses,publicAccessGateWorking:accessGate,publicWebsiteStatus:website.status,buildId,officeEnabled:true,developmentBypass:false,authenticatedDashboard:'requires-genuine-owner-browser-session',providerConfigured:false,commandExecutionEnabled:false};
    save(requireWorker?resultName:'activation-web-verification.json',result);if(!passed)throw new Error('Activation verification failed');
    console.log(JSON.stringify({phase,passed,fullActivationComplete:result.fullActivationComplete,buildId,enabledAgentProfiles:agent_count,workerOnline:Boolean(latest),protectedBusinessTablesUnchanged:true,publicWebsiteWorking:true,authenticationDenialsPassed:true}));
  }finally{await sql.end({timeout:2});}
}
try{if(phase==='stage')await stage();else if(phase==='migrate')await migrate();else if(phase==='provision')await provision();else if(phase==='verify')await verify();else if(phase==='verify-after-restart')await verify(true,'activation-verification-after-restart.json');else if(phase==='verify-after-owner')await verify(true,'activation-verification-after-owner.json');else if(phase==='verify-web')await verify(false);else throw new Error('Specify stage, migrate, provision, verify-web, verify, verify-after-restart or verify-after-owner');}
catch(error){fs.appendFileSync(path.join(root,'activation-errors.private.jsonl'),JSON.stringify({phase,code:error.code||error.name,message:error.message})+'\n');console.error(JSON.stringify({phase,failed:true,code:error.code||error.name,detail:'See protected activation evidence; no credential values emitted.'}));process.exitCode=1;}
