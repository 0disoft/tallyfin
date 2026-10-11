import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE_PATH, ApiClient, ApiError, clampLimit, resolveApiEndpoint } from './client.ts';
import { missingBrowserEvents } from './coverage.ts';
import { appendPage, shouldApplyPage } from './pagination.ts';
import { periodRange, todayInZone } from './dates.ts';
import { SettingsEditor } from './settings-editor.ts';
import { analyzeEventSeries, eventContext, eventPropertyNames, selectedGrouping } from './event-analysis.ts';
import { previousRange, countChange, rateChange, validateSnapshot, loadPeriod } from './period-comparison.ts';
import { analyticsCsv, csvCell, serializeCsv, CSV_COLUMNS } from './csv-export.ts';

// Fixtures below use no multiline fields; csvCell has a dedicated multiline/escaping check.
function exportRows(file) {
  return file.text.slice(1).trimEnd().split('\r\n').slice(1).map(line => {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""','"'));
    assert.equal(cells.length,CSV_COLUMNS.length);
    return Object.fromEntries(CSV_COLUMNS.map((key,index)=>[key,cells[index]]));
  });
}
test('CSV quotes delimiters, newlines and formula-like text; numeric negative, false, zero and blank remain distinct', () => {
  assert.equal(csvCell('한글,"이름"\n줄'), '"한글,""이름""\n줄"');
  for (const value of ['=1+1',' +2','-1','@SUM(A1)','\tplain','\rtext','\ntext','＝1','＋2','－3','＠A1']) assert.equal(csvCell(value),`"'${value}"`);
  assert.equal(csvCell(-10),'"-10"'); assert.equal(csvCell(false),'"false"'); assert.equal(csvCell(0),'"0"'); assert.equal(csvCell(null),'""');
  assert.equal(serializeCsv([['값','count'],['가',0]]),'\uFEFF"값","count"\r\n"가","0"\r\n');
  assert.throws(()=>csvCell(NaN));
});
test('CSV records view, project, schema, range and raw counts, includes comparison and workflow days without inventing rates', () => {
  const {registry,snapshot}=comparisonFixture(); registry.project.name='=1+2';
  const previous=structuredClone(snapshot); previous.range=previousRange(snapshot.range);
  previous.summary.meta={...previous.summary.meta,...previous.range}; previous.summary.totalEvents=0; previous.summary.events.forEach(event=>event.count=0);
  const flow=previous.workflows[0].response; flow.meta=previous.summary.meta;
  flow.summary={startedAttempts:0,succeededAttempts:0,failedAttempts:null,pendingAttempts:0,completionRate:null};
  flow.days=flow.days.map((day,index)=>({...day,date:index===0?previous.range.from:previous.range.to,...flow.summary}));
  const file=analyticsCsv({registry,current:snapshot,previous,view:'goals'}); const rows=exportRows(file);
  assert.equal(file.filename,'tallyfin-sembom-v1-goals-2026-10-07-2026-10-08.csv');
  rows.forEach(row=>{assert.equal(row.project_id,'sembom');assert.equal(row.project_name,"'=1+2");assert.equal(row.schema_version,'1');assert.equal(row.time_zone,'Asia/Seoul');});
  assert.equal(rows.filter(row=>row.record_type==='workflow_day').length,4);
  const comparison=rows.find(row=>row.record_type==='comparison_metric' && row.name==='convert:completionRate');
  assert.equal(comparison.value,'80');assert.equal(comparison.previous_value,'');assert.equal(comparison.change,'');assert.equal(comparison.change_unit,'percentage_point');assert.equal(comparison.availability,'not_available');
  const empty=rows.find(row=>row.period==='previous' && row.record_type==='workflow_total'); assert.equal(empty.started_attempts,'0');assert.equal(empty.completion_rate_percent,'');
  assert.equal(rows.some(row=>row.record_type==='event_total'),false);
  assert.equal(rows.some(row=>Object.hasOwn(row,'token')),false);
});
test('CSV event search and selected property analysis preserve all typed buckets and their daily values', () => {
  const {registry,snapshot}=comparisonFixture(); const event=analysisEvent(); registry.events.push(event);
  snapshot.summary.events.push({name:'view',count:10});snapshot.summary.totalEvents+=10;
  const series=analysisSeries();series.groupBy='range';series.days[0].breakdown=[{value:0,count:4},{value:1,count:2}];series.days[1].breakdown=[{value:0,count:3},{value:2,count:1}];
  const rows=exportRows(analyticsCsv({registry,current:snapshot,view:'events',filter:' View ',selection:{eventName:'view',groupBy:'range',series}}));
  assert.deepEqual(rows.filter(row=>row.record_type==='event_total').map(row=>row.name),['view']);
  assert.equal(rows.filter(row=>row.record_type==='property_day').length,6);
  assert.deepEqual(rows.filter(row=>row.record_type==='property_total').map(row=>[row.value_type,row.value,row.count]),[['number','0','7'],['number','1','2'],['number','2','1']]);
  rows.forEach(row=>{assert.equal(row.event_filter,'View');assert.equal(row.selected_event,'view');assert.equal(row.selected_group_by,'range');});
  series.groupBy='flag';series.days[0].breakdown=[{value:false,count:4},{value:true,count:2}];series.days[1].breakdown=[{value:false,count:3},{value:null,count:1}];
  const flags=exportRows(analyticsCsv({registry,current:snapshot,view:'events',selection:{eventName:'view',groupBy:'flag',series}})).filter(row=>row.record_type==='property_total');
  assert.deepEqual(flags.map(row=>[row.value_type,row.value]),[['boolean','false'],['boolean','true'],['null','']]);
});
test('CSV rejects stale schema, range, grouping and broken snapshots; unselected source counts stay blank', () => {
  const {registry,snapshot}=comparisonFixture(); registry.events.push(analysisEvent(),{name:'backend',label:'Backend',source:'server'});
  snapshot.summary.events.push({name:'view',count:10});snapshot.summary.totalEvents+=10;
  const input={registry,current:snapshot,view:'events',selection:{eventName:'view',groupBy:'format',series:analysisSeries()}};
  for (const edit of [r=>r.selection.series.meta.schemaVersion=2,r=>r.selection.series.meta.projectId='other',r=>r.selection.series.meta.timeZone='UTC',
    r=>r.selection.series.meta.to='2026-10-09',r=>r.selection.series.meta.source='server',r=>r.selection.series.meta.coverage='all',
    r=>r.selection.groupBy='flag',r=>r.current.summary.totalEvents++,r=>r.previous=structuredClone(r.current)]) {
    const copy=structuredClone(input); edit(copy); assert.throws(()=>analyticsCsv(copy));
  }
  const server=exportRows(analyticsCsv(input)).find(row=>row.name==='backend');assert.equal(server.count,'');assert.equal(server.availability,'not_selected');
});

