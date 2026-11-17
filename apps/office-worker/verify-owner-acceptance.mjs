// Read-only follow-up to genuine owner browser actions; never creates decisions.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const root='C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-4e6c38baf8';
const app='D:\\Enztronic\\apps\\backoffice';const require=createRequire(app+'\\package.json');
const requested=process.argv[2]||null;if(requested&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requested))throw new Error('Invalid task identifier');
process.env.NODE_ENV='production';require('@next/env').loadEnvConfig(app,false,{info(){},error(){}});
const url=new URL(process.env.DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.port!=='54329'||url.pathname!=='/enztronic_backoffice'||url.username!=='enztronic_app')throw new Error('Acceptance read target refused');
const sql=require('postgres')(url.toString(),{max:1,onnotice:()=>{},connection:{default_transaction_read_only:'on'}});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
try{
 const result=await sql.begin('isolation level repeatable read read only',async tx=>{
  const parents=requested?await tx`SELECT * FROM backoffice.office_tasks WHERE id=${requested} AND parent_task_id IS NULL AND mode='demo'`:await tx`SELECT * FROM backoffice.office_tasks WHERE parent_task_id IS NULL AND mode='demo' AND (goal ILIKE '%Activation check%' OR goal ILIKE '%Office acceptance demo%') ORDER BY created_at DESC LIMIT 2`;
  if(parents.length!==1)return {passed:false,pending:true,reason:parents.length?'Task identifier required to disambiguate':'No matching owner-created simulated brief yet',matchingParents:parents.length,operatorActionsCreated:0};
  const parent=parents[0];const children=await tx`SELECT id,agent_id,state,current_artifact_id,acceptance_evidence_id FROM backoffice.office_tasks WHERE parent_task_id=${parent.id} AND workspace_id=${parent.workspace_id} ORDER BY agent_id`;
  const artifacts=await tx`SELECT id,task_id,author_agent_id,revision,artifact_hash,content,manifest FROM backoffice.office_artifacts WHERE task_id=${parent.id} OR task_id IN (SELECT id FROM backoffice.office_tasks WHERE parent_task_id=${parent.id})`;
  const reviews=await tx`SELECT id,workspace_id,artifact_id,artifact_hash,reviewer_id,state FROM backoffice.office_reviews WHERE workspace_id=${parent.workspace_id} AND (task_id=${parent.id} OR task_id IN (SELECT id FROM backoffice.office_tasks WHERE parent_task_id=${parent.id}))`;
  const evidence=parent.acceptance_evidence_id?(await tx`SELECT * FROM backoffice.office_acceptance_evidence WHERE id=${parent.acceptance_evidence_id} AND workspace_id=${parent.workspace_id}`)[0]:null;
  const currentPackage=artifacts.find(artifact=>artifact.id===parent.current_artifact_id);
  const reviewedChildren=children.filter(child=>reviews.some(review=>review.artifact_id===child.current_artifact_id&&review.state==='passed'&&review.reviewer_id!==artifacts.find(artifact=>artifact.id===child.current_artifact_id)?.author_agent_id)).length;
  const progress={taskId:parent.id,parentState:parent.state,children:children.map(child=>({agentId:child.agent_id,state:child.state})),reviewedChildren,acceptanceEvidenceId:parent.acceptance_evidence_id,operatorActionsCreated:0};
  if(!evidence||!currentPackage)return {passed:false,pending:true,...progress};
  const [approval]=await tx`SELECT * FROM backoffice.office_approvals WHERE id=${evidence.approval_id}`;
  const [owner]=await tx`SELECT role,archived_at IS NULL AS active FROM backoffice.users WHERE id=${evidence.owner_id}`;
  const manifest=evidence.component_manifest;const manifestValid=Array.isArray(manifest)&&manifest.length===7&&new Set(manifest.map(entry=>entry.childTaskId)).size===7&&canonical(manifest)===canonical(currentPackage.manifest);
  const packageValid=evidence.artifact_id===currentPackage.id&&evidence.artifact_hash.trim()===currentPackage.artifact_hash.trim()&&digest(currentPackage.content)===evidence.artifact_hash.trim();
  const childrenValid=manifestValid&&children.length===7&&children.every(child=>{
    const entry=manifest.find(item=>item.childTaskId===child.id);const artifact=artifacts.find(item=>item.id===child.current_artifact_id);
    return child.state==='completed'&&child.acceptance_evidence_id===evidence.id&&entry&&artifact&&entry.artifactId===artifact.id&&entry.revisionId===artifact.id&&entry.artifactHash===artifact.artifact_hash.trim()&&digest(artifact.content)===entry.artifactHash&&entry.hashAlgorithm==='SHA-256'&&Array.isArray(entry.reviewReferences)&&entry.reviewReferences.length&&entry.reviewReferences.every(id=>reviews.some(review=>review.id===id&&review.artifact_id===artifact.id&&review.artifact_hash.trim()===artifact.artifact_hash.trim()&&review.state==='passed'&&review.reviewer_id!==artifact.author_agent_id));
  });
  const ownerValid=owner?.active&&owner.role==='admin'&&evidence.owner_id===parent.initiating_owner_id&&approval?.deciding_owner_id===evidence.owner_id;
  const approvalValid=approval?.state==='approved'&&approval.acceptance_evidence_id===evidence.id&&approval.artifact_id===currentPackage.id&&approval.artifact_hash.trim()===evidence.artifact_hash.trim()&&approval.action_scope==='accept_internal_proposal_package'&&evidence.action_scope===approval.action_scope&&Boolean(approval.consumed_at);
  const parentReviewed=reviews.some(review=>review.artifact_id===currentPackage.id&&review.artifact_hash.trim()===currentPackage.artifact_hash.trim()&&review.state==='passed'&&review.reviewer_id!==currentPackage.author_agent_id);
  const currentIds=new Set([currentPackage.id,...children.map(child=>child.current_artifact_id)]);
  const expectedReviews=reviews.filter(review=>{
    const artifact=artifacts.find(item=>item.id===review.artifact_id);
    return artifact&&currentIds.has(artifact.id)&&review.workspace_id===parent.workspace_id&&review.state==='passed'&&review.artifact_hash.trim()===artifact.artifact_hash.trim()&&review.reviewer_id!==artifact.author_agent_id;
  });
  const references=evidence.review_references;
  const flatReviewReferencesValid=Array.isArray(references)&&references.length>0&&new Set(references).size===references.length&&references.length===expectedReviews.length&&references.every(id=>expectedReviews.some(review=>review.id===id))&&expectedReviews.every(review=>references.includes(review.id));
  const roles=[...new Set(children.map(child=>child.agent_id))].sort();const sevenRoles=canonical(roles)===canonical(['adrian','clara','leo','lisa','nadia','sam','theo']);
  return {...progress,pending:false,passed:Boolean(parent.state==='completed'&&packageValid&&childrenValid&&ownerValid&&approvalValid&&parentReviewed&&sevenRoles&&flatReviewReferencesValid),packageDigestValid:packageValid,componentManifestValid:manifestValid,coveredChildrenValid:childrenValid,flatReviewReferencesValid,flatReviewReferenceCount:Array.isArray(references)?references.length:0,expectedReviewReferenceCount:expectedReviews.length,realOwnerDecisionConsistent:Boolean(ownerValid),approvalConsumed:Boolean(approvalValid),parentIndependentlyReviewed:parentReviewed,sevenRoleOutputs:sevenRoles,acceptedArtifactId:currentPackage.id,acceptedRevision:currentPackage.revision,acceptedArtifactSha256:currentPackage.artifact_hash.trim(),acceptanceEvidenceId:evidence.id};
 });
 if(result.passed){const file=root+'\\owner-acceptance-'+result.taskId+'-verification.json';if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
 console.log(JSON.stringify(result));if(!result.passed&&!result.pending)process.exitCode=1;
}finally{await sql.end({timeout:2});}
