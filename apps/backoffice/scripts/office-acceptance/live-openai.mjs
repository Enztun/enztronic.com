// Local release acceptance only. Extends the reviewed production-mode UX harness with a
// scripted provider; no OpenAI credential, paid request or production resource is used.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appRoot, minimalEnv, stamp } from './lib.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const candidate = path.resolve(options['production-app'] ?? '');
const temp = path.resolve(process.env.LOCALAPPDATA, 'Temp');
const reviewRoot = path.resolve(process.env.LOCALAPPDATA, 'EnztronicCodexLiveReviewRoot-20261109');
const sameDriveReviewRoot = path.resolve('D:\\tmp\\codex-live-openai-review-20261110');
if (!options['production-app'] || ![temp, reviewRoot, sameDriveReviewRoot].some(root => candidate.toLowerCase().startsWith(root.toLowerCase() + path.sep)) || path.basename(candidate) !== 'app') throw new Error('Use a separate candidate app under the recorded review roots, never the production tree.');
const snapshotManifest = path.join(path.dirname(candidate), 'app-manifest.json');
const snapshot = JSON.parse(await readFile(snapshotManifest, 'utf8'));
if (path.resolve(snapshot.destination).toLowerCase() !== candidate.toLowerCase() || !Array.isArray(snapshot.entries) || snapshot.entries.some(entry => path.basename(entry.path).startsWith('.env'))) throw new Error('Refused candidate source manifest.');
const generatedDeclarationChanges = [];
for (const entry of snapshot.entries) {
  const file = path.resolve(candidate, entry.path);
  if (!file.toLowerCase().startsWith(candidate.toLowerCase() + path.sep)) throw new Error('Refused candidate source path.');
  const bytes = await readFile(file), actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256) {
    // next build regenerates this declaration for the actual dist directory. Permit only
    // that exact transformation from the still-hash-matching source declaration.
    const source = entry.path === 'next-env.d.ts' ? await readFile(path.join(appRoot, entry.path)) : null;
    if (!source || createHash('sha256').update(source).digest('hex') !== entry.sha256 || bytes.toString('utf8') !== source.toString('utf8').replaceAll('./.next-office-check/', './.next/')) throw new Error('Candidate source differs from its sealed manifest: ' + entry.path);
    generatedDeclarationChanges.push({ path: entry.path, beforeSha256: entry.sha256, afterSha256: actual });
  }
}
const root = path.join(temp, 'enztronic-office-live-review', stamp() + '-' + randomUUID().slice(0, 8));
await mkdir(root, { recursive: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const original = await readFile(path.join(here, 'ui-ux.mjs'), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Reviewed harness anchor changed: ' + from.slice(0, 100));
  return source.replace(from, to);
}

const liveStory = String.raw`
async function liveChecks(page,context,before,cluster) {
 const base='http://127.0.0.1:'+APP_PORT;
 const LIVE='00000000-0000-4000-8000-000000000002';
 report.scope='Configured live UI and durable workflow with an offline scripted provider';
 report.isolation.provider='Scripted in process: no API credential and no OpenAI network requests';
 const module=await import(pathToFileURL(path.join(app,'src/lib/office-runtime/index.ts')).href);
 const createOfficeRuntime=module.createOfficeRuntime??module.default?.createOfficeRuntime;
 let requests=0;
 const provider={name:'openai',countInputTokens:async()=>({ok:true,inputTokens:900}),create:async(call)=>{
  requests++;
  const fields=call.schema.properties;
  let output;
  if(call.schemaName==='office_independent_review')output={outcome:'passed',summary:'Offline structural fixture review.',checks:fields.checks.items.properties.criterion.enum.map(criterion=>({criterion,result:'met',note:'Offline scripted fixture.'})),findings:[]};
  else {
   const sections=Object.fromEntries(fields.sections.required.map(section=>[section,section+': synthetic internal proposal. Budget and dates remain unknown.']));
   output=call.schemaName==='office_proposal_package'?{title:'Offline live package',sections}:{title:'Offline role draft',summary:'Synthetic internal proposal only.',sections,assumptions:[],unknowns:['Budget and dates require owner confirmation.'],sourceReferences:[]};
  }
  return {kind:'completed',requestId:'offline_'+requests,responseId:'offline_response_'+requests,output,usage:{inputTokens:900,cachedTokens:0,cacheWriteTokens:0,cacheWrite12hTokens:0,outputTokens:400,reasoningTokens:100},serviceTier:'default'};
 }};
 const runtime=createOfficeRuntime(sql,{live:{provider,settings:{draftModel:'gpt-6-luna',packageModel:'gpt-6.1-sol',reasoningEffort:'low'}}});
 await sql\`UPDATE backoffice.office_budget SET live_enabled=true,limit_microunits=10000000,monthly_limit_microunits=10000000,family_limit_microunits=1000000,request_limit_microunits=150000 WHERE id=1\`;
 const workerId='offline-browser-'+run;
 await runtime.workerHeartbeat(workerId);
 const heartbeat=setInterval(()=>runtime.workerHeartbeat(workerId).catch(()=>{}),10000);
 try {
  await page.goto(base+'/team?mode=live&workspace='+LIVE+'&view=status');
  const status=page.locator('section[aria-labelledby="office-status-title"]');
  await status.getByText('Live: OpenAI',{exact:true}).waitFor();
  check('Configured live Status names the provider and models',(await status.innerText()).includes('gpt-6-luna')&&(await status.innerText()).includes('gpt-6.1-sol'));
  await page.getByRole('button',{name:'New internal brief',exact:true}).click();
  const form=page.locator('section[aria-labelledby="office-new-brief-title"]');
  const goal='Offline live acceptance '+run;
  await form.getByLabel('Goal',{exact:true}).fill(goal);
  await form.getByLabel('Brief and permitted source references').fill('Synthetic internal website proposal only: five informational pages and a contact form. Budget, dates and hosting are unknown. No client or financial records. Do not send, publish, deploy or execute anything.');
  await form.getByRole('button',{name:'Save internal brief',exact:true}).click();
  const saved=page.getByText(/Saved as task [0-9a-f-]{36}/);await saved.waitFor();
  const saveText=await saved.textContent(),taskId=saveText.match(/[0-9a-f-]{36}/)[0];report.taskId=taskId;
  check('Configured-live save confirms persistence without claiming configuration failure',!saveText.includes('not configured')&&!saveText.includes('recorded as blocked')&&saveText.includes('once a run is recorded'),{text:saveText});
  check('Saving alone makes zero model requests',requests===0);
  await page.reload();await page.locator('#office-task-detail').getByRole('heading',{name:goal,exact:true}).waitFor();
  check('Saved live brief survives reload',new URL(page.url()).searchParams.get('task')===taskId);
  await page.goto(base+'/team?mode=live&workspace='+LIVE+'&view=status');
  await status.locator('li[data-indicator="queued"]').first().waitFor();
  check('All seven live role drafts are queued rather than misreported as unrunnable',await status.locator('li[data-indicator="queued"]').count()===7);
  await shot(page,'live-queued-status');
  const lease=await runtime.claim(workerId);if(!lease)throw new Error('No offline live lease was claimed');
  await page.reload();await status.locator('li[data-agent-id="'+lease.agentId+'"][data-indicator="executing"]').waitFor();
  check('A real live fixture lease drives the executing indicator',await status.locator('li[data-agent-id="'+lease.agentId+'"][data-indicator="executing"]').count()===1);
  await shot(page,'live-running-status');
  await runtime.execute(lease);
  for(let step=0;step<20;step++) {const next=await runtime.claim(workerId);if(!next)break;await runtime.execute(next);}
  const [parent]=await sql\`SELECT state,current_artifact_id,acceptance_evidence_id FROM backoffice.office_tasks WHERE id=\${taskId}\`;
  check('Sixteen scripted model requests stop at the owner decision',requests===16&&parent.state==='waiting_for_owner_approval'&&parent.acceptance_evidence_id===null,{requests,state:parent.state});
  const [completedBefore]=await sql\`SELECT count(*)::int AS n FROM backoffice.office_tasks WHERE (id=\${taskId} OR parent_task_id=\${taskId}) AND state='completed'\`;
  check('No task is completed before the owner acts',completedBefore.n===0);
  await page.goto(base+'/team?mode=live&workspace='+LIVE+'&task='+taskId+'&view=inbox');
  const inbox=page.locator('article[aria-current="true"]');
  await inbox.getByRole('button',{name:'View work and review findings',exact:true}).click();
  const detail=page.locator('#office-task-detail');
  await detail.locator('pre[aria-label$=", revision 1"]').waitFor();
  const body=await detail.locator('pre[aria-label$=", revision 1"]').textContent();
  const [packageRecord]=await sql\`SELECT content,artifact_hash FROM backoffice.office_artifacts WHERE id=\${parent.current_artifact_id}\`;
  check('View work exposes the exact package and immutable manifest',new URL(page.url()).searchParams.get('task')===taskId&&body===packageRecord.content&&(await detail.innerText()).includes(packageRecord.artifact_hash)&&body.includes('Immutable component manifest')&&body.includes('artifactHash'));
  await shot(page,'live-owner-review');
  await page.goto(base+'/team?mode=live&workspace='+LIVE+'&task='+taskId+'&view=inbox');
  await page.locator('article[aria-current="true"]').getByRole('button',{name:'Accept this internal package',exact:true}).click();
  await page.getByText(/Accepted\. Acceptance evidence [0-9a-f-]{36}/).waitFor();
  await page.reload();
  const tasks=await sql\`SELECT state,acceptance_evidence_id FROM backoffice.office_tasks WHERE id=\${taskId} OR parent_task_id=\${taskId}\`;
  check('Explicit synthetic-owner acceptance completes one exact eight-task family',tasks.length===8&&tasks.every(task=>task.state==='completed'&&task.acceptance_evidence_id)&&new Set(tasks.map(task=>task.acceptance_evidence_id)).size===1);
  const reviews=await sql\`SELECT r.state,r.reviewer_id<>a.author_agent_id AS independent FROM backoffice.office_reviews r JOIN backoffice.office_artifacts a ON a.id=r.artifact_id WHERE r.task_id=\${taskId} OR r.task_id IN (SELECT id FROM backoffice.office_tasks WHERE parent_task_id=\${taskId})\`;
  check('Every scripted artifact has its independent role review',reviews.length===8&&reviews.every(review=>review.state==='passed'&&review.independent));
  check('Synthetic business records are unchanged',JSON.stringify(before)===JSON.stringify(await businessDigest(sql)));
  await shot(page,'live-accepted-package');
  check('No uncaught browser errors',report.consoleErrors.length===0,{errors:report.consoleErrors});
 } finally {clearInterval(heartbeat);await runtime.workerHeartbeat(workerId,true);}
 // The full offline evaluation gets a separate disposable database in this same owned cluster.
 const evalDb='enztronic_office_live_eval_test';
 runChecked(path.join('C:\\Program Files\\PostgreSQL\\17\\bin','createdb.exe'),['-h','127.0.0.1','-p',String(PG_PORT),'-U','office_test',evalDb]);
 const evalOut=path.join(root,'offline-eval');
 const evalProcess=startProcess('offline-live-eval',process.execPath,['--import',pathToFileURL(path.join(app,'node_modules','tsx','dist','loader.mjs')).href,path.join(app,'scripts','office-live-eval','run.ts'),'--dry-run','--briefs','standard-five-page,indonesian-brief,prompt-injection,missing-rates,with-supplied-budget,conflicting-requirements,vague-brief,long-brief','--out',evalOut],{cwd:app,env:minimalEnv({OFFICE_EVAL_DATABASE_URL:'postgresql://office_test@127.0.0.1:'+PG_PORT+'/'+evalDb}),logFile:path.join(root,'offline-eval.log')});
 const evalExit=await evalProcess.exited;if(evalExit.code!==0)throw new Error('Offline evaluation failed; see retained log');
 const evaluation=JSON.parse(await readFile(path.join(evalOut,'report.json'),'utf8'));
 check('Eight offline evaluation briefs reach the owner decision',evaluation.dryRun&&evaluation.briefs.length===8&&evaluation.briefs.every(brief=>brief.reachedOwnerDecision&&brief.requests===16));
 check('Offline evaluation retains language and conflict negative controls',evaluation.briefs.find(brief=>brief.id==='indonesian-brief').checks.some(check=>check.check==='indonesian_language'&&!check.passed)&&evaluation.briefs.find(brief=>brief.id==='conflicting-requirements').checks.some(check=>check.check==='conflict_flagged'&&!check.passed));
 report.offlineEvaluation={out:evalOut,briefs:8,scriptedRequests:evaluation.briefs.reduce((sum,brief)=>sum+brief.requests,0),qualityVerified:false};
 await context.close();
}
`;

let source = original;
for (const name of ['lib.mjs', 'ui-ux-dependencies.mjs']) source = replaceOnce(source, "'./" + name + "'", JSON.stringify(pathToFileURL(path.join(here, name)).href));
for (const name of ['playwright', 'jose']) source = replaceOnce(source, "'" + name + "'", JSON.stringify(import.meta.resolve(name)));
source = replaceOnce(source, 'createCluster, createWorkerRole, finalizeRun,', 'runChecked, createCluster, createWorkerRole, finalizeRun,');
source = replaceOnce(source, "const evidence=path.join(appRoot,'docs','office','ui-ux-evidence-20261108');", "const evidence=path.join(appRoot,'docs','office','live-openai-review-evidence-20261109');");
source = replaceOnce(source, "const expectedBase=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108');", 'const expectedBase=' + JSON.stringify(path.dirname(candidate)) + ';');
source = replaceOnce(source, 'try{\n for(const port of [PG_PORT,APP_PORT])', liveStory.replaceAll('\\`', '`').replaceAll('\\${', '${') + '\ntry{\n for(const port of [PG_PORT,APP_PORT])');
source = replaceOnce(source, "if(options['controls-only']==='true'){", "if(options['live-only']==='true'){await liveChecks(page,context,before,cluster);}else if(options['controls-only']==='true'){");
const entry = path.join(root, 'acceptance.mjs');
await writeFile(entry, source, { flag: 'wx' });
await writeFile(path.join(root, 'harness.json'), JSON.stringify({ original: path.join(here, 'ui-ux.mjs'), originalSha256: hash(original), wrapper: fileURLToPath(import.meta.url), wrapperSha256: hash(await readFile(fileURLToPath(import.meta.url))), generated: entry, generatedSha256: hash(source), candidate, snapshotManifest, snapshotManifestSha256: hash(await readFile(snapshotManifest)), verifiedSourceFiles: snapshot.entries.length, generatedDeclarationChanges, productionUsed: false }, null, 2) + '\n', { flag: 'wx' });
if (options['prepare-only'] === 'true') { console.log(JSON.stringify({ root, entry, executed: false })); process.exit(0); }
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(appRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href, entry, '--production-app=' + candidate, '--pg-port=' + (options['pg-port'] ?? 55529), '--app-port=' + (options['app-port'] ?? 3168), '--issuer-port=' + (options['issuer-port'] ?? 9468), '--live-only=true'], { cwd: appRoot, windowsHide: true, env: minimalEnv(), stdio: ['ignore', 'inherit', 'inherit'] });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
console.log(JSON.stringify({ root, exitCode: code, candidate, productionUsed: false }));
process.exitCode = code;