test('comparison windows have equal inclusive length across month, leap-year and year boundaries', () => {
  for (const [range, expected] of [
    [{from:'2026-10-04',to:'2026-10-10'}, {from:'2026-09-27',to:'2026-10-03'}],
    [{from:'2024-03-01',to:'2024-03-07'}, {from:'2024-02-23',to:'2024-02-29'}],
    [{from:'2026-01-01',to:'2026-01-30'}, {from:'2025-12-02',to:'2025-12-31'}],
  ]) assert.deepEqual(previousRange(range), expected);
  assert.equal(countChange(150,100),50); assert.equal(countChange(0,100),-100);
  assert.equal(countChange(0,0),null); assert.equal(countChange(50,0),null);
  assert.equal(rateChange(86,80),6); assert.equal(rateChange(0,0),0); assert.equal(rateChange(null,80),null);
  assert.throws(() => previousRange({from:'2026-10-10',to:'2026-10-09'}));
});

function comparisonFixture() {
  const range = {from:'2026-10-07',to:'2026-10-08'};
  const definition = {id:'convert',label:'Convert',source:'browser',startEvent:'start',successEvent:'success',failureEvent:null,dimensions:[]};
  const registry = {project:project('sembom'),schemaVersion:1,events:[{name:'start',source:'browser'},{name:'success',source:'browser'}],workflows:[definition]};
  const counts = {startedAttempts:10,succeededAttempts:8,failedAttempts:null,pendingAttempts:2,completionRate:80};
  const summary = {meta:meta('sembom',1,range.from,range.to),totalEvents:18,events:[{name:'start',count:10},{name:'success',count:8}]};
  const response = {meta:summary.meta,workflowId:'convert',cohortBasis:'startedAt',summary:counts,days:[
    {date:range.from,...counts,provisional:false},
    {date:range.to,startedAttempts:0,succeededAttempts:0,failedAttempts:null,pendingAttempts:0,completionRate:null,provisional:true},
  ]};
  return {registry,snapshot:{summary,range,workflows:[{definition,response}]}};
}
test('comparison rejects omitted, duplicate, mismatched and inconsistent data rather than filling zeros', () => {
  const fixture = comparisonFixture(); validateSnapshot(fixture.snapshot,fixture.registry);
  for (const edit of [s=>s.summary.events.pop(),s=>s.summary.events[1].name='start',s=>s.summary.totalEvents++,
    s=>s.summary.meta.timeZone='UTC',s=>s.summary.events[0].count=Number.MAX_SAFE_INTEGER+1,
    s=>s.workflows.pop(),s=>s.workflows[0].response.days.pop(),s=>s.workflows[0].response.days.reverse(),
    s=>s.workflows[0].response.workflowId='foreign',s=>s.workflows[0].response.summary.completionRate=90,
    s=>s.workflows[0].response.days[0].pendingAttempts=3,s=>s.workflows[0].response.days[0].failedAttempts=0]) {
    const copy=structuredClone(fixture.snapshot); edit(copy); assert.throws(()=>validateSnapshot(copy,fixture.registry));
  }
});
test('period loading uses existing endpoints, same schema and signal, propagates failure and abort', async () => {
  const {registry,snapshot}=comparisonFixture(); const calls=[]; const controller=new AbortController();
  const client={getSummary:async(id,options)=>{calls.push([id,options]);return snapshot.summary;},
    getWorkflowDaily:async(id,flow,options)=>{calls.push([id,options,flow]);return snapshot.workflows[0].response;}};
  assert.deepEqual(await loadPeriod(client,registry,snapshot.range,controller.signal),snapshot);
  assert.equal(calls.length,2); calls.forEach(([,options])=>{assert.equal(options.schemaVersion,1);assert.equal(options.signal,controller.signal);assert.equal(options.from,snapshot.range.from);});
  await assert.rejects(loadPeriod({...client,getSummary:async()=>{throw Error('offline');}},registry,snapshot.range,controller.signal),/offline/);
  const captureAbort=capture(async(_url,init)=>{assert.equal(init.signal.aborted,true);throw new DOMException('Aborted','AbortError');});
  controller.abort(); await assert.rejects(loadPeriod(new ApiClient({token:TOKEN,fetchImpl:captureAbort.fetchImpl}),registry,snapshot.range,controller.signal),{name:'AbortError'});
});

