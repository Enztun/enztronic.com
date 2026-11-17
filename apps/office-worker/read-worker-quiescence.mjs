// Read-only maintenance fence. It never pauses, cancels or impersonates owner work.
import {createRequire} from 'node:module';
const app='D:\\Enztronic\\apps\\backoffice';const require=createRequire(app+'\\package.json');
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app')throw new Error('Maintenance target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
try{
 const [row]=await sql`SELECT (SELECT count(*)::int FROM backoffice.office_tasks WHERE state NOT IN ('completed','cancelled')) AS open_tasks,(SELECT count(*)::int FROM backoffice.office_dispatch WHERE state='leased') AS leased_steps,(SELECT count(*)::int FROM backoffice.office_runs WHERE finished_at IS NULL AND state NOT IN ('succeeded','failed','cancelled','interrupted')) AS open_runs`;
 const quiescent=Object.values(row).every(value=>value===0);console.log(JSON.stringify({quiescent,...row}));if(!quiescent)process.exitCode=2;
}finally{await sql.end({timeout:2});}
