// Office UX acceptance against a new secret-free source snapshot and disposable database.
// Production ports/configuration/records are never used. All created processes are owned.
import { randomUUID, createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { exportJWK,generateKeyPair,SignJWT } from 'jose';
import {
  appRoot, workerRoot, OWNER_EMAIL, applyMigrations, assertTestPort, businessDigest, connect,
  createCluster, createWorkerRole, finalizeRun, minimalEnv, seedSyntheticBusiness,
  snapshotWorkingTree, stamp, startProcess, stopProcess, waitFor,realSystem,
} from './lib.mjs';
import { attachUiDependencies } from './ui-ux-dependencies.mjs';

const options=Object.fromEntries(process.argv.slice(2).map(value=>value.replace(/^--/,'').split('=')));
const PG_PORT=Number(options['pg-port']??55499);
const APP_PORT=Number(options['app-port']??3138);
const run=stamp()+'-'+randomUUID().slice(0,8);
const root=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108','acceptance-'+run);
const productionApp=options['production-app']?path.resolve(options['production-app']):null;
const app=productionApp??path.join(root,'app');
const shots=path.join(root,'screenshots');
const evidence=path.join(appRoot,'docs','office','ui-ux-evidence-20261108');
const report={run,startedAt:new Date().toISOString(),isolation:{productionUsed:false,pgPort:PG_PORT,appPort:APP_PORT,snapshot:app,root},checks:[],screenshots:[],consoleErrors:[],consoleWarnings:[]};
const DEMO='00000000-0000-4000-8000-000000000001';
const goal='Office UX acceptance '+run;
let sql=null,browser=null,failure=null,issuerServer=null,activePage=null;
let authenticationHeaders={};
const note=(event,details={})=>console.log(JSON.stringify({event,...details}));
function check(name,passed,details={}){report.checks.push({name,passed:!!passed,...details});note(passed?'passed':'failed',{name,...details});if(!passed)throw new Error(name);}
async function shot(page,name){const file=path.join(shots,name+'.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push(file);}
const officeButton=(page,name)=>page.getByRole('button',{name,exact:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function observePage(page){activePage=page;page.on('pageerror',error=>report.consoleErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());else if(message.type()==='warning')report.consoleWarnings.push(message.text());});}
async function clickFiltersIfNeeded(page){
 const person=page.getByRole('combobox',{name:'Person',exact:true});
 if(await person.isVisible().catch(()=>false))return;
 const summary=page.locator('summary').filter({hasText:/Filters/}).first();
 if(await summary.count())await summary.click();
 else {const button=page.getByRole('button',{name:/Filters/}).first();if(await button.count())await button.click();}
}
async function selectPerson(page,id){await clickFiltersIfNeeded(page);await page.getByRole('combobox',{name:'Person',exact:true}).selectOption(id);}
async function compactControls(page){
 const info=page.getByRole('button',{name:'Office information',exact:true});const tooltip=page.getByRole('tooltip');
 await info.hover();await tooltip.waitFor();check('Office information opens on hover',await tooltip.isVisible());await page.keyboard.press('Escape');await tooltip.waitFor({state:'hidden'});check('hover-open information closes on Escape',await info.getAttribute('aria-expanded')==='false');await page.mouse.move(1,1);
 await info.focus();await tooltip.waitFor();check('Office information opens on keyboard focus',await tooltip.isVisible());await page.keyboard.press('Escape');await tooltip.waitFor({state:'hidden'});check('Office information closes on Escape',await info.getAttribute('aria-expanded')==='false');
 const filters=page.getByRole('button',{name:/^Filters/});check('filters are collapsed by default',await filters.getAttribute('aria-expanded')==='false');await filters.click();const person=page.getByRole('combobox',{name:'Person',exact:true});await person.selectOption('adrian');await page.getByRole('button',{name:'Done',exact:true}).click();
 check('active filter badge remains after Done closes filters',await filters.getAttribute('aria-expanded')==='false'&&/1/.test(await filters.textContent())&&!(await person.isVisible()));await filters.click();check('selected person filter is retained',await person.inputValue()==='adrian');await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
 const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,colorScheme:'dark',reducedMotion:'reduce',extraHTTPHeaders:authenticationHeaders});const mobilePage=await mobile.newPage();observePage(mobilePage);await mobilePage.goto('http://127.0.0.1:'+APP_PORT+'/team');await mobilePage.getByText('Welcome to the office!',{exact:true}).waitFor();
 const mobileInfo=mobilePage.getByRole('button',{name:'Office information',exact:true});await mobileInfo.tap();const mobileTooltip=mobilePage.getByRole('tooltip');await mobileTooltip.waitFor();check('Office information opens on a mobile tap',await mobileTooltip.isVisible());await shot(mobilePage,'07-mobile-office-information');
 const rect=await mobileTooltip.boundingBox();check('mobile information stays within the viewport',rect.x>=-1&&rect.x+rect.width<=391&&rect.y>=-1&&rect.y+rect.height<=845,{rect});await mobilePage.getByRole('heading',{name:'Office',exact:true,level:1}).tap();await mobileTooltip.waitFor({state:'hidden'});check('mobile information closes on outside pointer',await mobileInfo.getAttribute('aria-expanded')==='false');await mobile.close();activePage=page;
}
async function sourceComponentHashes(){
 const directory=path.join(app,'src','components','office');
 const entries=[];
 for(const name of (await readdir(directory)).filter(name=>/\.(tsx|ts|css)$/.test(name))){const bytes=await readFile(path.join(directory,name));entries.push({name,sha256:createHash('sha256').update(bytes).digest('hex')});}
 return entries;
}
async function waitForDev(base){
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){
  if(await access(path.join(root,'abort')).then(()=>true,()=>false))throw new Error('Operator requested owned fixture shutdown');
  const response=await fetch(base+'/team',{redirect:'manual',headers:authenticationHeaders}).catch(()=>null);if(response&&response.status<500){await response.arrayBuffer();return;}
  const log=await readFile(path.join(root,'app.log'),'utf8').catch(()=>'');
  if(/Module not found|MODULE_NOT_FOUND|Failed to compile|SyntaxError|AccessAuthenticationError/.test(log))throw new Error('Isolated server startup failed; see retained app.log');
  await pause(1500);
 }
 throw new Error('Isolated development server startup timed out');
}
async function syntheticProductionAuth(){
 const port=Number(options['issuer-port']??9448);await assertTestPort(port);await mkdir(root,{recursive:true});
 const caFile=path.join(root,'test-issuer-ca.pem');
 // Reuse the reviewed production-smoke certificate recipe. Git OpenSSL's default req config
 // can emit duplicate BasicConstraints when an extension is also supplied on its CLI.
 const tlsPython=String.raw`import json,datetime,ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import hashes,serialization
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Office isolated UX issuer')])
now=datetime.datetime.now(datetime.timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(hours=2)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).sign(k,hashes.SHA256())
print(json.dumps({'key':k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.TraditionalOpenSSL,serialization.NoEncryption()).decode(),'cert':c.public_bytes(serialization.Encoding.PEM).decode()}))`;
 const tlsProcess=spawnSync(path.join(process.env.LOCALAPPDATA,'Programs','Python','Python313','python.exe'),['-c',tlsPython],{windowsHide:true,encoding:'utf8',env:minimalEnv()});
 if(tlsProcess.status!==0)throw new Error('Unable to create isolated HTTPS issuer certificate');const tls=JSON.parse(tlsProcess.stdout);await writeFile(caFile,tls.cert,{flag:'wx'});
 const {privateKey,publicKey}=await generateKeyPair('RS256');const kid='office-ux-'+randomUUID();const key={...await exportJWK(publicKey),kid,alg:'RS256',use:'sig'};
 const issuer='https://127.0.0.1:'+port;const audience='office-ui-ux-fixture';
 const token=await new SignJWT({email:OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid}).setSubject(OWNER_EMAIL).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('20m').sign(privateKey);
 issuerServer=https.createServer({key:tls.key,cert:tls.cert},(request,response)=>{if(request.url==='/cdn-cgi/access/certs'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({keys:[key]}));}else{response.writeHead(404);response.end();}});
 await new Promise((resolve,reject)=>{issuerServer.once('error',reject);issuerServer.listen(port,'127.0.0.1',resolve);});
 authenticationHeaders={'cf-access-jwt-assertion':token};
 report.isolation.authentication='Synthetic RS256 owner assertion verified through a loopback HTTPS JWKS; production mode, bypass false';report.isolation.issuerPort=port;
 return {NODE_EXTRA_CA_CERTS:caFile,CLOUDFLARE_ACCESS_DEV_BYPASS:'false',CLOUDFLARE_ACCESS_TEAM_DOMAIN:issuer,CLOUDFLARE_ACCESS_AUDIENCE:audience,CLOUDFLARE_ACCESS_ALLOWED_EMAILS:OWNER_EMAIL};
}