const TOKEN = 'test-bearer-token-value';
const REQUEST_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function capture(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, fetchImpl };
}

const project = id => ({ id, name: `Project ${id}`, status: 'active', timeZone: 'Asia/Seoul' });
const meta = (projectId, schemaVersion, from, to) => ({ projectId, schemaVersion, source: 'browser', from, to, timeZone: 'Asia/Seoul', generatedAt: '2026-10-08T00:00:00Z', latestReceivedAt: null, coverage: 'observed-only' });

const settings = (overrides = {}) => ({ project: project('sembom'), allowedOrigins: ['https://example.invalid'],
  limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, settingsHash: 'a'.repeat(64), canEdit: true, ...overrides });

const analysisEvent = () => ({ name: 'view', label: 'View', source: 'browser', properties: {
  format: { type: 'enum', required: false, purpose: 'Public format', values: ['pdf', 'png'] },
  flag: { type: 'boolean', required: false, purpose: 'Flag' },
  range: { type: 'integer', required: true, purpose: 'Range', minimum: 0, maximum: 2 },
} });
const analysisSeries = () => ({ meta: meta('sembom', 1, '2026-10-07', '2026-10-08'), eventName: 'view', groupBy: 'format', totalEvents: 10,
  days: [{ date: '2026-10-07', count: 6, breakdown: [{ value: 'pdf', count: 4 }, { value: 'png', count: 2 }] },
    { date: '2026-10-08', count: 4, breakdown: [{ value: 'pdf', count: 3 }, { value: null, count: 1 }] }] });

test('event grouping uses the selected event source and never reuses another project or schema selection', () => {
  const event = analysisEvent(), registry = { project: project('sembom'), schemaVersion: 1 };
  const selection = { context: eventContext(registry, event), property: 'format' };
  assert.deepEqual(eventPropertyNames(event), ['format', 'flag', 'range']);
  assert.deepEqual(eventPropertyNames({ ...event, source: 'server' }), ['format', 'flag', 'range']);
  assert.equal(selectedGrouping(registry, event, selection), 'format');
  for (const next of [{ ...registry, schemaVersion: 2 }, { ...registry, project: project('other') }]) assert.equal(selectedGrouping(next, event, selection), '');
  assert.equal(selectedGrouping(registry, { ...event, name: 'other' }, selection), '');
  assert.equal(selectedGrouping(registry, { ...event, properties: {} }, selection), '');
  assert.equal(selectedGrouping(registry, event, { ...selection, property: 'unregistered' }), '');
});

