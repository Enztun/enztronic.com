// Operator read-only checks supplement the owner's genuine browser confirmation.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../backoffice');
const root='C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-4e6c38baf8';
const proof=JSON.parse(fs.readFileSync(path.join(root,'owner-acceptance-db1cddf7-1b8f-4d2e-8074-210cc094562c-verification.json'),'utf8'));
if(!proof.passed||!proof.flatReviewReferencesValid)throw new Error('Owner acceptance verification required');
const require=createRequire(path.join(app,'package.json'));
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app'||process.env.OFFICE_ENABLED!=='true'||(process.env.CLOUDFLARE_ACCESS_DEV_BYPASS||'false')!=='false')throw new Error('Read-only dashboard target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connect_timeout:10,connection:{default_transaction_read_only:'on'}});
try{
 const {createOfficeReadModel}=await import(pathToFileURL(path.join(app,'src/lib/server/office-read-model.ts')).href);
 const {officeHref,parseOfficeLink}=await import(pathToFileURL(path.join(app,'src/lib/office-links.ts')).href);
 const model=createOfficeReadModel(sql);const dashboard=await model.dashboard();
 const output=dashboard.outputs.find(item=>item.link.taskId===proof.taskId&&item.artifactId===proof.acceptedArtifactId);
 let resolved=null;let href=null;
 if(output){href=officeHref(output.link);const request=parseOfficeLink(new URL(href,'https://admin.enztronic.com').searchParams);if(request.kind==='link')resolved=await model.resolveLink(request);}
 const exactRevisionLink=Boolean(output&&output.revision===proof.acceptedRevision&&output.link.artifactId===proof.acceptedArtifactId&&resolved?.status==='ok'&&resolved.artifact==='found'&&resolved.taskId===proof.taskId&&resolved.artifactId===proof.acceptedArtifactId&&resolved.workspaceId===output.link.workspaceId&&resolved.mode==='demo');
 const result={passed:dashboard.state==='available'&&dashboard.worker.online&&output?.status==='owner_accepted'&&exactRevisionLink,operatorReadOnly:true,authenticatedOwnerBrowserTest:false,taskId:proof.taskId,acceptedArtifactId:proof.acceptedArtifactId,acceptedRevision:proof.acceptedRevision,dashboardState:dashboard.state,workerOnline:dashboard.worker.online,roles:dashboard.roles.length,demoTasks:dashboard.modes.demo.tasks,liveTasks:dashboard.modes.live.tasks,pendingDecisions:dashboard.decisions.pending,outputStatus:output?.status??null,exactRevisionLink,href,execution:dashboard.execution};
 if(result.passed)fs.writeFileSync(path.join(root,'dashboard-acceptance-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}catch(error){console.error(JSON.stringify({failed:true,code:error.code||error.name}));process.exitCode=1;}
finally{await sql.end({timeout:2});}