try{
 for(const port of [PG_PORT,APP_PORT])await assertTestPort(port);
 if(productionApp){
  const expectedBase=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108');
  if(!productionApp.toLowerCase().startsWith(expectedBase.toLowerCase()+path.sep)||path.basename(productionApp)!=='app'||(await readdir(productionApp)).some(name=>name.startsWith('.env')))throw new Error('Refused production-mode fixture app');
  report.isolation.buildId=(await readFile(path.join(productionApp,'.next','BUILD_ID'),'utf8')).trim();report.isolation.environmentFiles=0;
 }else{
  const snapshot=await snapshotWorkingTree(app);report.isolation.snapshotFiles=snapshot.files;report.isolation.manifest=snapshot.manifest;report.isolation.environmentFiles=0;
  report.isolation.dependencies=await attachUiDependencies(app);
 }
 await mkdir(shots,{recursive:true});await mkdir(evidence,{recursive:true});
 report.componentHashes=await sourceComponentHashes();
 const cluster=await createCluster({root:path.join(root,'pg'),port:PG_PORT,pgBin:'C:\\Program Files\\PostgreSQL\\17\\bin',log:message=>note('fixture',{message})});
 sql=connect(cluster.url);await applyMigrations(sql);await seedSyntheticBusiness(sql);const role=await createWorkerRole(sql,PG_PORT);
 const before=await businessDigest(sql);
 const fixtureAuth=productionApp?await syntheticProductionAuth():{CLOUDFLARE_ACCESS_DEV_BYPASS:'true',CLOUDFLARE_ACCESS_DEV_EMAIL:OWNER_EMAIL,OFFICE_BUILD_DIR:'.next-office-dev'};
 const appHandle=startProcess('ui-ux-owner',process.execPath,[path.join(app,'node_modules','next','dist','bin','next'),productionApp?'start':'dev',...(!productionApp?['--webpack']:[]),'--hostname','127.0.0.1','--port',String(APP_PORT)],{cwd:app,env:minimalEnv({NODE_ENV:productionApp?'production':'development',NEXT_TELEMETRY_DISABLED:'1',OFFICE_ENABLED:'true',DATABASE_URL:cluster.url,...fixtureAuth}),logFile:path.join(root,'app.log'),ports:[APP_PORT]});
 report.isolation.appPid=appHandle.pid;
 const base='http://127.0.0.1:'+APP_PORT;await waitForDev(base);
 browser=await chromium.launch({headless:true,env:minimalEnv(),args:['--enable-unsafe-swiftshader']});
 let context=await browser.newContext({viewport:{width:1512,height:982},reducedMotion:'reduce',colorScheme:'dark',extraHTTPHeaders:authenticationHeaders});
 let page=await context.newPage();page.setDefaultTimeout(45000);
 observePage(page);
 await page.goto(base+'/team');
 await page.getByRole('heading',{name:'Office',exact:true,level:1}).waitFor();
 await page.getByText('Welcome to the office!',{exact:true}).waitFor();
 if(productionApp){const themeNonce=await page.locator('script').evaluateAll(scripts=>{const theme=scripts.find(script=>script.textContent.includes('localStorage.getItem("enztronic-theme")'));return theme?.nonce??null;});check('theme initializer carries the request CSP nonce',typeof themeNonce==='string'&&themeNonce.length>=16);check('stored/system theme initializes before interaction',await page.locator('html').getAttribute('data-theme')==='dark');}
 check('welcome copy is concise',await page.getByText('Welcome to the office!',{exact:true}).isVisible());
 check('fictional persona badge removed',await page.getByText('Fictional AI persona',{exact:true}).count()===0);
 check('large demonstration box removed',await page.getByText('Demonstration · deterministic test adapter',{exact:true}).count()===0);
 const sidebar=page.locator('aside[aria-label$=" profile"]');
 await sidebar.waitFor();const sideBox=await sidebar.boundingBox();const headingBox=await page.getByRole('heading',{name:'Office',level:1,exact:true}).boundingBox();
 check('desktop profile panel is compact',sideBox.height<=560,{height:Math.round(sideBox.height)});
 check('desktop content begins without tall diagnostic stack',sideBox.y-headingBox.y<250,{headerHeight:Math.round(sideBox.y-headingBox.y)});
 const profileButton=sidebar.getByRole('button',{name:/profile/i}).first();await profileButton.click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 check('profile details are available on demand',await dialog.getByText('Responsibility',{exact:true}).isVisible()&&await dialog.getByText('Working rule',{exact:true}).isVisible());
 await page.keyboard.press('Tab');const focusInside=await dialog.evaluate(element=>element.contains(document.activeElement));check('profile keyboard focus stays in dialog',focusInside);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 check('profile closes on Escape and returns focus',await profileButton.evaluate(element=>element===document.activeElement));
 await shot(page,'01-desktop-office');
 if(options['controls-only']==='true'){
  report.scope='Additional compact information and filter controls';await compactControls(page);await context.close();check('no browser errors in compact controls',report.consoleErrors.length===0,{errors:report.consoleErrors});
 }else{
 if(options['include-controls']==='true')await compactControls(page);
 const scene=page.getByRole('region',{name:'3D office preview',exact:true});
 await scene.locator('canvas').waitFor();await scene.getByText('Opening your office…',{exact:true}).waitFor({state:'hidden'});await pause(500);
 const canvasBox=await scene.locator('canvas').boundingBox();const controls=scene.getByRole('group',{name:'Office scene controls',exact:true});const controlBox=await controls.boundingBox();
 check('3D canvas is above its controls',canvasBox&&controlBox&&controlBox.y>=canvasBox.y+canvasBox.height-2,{canvasBottom:Math.round(canvasBox.y+canvasBox.height),controlsTop:Math.round(controlBox.y)});
 report.sceneDiagnostics=await scene.evaluate(element=>({text:element.innerText,buttons:Array.from(element.querySelectorAll('button')).map(button=>({text:button.textContent,label:button.getAttribute('aria-label'),rect:button.getBoundingClientRect().toJSON()})),canvasCount:element.querySelectorAll('canvas').length}));await shot(page,'02a-scene-after-ready');
 const scenePeople=[];for(const name of ['Adrian','Clara','Nadia','Leo','Lisa','Sam','Theo']){const button=scene.getByRole('button',{name:new RegExp('^'+name+'\\b')});await button.waitFor();scenePeople.push(name);}
 check('all seven 3D persona names are selectable',scenePeople.length===7);
 await scene.getByRole('button',{name:/^Theo\b/}).click();await sidebar.getByRole('heading',{name:'Theo',exact:true}).waitFor();await pause(300);await shot(page,'02b-selected-theo');
 check('3D name selection opens the matching compact profile',await sidebar.getByRole('heading',{name:'Theo',exact:true}).isVisible());
 await scene.getByRole('button',{name:'Overview',exact:true}).click();await scene.getByRole('button',{name:'Zoom in',exact:true}).click();await scene.getByRole('button',{name:'Zoom out',exact:true}).click();
 const about=scene.locator('summary[aria-label="About the 3D office"]');await about.click();check('3D details are available by click',await scene.getByText(/static figures are original stylized previews/i).isVisible());await about.click();
 await shot(page,'02-desktop-scene');

 // Real browser save; no worker yet. Dismissal must not remove the saved task.
 await officeButton(page,'New internal brief').click();const form=page.locator('section[aria-labelledby="office-new-brief-title"]');
 await form.getByLabel('Goal',{exact:true}).fill(goal);await form.getByLabel('Brief and permitted source references').fill('Synthetic internal UI acceptance only. Prepare a simple website proposal. No client or financial records. Do not send, publish, deploy or execute anything.');
 await form.getByRole('button',{name:'Save simulated brief',exact:true}).click();const saved=page.getByText(/Saved as task [0-9a-f-]{36}/);await saved.waitFor();
 const taskId=(await saved.textContent()).match(/[0-9a-f-]{36}/)[0];report.taskId=taskId;
 const successNotice=saved.locator('xpath=ancestor::*[@role="status"][1]');const dismiss=successNotice.getByRole('button',{name:/dismiss/i});await dismiss.click();await saved.waitFor({state:'hidden'});
 check('save notification can be dismissed without deleting task',(await sql`SELECT count(*)::int AS n FROM backoffice.office_tasks WHERE id=${taskId}`)[0].n===1);
 await page.reload();await page.locator('#office-task-detail').getByRole('heading',{name:goal,exact:true}).waitFor();check('saved task persists and exact selection reloads',new URL(page.url()).searchParams.get('task')===taskId);
 await shot(page,'03-saved-task');

 // A real claimed fixture lease tests the new elapsed timer without pretending queueing is work.
 const leaseFile=path.join(root,'lease.json');const zombie=startProcess('ui-ux-claimed-lease',process.execPath,['--import',pathToFileURL(path.join(appRoot,'node_modules','tsx','dist','loader.mjs')).href,path.join(appRoot,'scripts','office-acceptance','zombie-lease.ts'),'claim',role.url,leaseFile],{cwd:appRoot,env:minimalEnv(),logFile:path.join(root,'lease.log')});
 const zombieExit=await zombie.exited;if(zombieExit.code!==0)throw new Error('Fixture lease claim failed');const claimed=JSON.parse(await readFile(leaseFile,'utf8'));check('timer test uses a real fixture lease',!!claimed.lease?.runId);
 const statusReads=[];page.on('response',response=>{if(new URL(response.url()).pathname==='/api/office/status'&&response.ok())response.json().then(body=>statusReads.push(body),()=>{});});
 await page.clock.install();await page.reload();await selectPerson(page,claimed.lease.agentId);await page.getByRole('button',{name:'Refresh office records',exact:true}).click();await page.getByRole('button',{name:'Refresh office records',exact:true}).and(page.locator(':enabled')).waitFor();
 const elapsed=sidebar.locator('[aria-label^="Elapsed work time"]');await elapsed.waitFor();
 const leased=await waitFor(()=>statusReads.at(-1)?.roles?.find(item=>item.agentId===claimed.lease.agentId&&item.mode==='demo')?.leasedRuns?.find(item=>item.id===claimed.lease.runId),{timeoutMs:15000,intervalMs:100,label:'real leased run in the browser status response'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+50));const firstElapsed=await elapsed.textContent();await page.clock.runFor(2100);const secondElapsed=await elapsed.textContent();
 check('active profile elapsed time ticks while its real lease is live',firstElapsed!==secondElapsed,{first:firstElapsed,second:secondElapsed});
 await page.clock.runFor(leased.leaseRemainingMs+1000);await sidebar.locator('[data-indicator="stalled"]').waitFor();
 check('expired local lease stops the work timer',await elapsed.count()===0);await shot(page,'03b-lease-expired-timer-stopped');
 // Clock is a BrowserContext resource in the installed Playwright, so a new page would inherit
 // its paused RAF/timers. End that context and use an unmocked one for the remaining real workflow.
 await context.close();context=await browser.newContext({viewport:{width:1512,height:982},reducedMotion:'reduce',colorScheme:'dark',extraHTTPHeaders:authenticationHeaders});page=await context.newPage();page.setDefaultTimeout(45000);observePage(page);

 const worker=startProcess('ui-ux-worker',process.execPath,['--import',pathToFileURL(path.join(workerRoot,'node_modules','tsx','dist','loader.mjs')).href,path.join(workerRoot,'src','index.ts')],{cwd:workerRoot,stdin:'pipe',env:minimalEnv({OFFICE_ENABLED:'true',OFFICE_DEMO_WORKER:'true',OFFICE_WORKER_DATABASE_URL:role.url,OFFICE_WORKER_CONCURRENCY:'1',OFFICE_WORKER_LOG_DIRECTORY:path.join(root,'worker-logs'),OFFICE_WORKER_SUPERVISED:'true'}),logFile:path.join(root,'worker.log')});
 report.isolation.workerPid=worker.pid;
 await waitFor(async()=>{const [task]=await sql`SELECT state FROM backoffice.office_tasks WHERE id=${taskId}`;return task.state==='waiting_for_owner_approval';},{timeoutMs:240000,label:'seven reviewed specialist outputs and final package'});
 await page.goto(`${base}/team?mode=demo&workspace=${DEMO}&task=${taskId}&view=inbox`);await page.locator('article[aria-current="true"]').getByRole('button',{name:'Accept this internal package',exact:true}).click();
 const accepted=page.getByText(/Accepted\. Acceptance evidence [0-9a-f-]{36}/);await accepted.waitFor();await accepted.locator('xpath=ancestor::*[@role="status"][1]').getByRole('button',{name:/dismiss/i}).click();await accepted.waitFor({state:'hidden'});
 const terminalDismiss=page.getByRole('button',{name:'Dismiss completed task notification',exact:true});await terminalDismiss.click();check('completed task notification also has a working dismiss control',await terminalDismiss.count()===0);
 const tasks=await sql`SELECT state,acceptance_evidence_id FROM backoffice.office_tasks WHERE id=${taskId} OR parent_task_id=${taskId}`;const acceptanceIds=new Set(tasks.map(task=>task.acceptance_evidence_id));
 check('dismissible final notification preserves accepted parent and seven children',tasks.length===8&&tasks.every(task=>task.state==='completed')&&acceptanceIds.size===1&&!acceptanceIds.has(null));
 const artifacts=await sql`SELECT id,revision,artifact_hash,encode(sha256(convert_to(content,'UTF8')),'hex')=artifact_hash AS digest_matches FROM backoffice.office_artifacts WHERE task_id=${taskId} OR task_id IN (SELECT id FROM backoffice.office_tasks WHERE parent_task_id=${taskId})`;
 const reviews=await sql`SELECT r.state,r.reviewer_id<>a.author_agent_id AS independent FROM backoffice.office_reviews r JOIN backoffice.office_artifacts a ON a.id=r.artifact_id WHERE r.task_id=${taskId} OR r.task_id IN (SELECT id FROM backoffice.office_tasks WHERE parent_task_id=${taskId})`;
 check('review and immutable artifact evidence survives UX changes',artifacts.length===8&&artifacts.every(artifact=>artifact.digest_matches)&&reviews.length===8&&reviews.every(review=>review.state==='passed'&&review.independent));
 await page.goto(base+'/dashboard');const panel=page.locator('section[aria-labelledby="dashboard-office-title"]');await panel.getByText('Owner accepted',{exact:true}).first().waitFor();
 const [parent]=await sql`SELECT current_artifact_id FROM backoffice.office_tasks WHERE id=${taskId}`;const output=panel.locator(`a[href*="task=${taskId}"][href*="artifact=${parent.current_artifact_id}"]`).first();const expectedHref=await output.getAttribute('href');await output.click();await page.waitForURL(url=>url.pathname==='/team'&&url.searchParams.get('task')===taskId&&url.searchParams.get('artifact')===parent.current_artifact_id);
 check('Dashboard opens the exact accepted revision',new URL(page.url()).searchParams.get('artifact')===parent.current_artifact_id,{expectedHref,settledUrl:new URL(page.url()).pathname+new URL(page.url()).search});await page.locator('#office-task-detail').locator('pre[aria-label$=", revision 1"]').waitFor();
 await page.reload();await page.locator('#office-task-detail').locator('pre[aria-label$=", revision 1"]').waitFor();check('exact accepted revision survives reload',new URL(page.url()).searchParams.get('artifact')===parent.current_artifact_id);await shot(page,'04-accepted-package');
 await page.goto(base+'/team');const finalScene=page.getByRole('region',{name:'3D office preview',exact:true});await finalScene.getByRole('button',{name:/^Adrian\b/}).waitFor();await page.getByText('Office online',{exact:true}).waitFor();await finalScene.getByRole('button',{name:'Overview',exact:true}).click();await pause(400);await shot(page,'05-desktop-ready');
 await page.setViewportSize({width:390,height:844});await pause(300);check('mobile Office has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(page,'05-mobile-office');
 const mobileSidebar=page.locator('aside[aria-label$=" profile"]');await mobileSidebar.getByRole('button',{name:'Profile',exact:true}).click();const mobileDialog=page.getByRole('dialog');await mobileDialog.waitFor();check('mobile profile details fit the viewport',await mobileDialog.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&box.height<=innerHeight;}));await shot(page,'06-mobile-profile');await page.keyboard.press('Escape');
 await context.close();check('synthetic business records unchanged',JSON.stringify(before)===JSON.stringify(await businessDigest(sql)));check('no uncaught browser errors',report.consoleErrors.length===0,{errors:report.consoleErrors});
 worker.child.stdin.write('stop\n');const exit=await Promise.race([worker.exited,pause(30000).then(()=>null)]);if(!exit)await stopProcess(worker);
 }
}catch(error){failure=error;if(activePage&&!activePage.isClosed()){await shot(activePage,'failure').catch(()=>{});report.failurePageText=(await activePage.locator('body').innerText().catch(()=>'')).slice(0,8000);}note('failure',{message:error.message});}
finally{
 const result=await finalizeRun({report,failure,closers:[...(browser?[['browser',()=>browser.close()]]:[]),...(sql?[['database',()=>sql.end({timeout:5})]]:[]),...(issuerServer?[['synthetic HTTPS issuer',()=>new Promise((resolve,reject)=>{if(!issuerServer.listening)return resolve();issuerServer.closeAllConnections();issuerServer.close(error=>error?reject(error):resolve());})]]:[])]});
 if(issuerServer){report.isolation.issuerPortClosed=!(await realSystem.portOpen(report.isolation.issuerPort));if(!report.isolation.issuerPortClosed){report.cleanup.passed=false;report.cleanup.unresolved.push({kind:'https',port:report.isolation.issuerPort,reason:'fixture_listener_remaining'});report.passed=false;result.passed=false;result.exitCode=1;}}
 report.completedAt=new Date().toISOString();await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,'ui-ux-browser-report-'+run+'.json'),JSON.stringify(report,null,2)+'\n');
 await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n').catch(()=>{});note('complete',{passed:result.passed,checks:report.checks.length,root,cleanupPassed:report.cleanup.passed});process.exitCode=result.exitCode;
}