test('property analysis aggregates values, shares and daily counts without confusing null, false or zero', () => {
  const result = analyzeEventSeries(analysisSeries(), analysisEvent());
  assert.equal(result.total, 10); assert.deepEqual(result.rows.map(row => [row.value, row.count, row.share]), [['pdf', 7, 70], ['png', 2, 20], [null, 1, 10]]);
  assert.deepEqual(result.rows[1].daily.map(day => day.count), [2, 0]);
  const flags = analysisSeries(); flags.groupBy = 'flag'; flags.days[0].breakdown = [{ value: false, count: 4 }, { value: true, count: 2 }];
  flags.days[1].breakdown = [{ value: false, count: 3 }, { value: null, count: 1 }];
  assert.deepEqual(analyzeEventSeries(flags, analysisEvent()).rows.map(row => row.value), [false, true, null]);
  const numbers = analysisSeries(); numbers.groupBy = 'range'; numbers.days[0].breakdown = [{ value: 0, count: 4 }, { value: 1, count: 2 }];
  numbers.days[1].breakdown = [{ value: 0, count: 3 }, { value: 2, count: 1 }];
  assert.equal(analyzeEventSeries(numbers, analysisEvent()).rows[0].value, 0);
  const empty = analysisSeries(); empty.totalEvents = 0; empty.days.forEach(day => { day.count = 0; day.breakdown = []; });
  assert.deepEqual(analyzeEventSeries(empty, analysisEvent()), { total: 0, rows: [] });
  const totalOnly = analysisSeries(); totalOnly.groupBy = null; totalOnly.days.forEach(day => { day.breakdown = []; });
  assert.equal(analyzeEventSeries(totalOnly, analysisEvent()), null);
});

test('partial, duplicate, unsafe and invalid property buckets fail before displaying plausible percentages', () => {
  const edits = [r => r.days.pop(), r => r.days.reverse(), r => { r.days[1].date = r.days[0].date; },
    r => { r.totalEvents = 9; }, r => { r.days[0].breakdown[0].count = 5; },
    r => { r.days[0].breakdown = [{ value: 'pdf', count: 3 }, { value: 'pdf', count: 3 }]; },
    r => { r.days[0].breakdown[0].value = 'private'; }, r => { r.days[0].breakdown[0].value = false; },
    r => { r.groupBy = 'unknown'; }, r => { r.eventName = 'foreign'; },
    r => { r.totalEvents = Number.MAX_SAFE_INTEGER + 1; }];
  for (const edit of edits) { const next = analysisSeries(); edit(next); assert.throws(() => analyzeEventSeries(next, analysisEvent())); }
  const event = analysisEvent(); event.properties.format.required = true;
  assert.throws(() => analyzeEventSeries(analysisSeries(), event));
});

test('settings PATCH uses the protected transport, returned capability and submitted values are checked', async () => {
  const current = settings();
  const saved = settings({ project: { ...current.project, name: 'New name' }, settingsHash: 'b'.repeat(64) });
  const { calls, fetchImpl } = capture((url, init) => jsonResponse(200, init.method === 'PATCH' ? saved : current));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  assert.deepEqual(await client.getSettings('sembom'), current);
  const update = { expectedSettingsHash: current.settingsHash, name: 'New name' };
  assert.deepEqual(await client.updateSettings('sembom', update), saved);
  assert.equal(calls[1].url, '/v1/projects/sembom'); assert.equal(calls[1].init.method, 'PATCH');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].init.credentials, 'omit'); assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].init.referrerPolicy, 'no-referrer'); assert.deepEqual(JSON.parse(calls[1].init.body), update);
  assert.ok(!calls[1].init.body.includes(TOKEN));
  for (const response of [settings({ canEdit: undefined }), settings({ canEdit: 'owner' }), settings({ settingsHash: 'bad' }),
    settings({ project: project('other') }), settings({ canEdit: false }), current]) {
    const invalid = new ApiClient({ token: TOKEN, fetchImpl: async () => jsonResponse(200, response) });
    await assert.rejects(() => invalid.updateSettings('sembom', update), error => error.kind === 'contract');
  }
});

test('settings editor sends only changed fields, validates inputs and blocks duplicate submissions', async () => {
  let resolveWrite;
  const { calls, fetchImpl } = capture((url, init) => init.method === 'PATCH'
    ? new Promise(resolve => { resolveWrite = resolve; }) : jsonResponse(200, settings()));
  const editor = new SettingsEditor(new ApiClient({ token: TOKEN, fetchImpl }), 'sembom');
  await editor.load(); editor.edit('name', ''); await editor.save();
  assert.ok(editor.state.errors.name); assert.equal(calls.length, 1);
  editor.edit('name', 'Changed'); editor.edit('requestsPerMinute', '0'); await editor.save();
  assert.ok(editor.state.errors.requestsPerMinute); assert.equal(calls.length, 1);
  editor.edit('requestsPerMinute', '60');
  const pending = editor.save(); await editor.save();
  assert.equal(editor.state.phase, 'saving'); assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { expectedSettingsHash: 'a'.repeat(64), name: 'Changed', limits: { requestsPerMinute: 60 } });
  resolveWrite(jsonResponse(200, settings({ project: { ...project('sembom'), name: 'Changed' },
    limits: { requestsPerMinute: 60, newReceiptsPerUtcDay: 100000 }, settingsHash: 'b'.repeat(64) })));
  await pending; assert.equal(editor.state.phase, 'ready'); assert.equal(editor.state.draft.name, 'Changed');
  editor.destroy();
});

