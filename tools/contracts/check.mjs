import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Parser } from '@dbml/core';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const spec = YAML.parse(read('api/openapi.yaml'));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const definitions=JSON.parse(JSON.stringify(spec.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
ajv.addSchema({ $id: 'tallyfin', $defs: definitions });
const validate = (name, value) => ajv.validate({ $ref: `tallyfin#/$defs/${name}` }, value);
const example = name => JSON.parse(read(`api/examples/${name}.json`));
let checks = 0;
const check = (name, action) => { action(); checks++; console.log(`OK ${name}`); };

for (const [file, schema] of Object.entries({ registry:'Registry', 'browser-batch':'BrowserBatch', 'server-batch':'ServerBatch',
  'success-response':'BatchResult', 'error-response':'ErrorResponse', 'paginated-response':'ProjectPage',
  'summary-response':'SummaryResponse', 'event-series-response':'EventSeriesResponse', 'workflow-response':'WorkflowResponse',
  'project-settings':'ProjectSettings', 'project-settings-update':'ProjectSettingsUpdate', 'project-creation':'ProjectCreation',
  'project-grants':'ProjectGrantPage', 'admin-changes':'AdminChangePage' })) {
  check(`example ${file}`, () => assert.ok(validate(schema, example(file)), JSON.stringify(ajv.errors)));
}
check('server batch is closed, source-specific and forbids browser attempt identities', () => {
  const server = example('server-batch');
  assert.equal(validate('BrowserBatch', server), false);
  assert.equal(validate('ServerBatch', example('browser-batch')), false);
  for (const mutate of [v => v.source = 'browser', v => v.source = 'other', v => v.token = 'extra',
    v => v.events = [], v => v.events = Array(21).fill(v.events[0]),
    v => v.events[0].attempt = example('browser-batch').events[0].attempt,
    v => v.events[0].attempt = null, v => v.events[0].userId = 'private',
    v => v.events[0].properties = { outcome: { name: 'nested' } },
    v => v.events[0].properties.outcome = 'free text', v => v.events[0].eventId = 'persistent-id',
    v => v.events[0].occurredAt = '2026-10-08T15:00:10+09:00']) {
    const value = structuredClone(server); mutate(value); assert.equal(validate('ServerBatch', value), false);
  }
  assert.equal(spec.paths['/v1/projects/{projectId}/batches'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/BrowserBatch');
});
const batch = example('browser-batch');
for (const [name, mutate] of [
  ['unknown envelope key', b => { b.userId = 'private'; }],
  ['unknown event key', b => { b.events[0].url = 'https://private.invalid'; }],
  ['server on public browser endpoint', b => { b.source = 'server'; }],
  ['empty batch', b => { b.events = []; }],
  ['batch exceeds 20', b => { b.events = Array(21).fill(b.events[0]); }],
  ['nested property', b => { b.events[0].properties.tool = { id:'loan' }; }],
  ['free text property', b => { b.events[0].properties.tool = 'My private input'; }],
  ['too many properties', b => { b.events[0].properties = {a:1,b:2,c:3,d:4,e:5}; }],
  ['persistent identifier key', b => { b.events[0].eventId = 'visitor_123'; }],
  ['non-UTC time', b => { b.events[0].occurredAt = '2026-10-08T14:59:50+09:00'; }],
  ['submillisecond time', b => { b.events[0].occurredAt = '2026-10-08T14:59:50.1234Z'; }],
  ['zero schema version', b => { b.schemaVersion = 0; }],
]) check(`reject ${name}`, () => { const value=structuredClone(batch); mutate(value); assert.equal(validate('BrowserBatch', value), false); });

// Cross-field checks here verify the declared example, not a collector implementation.
const registry = example('registry');
check('registry references and cardinality', () => {
  const names = new Map();
  for (const event of registry.events) {
    assert.ok(!names.has(event.name)); names.set(event.name,event);
    let cardinality = 1;
    for (const definition of Object.values(event.properties)) {
      const count = definition.type === 'boolean' ? 2 : definition.type === 'enum' ? definition.values.length : definition.maximum-definition.minimum+1;
      assert.ok(count > 0 && count <= 32); cardinality *= count + (definition.required ? 0 : 1);
    }
    assert.ok(cardinality <= 256);
  }
  const bound = new Set();
  for (const workflow of registry.workflows) {
    const phases = [workflow.startEvent,workflow.successEvent,workflow.failureEvent].filter(Boolean);
    assert.equal(new Set(phases).size,phases.length);
    for (const name of phases) { assert.equal(names.get(name)?.source,workflow.source); assert.ok(!bound.has(name)); bound.add(name); }
    for (const key of workflow.dimensions) {
      const first=names.get(phases[0]).properties[key]; assert.equal(first.required,true);
      for (const name of phases) assert.deepEqual(names.get(name).properties[key],first);
    }
  }
});
check('batch uses registered properties and workflow binding', () => {
  const ids = new Set();
  for (const event of batch.events) {
    assert.ok(!ids.has(event.eventId)); ids.add(event.eventId);
    const definition=registry.events.find(e=>e.name===event.name); assert.ok(definition);
    for (const [key,value] of Object.entries(event.properties)) {
      const property=definition.properties[key]; assert.ok(property);
      if (property.type === 'enum') assert.ok(property.values.includes(value));
    }
    const workflow=registry.workflows.find(w=>[w.startEvent,w.successEvent,w.failureEvent].includes(event.name));
    assert.equal(Boolean(event.attempt),Boolean(workflow));
    if (workflow) { assert.equal(event.attempt.workflowId,workflow.id); assert.ok(Date.parse(event.occurredAt)>=Date.parse(event.attempt.startedAt)); }
  }
});
check('midnight example has different event dates and one start cohort', () => {
  const localDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:registry.project.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  assert.equal(localDate(batch.events[0].occurredAt),'2026-10-08');
  assert.equal(localDate(batch.events[1].occurredAt),'2026-10-09');
  assert.equal(batch.events[0].attempt.attemptId,batch.events[1].attempt.attemptId);
  const result=example('workflow-response');
  assert.equal(result.days[0].succeededAttempts,1); assert.equal(result.days[1].succeededAttempts,0);
  assert.equal(result.days[1].completionRate,null); assert.equal(result.summary.failedAttempts,null);
});
check('response totals and denominators agree', () => {
  const summary=example('summary-response'); assert.equal(summary.events.reduce((n,e)=>n+e.count,0),summary.totalEvents);
  const series=example('event-series-response'); assert.equal(series.days.reduce((n,d)=>n+d.count,0),series.totalEvents);
  for (const day of series.days) assert.equal(day.breakdown.reduce((n,b)=>n+b.count,0),day.count);
  const workflow=example('workflow-response');
  for (const row of [...workflow.days,workflow.summary]) {
    assert.equal(row.pendingAttempts,row.startedAttempts-row.succeededAttempts-(row.failedAttempts??0));
    assert.equal(row.completionRate,row.startedAttempts===0?null:row.succeededAttempts/row.startedAttempts*100);
  }
});

const database = new Parser().parse(read('db/schema.dbml'),'dbml');
check('DBML parses with project-scoped storage and no raw visitor tables', () => {
  const tables=database.schemas.flatMap(schema=>schema.tables);
  assert.deepEqual(tables.map(t=>t.name).sort(),['projects','project_grants','project_creators','project_creations','project_schemas','admin_changes','event_receipts','workflow_attempts','ingest_daily_usage','ingest_minute_usage','event_daily_counts','workflow_daily_counts','retention_cleanup_state'].sort());
  for (const table of tables.filter(t=>!['projects','project_creators','retention_cleanup_state'].includes(t.name))) assert.ok(table.fields.some(f=>f.name==='project_id'));
  assert.deepEqual(tables.find(t=>t.name==='retention_cleanup_state').fields.map(f=>f.name).sort(),['id','last_project_id','revision']);
  assert.deepEqual(tables.find(t=>t.name==='admin_changes').fields.map(f=>f.name).sort(),
    ['id','project_id','occurred_at','actor_kind','actor_issuer','actor_subject','action','fields_json','schema_version','target_issuer','target_subject','before_role','after_role'].sort());
});
check('API auth declarations remain explicit', () => {
  assert.deepEqual(spec.paths['/v1/projects/{projectId}/batches'].post.security,[]);
  assert.deepEqual(spec.security,[{adminBearer:[]}]);
  for (const path of Object.keys(spec.paths).filter(p=>p!=='/v1/projects/{projectId}/batches'))
    for (const [method, operation] of Object.entries(spec.paths[path]).filter(([method])=>['get','post','patch','put','delete'].includes(method)))
      assert.ok(operation.responses['401'], `${method} ${path}`);
  assert.ok(spec.paths['/v1/projects/{projectId}'].patch.responses['401']);
  assert.ok(spec.paths['/v1/projects/{projectId}'].patch.responses['403']);
  assert.ok(spec.paths['/v1/projects/{projectId}'].patch.responses['409']);
});
check('project creation requires explicit authority, closed input and immutable retry metadata', () => {
  const input = example('project-creation');
  for (const value of [{ ...input, owner: 'asserted' }, { ...input, status: 'active' }, { ...input, name: ' ' },
    { ...input, timeZone: '' }, { ...input, limits: { requestsPerMinute: 120 } }]) assert.equal(validate('ProjectCreation', value), false);
  assert.ok(validate('CreatedProject', { projectId: input.id, createdAt: '2026-10-09T00:00:00.000Z', creationHash: 'a'.repeat(64) }));
  const route = spec.paths['/v1/projects'].post;
  assert.ok(route.responses['403']); assert.ok(route.responses['409']); assert.ok(route.responses['413']);
  assert.equal(spec.paths['/v1/projects'].get.responses['405'].headers.Allow.schema.const, 'GET, POST');
});
check('admin history projects only bounded typed changes and excludes bodies, values and invented CLI identities', () => {
  const page = example('admin-changes'), row = page.data[0];
  for (const action of [
    { action: 'project.created' },
    { action: 'project.settings_changed', fields: ['name'] },
    { action: 'schema.published', schemaVersion: 2 },
    { action: 'schema.status_changed', schemaVersion: 2 },
    { ...row.change, action: 'grant.created', beforeRole: null, afterRole: 'reader' },
    row.change, { ...row.change, beforeRole: 'owner', afterRole: 'reader' },
    { ...row.change, action: 'grant.revoked', beforeRole: 'owner', afterRole: null },
  ]) assert.ok(validate('AdminChangeDetail', action), JSON.stringify(ajv.errors));
  for (const change of [
    { action: 'project.created', name: 'raw setting' },
    { action: 'project.settings_changed', fields: [] },
    { action: 'project.settings_changed', fields: ['name', 'name'] },
    { action: 'project.settings_changed', fields: ['accessToken'] },
    { action: 'schema.published', schemaVersion: 0 },
    { action: 'schema.published', schemaVersion: 2, definition: {} },
    { ...row.change, action: 'grant.created' }, { ...row.change, action: 'grant.revoked' },
    { ...row.change, afterRole: 'reader' }, { ...row.change, beforeRole: null },
  ]) assert.equal(validate('AdminChangeDetail', change), false);
  for (const value of [{ ...row, actor: { kind: 'local_operator', subject: 'inferred' } },
    { ...row, actor: { kind: 'administrator' } }, { ...row, requestBody: {} }, { ...row, occurredAt: 'bad' }])
    assert.equal(validate('AdminChange', value), false);
  for (const value of [{ ...page, retentionDays: 365 }, { ...page, coverage: 'complete' },
    { ...page, data: Array(101).fill(row) }, { ...page, page: { limit: 101, nextCursor: null } }])
    assert.equal(validate('AdminChangePage', value), false);
  const route = spec.paths['/v1/projects/{projectId}/changes'].get;
  for (const code of ['200', '400', '401', '403', '405', '503']) assert.ok(route.responses[code]);
  assert.equal(route.responses['405'].headers.Allow.schema.const, 'GET');
});
check('grant list is closed, paginated and owner-protected', () => {
  const page = example('project-grants');
  for (const value of [{ ...page, accessToken: 'unexpected' }, { ...page, data: [{ ...page.data[0], role: 'admin' }] },
    { ...page, data: [{ ...page.data[0], email: 'unexpected' }] }, { ...page, page: { limit: 101, nextCursor: null } }])
    assert.equal(validate('ProjectGrantPage', value), false);
  const route = spec.paths['/v1/projects/{projectId}/grants'].get;
  assert.ok(route.responses['401']); assert.ok(route.responses['403']);
  assert.equal(route.responses['405'].headers.Allow.schema.const, 'GET, PUT, DELETE');
});
check('grant mutations declare guarded writes, closed requests and exact result metadata', () => {
  const identity = { issuer: 'https://identity.example.invalid', subject: 'test-reader' };
  const add = { ...identity, role: 'reader', expectedRole: null };
  assert.ok(validate('GrantChangeRequest', add));
  assert.ok(validate('GrantChangeRequest', { ...add, role: 'owner', expectedRole: 'reader' }));
  assert.ok(validate('GrantRevokeRequest', { ...identity, expectedRole: 'owner' }));
  for (const value of [{ ...add, caller: 'asserted-owner' }, { ...add, role: null },
    { ...add, role: 'admin' }, { ...add, expectedRole: 'admin' }, { ...add, expectedRole: undefined }])
    assert.equal(validate('GrantChangeRequest', value), false);
  assert.equal(validate('GrantRevokeRequest', add), false);
  const result = { projectId: 'sembom', ...identity, role: 'reader', createdAt: '2026-10-11T00:00:00.000Z', canManage: true, changed: true };
  assert.ok(validate('GrantMutationResult', result));
  assert.ok(validate('GrantMutationResult', { ...result, role: null, createdAt: null, canManage: false }));
  for (const value of [{ ...result, accessToken: 'unexpected' }, { ...result, role: 'admin' },
    { ...result, changed: undefined }, { ...result, createdAt: 'invalid' },
    { ...result, role: null }, { ...result, createdAt: null }])
    assert.equal(validate('GrantMutationResult', value), false);
  for (const method of ['put', 'delete']) {
    const route = spec.paths['/v1/projects/{projectId}/grants'][method];
    for (const code of ['200', '400', '401', '403', '405', '409', '413', '415', '503']) assert.ok(route.responses[code]);
    assert.equal(route.responses['405'].headers.Allow.schema.const, 'GET, PUT, DELETE');
    assert.equal(route.requestBody.required, true);
    assert.equal(route.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/GrantMutationResult');
  }
  for (const code of ['grant_conflict', 'last_owner'])
    assert.ok(validate('ErrorResponse', { error: { ...example('error-response').error, code, message: 'Safe generic error.' } }));
});
check('schema drafts separate malformed envelopes from semantic errors and reports have consistent validity', () => {
  const draft = { events: registry.events, workflows: registry.workflows };
  assert.ok(validate('SchemaDraft', draft));
  assert.ok(validate('SchemaDraft', { events: [null], workflows: [] }));
  for (const value of [null, {}, { ...draft, schemaVersion: 2 }, { ...draft, events: null }])
    assert.equal(validate('SchemaDraft', value), false);
  const valid = { valid: true, issues: [], privacyReviewRequired: true };
  const invalid = { valid: false, issues: [{ path: '/events/0/name', code: 'duplicate' }], privacyReviewRequired: true };
  assert.ok(validate('SchemaValidation', valid)); assert.ok(validate('SchemaValidation', invalid));
  for (const value of [{ ...valid, valid: false }, { ...invalid, valid: true }, { ...valid, privacyReviewRequired: false },
    { ...invalid, issues: [{ path: '', code: 'unknown' }] }, { ...invalid, issues: [invalid.issues[0], invalid.issues[0]] }])
    assert.equal(validate('SchemaValidation', value), false);
  const operation = spec.paths['/v1/projects/{projectId}/schemas/validate'].post;
  assert.ok(operation.responses['403']); assert.ok(operation.responses['413']); assert.ok(operation.responses['415']);
});
check('settings updates reject unsafe shapes and require a hash plus a mutable field', () => {
  const valid = example('project-settings-update');
  for (const value of [null, [], {}, { expectedSettingsHash: valid.expectedSettingsHash }, { name: 'missing hash' },
    { ...valid, expectedSettingsHash: 'bad' }, { ...valid, timeZone: 'UTC' }, { ...valid, status: 'retired' },
    { ...valid, name: null }, { ...valid, limits: {} }, { ...valid, limits: { requestsPerMinute: 601 } },
    { ...valid, limits: { newReceiptsPerUtcDay: 0 } }, { ...valid, allowedOrigins: [] }])
    assert.equal(validate('ProjectSettingsUpdate', value), false);
  assert.ok(validate('ProjectSettingsUpdate', { expectedSettingsHash: valid.expectedSettingsHash, limits: { requestsPerMinute: 1 } }));
});
check('schema publication requires reviewed definitions and listing/publication metadata are bounded', () => {
  const input = { expectedLatestVersion: 1, privacyReviewed: true, events: registry.events, workflows: registry.workflows };
  assert.ok(validate('SchemaPublication', input));
  assert.ok(validate('SchemaPublication', { ...input, expectedLatestVersion: null }));
  for (const value of [{ ...input, privacyReviewed: false }, { ...input, expectedLatestVersion: 0 },
    { ...input, schemaVersion: 2 }, { ...input, events: [] }, { ...input, workflows: null }])
    assert.equal(validate('SchemaPublication', value), false);
  const metadata = { schemaVersion: 2, schemaStatus: 'active', publishedAt: '2026-10-09T00:00:00.000Z' };
  const published = { ...metadata, projectId: 'sembom', definitionHash: 'a'.repeat(64) };
  assert.ok(validate('PublishedSchema', published));
  const page = { projectId: 'sembom', latestVersion: 2, data: [metadata], page: { limit: 25, beforeVersion: null } };
  assert.ok(validate('SchemaPage', page));
  assert.equal(validate('SchemaPage', { ...page, data: Array(101).fill(metadata) }), false);
  const operation = spec.paths['/v1/projects/{projectId}/schemas/{schemaVersion}'].put;
  for (const code of ['401', '403', '409', '413', '415', '503']) assert.ok(operation.responses[code]);
  assert.equal(operation.responses['405'].headers.Allow.schema.const, 'GET, PUT');
});
check('all changed document relative links resolve', () => {
  const documents=['README.md','DEVELOPMENT.md','VALIDATION.md','ARCHITECTURE.md','docs/README.md','docs/product/02-spec.md','docs/product/01-roadmap.md','docs/adr/0002-contract-source-of-truth.md','docs/adr/0003-minimal-privacy-preserving-events.md','docs/adr/0005-event-and-aggregation-contract.md','docs/backend/event-contract.md','docs/backend/collector.md','docs/backend/README.md','docs/backend/03-persistence-model.md','docs/backend/04-http-api-policy.md','docs/integrations/backend-api.md','docs/integrations/sembom.md','docs/monorepo/package-ownership.md','docs/monorepo/workspace-boundaries.md','db/migrations/README.md'];
  for (const document of documents) for (const match of read(document).matchAll(/\]\(([^)]+)\)/g)) {
    const target=match[1]; if(/^(https?:|#)/.test(target))continue;
    assert.ok(fs.existsSync(fileURLToPath(new URL(target.split('#')[0],new URL(document,root)))),`${document}: ${target}`);
  }
});
console.log(`${checks} contract checks passed. No runtime, transaction, migration or auth behavior was executed.`);
