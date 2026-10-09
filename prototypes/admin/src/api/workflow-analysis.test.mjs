import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './client.ts';
import { validateWorkflowBreakdown, workflowValueLabel } from './workflow-analysis.ts';
import { analyticsCsv } from './csv-export.ts';

const range={from:'2026-10-07',to:'2026-10-08'};
function fixture() {
  const definition={id:'flow',label:'Flow',source:'browser',startEvent:'start',successEvent:'success',failureEvent:null,dimensions:['flag']};
  const registry={project:{id:'example',name:'Example',status:'active',timeZone:'Asia/Seoul'},schemaVersion:1,
    events:['start','success'].map(name=>({name,label:name,source:'browser',properties:{flag:{type:'boolean',required:true,purpose:'Public flag'}}})),workflows:[definition]};
  const meta={projectId:'example',schemaVersion:1,source:'browser',...range,timeZone:'Asia/Seoul',generatedAt:'2026-10-08T12:00:00Z',latestReceivedAt:null,coverage:'observed-only'};
  const counts=(start,success)=>({startedAttempts:start,succeededAttempts:success,failedAttempts:null,pendingAttempts:start-success,completionRate:start?success/start*100:null});
  const bucket=(value,start,success)=>({value,summary:counts(start,success),days:[{date:range.from,...counts(start,success),provisional:false},{date:range.to,...counts(0,0),provisional:true}]});
  const response={meta,workflowId:'flow',cohortBasis:'startedAt',groupBy:'flag',summary:counts(10,6),buckets:[bucket(false,8,4),bucket(true,2,2)]};
  const current={range,summary:{meta,totalEvents:0,events:[{name:'start',count:0},{name:'success',count:0}]},
    workflows:[{definition,response:{meta,workflowId:'flow',cohortBasis:'startedAt',summary:counts(10,6),days:[{date:range.from,...counts(10,6),provisional:false},{date:range.to,...counts(0,0),provisional:true}]}}]};
  return {registry,response,current,counts};
}
test('workflow grouping validates weighted completion, boolean false/integer zero, empty results and null rates',()=>{
  const {registry,response,counts}=fixture(); validateWorkflowBreakdown(response,registry,range,'flow','flag');
  assert.equal(response.summary.completionRate,60);assert.equal(response.buckets[0].days[1].completionRate,null);
  assert.equal(workflowValueLabel(false),'거짓 (false)');assert.equal(workflowValueLabel(0),'0');
  const empty={...response,buckets:[],summary:counts(0,0)};validateWorkflowBreakdown(empty,registry,range,'flow','flag');
  registry.events.forEach(event=>event.properties.flag={type:'integer',required:true,purpose:'Range',minimum:0,maximum:1});
  response.buckets.forEach((bucket,index)=>bucket.value=index);validateWorkflowBreakdown(response,registry,range,'flow','flag');
});
test('grouping rejects wrong contexts, missing/duplicate days or values, unsafe counts and unweighted rates',()=>{
  for (const edit of [r=>r.response.meta.projectId='foreign',r=>r.response.meta.schemaVersion=2,r=>r.response.meta.timeZone='UTC',
    r=>r.response.workflowId='other',r=>r.response.groupBy='other',r=>r.registry.workflows[0].dimensions=[],r=>r.response.buckets[0].value=null,
    r=>r.response.buckets[1].value=false,r=>r.response.buckets[0].days.pop(),r=>r.response.buckets[0].days.reverse(),
    r=>r.response.buckets[0].summary.startedAttempts=Number.MAX_SAFE_INTEGER+1,r=>r.response.summary.completionRate=75,
    r=>r.response.buckets[0].days[0].pendingAttempts++,r=>r.response.buckets[0].days[0].provisional='false',
    r=>r.response.buckets[0].summary.failedAttempts=0,r=>r.response.buckets=[]]) {
    const f=fixture();edit(f);assert.throws(()=>validateWorkflowBreakdown(f.response,f.registry,range,'flow','flag'));
  }
});
test('workflow CSV preserves all values/days and grouping metadata for empty results and rejects stale data',()=>{
  const {registry,response,current,counts}=fixture();
  const file=analyticsCsv({registry,current,view:'goals',workflowSelections:[response]});
  assert.equal(file.text.match(/"workflow_property_total"/g).length,2);assert.equal(file.text.match(/"workflow_property_day"/g).length,4);
  assert.ok(file.text.includes('"boolean","false"'));assert.ok(file.text.includes('"flag"'));
  const empty=analyticsCsv({registry,current,view:'goals',workflowSelections:[{...response,buckets:[],summary:counts(0,0)}]});
  assert.ok(empty.text.includes('"workflow_property_summary"'));assert.ok(empty.text.includes('"flag"'));
  assert.throws(()=>analyticsCsv({registry,current,view:'goals',workflowSelections:[response,response]}));
  assert.throws(()=>analyticsCsv({registry,current,view:'events',workflowSelections:[response]}));
  const bad=structuredClone(response);bad.meta.to='2026-10-09';assert.throws(()=>analyticsCsv({registry,current,view:'goals',workflowSelections:[bad]}));
});
test('workflow breakdown transport encodes endpoint, groupBy and signal and rejects mismatched echo',async()=>{
  const {response}=fixture();let seen;const controller=new AbortController();
  const client=new ApiClient({token:'not-a-credential',fetchImpl:async(url,init)=>{seen={url,init};return {ok:true,status:200,json:async()=>response};}});
  assert.deepEqual(await client.getWorkflowBreakdown('example','flow',{schemaVersion:1,...range,groupBy:'flag',signal:controller.signal}),response);
  assert.equal(new URL(seen.url,'https://example.invalid').pathname,'/v1/projects/example/workflows/flow/breakdown');
  assert.equal(new URL(seen.url,'https://example.invalid').searchParams.get('groupBy'),'flag');assert.equal(seen.init.signal.aborted,false);
  await assert.rejects(client.getWorkflowBreakdown('example','flow',{schemaVersion:1,...range,groupBy:'other'}),error=>error.kind==='contract');
  response.buckets[0].value=null;await assert.rejects(client.getWorkflowBreakdown('example','flow',{schemaVersion:1,...range,groupBy:'flag'}),error=>error.kind==='contract');
});