test('conflict preserves input until explicit review, and untouched remote fields survive rebasing', async () => {
  let reads = 0;
  const original = settings(), latest = settings({ project: { ...project('sembom'), status: 'paused' },
    limits: { requestsPerMinute: 50, newReceiptsPerUtcDay: 300 }, settingsHash: 'b'.repeat(64) });
  const { calls, fetchImpl } = capture((url, init) => init.method === 'PATCH'
    ? jsonResponse(409, { error: { code: 'settings_conflict', requestId: REQUEST_ID } })
    : jsonResponse(200, ++reads === 1 ? original : latest));
  const editor = new SettingsEditor(new ApiClient({ token: TOKEN, fetchImpl }), 'sembom');
  await editor.load(); editor.edit('name', 'My edit'); await editor.save();
  assert.equal(editor.state.phase, 'review'); assert.equal(editor.state.draft.name, 'My edit');
  await editor.save(); assert.equal(calls.length, 2);
  await editor.checkLatest(); assert.equal(editor.state.draft.status, 'active'); assert.equal(editor.state.latest.project.status, 'paused');
  editor.keepChanges(); assert.equal(editor.state.draft.name, 'My edit'); assert.equal(editor.state.draft.status, 'paused');
  assert.equal(editor.state.draft.requestsPerMinute, '50'); assert.equal(editor.state.snapshot.settingsHash, latest.settingsHash);
  await editor.save(); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { expectedSettingsHash: latest.settingsHash, name: 'My edit' });
  editor.destroy();
});

test('uncertain write is not retried and read-back can recover a committed update', async () => {
  let reads = 0;
  const original = settings(), latest = settings({ project: { ...project('sembom'), name: 'Committed' }, settingsHash: 'b'.repeat(64) });
  const { calls, fetchImpl } = capture((url, init) => {
    if (init.method === 'PATCH') throw new TypeError('connection dropped');
    return jsonResponse(200, ++reads === 1 ? original : latest);
  });
  const editor = new SettingsEditor(new ApiClient({ token: TOKEN, fetchImpl }), 'sembom');
  await editor.load(); editor.edit('name', 'Committed'); await editor.save();
  assert.equal(editor.state.phase, 'review'); assert.equal(editor.state.draft.name, 'Committed');
  await editor.save(); assert.equal(calls.length, 2);
  await editor.checkLatest(); editor.useServer();
  assert.equal(editor.state.draft.name, 'Committed'); assert.equal(editor.state.snapshot.settingsHash, latest.settingsHash);
  await editor.save(); assert.equal(calls.filter(call => call.init.method === 'PATCH').length, 1);
  editor.destroy();
});

test('reader and revoked owner cannot save, and refresh preserves a dirty form', async () => {
  let accessLosses = 0;
  let current = settings({ canEdit: false });
  const { calls, fetchImpl } = capture((url, init) => init.method === 'PATCH'
    ? jsonResponse(403, { error: { code: 'forbidden', requestId: REQUEST_ID } }) : jsonResponse(200, current));
  const editor = new SettingsEditor(new ApiClient({ token: TOKEN, fetchImpl }), 'sembom', undefined, () => { accessLosses++; });
  await editor.load(); editor.edit('name', 'Denied'); await editor.save();
  assert.equal(accessLosses, 0);
  assert.equal(editor.state.draft.name, current.project.name); assert.equal(calls.length, 1);
  current = settings(); await editor.refresh(); editor.edit('name', 'Keep me');
  current = settings({ limits: { requestsPerMinute: 99, newReceiptsPerUtcDay: 400 }, settingsHash: 'b'.repeat(64) });
  await editor.refresh(); assert.equal(editor.state.phase, 'review'); assert.equal(editor.state.draft.name, 'Keep me');
  editor.keepChanges(); await editor.save(); assert.equal(editor.state.blocked, true);
  assert.equal(accessLosses, 1);
  assert.equal(editor.state.draft.name, 'Keep me'); await editor.save();
  assert.equal(calls.filter(call => call.init.method === 'PATCH').length, 1);
  current = { ...current, canEdit: false }; await editor.checkLatest(); editor.keepChanges();
  assert.equal(editor.state.phase, 'review'); editor.useServer(); assert.equal(editor.state.blocked, true);
  await editor.refresh(); assert.equal(accessLosses, 1);
  current = settings(); await editor.refresh();
  current = settings({ canEdit: false }); await editor.refresh(); assert.equal(accessLosses, 2);
  editor.destroy();
});

