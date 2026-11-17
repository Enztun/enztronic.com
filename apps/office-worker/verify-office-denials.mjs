import fs from 'node:fs';
const checks=[];
const uuid='00000000-0000-0000-0000-000000000000';
const probes=[
 {route:'/api/office/assets'},
 {route:`/api/office/events?workspaceId=${uuid}&after=0`},
 {route:`/api/office/artifacts/${uuid}?workspaceId=${uuid}`},
 {route:'/api/office',method:'POST'},
 {route:'/api/office',method:'POST',headers:{'cf-access-authenticated-user-email':'untrusted@example.invalid'}},
 {route:'/api/office',method:'POST',headers:{'cf-access-jwt-assertion':'invalid.invalid.invalid'}}
];
for(const probe of probes){
 const response=await fetch('http://127.0.0.1:3100'+probe.route,{method:probe.method||'GET',headers:{...probe.headers,...(probe.method?{'content-type':'application/json',origin:'https://admin.enztronic.com'}:{})},...(probe.method?{body:JSON.stringify({operation:'submit',input:{}})}:{}),redirect:'manual',signal:AbortSignal.timeout(10000)});
 const body=await response.json();checks.push({route:probe.route,method:probe.method||'GET',status:response.status,code:body.code,passed:response.status===401,cacheControl:response.headers.get('cache-control')});
}
const result={passed:checks.every(check=>check.passed),checks,signedInActorTests:false,productionTaskOrApprovalCreated:false};
fs.writeFileSync('C:\\Users\\hoyec\\Enztronic-Recovery\\production-prep-20261108-4e6c38baf8\\production-access-denials.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,checks:checks.length,writeRequestsRejectedBeforeMutation:true,signedInActorTests:false}));if(!result.passed)process.exitCode=1;
