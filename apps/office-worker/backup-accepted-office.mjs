// Post-acceptance production READ ONLY backup and a NEW isolated restore only.
// Never migrates production, changes configuration, or controls production processes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {collectInvariants, collectSequenceState, compareInvariants} from '../backoffice/scripts/recovery/invariant-query.mjs';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../backoffice');
const require=createRequire(path.join(app,'package.json'));
const postgres=require('postgres');
const base='C:\\Users\\hoyec\\Enztronic-Recovery';
const secondaryBase='E:\\Enztronic-Recovery';
const pgBin='C:\\Program Files\\PostgreSQL\\17\\bin';
const port=55489;
const restoreDatabase='backoffice_post_acceptance_restore';
const parentId='db1cddf7-1b8f-4d2e-8074-210cc094562c';
const evidenceId='f46fd39b-79ef-456b-b3fc-9024a8dcaa34';
const rolesExpected=['enztronic_admin','enztronic_app','enztronic_office_runtime','enztronic_office_worker'].sort();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const digest=file=>sha(fs.readFileSync(file));
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const literal=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

function noLink(file) {
  let current=path.resolve(file);
  while(current) {
    if(fs.lstatSync(current).isSymbolicLink())throw new Error('Link refused');
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
function env(connection,root,readOnly=false) {
  const value=Object.fromEntries(['SystemRoot','WINDIR','ComSpec'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  value.TEMP=path.join(root,'temp');value.TMP=value.TEMP;
  if(connection)Object.assign(value,{PGHOST:connection.host,PGPORT:String(connection.port),PGDATABASE:connection.database,PGUSER:connection.username,PGPASSWORD:connection.password,PGCONNECT_TIMEOUT:'10',PGAPPNAME:'enztronic-post-acceptance-backup'});
  if(readOnly)value.PGOPTIONS='-c default_transaction_read_only=on';
  return value;
}
function privateDirectory(directory,expectedParent) {
  if(path.dirname(directory).toLowerCase()!==expectedParent.toLowerCase()||fs.existsSync(directory))throw new Error('New private destination required');
  noLink(expectedParent);fs.mkdirSync(directory);noLink(directory);
  const script=String.raw`$ErrorActionPreference='Stop';$p=$env:ENZTRONIC_POST_ACCEPTANCE_TARGET;$s=[Security.Principal.WindowsIdentity]::GetCurrent().User;$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetAccessRuleProtection($true,$false);$a.SetOwner($s);foreach($v in @($s.Value,'S-1-5-18','S-1-5-32-544')){$i=[Security.Principal.SecurityIdentifier]::new($v);$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($i,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath $p -AclObject $a;$r=Get-Acl -LiteralPath $p;$allowed=@($s.Value,'S-1-5-18','S-1-5-32-544');if (!$r.AreAccessRulesProtected -or @($r.Access | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed }).Count){exit 2}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...env(null,directory),ENZTRONIC_POST_ACCEPTANCE_TARGET:directory},stdio:'ignore',timeout:30000});
  if(result.status!==0)throw new Error('Private recovery ACL failed');
}
async function occupied() {
  return new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port});let settled=false;
    const done=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
    socket.setTimeout(1500,()=>done(true));socket.once('connect',()=>done(true));socket.once('error',error=>done(error.code!=='ECONNREFUSED'));
  });
}
function db(connection,productionReadOnly=false) {
  if(connection.host!=='127.0.0.1'||![54329,port].includes(connection.port)||
      (connection.port===54329&&(!productionReadOnly||connection.database!=='enztronic_backoffice'||connection.username!=='enztronic_admin'))||
      (connection.port===port&&!['postgres',restoreDatabase].includes(connection.database)))throw new Error('Database connection target refused');
  return postgres(connection,{max:1,prepare:false,idle_timeout:2,connect_timeout:10,onnotice:()=>{},...(productionReadOnly?{connection:{default_transaction_read_only:'on'}}:{})});
}
async function identity(sql,connection,data) {
  const [actual]=await sql`SELECT current_database() AS database,current_user AS role,inet_server_port() AS port,current_setting('data_directory') AS data_directory,current_setting('transaction_read_only') AS read_only`;
  if(actual.database!==connection.database||actual.role!==connection.username||actual.port!==connection.port||path.resolve(actual.data_directory).toLowerCase()!==data.toLowerCase()||
      (connection.port===54329&&actual.read_only!=='on'))throw new Error('Database server identity mismatch');
}
async function roleMetadata(tx) {
  const roles=await tx`SELECT a.rolname,a.rolsuper,a.rolinherit,a.rolcreaterole,a.rolcreatedb,a.rolcanlogin,a.rolreplication,a.rolconnlimit,a.rolpassword,a.rolvaliduntil,a.rolbypassrls,r.rolconfig FROM pg_authid a JOIN pg_roles r ON r.rolname=a.rolname WHERE a.rolname NOT LIKE 'pg_%' ORDER BY a.rolname COLLATE "C"`;
  const memberships=await tx`SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,pg_get_userbyid(grantor) AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE pg_get_userbyid(member) NOT LIKE 'pg_%' ORDER BY pg_get_userbyid(roleid) COLLATE "C",pg_get_userbyid(member) COLLATE "C",pg_get_userbyid(grantor) COLLATE "C"`;
  return {roles,memberships};
}
async function acceptedRecords(tx) {
  const [parent]=await tx`SELECT * FROM backoffice.office_tasks WHERE id=${parentId} AND parent_task_id IS NULL AND mode='demo'`;
  const children=await tx`SELECT * FROM backoffice.office_tasks WHERE parent_task_id=${parentId} ORDER BY agent_id COLLATE "C"`;
  const [evidence]=await tx`SELECT * FROM backoffice.office_acceptance_evidence WHERE id=${evidenceId}`;
  if(!parent||parent.state!=='completed'||parent.acceptance_evidence_id!==evidenceId||children.length!==7||children.some(child=>child.state!=='completed'||child.acceptance_evidence_id!==evidenceId)||!evidence)throw new Error('Expected accepted family absent');
  const ids=[parentId,...children.map(child=>child.id)];
  const artifacts=await tx`SELECT * FROM backoffice.office_artifacts WHERE task_id IN ${tx(ids)} ORDER BY id`;
  const reviews=await tx`SELECT * FROM backoffice.office_reviews WHERE task_id IN ${tx(ids)} ORDER BY id`;
  const [approval]=await tx`SELECT * FROM backoffice.office_approvals WHERE id=${evidence.approval_id}`;
  const [owner]=await tx`SELECT id,role,archived_at FROM backoffice.users WHERE id=${evidence.owner_id}`;
  const current=artifacts.find(artifact=>artifact.id===parent.current_artifact_id);
  if(!current||current.id!==evidence.artifact_id||sha(current.content)!==evidence.artifact_hash.trim()||current.artifact_hash.trim()!==evidence.artifact_hash.trim()||
      !Array.isArray(evidence.component_manifest)||evidence.component_manifest.length!==7||canonical(evidence.component_manifest)!==canonical(current.manifest)||
      approval?.state!=='approved'||approval.acceptance_evidence_id!==evidenceId||!approval.consumed_at||approval.deciding_owner_id!==owner?.id||owner.role!=='admin'||owner.archived_at!==null)throw new Error('Accepted evidence relationship mismatch');
  for(const task of [parent,...children]) {
    const artifact=artifacts.find(item=>item.id===task.current_artifact_id);
    if(!artifact||sha(artifact.content)!==artifact.artifact_hash.trim()||!reviews.some(review=>review.artifact_id===artifact.id&&review.artifact_hash.trim()===artifact.artifact_hash.trim()&&review.state==='passed'&&review.reviewer_id!==artifact.author_agent_id))throw new Error('Accepted artifact or independent review mismatch');
    if(task.id!==parentId) {
      const entry=evidence.component_manifest.find(item=>item.childTaskId===task.id);
      if(!entry||entry.artifactId!==artifact.id||entry.revisionId!==artifact.id||entry.artifactHash!==artifact.artifact_hash.trim()||entry.hashAlgorithm!=='SHA-256'||!Array.isArray(entry.reviewReferences)||!entry.reviewReferences.length||entry.reviewReferences.some(id=>!reviews.some(review=>review.id===id&&review.artifact_id===artifact.id&&review.artifact_hash.trim()===artifact.artifact_hash.trim()&&review.state==='passed'&&review.reviewer_id!==artifact.author_agent_id)))throw new Error('Accepted component reference mismatch');
    }
  }
  return {parent,children,evidence,approval,owner,artifacts,reviews};
}
async function main() {
  const name='post-acceptance-20261108-'+crypto.randomUUID();
  const root=path.join(base,name),secondary=path.join(secondaryBase,name),data=path.join(root,'isolated-restore','pgdata');
  let stage='private-directory',sourceSql,restoreSql,started=false,completed=false,sourceConfig,sourceBaseline,sourceRoles,sourceAccepted,restoreConnection;
  const result={passed:false,clientDate:'2026-11-08',productionReadOnly:true,productionDataOrConfigurationWrites:0,productionProcessesStopped:false,restorePort:port};
  const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const journal=value=>fs.appendFileSync(path.join(root,'operations.jsonl'),JSON.stringify({machineUtc:new Date().toISOString(),stage,...value})+'\n');
  async function tool(name,args,connection,log,{readOnly=false,detached=false,timeout=120000}={}) {
    if(connection?.port===54329&&(!readOnly||name!=='pg_dump'))throw new Error('Production CLI mutation refused');
    const fd=fs.openSync(path.join(root,log),'wx');let child,timer,timedOut=false,code;
    try {
      child=spawn(path.join(pgBin,name+'.exe'),args,{cwd:root,windowsHide:true,env:env(connection,root,readOnly),stdio:detached?'ignore':['ignore',fd,fd]});
      timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
      code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    } finally {clearTimeout(timer);fs.closeSync(fd);}
    journal({operation:name,exitCode:code,timedOut});if(timedOut||code!==0)throw new Error('Owned backup subprocess failed');
  }
  try {
    if(await occupied())throw new Error('Isolated restore port already occupied');
    privateDirectory(root,base);fs.mkdirSync(path.join(root,'temp'),{recursive:true});fs.mkdirSync(path.join(root,'protected-configuration'));
    stage='protected-configuration';
    const appEnv=path.join(app,'.env.local'),workerEnv='C:\\ProgramData\\EnztronicOffice\\configuration\\pending.json';
    noLink(appEnv);noLink(workerEnv);
    const sourceConfigHashes={appEnv:digest(appEnv),workerConfig:digest(workerEnv)};
    fs.copyFileSync(appEnv,path.join(root,'protected-configuration','app.env.local'),fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(workerEnv,path.join(root,'protected-configuration','office-worker.private.json'),fs.constants.COPYFILE_EXCL);
    process.env.NODE_ENV='production';
    const loaded=require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
    const appUrl=new URL(process.env.DATABASE_URL);
    if(!loaded.loadedEnvFiles.some(file=>file.path==='.env.local')||!['postgres:','postgresql:'].includes(appUrl.protocol)||appUrl.hostname!=='127.0.0.1'||appUrl.port!=='54329'||appUrl.pathname!=='/enztronic_backoffice'||decodeURIComponent(appUrl.username)!=='enztronic_app'||appUrl.search||appUrl.hash||process.env.OFFICE_ENABLED!=='true'||(process.env.CLOUDFLARE_ACCESS_DEV_BYPASS||'false')!=='false')throw new Error('Production configuration target refused');
    const adminPassword=fs.readFileSync(path.join(app,'.runtime','postgres-admin-password.txt'),'utf8').trim();
    sourceConfig={host:'127.0.0.1',port:54329,database:'enztronic_backoffice',username:'enztronic_admin',password:adminPassword};
    sourceSql=db(sourceConfig,true);stage='exported-read-only-snapshot';
    await sourceSql.begin('isolation level repeatable read read only',async tx=>{
      await identity(tx,sourceConfig,path.join(app,'.runtime','postgres-data'));
      sourceBaseline=await collectInvariants(tx);
      if(!sourceBaseline.migrations.some(row=>row.filename==='003_office.sql'))throw new Error('Expected Office schema absent');
      sourceAccepted=await acceptedRecords(tx);sourceRoles=await roleMetadata(tx);
      if(canonical(sourceRoles.roles.map(role=>role.rolname).sort())!==canonical(rolesExpected))throw new Error('Unexpected source role inventory');
      const [database]=await tx`SELECT pg_get_userbyid(datdba) AS owner,encoding,datcollate,datctype,datlocprovider,datlocale,datconnlimit,datallowconn,datistemplate FROM pg_database WHERE datname=current_database()`;
      const [snapshot]=await tx`SELECT pg_export_snapshot() AS id`;
      save('production-baseline.private.json',sourceBaseline);save('accepted-family.private.json',sourceAccepted);save('database-roles.private.json',sourceRoles);save('database-definition.json',database);
      stage='consistent-production-dump';
      await tool('pg_dump',['--format=custom','--file='+path.join(root,'production.pgdump'),'--snapshot='+snapshot.id,'--verbose','--no-password'],sourceConfig,'pg-dump.private.log',{readOnly:true});
      const sequenceAfter=await collectSequenceState(tx);save('sequence-after-dump.json',sequenceAfter);
      if(canonical(sequenceAfter)!==canonical(sourceBaseline.sequences))throw new Error('Sequence changed during backup');
    });
    await sourceSql.end({timeout:2});sourceSql=undefined;
    await tool('pg_restore',['--list',path.join(root,'production.pgdump')],null,'archive-list.txt');
    const archive={format:'custom',sha256:digest(path.join(root,'production.pgdump')),bytes:fs.statSync(path.join(root,'production.pgdump')).size,consistentExportedSnapshot:true,sequenceStatesStable:true};
    save('database-backup.json',archive);result.archive=archive;result.sourceTables=Object.keys(sourceBaseline.tables).length;result.sourceSequences=Object.keys(sourceBaseline.sequences).length;result.sourceRoles=sourceRoles.roles.length;
    stage='isolated-initialize';fs.mkdirSync(path.join(root,'isolated-restore'));
    const bootstrapPassword=crypto.randomBytes(36).toString('hex');
    const pwFile=path.join(root,'isolated-restore','bootstrap-password.private.txt');fs.writeFileSync(pwFile,bootstrapPassword+'\n',{flag:'wx'});
    await tool('initdb',['-D',data,'-U',sourceConfig.username,'--encoding=UTF8','--locale=C','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+pwFile],null,'isolated-initdb.private.log');
    // Only this freshly created, isolated random bootstrap secret is removed.
    if(path.dirname(pwFile)!==path.join(root,'isolated-restore'))throw new Error('Bootstrap path guard failed');fs.unlinkSync(pwFile);
    if(await occupied())throw new Error('Isolated port occupied before startup');
    started=true;stage='isolated-start';
    await tool('pg_ctl',['start','-D',data,'-l',path.join(root,'isolated-restore','postgres.private.log'),'-w','-t','30','-o','-h 127.0.0.1 -p '+port],null,'isolated-start.private.log',{detached:true,timeout:40000});
    restoreConnection={host:'127.0.0.1',port,database:'postgres',username:sourceConfig.username,password:bootstrapPassword};
    restoreSql=db(restoreConnection);await identity(restoreSql,restoreConnection,data);stage='isolated-role-restore';
    for(const role of sourceRoles.roles) {
      if(role.rolname.startsWith('pg_'))throw new Error('Built-in role modification refused');
      const flags=[['rolsuper','SUPERUSER'],['rolinherit','INHERIT'],['rolcreaterole','CREATEROLE'],['rolcreatedb','CREATEDB'],['rolcanlogin','LOGIN'],['rolreplication','REPLICATION'],['rolbypassrls','BYPASSRLS']].map(([key,name])=>role[key]?name:'NO'+name).join(' ');
      await restoreSql.unsafe(`${role.rolname===sourceConfig.username?'ALTER':'CREATE'} ROLE ${quote(role.rolname)} ${flags} CONNECTION LIMIT ${Number(role.rolconnlimit)} PASSWORD ${literal(role.rolpassword)}${role.rolvaliduntil?' VALID UNTIL '+literal(role.rolvaliduntil):''}`);
      for(const setting of role.rolconfig||[]) {const equals=setting.indexOf('=');if(equals<1)throw new Error('Invalid role setting');await restoreSql.unsafe(`ALTER ROLE ${quote(role.rolname)} SET ${quote(setting.slice(0,equals))} TO ${literal(setting.slice(equals+1))}`);}
    }
    for(const member of sourceRoles.memberships)await restoreSql.unsafe(`GRANT ${quote(member.role)} TO ${quote(member.member)} WITH ADMIN ${member.admin_option?'TRUE':'FALSE'}, INHERIT ${member.inherit_option?'TRUE':'FALSE'}, SET ${member.set_option?'TRUE':'FALSE'} GRANTED BY ${quote(member.grantor)}`);
    const original=JSON.parse(fs.readFileSync(path.join(root,'database-definition.json'),'utf8'));
    const provider={c:'libc',i:'icu',b:'builtin'}[original.datlocprovider];if(!provider||original.encoding!==6)throw new Error('Unsupported source database locale or encoding');
    const locale=provider==='libc'?`LC_COLLATE ${literal(original.datcollate)} LC_CTYPE ${literal(original.datctype)}`:`LOCALE ${literal(original.datlocale)}`;
    await restoreSql.unsafe(`CREATE DATABASE ${quote(restoreDatabase)} OWNER ${quote(original.owner)} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER ${provider} ${locale} CONNECTION LIMIT ${Number(original.datconnlimit)}`);
    await restoreSql.end({timeout:2});restoreSql=undefined;
    restoreConnection={...restoreConnection,database:restoreDatabase,password:sourceConfig.password};restoreSql=db(restoreConnection);await identity(restoreSql,restoreConnection,data);
    for(const extension of sourceBaseline.catalog.extensions) {
      const [existing]=await restoreSql`SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname=${extension.extname}`;
      if(existing){if(existing.owner!==extension.owner)throw new Error('Original extension owner mismatch');continue;}
      await restoreSql.unsafe('SET ROLE '+quote(extension.owner));
      try{await restoreSql.unsafe(`CREATE EXTENSION ${quote(extension.extname)} WITH SCHEMA ${quote(extension.schema_name)} VERSION ${literal(extension.extversion)}`);}finally{await restoreSql.unsafe('RESET ROLE');}
    }
    await restoreSql.end({timeout:2});restoreSql=undefined;stage='isolated-archive-restore';
    await tool('pg_restore',['--dbname='+restoreDatabase,'--exit-on-error','--verbose','--no-password',path.join(root,'production.pgdump')],restoreConnection,'isolated-archive-restore.private.log');
    restoreSql=db(restoreConnection);await identity(restoreSql,restoreConnection,data);stage='exact-restored-comparison';
    // A non--create archive may omit database-level ACLs. Reconstruct only the NEW
    // database's effective ACL, including the post-activation worker CONNECT grant.
    for(const grantee of ['PUBLIC',...sourceRoles.roles.map(role=>role.rolname)])await restoreSql.unsafe(`REVOKE ALL PRIVILEGES ON DATABASE ${quote(restoreDatabase)} FROM ${grantee==='PUBLIC'?'PUBLIC':quote(grantee)}`);
    for(const privilege of sourceBaseline.catalog.objectPrivileges.filter(item=>item.object_type==='database')) {
      if(!['CREATE','CONNECT','TEMPORARY'].includes(privilege.privilege_type))throw new Error('Unsupported database privilege');
      await restoreSql.unsafe('SET ROLE '+quote(privilege.grantor));
      try{await restoreSql.unsafe(`GRANT ${privilege.privilege_type} ON DATABASE ${quote(restoreDatabase)} TO ${privilege.grantee==='PUBLIC'?'PUBLIC':quote(privilege.grantee)}${privilege.is_grantable?' WITH GRANT OPTION':''}`);}finally{await restoreSql.unsafe('RESET ROLE');}
    }
    const restored=await restoreSql.begin('isolation level repeatable read read only',collectInvariants);
    const restoredRoles=await restoreSql.begin('isolation level repeatable read read only',roleMetadata);
    const comparison=compareInvariants(sourceBaseline,restored);
    // No restore-only role omission or table/heartbeat exclusion is allowed here.
    comparison.exactAllGroups=canonical(sourceBaseline)===canonical(restored);comparison.exactPrivateRolesAndMemberships=canonical(sourceRoles)===canonical(restoredRoles);
    save('restored-baseline.private.json',restored);save('restore-comparison.json',comparison);
    if(!comparison.passed||!comparison.exactAllGroups||!comparison.exactPrivateRolesAndMemberships)throw new Error('Exact restore invariants mismatch');
    const appRestoreUrl=new URL(appUrl);appRestoreUrl.port=String(port);appRestoreUrl.pathname='/'+restoreDatabase;
    if(appRestoreUrl.hostname!=='127.0.0.1'||appRestoreUrl.port!==String(port)||appRestoreUrl.pathname!=='/'+restoreDatabase)throw new Error('Restored application target refused');
    const appSql=postgres(appRestoreUrl.toString(),{max:1,prepare:false,idle_timeout:2,connect_timeout:10,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
    let appAcceptance;
    try {appAcceptance=await appSql.begin('isolation level repeatable read read only',async tx=>{const [identity]=await tx`SELECT current_user AS role,inet_server_port() AS port,current_setting('transaction_read_only') AS read_only`;if(identity.role!=='enztronic_app'||identity.port!==port||identity.read_only!=='on')throw new Error('Restored application identity refused');return acceptedRecords(tx);});}
    finally {await appSql.end({timeout:2});}
    if(canonical(sourceAccepted)!==canonical(appAcceptance))throw new Error('Restored owner acceptance differs');
    result.restore={passed:true,fullCatalogAndTableEquality:true,privateRolesAndGrantorsEqual:true,acceptedParentAndSevenChildrenEqual:true,originalApplicationCredentialWorks:true,acceptedTasks:8};
    result.productionConfigurationUnchanged=digest(appEnv)===sourceConfigHashes.appEnv&&digest(workerEnv)===sourceConfigHashes.workerConfig;
    if(!result.productionConfigurationUnchanged)throw new Error('Source configuration changed during backup');
    save('source-configuration-hashes.private.json',sourceConfigHashes);completed=true;
  } catch(error) {
    result.failure={stage,code:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'BACKUP_RESTORE_FAILED'};
  } finally {
    if(sourceSql)await sourceSql.end({timeout:2}).catch(()=>{});if(restoreSql)await restoreSql.end({timeout:2}).catch(()=>{});
    let stopped=!started;
    if(started) {
      const status=spawnSync(path.join(pgBin,'pg_ctl.exe'),['status','-D',data],{windowsHide:true,env:env(null,root),stdio:'ignore',timeout:10000});
      if(status.status===3)stopped=true;
      else if(status.status===0){const stop=spawnSync(path.join(pgBin,'pg_ctl.exe'),['stop','-D',data,'-m','fast','-w','-t','30'],{windowsHide:true,env:env(null,root),stdio:'ignore',timeout:40000});stopped=stop.status===0;}
    }
    result.cleanup={ownedClusterStopped:stopped,portClosed:!await occupied(),productionProcessesStopped:false};
    result.passed=completed&&stopped&&result.cleanup.portClosed;
    if(fs.existsSync(root))save('backup-restore-result.json',result);
  }
  if(result.passed) {
    try {
      stage='verified-secondary-copy';privateDirectory(secondary,secondaryBase);
      fs.mkdirSync(path.join(secondary,'protected-configuration'));
      const names=['production.pgdump','database-roles.private.json','database-definition.json','database-backup.json','archive-list.txt','production-baseline.private.json','restored-baseline.private.json','accepted-family.private.json','restore-comparison.json','sequence-after-dump.json','backup-restore-result.json','source-configuration-hashes.private.json','protected-configuration/app.env.local','protected-configuration/office-worker.private.json'];
      const files=[];
      for(const name of names){const from=path.join(root,name),to=path.join(secondary,name);noLink(from);fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);const hash=digest(from);if(digest(to)!==hash)throw new Error('Secondary checksum mismatch');files.push({path:name,bytes:fs.statSync(to).size,sha256:hash});}
      const receipt={passed:true,secondaryDirectory:secondary,files,sourceArchiveSha256:result.archive.sha256,restorePassedBeforeCopy:true};
      save('secondary-copy.json',receipt);fs.writeFileSync(path.join(secondary,'secondary-copy.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
      result.secondaryCopy={passed:true,files:files.length};
    } catch(error) {result.passed=false;result.failure={stage,code:'SECONDARY_COPY_FAILED'};}
  }
  if(fs.existsSync(root))save('post-acceptance-summary.json',result);
  console.log(JSON.stringify({passed:result.passed,privateEvidenceDirectory:root,...(result.secondaryCopy?.passed?{secondaryEvidenceDirectory:secondary}:{}),tables:result.sourceTables,sequences:result.sourceSequences,roles:result.sourceRoles,archive:result.archive,restore:result.restore,cleanup:result.cleanup,secondaryCopy:result.secondaryCopy,...(result.failure?{failure:result.failure}:{})}));
  if(!result.passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3||process.argv[2]!=='--run')throw new Error('Explicit --run is required for the authorized read-only backup and isolated restore');
  await main();
}