test('disposed editor aborts the write and ignores its late response', async () => {
  let resolveWrite; let callbacks = 0;
  const { calls, fetchImpl } = capture((url, init) => init.method === 'PATCH'
    ? new Promise(resolve => { resolveWrite = resolve; }) : jsonResponse(200, settings()));
  const editor = new SettingsEditor(new ApiClient({ token: TOKEN, fetchImpl }), 'sembom', () => { callbacks++; });
  await editor.load(); editor.edit('name', 'Late'); const pending = editor.save(); editor.destroy();
  assert.equal(calls[1].init.signal.aborted, true);
  resolveWrite(jsonResponse(200, settings({ project: { ...project('sembom'), name: 'Late' }, settingsHash: 'b'.repeat(64) })));
  await pending; assert.equal(callbacks, 1); assert.equal(editor.state.snapshot.project.name, project('sembom').name);
});

test('list requests keep the token in the header only and disable storage and caching', async () => {
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [project('modufile')], page: { limit: 25, nextCursor: null } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const page = await client.listProjects({ limit: 500 });
  assert.equal(page.data[0].id, 'modufile');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE_PATH}/projects?limit=100`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.body, undefined);
  assert.ok(!calls[0].url.includes(TOKEN));
});

test('the token never leaks through serialization or error text', async () => {
  const { fetchImpl } = capture(() => jsonResponse(401, { error: { code: 'unauthorized', message: `echo ${TOKEN}`, requestId: REQUEST_ID } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  assert.ok(!JSON.stringify(client).includes(TOKEN));
  assert.ok(!String(client).includes(TOKEN));
  await assert.rejects(() => client.listProjects(), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, 'unauthorized');
    assert.ok(!error.message.includes(TOKEN));
    assert.equal(error.status, 401);
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.requestId, REQUEST_ID);
    return true;
  });
});

test('server error text is replaced by a fixed message', async () => {
  const { fetchImpl } = capture(() => jsonResponse(403, { error: { code: 'forbidden', message: `echo ${TOKEN}`, requestId: REQUEST_ID } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  await assert.rejects(() => client.listProjects(), error => {
    assert.equal(error.kind, 'forbidden');
    assert.equal(error.message, '이 프로젝트에 대한 권한이 없어요. (HTTP 403)');
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
});

test('clampLimit keeps every page within 1..100', () => {
  assert.equal(clampLimit(undefined), 25);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(1000), 100);
  assert.equal(clampLimit(12.7), 12);
});

test('each query shape matches the openapi paths and required parameters', async () => {
  const { calls, fetchImpl } = capture(url => {
    if (url.includes('/schemas/')) return jsonResponse(200, { project: project('sembom'), schemaVersion: 3, schemaStatus: 'retired', allowedOrigins: ['https://a.example'], limits: { requestsPerMinute: 60, newReceiptsPerUtcDay: 1000 }, events: [{ name: 'input_start', label: '입력 시작', source: 'browser', properties: {} }], workflows: [] });
    if (url.includes('/summary')) return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), totalEvents: 0, events: [{ name: 'input_start', count: 0 }] });
    if (url.includes('/events/')) return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), eventName: 'input_start', groupBy: 'tool', totalEvents: 0, days: [{ date: '2026-10-08', count: 0, breakdown: [] }] });
    return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), workflowId: 'calc', cohortBasis: 'startedAt', summary: { startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null }, days: [{ date: '2026-10-08', startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null, provisional: true }] });
  });
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const range = { schemaVersion: 3, from: '2026-10-02', to: '2026-10-08' };
  const registry = await client.getSchema('sembom', 3);
  assert.equal(registry.schemaStatus, 'retired');
  await client.getSummary('sembom', range);
  await client.getEventDaily('sembom', 'input_start', { ...range, groupBy: 'tool' });
  await client.getWorkflowDaily('sembom', 'calc', range);
  assert.deepEqual(calls.map(call => call.url), [
    `${API_BASE_PATH}/projects/sembom/schemas/3`,
    `${API_BASE_PATH}/projects/sembom/summary?schemaVersion=3&from=2026-10-02&to=2026-10-08`,
    `${API_BASE_PATH}/projects/sembom/events/input_start/daily?schemaVersion=3&from=2026-10-02&to=2026-10-08&groupBy=tool`,
    `${API_BASE_PATH}/projects/sembom/workflows/calc/daily?schemaVersion=3&from=2026-10-02&to=2026-10-08`,
  ]);
});

test('only same-origin /v1 endpoints are accepted', () => {
  const origin = 'https://admin.example.com';
  assert.deepEqual(resolveApiEndpoint('', origin), { basePath: API_BASE_PATH });
  assert.deepEqual(resolveApiEndpoint(`${origin}${API_BASE_PATH}`, origin), { basePath: API_BASE_PATH });
  assert.deepEqual(resolveApiEndpoint(`${origin}/`, origin), { basePath: API_BASE_PATH });
  for (const rejected of [`https://evil.example.com`, 'http://localhost:5180', `${origin}/api`, `${origin}${API_BASE_PATH}?x=1`, `${origin}#frag`, `https://user:pass@admin.example.com`]) {
    assert.ok('error' in resolveApiEndpoint(rejected, origin), rejected);
  }
  assert.throws(() => new ApiClient({ token: TOKEN, basePath: 'https://evil.example.com' }), error => error instanceof ApiError && error.kind === 'invalid_request');
});

