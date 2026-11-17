// Read-only gate for replacing the corrected live-aware worker with a previous demo worker.
// Does not stop, recover, settle or reconcile anything. Never emits credentials or business rows.
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

export async function readLiveRollbackFence(sql) {
  return sql.begin('isolation level repeatable read read only',async tx=>{
    const [columns]=await tx`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='backoffice' AND table_name='office_runs' AND column_name='provider_dispatched_at') AS live_schema`;
    const [operations]=await tx`SELECT count(*)::int AS count FROM backoffice.office_tool_operations WHERE tool_name='openai_responses' AND state IN ('reserved','unknown_outcome')`;
    const [leases]=await tx`SELECT count(*)::int AS count FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id WHERE t.mode='live' AND d.state='leased' AND d.lease_until>now()`;
    const [holds]=columns.live_schema
      ? await tx`SELECT count(*)::int AS count FROM backoffice.office_runs r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE t.mode='live' AND r.provider_dispatched_at IS NOT NULL AND r.usage_microunits IS NULL AND r.budget_reserved_microunits>0`
      : await tx`SELECT count(*)::int AS count FROM backoffice.office_runs r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE t.mode='live' AND r.usage_microunits IS NULL AND r.budget_reserved_microunits>0`;
    const result={readOnly:true,liveSchema:columns.live_schema,unsettledLiveReservations:holds.count,unresolvedOpenAIOperations:operations.count,activeLiveLeases:leases.count};
    return {...result,canUsePreviousWorker:holds.count===0&&operations.count===0&&leases.count===0};
  });
}

if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  let sql;
  try {
    const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../backoffice'),require=createRequire(app+'/package.json');
    process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
    const url=new URL(process.env.DATABASE_URL);
    if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app')throw new Error('Target refused');
    sql=require('postgres')(url.toString(),{max:1,onnotice(){},connection:{default_transaction_read_only:'on'}});
    const result=await readLiveRollbackFence(sql);console.log(JSON.stringify(result));if(!result.canUsePreviousWorker)process.exitCode=2;
  }catch(error){console.error(JSON.stringify({failed:true,code:error.code??error.name,reason:'Rollback fence could not be verified; do not replace the worker.'}));process.exitCode=1;}
  finally{if(sql)await sql.end({timeout:2});}
}
