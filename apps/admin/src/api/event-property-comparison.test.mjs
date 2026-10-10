import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './client.ts';
import { compareEventProperties, loadEventPropertyComparison } from './event-property-comparison.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';

function fixture() {
  const event={name:'view',label:'View',source:'browser',properties:{flag:{type:'boolean',required:false,purpose:'Public flag'}}};
  const registry={project:{id:'example',name:'Example',status:'active',timeZone:'Asia/Seoul'},schemaVersion:1,events:[event],workflows:[]};
  const series=(from,to,breakdown)=>{
    const totalEvents=breakdown.reduce((total,bucket)=>total+bucket.count,0);
    const meta={projectId:'example',schemaVersion:1,source:'browser',from,to,timeZone:'Asia/Seoul',generatedAt:'2026-10-09T00:00:00Z',latestReceivedAt:null,coverage:'observed-only'};
    return {meta,eventName:'view',groupBy:'flag',totalEvents,days:[{date:from,count:totalEvents,breakdown},{date:to,count:0,breakdown:[]}]};
  };
  const current=series('2026-10-07','2026-10-08',[{value:false,count:4},{value:true,count:6}]);
  const previous=series('2026-10-05','2026-10-06',[{value:false,count:3},{value:null,count:2}]);
  const snapshot=data=>({range:{from:data.meta.from,to:data.meta.to},summary:{meta:data.meta,totalEvents:data.totalEvents,events:[{name:'view',count:data.totalEvents}]},workflows:[]});
  return {registry,current,previous,snapshot};
}

test('event property comparison unions typed values, keeps missing buckets zero and shares distinct from growth',()=>{
  const {registry,current,previous}=fixture();
  const rows=compareEventProperties(current,previous,registry).rows;
  assert.deepEqual(rows.map(row=>row.value),[true,false,null]);
  const shared=rows.find(row=>row.value===false);
  assert.equal(shared.currentShare,40);assert.equal(shared.previousShare,60);assert.equal(shared.shareChange,-20);
  assert.ok(Math.abs(shared.countChange-100/3)<1e-9);
  const added=rows[0];assert.equal(added.previousCount,0);assert.equal(added.previousShare,0);assert.equal(added.countChange,null);assert.equal(added.shareChange,60);
  const removed=rows[2];assert.equal(removed.currentCount,0);assert.equal(removed.currentShare,0);assert.equal(removed.countChange,-100);assert.equal(removed.shareChange,-40);
  registry.events[0].properties.flag={type:'integer',required:false,purpose:'Public range',minimum:0,maximum:1};
  current.days[0].breakdown[0].value=0;current.days[0].breakdown[1].value=1;previous.days[0].breakdown[0].value=0;
  assert.deepEqual(compareEventProperties(current,previous,registry).rows.map(row=>row.value),[1,0,null]);
  current.totalEvents=0;current.days.forEach(day=>{day.count=0;day.breakdown=[];});
  const empty=compareEventProperties(current,previous,registry).rows;
  assert.equal(empty[0].currentShare,null);assert.equal(empty[0].shareChange,null);assert.equal(empty[0].countChange,-100);
  previous.totalEvents=0;previous.days.forEach(day=>{day.count=0;day.breakdown=[];});
  assert.deepEqual(compareEventProperties(current,previous,registry).rows,[]);
});

test('event property comparison rejects context, period, group and incomplete/invalid totals',()=>{
  for(const edit of [f=>f.previous.meta.projectId='other',f=>f.previous.meta.schemaVersion=2,f=>f.previous.meta.timeZone='UTC',
    f=>f.previous.meta.source='server',f=>f.previous.meta.coverage='all',f=>f.previous.meta.from='2026-10-04',f=>f.previous.eventName='other',
    f=>f.previous.groupBy=null,f=>f.current.groupBy=null,f=>f.previous.days.pop(),f=>f.previous.totalEvents++,
    f=>f.previous.days[0].breakdown.push({value:false,count:0}),f=>f.previous.days[0].breakdown[0].value='false',
    f=>f.registry.events[0].properties.flag.required=true]) {
    const f=fixture();edit(f);assert.throws(()=>compareEventProperties(f.current,f.previous,f.registry));
  }
});

test('previous event load keeps existing API dates/group/schema and aborts without returning late comparison',async()=>{
  const f=fixture(), controller=new AbortController();let seen;
  const client=new ApiClient({token:'not-a-credential',fetchImpl:async(url,init)=>{seen={url,init};return Response.json(f.previous);}});
  const result=await loadEventPropertyComparison(client,f.registry,f.current,controller.signal);
  assert.equal(result.analysis.rows.length,3);
  const url=new URL(seen.url,'https://example.invalid');assert.equal(url.pathname,'/v1/projects/example/events/view/daily');
  assert.equal(url.searchParams.get('from'),'2026-10-05');assert.equal(url.searchParams.get('to'),'2026-10-06');
  assert.equal(url.searchParams.get('schemaVersion'),'1');assert.equal(url.searchParams.get('groupBy'),'flag');
  let calls=0,release;
  const delayed=new ApiClient({token:'not-a-credential',fetchImpl:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  const pending=loadEventPropertyComparison(delayed,f.registry,f.current,controller.signal);
  controller.abort();release(Response.json(f.previous));await assert.rejects(pending);
  await assert.rejects(loadEventPropertyComparison(delayed,f.registry,f.current,controller.signal));assert.equal(calls,1);
});

test('event property CSV exports prior totals/days and count/share comparisons without partial or stale contexts',()=>{
  const f=fixture(), input={registry:f.registry,current:f.snapshot(f.current),previous:f.snapshot(f.previous),view:'events',
    selection:{eventName:'view',groupBy:'flag',series:f.current,previousSeries:f.previous}};
  const rows=analyticsCsv(input).text.slice(1).trimEnd().split('\r\n').slice(1).map(line=>{
    const cells=[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match=>match[1].replaceAll('""','"'));
    return Object.fromEntries(CSV_COLUMNS.map((column,index)=>[column,cells[index]]));
  });
  assert.equal(rows.filter(row=>row.record_type==='property_comparison').length,6);
  assert.equal(rows.filter(row=>row.period==='previous'&&row.record_type==='property_day').length,4);
  const share=rows.find(row=>row.record_type==='property_comparison'&&row.metric==='share'&&row.value==='false');
  assert.equal(share.share_percent,'40');assert.equal(share.previous_value,'60');assert.equal(share.change,'-20');assert.equal(share.change_unit,'percentage_point');
  const added=rows.find(row=>row.record_type==='property_comparison'&&row.metric==='count'&&row.value==='true');
  assert.equal(added.count,'6');assert.equal(added.previous_value,'0');assert.equal(added.availability,'not_available');assert.equal(added.change,'');
  assert.equal(rows.some(row=>row.record_type==='property_comparison'&&row.value_type==='null'&&row.value===''),true);
  assert.throws(()=>analyticsCsv({...input,previous:undefined}));
  assert.throws(()=>analyticsCsv({...input,selection:{...input.selection,previousSeries:undefined}}));
  assert.throws(()=>analyticsCsv({...input,selection:{...input.selection,groupBy:null}}));
  assert.throws(()=>analyticsCsv({...input,selection:{...input.selection,previousSeries:{...f.previous,meta:{...f.previous.meta,to:'2026-10-07'}}}}));
});