test('gateway unavailable errors identify the API connection separately from storage failure', async () => {
  const { fetchImpl } = capture(() => jsonResponse(503, { error: { code: 'admin_api_unavailable', message: `private ${TOKEN}` } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  await assert.rejects(client.listProjects(), error => {
    assert.equal(error.kind, 'admin_api_unavailable');
    assert.equal(error.status, 503); assert.match(error.message, /관리 API에 연결하지 못했어요/);
    assert.ok(!error.message.includes(TOKEN)); return true;
  });
});

test('http, network and contract failures stay distinct and never become zeros', async () => {
  const cases = [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [503, 'storage_unavailable'], [400, 'invalid_request'], [500, 'http']];
  for (const [status, kind] of cases) {
    const { fetchImpl } = capture(() => jsonResponse(status, { error: { code: 'x', requestId: REQUEST_ID } }));
    const client = new ApiClient({ token: TOKEN, fetchImpl });
    await assert.rejects(() => client.listProjects(), error => { assert.equal(error.kind, kind); assert.equal(error.status, status); return true; });
  }
  const offline = new ApiClient({ token: TOKEN, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => offline.listProjects(), error => { assert.equal(error.kind, 'network'); return true; });
  for (const body of [{ data: [project('a')], page: { limit: 500, nextCursor: null } }, { data: [project('a')], page: { limit: 25 } }, { data: {}, page: { limit: 25, nextCursor: null } }]) {
    const { fetchImpl } = capture(() => jsonResponse(200, body));
    const client = new ApiClient({ token: TOKEN, fetchImpl });
    await assert.rejects(() => client.listProjects(), error => { assert.equal(error.kind, 'contract'); return true; });
  }
  const { fetchImpl } = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), totalEvents: '0', events: [{ name: 'x', count: 0 }] }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  await assert.rejects(() => client.getSummary('a', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
});

test('valid but mismatched responses are rejected', async () => {
  const wrongMeta = capture(() => jsonResponse(200, { meta: meta('other', 1, '2026-10-02', '2026-10-08'), totalEvents: 0, events: [{ name: 'x', count: 0 }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongMeta.fetchImpl }).getSummary('a', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
  const wrongEvent = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), eventName: 'other', groupBy: null, totalEvents: 0, days: [{ date: '2026-10-08', count: 0, breakdown: [] }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongEvent.fetchImpl }).getEventDaily('a', 'input_start', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
  const wrongWorkflow = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), workflowId: 'other', cohortBasis: 'startedAt', summary: { startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null }, days: [{ date: '2026-10-08', startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null, provisional: false }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongWorkflow.fetchImpl }).getWorkflowDaily('a', 'calc', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
});

test('destroy clears the token and aborts pending requests', async () => {
  let seenSignal = null;
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
  });
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const pending = client.listProjects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.hasToken, true);
  client.destroy();
  assert.equal(client.hasToken, false);
  assert.equal(seenSignal.aborted, true);
  await assert.rejects(() => pending, error => { assert.equal(error.name, 'AbortError'); return true; });
});

test('destroy aborts an in-flight response body read', async () => {
  let seenSignal = null;
  const fetchImpl = async (_url, init) => {
    seenSignal = init.signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
      }),
    };
  };
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const pending = client.listProjects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seenSignal.aborted, false);
  client.destroy();
  assert.equal(seenSignal.aborted, true);
  await assert.rejects(() => pending, error => { assert.equal(error.name, 'AbortError'); return true; });
});

