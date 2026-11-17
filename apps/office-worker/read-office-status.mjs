// Operator read-only evidence, not a signed-in browser or an owner-action test.
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../backoffice');
const require=createRequire(path.join(app,'package.json'));
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app'||process.env.OFFICE_ENABLED!=='true'||(process.env.CLOUDFLARE_ACCESS_DEV_BYPASS||'false')!=='false')throw new Error('Read-only Office status target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connect_timeout:10,connection:{default_transaction_read_only:'on'}});
try{
  const {createOfficeRuntime}=await import(pathToFileURL(path.join(app,'src/lib/office-runtime/index.ts')).href);
  const {createOfficeReadModel}=await import(pathToFileURL(path.join(app,'src/lib/server/office-read-model.ts')).href);
  const snapshot=await createOfficeRuntime(sql).snapshot();
  const dashboard=await createOfficeReadModel(sql).dashboard();
  const activity=await createOfficeReadModel(sql).activity();
  const checks=[];
  for(const [route,status,headers] of [['/',307,{}],['/robots.txt',200,{}],['/api/office',401,{}],['/api/office',401,{'cf-access-authenticated-user-email':'untrusted@example.invalid'}],['/api/office',401,{'cf-access-jwt-assertion':'invalid.invalid.invalid'}]]){
    const response=await fetch('http://127.0.0.1:3100'+route,{redirect:'manual',headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();checks.push({route,status:response.status,passed:response.status===status});
  }
  console.log(JSON.stringify({operatorReadOnly:true,officeAvailable:snapshot.available,enabledAgentProfiles:snapshot.agents.filter(agent=>agent.enabled).length,workspaceModes:snapshot.workspaces.map(workspace=>workspace.mode),taskCount:snapshot.tasks.length,health:snapshot.health,dashboard:{state:dashboard.state,worker:dashboard.worker,roles:dashboard.roles.length,demo:dashboard.modes.demo.tasks,live:dashboard.modes.live.tasks,outputCount:dashboard.outputs.length,pendingDecisions:dashboard.decisions.pending},activity:{roleCount:activity.roles.length,worker:activity.worker},unsignedHttpChecks:checks,authenticatedOwnerBrowserTest:false}));
}catch(error){console.error(JSON.stringify({failed:true,code:error.code||error.name}));process.exitCode=1;}
finally{await sql.end({timeout:2});}
