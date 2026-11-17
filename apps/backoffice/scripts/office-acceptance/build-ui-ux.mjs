// Complete isolated Office UX candidate: checks and build write only to a new C: snapshot.
import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot,workerRoot,assertSafeSnapshotDestination,minimalEnv,snapshotWorkingTree,stamp } from './lib.mjs';
import { attachUiDependencies } from './ui-ux-dependencies.mjs';

const run=stamp()+'-'+randomUUID().slice(0,8);
const base=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108');
const arguments_=process.argv.slice(2);
const previousFixtureReport=arguments_.find(value=>value.startsWith('--prior-fixture-tests='))?.slice('--prior-fixture-tests='.length);
const resumeArgument=arguments_.find(value=>!value.startsWith('--'));
const resume=resumeArgument?path.resolve(resumeArgument):null;
if(resume&&(!resume.toLowerCase().startsWith(base.toLowerCase()+path.sep)||!/^build-\d{8}-\d{6}-[a-f0-9]{8}$/.test(path.basename(resume))))throw new Error('Refused candidate continuation');
const root=resume??path.join(base,'build-'+run);
const app=path.join(root,'app');
let snapshot,dependencies,prior;
if(resume){
 prior=JSON.parse(await readFile(path.join(root,'build-result.json'),'utf8'));
 if(prior.failure!=='spawn powershell.exe ENOENT'||prior.checks.length!==2||prior.checks.some(check=>check.exitCode!==0)||prior.checks[0].name!=='lint'||prior.checks[1].name!=='typecheck')throw new Error('Only the checked pre-test launch failure may be continued');
 snapshot={files:prior.snapshotFiles,manifest:prior.snapshotManifest};dependencies=prior.dependencies;
}else{
 assertSafeSnapshotDestination({source:appRoot,destination:app});
 snapshot=await snapshotWorkingTree(app);dependencies=await attachUiDependencies(app);
}
// The existing worker-role integration test reads this nonsecret source template through its
// normal monorepo-relative path. No worker configuration, package, runtime or credential is copied.
if(!resume)await mkdir(path.join(root,'office-worker'));
const grants=await readFile(path.join(workerRoot,'office-role.example.sql'));
if(!resume)await writeFile(path.join(root,'office-worker','office-role.example.sql'),grants,{flag:'wx'});
else if(createHash('sha256').update(await readFile(path.join(root,'office-worker','office-role.example.sql'))).digest('hex')!==createHash('sha256').update(grants).digest('hex'))throw new Error('Fixture grant template changed');
const evidence=path.join(appRoot,'docs','office','ui-ux-evidence-20261108');await mkdir(evidence,{recursive:true});
const result={run,startedAt:new Date().toISOString(),cwd:app,snapshotFiles:snapshot.files,snapshotManifest:snapshot.manifest,dependencies,environmentFiles:0,productionTouched:false,workerGrantTemplateSha256:createHash('sha256').update(grants).digest('hex'),checks:prior?[...prior.checks]:[],...(resume?{continuedCandidate:root,priorOperationalFailure:prior.failure}:{})};
if(previousFixtureReport){const previous=JSON.parse(await readFile(path.resolve(previousFixtureReport),'utf8'));const tests=previous.checks?.find(check=>check.name==='tests');if(previous.exitCode!==0||!previous.passed||tests?.exitCode!==0)throw new Error('Prior fixture checks did not pass');result.previousFixtureTests={report:path.resolve(previousFixtureReport),sourceSnapshot:previous.cwd,check:tests,repeated:false,reason:'Only scene name presentation and theme nonce plumbing changed after the passing full fixture suite'};}
async function command(name,executable,args,extra={}){
 const file=path.join(root,name+'-'+run+'.log');const log=createWriteStream(file,{flags:'wx'});const started=Date.now();
 const child=spawn(executable,args,{cwd:app,env:minimalEnv({NEXT_TELEMETRY_DISABLED:'1',OFFICE_ENABLED:'false',CLOUDFLARE_ACCESS_DEV_BYPASS:'false',...extra}),windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});await new Promise(resolve=>log.end(resolve));
 const check={name,exitCode,seconds:Math.round((Date.now()-started)/1000),log:file};result.checks.push(check);console.log(JSON.stringify(check));if(exitCode!==0)throw new Error(name+' failed');
}
try{
 if(!resume){await command('lint','cmd.exe',['/d','/c','npm','run','lint']);await command('typecheck','cmd.exe',['/d','/c','npm','run','typecheck']);}
 if(!previousFixtureReport)await command('tests',path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(app,'scripts','test-office-local.ps1')]);
 await command('build','cmd.exe',['/d','/c','npm','run','build','--','--webpack'],{NODE_ENV:'production'});
 result.buildId=(await readFile(path.join(app,'.next','BUILD_ID'),'utf8')).trim();result.exitCode=0;result.passed=true;
}catch(error){result.passed=false;result.exitCode=1;result.failure=error.message;process.exitCode=1;}
finally{result.completedAt=new Date().toISOString();const record=path.join(evidence,'build-'+run+'.json');await writeFile(record,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await writeFile(path.join(root,resume?'build-result-'+run+'.json':'build-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cwd:app,buildId:result.buildId??null,report:record}));}
