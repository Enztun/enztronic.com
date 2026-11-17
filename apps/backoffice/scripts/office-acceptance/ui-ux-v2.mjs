// Incremental Office UI acceptance. Only new C: snapshots and owned loopback fixtures are used.
// The reviewed v1 story is copied into a temporary harness with explicit, hash-recorded additions.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appRoot, workerRoot, minimalEnv, snapshotWorkingTree, stamp } from './lib.mjs';
import { attachUiDependencies } from './ui-ux-dependencies.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const run = stamp() + '-' + randomUUID().slice(0, 8);
const base = path.join(process.env.LOCALAPPDATA, 'Temp', 'enztronic-office-uiux-20261108');
const evidence = path.join(appRoot, 'docs', 'office', 'ui-ux-v2-evidence-20261108');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
await mkdir(evidence, { recursive: true });

async function command(command, args, cwd, logFile, env = {}) {
  const log = createWriteStream(logFile, { flags: 'wx' });
  const child = spawn(command, args, { cwd, windowsHide: true, env: minimalEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await new Promise(resolve => log.end(resolve));
  return code;
}

async function buildCandidate() {
  const root = path.join(base, 'v2-build-' + run), app = path.join(root, 'app');
  const snapshot = await snapshotWorkingTree(app), dependencies = await attachUiDependencies(app);
  await mkdir(path.join(root, 'office-worker'));
  const grants = await readFile(path.join(workerRoot, 'office-role.example.sql'));
  await writeFile(path.join(root, 'office-worker', 'office-role.example.sql'), grants, { flag: 'wx' });
  const result = { run, startedAt: new Date().toISOString(), cwd: app, snapshotFiles: snapshot.files, snapshotManifest: snapshot.manifest, dependencies, environmentFiles: 0, productionTouched: false, workerGrantTemplateSha256: hash(grants), checks: [] };
  try {
    const commands = [
      ['lint', 'cmd.exe', ['/d', '/c', 'npm', 'run', 'lint']],
      ['typecheck', 'cmd.exe', ['/d', '/c', 'npm', 'run', 'typecheck']],
      ['tests', path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(app, 'scripts', 'test-office-local.ps1')]],
      ['build', 'cmd.exe', ['/d', '/c', 'npm', 'run', 'build', '--', '--webpack']],
    ];
    for (const [name, executable, args] of commands) {
      const started = Date.now(), log = path.join(root, name + '.log');
      const exitCode = await command(executable, args, app, log, { NEXT_TELEMETRY_DISABLED: '1', OFFICE_ENABLED: 'false', CLOUDFLARE_ACCESS_DEV_BYPASS: 'false', ...(name === 'build' ? { NODE_ENV: 'production' } : {}) });
      const check = { name, exitCode, seconds: Math.round((Date.now() - started) / 1000), log };
      result.checks.push(check); console.log(JSON.stringify(check));
      if (exitCode !== 0) throw new Error(name + ' failed');
    }
    result.buildId = (await readFile(path.join(app, '.next', 'BUILD_ID'), 'utf8')).trim();
    result.passed = true; result.exitCode = 0;
  } catch (error) { result.passed = false; result.exitCode = 1; result.failure = error.message; }
  result.completedAt = new Date().toISOString();
  const record = path.join(evidence, 'build-' + run + '.json');
  await writeFile(record, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(root, 'build-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, cwd: app, buildId: result.buildId, report: record }));
  process.exitCode = result.exitCode;
}

// Kept as source strings so the temporary harness uses the original reviewed ownership registry,
// certificate recipe and full workflow rather than maintaining another process/cluster lifecycle.
const fixtureAddition = String.raw`
async function seedV2DisplayFixture() {
 const [owner]=await sql\`SELECT id FROM backoffice.users WHERE email=\${OWNER_EMAIL}\`;
 const ids=['adrian','clara','nadia','leo','lisa','sam','theo'];
 const alternate=randomUUID();
 await sql\`INSERT INTO backoffice.office_workspaces(id,name,scope,scope_key,project_key,mode) VALUES(\${alternate},'Separate UI fixture','internal',\${'internal:v2-other-'+run},\${'v2-other-'+run},'demo')\`;
 await sql\`INSERT INTO backoffice.office_workspace_grants(workspace_id,agent_id) SELECT \${alternate},id FROM backoffice.office_agents\`;
 let sequence=0;const tasks=[],events=[];const families=[];
 async function task(agentId,goal,parent=null,workspace=DEMO) {
  const id=randomUUID();await sql\`INSERT INTO backoffice.office_tasks(id,workspace_id,parent_task_id,initiating_owner_id,agent_id,goal,brief,state,mode,idempotency_key,input_hash) VALUES(\${id},\${workspace},\${parent},\${owner.id},\${agentId},\${goal},'Synthetic display-only fixture. No provider, execution or real records.','assigned','demo',\${'fixture-'+id},\${'0'.repeat(64)})\`;tasks.push({id,agentId,goal,parent,workspace});return id;
 }
 async function event(taskId,agentId,eventType,runId=null,workspace=DEMO,payload={}) {
  const id=randomUUID();sequence++;await sql\`INSERT INTO backoffice.office_events(id,workspace_id,sequence,task_id,run_id,actor_type,actor_id,event_type,mode,simulated,source,payload,occurred_at) VALUES(\${id},\${workspace},\${sequence},\${taskId},\${runId},\${runId?'agent':eventType==='task_note_added'?'owner':'worker'},\${runId?agentId:eventType==='task_note_added'?OWNER_EMAIL:'scheduler'},\${eventType},'demo',true,\${eventType==='task_note_added'?'authenticated_owner_action':'sample_data'},\${sql.json(payload)},now()-(\${sequence}*interval '1 minute'))\`;events.push({id,taskId,agentId,eventType,runId,workspace});return id;
 }
 for(let family=0;family<2;family++) {
  const parent=await task('adrian','UI family '+(family+1)+' website proposal');families.push(parent);
  for(const agent of ids) {
   const child=await task(agent,'UI family '+(family+1)+' '+agent+' work',parent);
   const runId=randomUUID();await sql\`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,finished_at) VALUES(\${runId},\${DEMO},\${child},\${agent},1,1,1,'succeeded','draft',now())\`;
   for(const type of ['work_started','artifact_created','review_requested','review_passed'])await event(child,agent,type,runId,DEMO,{agentName:agent[0].toUpperCase()+agent.slice(1),artifactTitle:'UI proposal draft',reviewerName:'Independent reviewer',revisionLabel:'R1'});
  }
  await event(parent,'adrian','task_note_added',null,DEMO,{note:'Owner note fixture '+family});
 }
 for(let index=0;index<12;index++){const id=await task(ids[index%7],'UI standalone '+(index+1));await event(id,ids[index%7],'task_created');await event(id,ids[index%7],'work_started');}
 const retryTask=tasks.find(item=>item.agentId==='clara'&&item.parent).id;
 const failed=randomUUID(),retry=randomUUID();
 await sql\`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,error_code,finished_at) VALUES(\${failed},\${DEMO},\${retryTask},'clara',1,1,1,'failed','draft','fixture_retry',now())\`;
 await sql\`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,predecessor_run_id,finished_at) VALUES(\${retry},\${DEMO},\${retryTask},'clara',1,1,2,'succeeded','draft',\${failed},now())\`;
 await event(retryTask,'clara','run_failed',failed);await event(retryTask,'clara','retry_scheduled',retry);await event(null,'adrian','fixture_unrecognised_event');
 const other=await task('lisa','UI other workspace must stay separate',null,alternate);await event(other,'lisa','task_created',null,alternate);
 await sql\`UPDATE backoffice.office_workspaces SET event_sequence=\${sequence} WHERE id IN (\${DEMO},\${alternate})\`;
 report.displayFixture={tasks,families,events,eventCount:events.length,alternateWorkspace:alternate};
}
`;

const checksAddition = String.raw`
async function v2ProfileGeometry(page,origin,width,height,label) {
 await page.setViewportSize({width,height});await origin.scrollIntoViewIfNeeded();await origin.click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();await pause(120);
 const rect=await dialog.boundingBox();
 check(label+' profile is centered on both axes',Math.abs(rect.x+rect.width/2-width/2)<=2&&Math.abs(rect.y+rect.height/2-height/2)<=2,{rect,viewport:{width,height}});
 check(label+' profile fits the viewport',rect.x>=8&&rect.y>=8&&rect.x+rect.width<=width-8&&rect.y+rect.height<=height-8,{rect});
 const close=dialog.getByRole('button',{name:'Close profile',exact:true});
 await dialog.evaluate(element=>{const scrollables=[element,...element.querySelectorAll('*')].filter(node=>node.scrollHeight>node.clientHeight+4&&['auto','scroll'].includes(getComputedStyle(node).overflowY));for(const node of scrollables)node.scrollTop=node.scrollHeight;});
 await pause(80);const closeRect=await close.boundingBox();
 check(label+' close button stays reachable after scrolling',closeRect&&closeRect.y>=rect.y-1&&closeRect.y+closeRect.height<=rect.y+rect.height+1&&closeRect.x>=rect.x);
 await shot(page,'v2-profile-'+label);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 check(label+' Escape restores the invoking button focus',await origin.evaluate(element=>element===document.activeElement));
}
async function targetedV2Checks(page,context,beforeDigest) {
 report.scope='Incremental profile, activity grouping, consistent identity and PC pan acceptance';
 const base='http://127.0.0.1:'+APP_PORT;
 let sidebar=page.locator('aside[aria-label$=" profile"]');
 await v2ProfileGeometry(page,sidebar.getByRole('button',{name:'Profile',exact:true}),1512,982,'desktop-1512');
 await v2ProfileGeometry(page,sidebar.getByRole('button',{name:'Profile',exact:true}),1890,936,'desktop-1890');
 await page.goto(base+'/team?mode=demo&workspace='+DEMO+'&view=status');
 for(const name of ['Clara','Theo','Adrian']){
  const origin=page.getByRole('button',{name:"Show "+name+"'s profile",exact:true});await origin.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  check('Status button opens '+name+' profile dialog',await dialog.getByRole('heading',{name,exact:true}).isVisible());
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  check('Status '+name+' profile restores its button focus',await origin.evaluate(element=>element===document.activeElement));
 }
 await page.setViewportSize({width:390,height:844});
 await v2ProfileGeometry(page,page.getByRole('button',{name:"Show Clara's profile",exact:true}),390,844,'mobile-390');
 check('mobile Status has no page horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.setViewportSize({width:1512,height:982});
 await page.goto(base+'/team?mode=demo&workspace='+DEMO+'&view=tasks');
 const tasks=page.getByLabel('Office task list',{exact:true});await tasks.waitFor();
 const identities=tasks.locator('[data-role-id]');await identities.first().waitFor();
 const taskIdentities=await identities.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.roleId,color:getComputedStyle(node).getPropertyValue('--agent-ink').trim(),text:node.textContent,image:!!node.querySelector('img')})));
 check('Tasks show all seven agent portraits and named role badges',new Set(taskIdentities.map(item=>item.id)).size===7&&taskIdentities.every(item=>item.text&&item.image&&item.color),{identities:taskIdentities});
 const portraitLoads=[];for(const id of ['adrian','clara','nadia','leo','lisa','sam','theo']){const badge=tasks.locator('[data-role-id="'+id+'"]').first();await badge.scrollIntoViewIfNeeded();const image=badge.locator('img');await image.evaluate(image=>image.complete?undefined:new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});setTimeout(resolve,5000);}));portraitLoads.push({id,loaded:await image.evaluate(image=>image.complete&&image.naturalWidth>0)});}check('All seven authenticated portrait images load successfully',portraitLoads.every(item=>item.loaded),{portraits:portraitLoads});await tasks.locator('button').first().scrollIntoViewIfNeeded();
 await shot(page,'v2-task-identities');
 await page.goto(base+'/team?mode=demo&workspace='+DEMO+'&view=activity');
 const feed=page.locator('section[aria-labelledby="office-activity-title"]');await feed.waitFor();
 await verifyV2Activity(page,feed,taskIdentities);
 await page.goto(base+'/team?mode=demo&workspace='+DEMO+'&view=scene');
 const scene=page.getByRole('region',{name:'3D office preview',exact:true});const adrian=scene.getByRole('button',{name:/^Adrian\b/});await adrian.waitFor();
 await scene.getByRole('button',{name:'Overview',exact:true}).click();await pause(250);
 check('PC hint explains Ctrl click and hold to pan',await scene.getByText(/PC:\s*Ctrl\s*\+\s*click and hold to pan|Ctrl\s*\+\s*click and hold to pan for PC/i).isVisible());
 const canvas=scene.locator('canvas'),box=await canvas.boundingBox(),sceneBefore=await adrian.boundingBox();
 await page.keyboard.down('Control');await page.mouse.move(box.x+box.width*0.45,box.y+box.height*0.65);await page.mouse.down();await page.mouse.move(box.x+box.width*0.45+90,box.y+box.height*0.65+25,{steps:12});await page.mouse.up();await page.keyboard.up('Control');await pause(200);
 const sceneAfter=await adrian.boundingBox();check('Ctrl plus held left pointer actually pans the room',Math.hypot(sceneAfter.x-sceneBefore.x,sceneAfter.y-sceneBefore.y)>5,{before:sceneBefore,after:sceneAfter});
 await scene.getByRole('button',{name:'Overview',exact:true}).click();await pause(200);
 const currentWork=page.getByRole('heading',{name:'Current work in this workspace',exact:true}).locator('..').locator('..');
 const currentIdentities=await currentWork.locator('[data-role-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.roleId,color:getComputedStyle(node).getPropertyValue('--agent-ink').trim(),image:!!node.querySelector('img')})));
 check('Current work uses the same portrait and role colors as Tasks',currentIdentities.length>0&&currentIdentities.every(item=>item.image&&taskIdentities.some(task=>task.id===item.id&&task.color===item.color)),{identities:currentIdentities});
 await shot(page,'v2-overview');
 check('synthetic business records unchanged',JSON.stringify(beforeDigest)===JSON.stringify(await businessDigest(sql)));
 check('no browser errors in incremental UI acceptance',report.consoleErrors.length===0,{errors:report.consoleErrors});
}
`;

// Activity selectors are intentionally local to the acceptance harness and checked after the peer's
// accessible UI contract is frozen; technical event IDs prove every loaded event remains inspectable.
const activityAddition = String.raw`
async function verifyV2Activity(page,feed,taskIdentities) {
 const expected=report.displayFixture.events.filter(event=>event.workspace===DEMO);
 check('Activity fixture includes at least 67 scoped events',expected.length>=67,{loaded:expected.length});
 const groups=feed.locator('[data-activity-group]');await groups.first().waitFor();
 const initialCount=await groups.count();
 check('Activity begins with a bounded set of collapsed task histories',initialCount<=10&&initialCount>0&&(await feed.locator('[data-event-id]:visible').count())===0,{initialGroups:initialCount});
 await shot(page,'v2-activity-collapsed');
 const more=feed.getByRole('button',{name:/Show \d+ more histories/});let iterations=0;while(await more.count()&&await more.isVisible()&&iterations++<20)await more.click();
 const allGroups=await groups.count();check('Show more reveals additional task histories',allGroups>initialCount,{allGroups});
 for(const group of await groups.all()){const details=group.locator('details').first();if(await details.count()&&!(await details.evaluate(element=>element.open)))await details.locator('summary').first().click();}
 let eventMore=feed.getByRole('button',{name:/Show \d+ earlier events/});iterations=0;while(await eventMore.count()&&iterations++<30){let clicked=false;for(const button of await eventMore.all()){if(await button.isVisible()){await button.click();clicked=true;}}if(!clicked)break;}
 const visibleIds=await feed.locator('[data-event-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.eventId));
 check('Grouped Activity retains every loaded event exactly once',visibleIds.length===expected.length&&new Set(visibleIds).size===expected.length&&expected.every(event=>visibleIds.includes(event.id)),{expected:expected.length,visible:visibleIds.length});
 check('Activity keeps unrelated workspace events outside selected scope',!visibleIds.includes(report.displayFixture.events.find(event=>event.workspace!==DEMO).id));
 const retryIds=expected.filter(event=>['run_failed','retry_scheduled'].includes(event.eventType)).map(event=>event.id);
 check('Failure and retry attempts remain separately inspectable',retryIds.every(id=>visibleIds.includes(id))&&retryIds.length===2);
 for(const id of retryIds){const row=feed.locator('[data-event-id="'+id+'"]'),details=row.locator('details');await details.locator('summary').click();const evidence=await details.innerText(),fixture=expected.find(event=>event.id===id);check('Technical evidence retains '+fixture.eventType+' identity and source',evidence.includes(id)&&evidence.includes(fixture.runId)&&evidence.includes('sample_data'));await details.locator('summary').click();}
 const uuidLines=await feed.locator('[data-event-id] > p:first-of-type').allTextContents();check('Human activity summaries do not lead with raw UUIDs',uuidLines.length>0&&uuidLines.every(line=>!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(line)));
 const eventIdentities=await feed.locator('[data-event-id] [data-role-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.roleId,color:getComputedStyle(node).getPropertyValue('--agent-ink').trim()})));
 check('Activity portraits reuse the same named role colors',eventIdentities.length>0&&eventIdentities.every(item=>taskIdentities.some(task=>task.id===item.id&&task.color===item.color)),{identities:eventIdentities.length});
 await feed.locator('#office-activity-title').scrollIntoViewIfNeeded();await shot(page,'v2-activity-expanded');
 const group=groups.first(),details=group.locator('details').first();if(await details.count()){await details.locator('summary').first().click();check('Activity task history can be collapsed again',!(await details.evaluate(element=>element.open)));}
 await page.setViewportSize({width:390,height:844});check('mobile Activity histories have no page horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(page,'v2-mobile-activity');await page.setViewportSize({width:1512,height:982});
}
`;

function exactlyOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Reviewed story anchor changed: ' + from.slice(0, 90));
  return source.replace(from, to);
}

async function runBrowser() {
  if (!options['production-app']) throw new Error('--production-app is required; this pass never uses dev bypass');
  const root = path.join(base, 'v2-harness-' + run); await mkdir(root);
  const dependencies = JSON.parse((await readFile(path.join(appRoot, 'docs', 'office', 'ui-ux-evidence-20261108', 'dependency-copy.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const modules = path.resolve(dependencies.destination);
  if (!modules.toLowerCase().startsWith(base.toLowerCase() + path.sep) || path.basename(modules) !== 'node_modules') throw new Error('Refused harness dependency target');
  await symlink(modules, path.join(root, 'node_modules'), 'junction');
  const original = await readFile(path.join(here, 'ui-ux.mjs'), 'utf8'); let source = original;
  for (const name of ['lib.mjs', 'ui-ux-dependencies.mjs']) source = exactlyOnce(source, "'./" + name + "'", JSON.stringify(pathToFileURL(path.join(here, name)).href));
  for (const name of ['playwright', 'jose']) source = exactlyOnce(source, "'" + name + "'", JSON.stringify(import.meta.resolve(name)));
  source = exactlyOnce(source, "const evidence=path.join(appRoot,'docs','office','ui-ux-evidence-20261108');", "const evidence=path.join(appRoot,'docs','office','ui-ux-v2-evidence-20261108');");
  source = exactlyOnce(source, 'const PG_PORT=Number(options[\'pg-port\']??55499);', "const PG_PORT=Number(options['pg-port']??55519);");
  source = exactlyOnce(source, 'const APP_PORT=Number(options[\'app-port\']??3138);', "const APP_PORT=Number(options['app-port']??3158);");
  source = exactlyOnce(source, "options['issuer-port']??9448", "options['issuer-port']??9458");
  source = exactlyOnce(source, "'acceptance-'+run", "'v2-acceptance-'+run");
  source = exactlyOnce(source, "await page.screenshot({path:file,fullPage:false});", "await page.evaluate(async()=>{const images=Array.from(document.images).filter(image=>{const box=image.getBoundingClientRect();return box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth;});await Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});setTimeout(resolve,5000);})));});await page.screenshot({path:file,fullPage:false});");
  source = exactlyOnce(source, 'try{\n for(const port of [PG_PORT,APP_PORT])', fixtureAddition.replaceAll('\\`','`').replaceAll('\\${','${') + checksAddition + activityAddition + '\ntry{\n for(const port of [PG_PORT,APP_PORT])');
  source = exactlyOnce(source, 'const before=await businessDigest(sql);', "const before=await businessDigest(sql);if(options['targeted-only']==='true')await seedV2DisplayFixture();");
  source = exactlyOnce(source, "if(options['controls-only']==='true'){", "if(options['targeted-only']==='true'){await targetedV2Checks(page,context,before);await context.close();}else if(options['controls-only']==='true'){");
  source = exactlyOnce(source, 'report.componentHashes=await sourceComponentHashes();', 'report.componentHashes=await sourceComponentHashes();report.harness=' + JSON.stringify({ originalSha256: hash(original), extensionSha256: hash(fixtureAddition + checksAddition + activityAddition), wrapper: path.resolve(fileURLToPath(import.meta.url)), wrapperSha256: hash(await readFile(fileURLToPath(import.meta.url))), scope: options['full-story'] === 'true' ? 'Existing full production story with compact controls' : 'Targeted UI pass 2' }) + ';');
  const entry = path.join(root, 'acceptance.mjs'); await writeFile(entry, source, { flag: 'wx' });
  await writeFile(path.join(root, 'harness.json'), JSON.stringify({ original: path.join(here, 'ui-ux.mjs'), originalSha256: hash(original), generated: entry, generatedSha256: hash(source), productionApp: path.resolve(options['production-app']), productionUsed: false }, null, 2) + '\n', { flag: 'wx' });
  if (options['prepare-only'] === 'true') { console.log(JSON.stringify({ generated: entry, productionUsed: false, executed: false })); return; }
  const args = [entry, '--production-app=' + path.resolve(options['production-app']), '--pg-port=' + (options['pg-port'] ?? 55519), '--app-port=' + (options['app-port'] ?? 3158), '--issuer-port=' + (options['issuer-port'] ?? 9458), ...(options['full-story'] === 'true' ? ['--include-controls=true'] : ['--targeted-only=true'])];
  const log = path.join(root, 'acceptance.log'); const exitCode = await command(process.execPath, args, appRoot, log);
  console.log(JSON.stringify({ passed: exitCode === 0, exitCode, harness: root, log, evidence })); process.exitCode = exitCode;
}

if (options.build === 'true') await buildCandidate(); else await runBrowser();
