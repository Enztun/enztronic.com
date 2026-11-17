import fs from 'node:fs';
import {createRequire} from 'node:module';
const root='C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-4e6c38baf8';
const read=name=>JSON.parse(fs.readFileSync(root+'\\'+name,'utf8').replace(/^\uFEFF/,''));
const windows=read('worker-restart-windows.json');if(!windows.passed)throw new Error('Windows restart has not passed');
const prior=read('activation-verification.json').workers.find(worker=>worker.active&&worker.heartbeat_age_seconds<60)?.id;
const app='D:\\Enztronic\\apps\\backoffice';const require=createRequire(app+'\\package.json');
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app')throw new Error('Read target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
try{
 const first=await sql`SELECT id,heartbeat_at,stopping,extract(epoch FROM clock_timestamp()-heartbeat_at)::float8 AS age FROM backoffice.office_workers ORDER BY heartbeat_at DESC`;
 const current=first.find(worker=>!worker.stopping&&worker.age<60&&worker.id!==prior);
 await new Promise(resolve=>setTimeout(resolve,2200));
 const second=await sql`SELECT id,heartbeat_at,stopping FROM backoffice.office_workers ORDER BY heartbeat_at DESC`;
 const newer=second.find(worker=>worker.id===current?.id);const olderBefore=first.find(worker=>worker.id===prior);const olderAfter=second.find(worker=>worker.id===prior);
 const passed=Boolean(prior&&current&&newer&&new Date(newer.heartbeat_at)>new Date(current.heartbeat_at)&&olderBefore&&olderAfter&&new Date(olderBefore.heartbeat_at).getTime()===new Date(olderAfter.heartbeat_at).getTime());
 const result={passed,newWorkerIdentity:current?.id,previousWorkerIdentity:prior,newHeartbeatAdvancing:Boolean(newer&&current&&new Date(newer.heartbeat_at)>new Date(current.heartbeat_at)),oldHeartbeatNoLongerAdvancing:Boolean(olderBefore&&olderAfter&&new Date(olderBefore.heartbeat_at).getTime()===new Date(olderAfter.heartbeat_at).getTime()),queueWasEmpty:windows.before.quiescent,ownedProcessesStopped:windows.stop.ownedProcessesExited,gracefulStopClaimed:false,productionTasksCreated:false};
 fs.writeFileSync(root+'\\worker-restart-verification.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!passed)process.exitCode=1;
}finally{await sql.end({timeout:2});}
