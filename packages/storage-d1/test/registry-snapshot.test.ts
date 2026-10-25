import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, schemaDefinitions } from '@tallyfin/core';
import { RegistrySnapshot } from '../src/registry-snapshot.ts';
import type { ProjectRow, SchemaRow } from '../src/sql.ts';
import { registry } from './helpers.ts';

const project: ProjectRow = { id: registry.project.id, name: registry.project.name, status: 'active', time_zone: registry.project.timeZone,
  allowed_origins_json: JSON.stringify(registry.allowedOrigins), requests_per_minute: registry.limits.requestsPerMinute,
  new_receipts_per_utc_day: registry.limits.newReceiptsPerUtcDay, ingest_revision: 0, grant_revision: 0 };
const schema: SchemaRow = { version: registry.schemaVersion, status: 'active', definitions_json: JSON.stringify(schemaDefinitions(registry)) };

test('eight unchanged snapshots validate once and caller mutations cannot change the stored fingerprint', () => {
  const snapshot = new RegistrySnapshot(false), read = snapshot.read.bind(snapshot); let validations = 0;
  snapshot.read = (project, schema) => { validations++; return read(project, schema); };
  const result = snapshot.read(project, schema), expected = canonicalJson(result);
  for (let ingest_revision = 0; ingest_revision < 8; ingest_revision++)
    assert.equal(snapshot.matches({ ...project, ingest_revision }, schema, expected), true);
  assert.equal(validations, 1);
  result.project.name = 'Caller mutation';
  assert.equal(snapshot.matches(project, schema, canonicalJson(result)), false);
  assert.equal(snapshot.matches(project, schema, expected), true);
  assert.equal(validations, 1);
  assert.notEqual(snapshot.read(project, schema).project.name, result.project.name);
});

test('all configuration fields invalidate reuse while equivalent JSON preserves semantic comparison', () => {
  const snapshot = new RegistrySnapshot(false), expected = canonicalJson(snapshot.read(project, schema));
  for (const change of [{id:'different-project'}, {name:'Changed name'}, {status:'paused' as const}, {time_zone:'UTC'},
    {allowed_origins_json:'["https://other.example.invalid"]'}, {requests_per_minute:1}, {new_receipts_per_utc_day:1}]) {
    snapshot.read(project, schema);
    assert.equal(snapshot.matches({...project,...change},schema,expected),false);
  }
  for (const change of [{version:2}, {status:'retired' as const},
    {definitions_json: JSON.stringify({...schemaDefinitions(registry),workflows:[]})}]) {
    snapshot.read(project, schema);
    assert.equal(snapshot.matches(project,{...schema,...change},expected),false);
  }
  assert.equal(snapshot.matches(project,{...schema,definitions_json:JSON.stringify(schemaDefinitions(registry),null,2)},expected),true);
  assert.throws(()=>snapshot.matches(project,{...schema,definitions_json:'{"events":null,"workflows":[]}'},expected));
  assert.equal(snapshot.matches(project,schema,expected),true);
});
