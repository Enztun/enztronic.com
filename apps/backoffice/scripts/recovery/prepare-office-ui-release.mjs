// UI-only release staging and READ ONLY production preservation evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {collectInvariants,compareInvariants} from './invariant-query.mjs';
const app='D:\\Enztronic\\apps\\backoffice';
const privateBase='C:\\Users\\hoyec\\Enztronic-Recovery';
const require=createRequire(path.join(app,'package.json'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=file=>sha(fs.readFileSync(file));
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function files(root,relative=''){
 return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.isSymbolicLink())throw new Error('Build link refused');
  const child=path.join(relative,entry.name);return entry.isDirectory()?files(root,child):[{path:child.replaceAll('\\','/'),bytes:fs.statSync(path.join(root,child)).size,sha256:hash(path.join(root,child))}];
 });
}
function noLinks(target){for(let current=path.resolve(target);;){if(fs.lstatSync(current).isSymbolicLink())throw new Error('Linked release destination refused');const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function privateDirectory(root){
 if(path.dirname(root).toLowerCase()!==privateBase.toLowerCase()||fs.existsSync(root))throw new Error('New private destination required');
 noLinks(privateBase);fs.mkdirSync(root);
 const command=String.raw`$ErrorActionPreference='Stop';$p=$env:OFFICE_UI_PRIVATE_ROOT;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath $p -AclObject $acl`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...process.env,OFFICE_UI_PRIVATE_ROOT:root},stdio:'ignore'});
 if(result.status!==0)throw new Error('Private release ACL failed');
}
function connection(){
 process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
 const url=new URL(process.env.DATABASE_URL);
 if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app'||process.env.OFFICE_ENABLED!=='true'||process.env.CLOUDFLARE_ACCESS_DEV_BYPASS==='true')throw new Error('Read-only UI release target refused');
 return require('postgres')(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
}
async function capture(){const sql=connection();try{return await sql.begin('isolation level repeatable read read only',collectInvariants);}finally{await sql.end({timeout:2});}}
async function quiescence(){const sql=connection();try{const [counts]=await sql`SELECT (SELECT count(*)::int FROM backoffice.office_tasks WHERE state NOT IN ('completed','cancelled')) AS open_tasks,(SELECT count(*)::int FROM backoffice.office_dispatch WHERE state='leased') AS leased_steps,(SELECT count(*)::int FROM backoffice.office_runs WHERE finished_at IS NULL AND state NOT IN ('succeeded','failed','cancelled','interrupted')) AS open_runs`;return {quiescent:Object.values(counts).every(value=>value===0),...counts,checkedAtUtc:new Date().toISOString()};}finally{await sql.end({timeout:2});}}
const [phase,...args]=process.argv.slice(2);
try{
 if(phase==='prepare'){
  const [buildFile,browserFile,controlsFile,backupArgument]=args;const build=read(buildFile),browser=read(browserFile),controls=read(controlsFile);
  if(build.exitCode!==0||!build.passed||!build.buildId||build.checks.some(check=>check.exitCode!==0)||!browser.passed||!browser.cleanup?.passed||browser.isolation.productionUsed!==false||browser.checks.some(check=>!check.passed)||browser.consoleErrors.length)throw new Error('Validated build and isolated browser result required');
  const candidate=path.resolve(build.cwd);const allowed=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108');
  if(browser.isolation.buildId!==build.buildId.trim()||path.resolve(browser.isolation.snapshot)!==candidate||browser.isolation.environmentFiles!==0)throw new Error('The exact production-mode candidate must pass browser acceptance');
  if(!controls.passed||!controls.cleanup?.passed||controls.isolation.productionUsed!==false||controls.checks.some(check=>!check.passed)||controls.consoleErrors.length||controls.isolation.buildId!==build.buildId.trim()||path.resolve(controls.isolation.snapshot)!==candidate||controls.isolation.environmentFiles!==0)throw new Error('The exact candidate must pass responsive information and filter controls');
  if(!candidate.toLowerCase().startsWith(allowed.toLowerCase()+path.sep)||fs.realpathSync(candidate).toLowerCase()!==candidate.toLowerCase()||fs.readdirSync(candidate).some(name=>name.startsWith('.env')))throw new Error('Secret-free isolated candidate required');
  const snapshot=read(build.snapshotManifest);const sourceManifest=snapshot.entries;if(path.resolve(snapshot.destination)!==candidate||path.resolve(snapshot.source)!==app||!Array.isArray(sourceManifest)||snapshot.files!==sourceManifest.length)throw new Error('Invalid source snapshot manifest');for(const file of sourceManifest){if(!/^src\//.test(file.path))continue;if(hash(path.join(candidate,file.path))!==file.sha256||hash(path.join(app,file.path))!==file.sha256)throw new Error('UI source changed since final build snapshot');}
  const tested=new Map((browser.componentHashes??[]).map(file=>[file.name,file.sha256]));
  for(const file of sourceManifest.filter(file=>/^src\/components\/office\/[^/]+\.(ts|tsx|css)$/.test(file.path))){if(tested.get(path.basename(file.path))!==file.sha256)throw new Error('Browser-tested and built Office sources differ');}
  const suffix=crypto.randomBytes(5).toString('hex'),root=path.join(privateBase,'ui-ux-release-20261108-'+suffix),releaseRoot=path.join(app,'.runtime','releases','ui-ux-20261108-'+suffix);
  const manifest=files(path.join(candidate,'.next'));const previous=files(path.join(app,'.next'));const bytes=manifest.reduce((sum,file)=>sum+file.bytes,0);const disk=fs.statfsSync(app);if(disk.bavail*disk.bsize<bytes+1024**3)throw new Error('Insufficient release staging space');
  privateDirectory(root);fs.mkdirSync(path.join(root,'protected-before'));const before=path.join(root,'protected-before');
  fs.copyFileSync(path.join(app,'.env.local'),path.join(before,'backoffice.env.local'));fs.copyFileSync('C:\\ProgramData\\EnztronicOffice\\configuration\\pending.json',path.join(before,'office-worker.json'));
  const command=String.raw`$ErrorActionPreference='Stop';$s=New-Object -ComObject 'Schedule.Service';$s.Connect();$f=$s.GetFolder('\');[IO.File]::WriteAllText((Join-Path $env:OFFICE_UI_PRIVATE_ROOT 'protected-before\backoffice-task.xml'),$f.GetTask('Enztronic Backoffice').Xml);[IO.File]::WriteAllText((Join-Path $env:OFFICE_UI_PRIVATE_ROOT 'protected-before\office-worker-task.xml'),$f.GetTask('EnztronicOfficeWorker').Xml)`;
  const taskSave=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...process.env,OFFICE_UI_PRIVATE_ROOT:root},stdio:'ignore'});if(taskSave.status!==0)throw new Error('Startup definition capture failed');
  const baseline=await capture();save(path.join(root,'before.private.json'),baseline);
  const backupRoot=path.resolve(backupArgument||path.join(privateBase,'post-acceptance-20261108-bb37ac9d-bf89-4332-ad53-bf073c3f8fcf'));if(path.dirname(backupRoot).toLowerCase()!==privateBase.toLowerCase()||!/^post-acceptance-20261108-[a-f0-9-]{36}$/.test(path.basename(backupRoot)))throw new Error('Protected verified-backup path required');noLinks(backupRoot);const recovered=read(path.join(backupRoot,'post-acceptance-summary.json'));if(!recovered.passed||!recovered.restore.passed||!recovered.secondaryCopy.passed)throw new Error('Fresh restore-tested backup required');
  const backupBaseline=read(path.join(backupRoot,'production-baseline.private.json'));const current=JSON.parse(JSON.stringify(baseline));delete backupBaseline.tables['backoffice.office_workers'];delete current.tables['backoffice.office_workers'];const baselineComparison=compareInvariants(backupBaseline,current);save(path.join(root,'pre-stage-preservation.json'),baselineComparison);if(!baselineComparison.passed)throw new Error('Records changed since the verified backup');
  const quiet=await quiescence();if(!quiet.quiescent)throw new Error('Owner work is active; no promotion prepared');save(path.join(root,'quiescence-verification.json'),quiet);
  noLinks(path.dirname(releaseRoot));if(fs.existsSync(releaseRoot))throw new Error('Release exists');fs.mkdirSync(releaseRoot);fs.cpSync(path.join(candidate,'.next'),path.join(releaseRoot,'candidate-build'),{recursive:true,errorOnExist:true,force:false});
  if(JSON.stringify(files(path.join(releaseRoot,'candidate-build')))!==JSON.stringify(manifest))throw new Error('Staged full build mismatch');
  save(path.join(releaseRoot,'validated-build-files.json'),manifest);save(path.join(releaseRoot,'previous-build-files.json'),previous);
  const acceptedBuildId=fs.readFileSync(path.join(candidate,'.next','BUILD_ID'),'utf8').trim(),previousBuildId=fs.readFileSync(path.join(app,'.next','BUILD_ID'),'utf8').trim();if(acceptedBuildId!==build.buildId.trim())throw new Error('Candidate build identity mismatch');
  const context={ownerAuthorizedUiFix:true,browserVerificationPassed:true,controlsVerificationPassed:true,webpackBuildPassed:true,baselineBusinessVerificationPassed:baselineComparison.passed,acceptedBuildId,previousBuildId,releaseRoot,environmentSha256:hash(path.join(before,'backoffice.env.local')),workerConfigurationSha256:hash(path.join(before,'office-worker.json')),manifestSha256:hash(path.join(releaseRoot,'validated-build-files.json')),previousManifestSha256:hash(path.join(releaseRoot,'previous-build-files.json')),quiescenceHelperSha256:hash(path.join(app,'../office-worker/read-worker-quiescence.mjs')),buildFileCount:manifest.length,previousBuildFileCount:previous.length,candidate,backupRoot,buildReport:path.resolve(buildFile),browserReport:path.resolve(browserFile),controlsReport:path.resolve(controlsFile)};
  save(path.join(root,'ui-release-context.json'),context);console.log(JSON.stringify({passed:true,preparationRoot:root,releaseRoot,acceptedBuildId,previousBuildId,buildFiles:manifest.length,stagedBytes:bytes,productionUntouched:true}));
 }else if(phase==='quiescence'||phase==='verify'){
  const root=path.resolve(args[0]);if(path.dirname(root).toLowerCase()!==privateBase.toLowerCase()||!/^ui-ux-release-20261108-[a-f0-9]{10}$/.test(path.basename(root)))throw new Error('Invalid UI release root');noLinks(root);const context=read(path.join(root,'ui-release-context.json'));
  if(phase==='quiescence'){const result=await quiescence();fs.writeFileSync(path.join(root,'quiescence-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.quiescent)process.exitCode=2;}
  else{
   const after=await capture();save(path.join(root,'after.private.json'),after);const before=read(path.join(root,'before.private.json'));delete before.tables['backoffice.office_workers'];delete after.tables['backoffice.office_workers'];const comparison=compareInvariants(before,after);
   const buildId=fs.readFileSync(path.join(app,'.next','BUILD_ID'),'utf8').trim();const environmentUnchanged=hash(path.join(app,'.env.local'))===context.environmentSha256;const workerConfigurationUnchanged=hash('C:\\ProgramData\\EnztronicOffice\\configuration\\pending.json')===context.workerConfigurationSha256;
   const result={passed:comparison.passed&&buildId===context.acceptedBuildId&&environmentUnchanged&&workerConfigurationUnchanged,comparison,buildId,environmentUnchanged,workerConfigurationUnchanged,officeEnabled:true,developmentBypass:false,transientHeartbeatTableExcluded:'backoffice.office_workers',databaseWritesPerformed:false};save(path.join(root,'ui-preservation-verification.json'),result);console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
  }
 }else throw new Error('Specify prepare, quiescence or verify');
}catch(error){console.error(JSON.stringify({failed:true,code:error.code||error.name,reason:error.message?.startsWith('UI ')||error.message?.startsWith('Browser-')?error.message:'UI release gate failed; inspect local preparation inputs. No credential values emitted.'}));process.exitCode=1;}
