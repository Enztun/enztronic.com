// Read-only live-service checks after the complete UI build promotion.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const app='D:\\Enztronic\\apps\\backoffice';
async function main(){
const root=path.resolve(process.argv[2]||'');
if(path.dirname(root).toLowerCase()!=='c:\\users\\hoyec\\enztronic-recovery'||!/^ui-ux-release-20261108-[a-f0-9]{10}$/.test(path.basename(root))||fs.realpathSync(root).toLowerCase()!==root.toLowerCase())throw new Error('UI verification root refused');
const context=JSON.parse(fs.readFileSync(path.join(root,'ui-release-context.json'),'utf8'));
const require=createRequire(path.join(app,'package.json'));
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app'||process.env.OFFICE_ENABLED!=='true'||(process.env.CLOUDFLARE_ACCESS_DEV_BYPASS||'false')!=='false')throw new Error('Live UI target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
try{
 const seen=new Map();let worker=null;
 for(let attempt=0;attempt<30;attempt++){
  const [current]=await sql`SELECT id,heartbeat_at,extract(epoch FROM clock_timestamp()-heartbeat_at)::float8 AS age FROM backoffice.office_workers WHERE NOT stopping ORDER BY heartbeat_at DESC LIMIT 1`;
  if(current){const stamp=new Date(current.heartbeat_at).getTime();if(current.age>=0&&current.age<60&&stamp>(seen.get(current.id)??Infinity)){worker={id:current.id,heartbeatAdvancing:true,heartbeatAgeSeconds:current.age};break;}seen.set(current.id,stamp);}
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 const checks=[];
 for(const [route,expected,headers] of [['/',307,{}],['/robots.txt',200,{}],['/api/office',401,{}],['/api/office',401,{'cf-access-authenticated-user-email':'untrusted@example.invalid'}],['/api/office',401,{'cf-access-jwt-assertion':'invalid.invalid.invalid'}]]){
  const response=await fetch('http://127.0.0.1:3100'+route,{redirect:'manual',headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();checks.push({route,status:response.status,passed:response.status===expected});
 }
 const access=await fetch('https://admin.enztronic.com/team',{redirect:'manual',signal:AbortSignal.timeout(15000)});await access.arrayBuffer();const issuer=new URL(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN.includes('://')?process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN:'https://'+process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN).origin;
 const accessGate=access.status===302&&new URL(access.headers.get('location'),'https://admin.enztronic.com').origin===issuer;
 const website=await fetch('https://www.enztronic.com/',{signal:AbortSignal.timeout(15000)});await website.arrayBuffer();
 const [{count}]=await sql`SELECT count(*)::int AS count FROM backoffice.office_agents WHERE enabled`;
 const buildId=fs.readFileSync(path.join(app,'.next','BUILD_ID'),'utf8').trim();
 const result={passed:Boolean(worker)&&checks.every(check=>check.passed)&&accessGate&&website.status===200&&count===7&&buildId===context.acceptedBuildId,clientDate:'2026-11-08',machineUtc:new Date().toISOString(),buildId,worker,enabledProfiles:count,localChecks:checks,cloudflareAccessGateWorking:accessGate,publicWebsiteStatus:website.status,officeEnabled:true,developmentBypass:false,productionDatabaseWrites:0,authenticatedOwnerBrowserTest:false,ownerBrowserFollowUp:'Refresh the existing signed-in Office tab to inspect the new layout and physical-device rendering.'};
 fs.writeFileSync(path.join(root,'ui-live-service-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}finally{await sql.end({timeout:2});}
}
main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||error.name,detail:'Live UI verification failed; no credential values emitted.'}));process.exitCode=1;});
