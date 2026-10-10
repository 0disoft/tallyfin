import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './client.ts';
import { compareWorkflowProperties, validateWorkflowBreakdown, workflowValueLabel } from './workflow-analysis.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';
import { previousRange } from './period-comparison.ts';

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
function comparisonFixture() {
  const f = fixture(), prior = previousRange(range), previous = structuredClone(f.current), response = structuredClone(f.response);
  previous.range = prior;
  for (const meta of [previous.summary.meta, previous.workflows[0].response.meta, response.meta]) Object.assign(meta, prior);
  for (const days of [previous.workflows[0].response.days, ...response.buckets.map(bucket => bucket.days)]) {
    days[0].date = prior.from; days[1].date = prior.to;
  }
  return { ...f, previous, priorResponse: response };
}

test('property comparison uses weighted rates, typed value union, zero counts and unknown rates for absent buckets', () => {
  const {registry,response,priorResponse,counts}=comparisonFixture();
  priorResponse.buckets[0].summary=counts(8,2);Object.assign(priorResponse.buckets[0].days[0],counts(8,2));priorResponse.summary=counts(10,4);
  const rows=compareWorkflowProperties(response,priorResponse,registry);
  assert.equal(rows[0].rateDifference,25);assert.equal(rows[0].value,false);assert.equal(rows[0].provisional,true);
  response.buckets.pop();response.summary=counts(8,4);
  priorResponse.buckets.shift();priorResponse.summary=counts(2,2);
  const union=compareWorkflowProperties(response,priorResponse,registry);
  assert.deepEqual(union.map(row=>row.value),[false,true]);
  assert.equal(union[0].previous.startedAttempts,0);assert.equal(union[0].previous.completionRate,null);assert.equal(union[0].rateDifference,null);
  assert.equal(union[1].current.startedAttempts,0);assert.equal(union[1].current.failedAttempts,null);assert.equal(union[1].rateDifference,null);
  registry.events.forEach(event=>event.properties.flag={type:'integer',required:true,purpose:'Range',minimum:0,maximum:1});
  response.buckets[0].value=0;priorResponse.buckets[0].value=1;
  assert.deepEqual(compareWorkflowProperties(response,priorResponse,registry).map(row=>row.value),[0,1]);
  assert.equal(compareWorkflowProperties({...response,buckets:[],summary:counts(0,0)},{...priorResponse,buckets:[],summary:counts(0,0)},registry).length,0);
});
test('property comparison rejects different projects, versions, groups and nonadjacent or unequal periods', () => {
  for (const edit of [r=>r.meta.projectId='other',r=>r.meta.schemaVersion=2,r=>r.meta.timeZone='UTC',r=>r.workflowId='other',
    r=>r.groupBy='other',r=>r.meta.from='2026-10-04',r=>r.meta.to='2026-10-07']) {
    const {registry,response,priorResponse}=comparisonFixture();edit(priorResponse);
    assert.throws(()=>compareWorkflowProperties(response,priorResponse,registry));
  }
});
test('property CSV exports prior daily data and metric comparisons, including previous-only values and unavailable changes', () => {
  const {registry,response,current,previous,priorResponse,counts}=comparisonFixture();
  response.buckets.pop();response.summary=counts(8,4);
  priorResponse.buckets.shift();priorResponse.summary=counts(2,2);
  const input={registry,current,previous,view:'goals',workflowSelections:[response],workflowComparisons:[priorResponse]};
  const file=analyticsCsv(input);
  const rows=file.text.trim().split('\r\n').slice(1).map(line=>Object.fromEntries(line.slice(1,-1).split('\",\"').map((value,index)=>[CSV_COLUMNS[index],value])));
  const comparison=rows.filter(row=>row.record_type==='workflow_property_comparison');
  assert.equal(comparison.length,6);assert.equal(rows.filter(row=>row.period==='previous'&&row.record_type==='workflow_property_day').length,2);
  const rate=comparison.find(row=>row.metric==='completionRate'&&row.value==='true');
  assert.equal(rate.completion_rate_percent,'');assert.equal(rate.previous_value,'100');assert.equal(rate.availability,'not_available');assert.equal(rate.change_unit,'percentage_point');
  const starts=comparison.find(row=>row.metric==='startedAttempts'&&row.value==='true');
  assert.equal(starts.count,'0');assert.equal(starts.previous_value,'2');assert.equal(starts.change,'-100');assert.equal(starts.selected_event,'');
  for (const replacement of [{previous:undefined},{workflowSelections:[]},{workflowComparisons:[]},{workflowComparisons:[priorResponse,priorResponse]},
    {workflowComparisons:[{...priorResponse,groupBy:'other'}]},{workflowComparisons:[{...priorResponse,meta:{...priorResponse.meta,to:range.to}}]}])
    assert.throws(()=>analyticsCsv({...input,...replacement}));
});
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