test('stale pagination results are discarded after a reconnect', () => {
  assert.equal(shouldApplyPage({ generation: 2, current: 2, aborted: false }), true);
  assert.equal(shouldApplyPage({ generation: 1, current: 2, aborted: false }), false);
  assert.equal(shouldApplyPage({ generation: 2, current: 2, aborted: true }), false);
  const next = appendPage([{ id: 'a' }], { data: [{ id: 'b' }], page: { limit: 25, nextCursor: 'b' } });
  assert.deepEqual(next.items.map(item => item.id), ['a', 'b']);
  assert.equal(next.nextCursor, 'b');
});

test('project page merging updates an overlapping project once and keeps stable ID order', () => {
  const items = [{ id: 'alpha', name: 'Alpha' }, { id: 'zeta', name: 'Created locally' }];
  const page = { data: [{ id: 'beta', name: 'Beta' }, { id: 'zeta', name: 'Latest name' }], page: { nextCursor: 'zeta' } };
  const merged = appendPage(items, page);
  assert.deepEqual(merged.items, [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'zeta', name: 'Latest name' }]);
  assert.equal(merged.nextCursor, 'zeta');
  assert.equal(items[1].name, 'Created locally');
  assert.deepEqual(appendPage(merged.items, page), merged);
});

test('a summary that omits a registered browser event is reported, not zero-filled', () => {
  const registry = { events: [{ name: 'tool_view', source: 'browser' }, { name: 'start', source: 'browser' }, { name: 'server_ping', source: 'server' }] };
  assert.deepEqual(missingBrowserEvents(registry, { events: [{ name: 'tool_view', count: 3 }, { name: 'start', count: 1 }] }), []);
  assert.deepEqual(missingBrowserEvents(registry, { events: [{ name: 'tool_view', count: 3 }] }), ['start']);
  assert.deepEqual(missingBrowserEvents(registry, { events: [] }), ['tool_view', 'start']);
});

test('project-local dates follow the project time zone and 7/14/30 periods', () => {
  assert.equal(todayInZone('Asia/Seoul', new Date('2026-10-08T15:30:00Z')), '2026-10-09');
  assert.equal(todayInZone('Asia/Seoul', new Date('2026-10-08T14:30:00Z')), '2026-10-08');
  assert.deepEqual(periodRange('2026-10-08', 7), { from: '2026-10-02', to: '2026-10-08' });
  assert.deepEqual(periodRange('2026-10-08', 30), { from: '2026-09-09', to: '2026-10-08' });
});

test('the default fetch keeps the global receiver instead of the client', async () => {
  const original = globalThis.fetch;
  let receiver = null;
  globalThis.fetch = async function () { receiver = this; return jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }); };
  try {
    await new ApiClient({ token: TOKEN }).listProjects();
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = original;
  }
});

test('each request reads the current bearer and destroy disposes the login once', async () => {
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }));
  let current = TOKEN;
  let destroyed = 0;
  const client = new ApiClient({ getBearer: async () => current, onDestroy: () => { destroyed++; }, fetchImpl });
  assert.equal(client.hasToken, true);
  await client.listProjects();
  current = `${TOKEN}-rotated`;
  await client.listProjects();
  assert.deepEqual(calls.map(call => call.init.headers.Authorization), [`Bearer ${TOKEN}`, `Bearer ${current}`]);
  assert.ok(!JSON.stringify(client).includes(TOKEN));
  client.destroy(); client.destroy();
  assert.equal(destroyed, 1);
  assert.equal(client.hasToken, false);
});

test('failed or empty token providers return a fixed 401 without calling the API', async () => {
  for (const getBearer of [async () => { throw new Error(TOKEN); }, async () => '']) {
    const { calls, fetchImpl } = capture(() => { throw new Error('API must not be called'); });
    const client = new ApiClient({ getBearer, fetchImpl });
    await assert.rejects(client.listProjects(), error => error.kind === 'unauthorized' && error.status === 401 && !error.message.includes(TOKEN));
    assert.equal(calls.length, 0);
    client.destroy();
  }
});

test('abort while awaiting shared refresh ends only that request and destroy prevents late fetch', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }));
  const client = new ApiClient({ getBearer: () => waiting, fetchImpl });
  const controller = new AbortController();
  const aborted = client.listProjects({ signal: controller.signal });
  const surviving = client.listProjects();
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  assert.equal(calls.length, 0);
  release(TOKEN);
  await surviving;
  assert.equal(calls.length, 1);
  client.destroy();

  let lateRelease;
  const late = new Promise(resolve => { lateRelease = resolve; });
  const disconnected = new ApiClient({ getBearer: () => late, fetchImpl });
  const pending = disconnected.listProjects();
  disconnected.destroy();
  await assert.rejects(pending, error => error.name === 'AbortError');
  lateRelease(TOKEN);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});
