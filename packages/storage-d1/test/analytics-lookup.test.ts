import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { initialize } from '../../../tools/provision/local.ts';
import { queryStatements } from '../src/query-statements.ts';
import type { SqlDatabase, SqlValue } from '../src/sql.ts';
import { migrationStatements, seed, now } from './helpers.ts';

test('lookup migration preserves query results, improves actual D1 plans and rejects incomplete indexes', async t => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}',
    compatibilityDate: '2026-08-06', d1Databases: { DB: 'analytics-lookup-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('CREATE INDEX event_daily_counts_lookup'));
    assert.ok(boundary > 0);
    await db.batch(statements.slice(0, boundary).map(sql => db.prepare(sql))); await seed(db);
    const principal = { issuer: 'https://identity.example.invalid', subject: 'test-reader' };
    await db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'reader',?)").bind(principal.issuer, principal.subject, now).run();
    await db.prepare("INSERT INTO event_daily_counts VALUES ('sembom',1,'browser','2026-10-08','tool_view','{}',7,?)").bind(now).run();
    for (const funnel of ['conversion', 'other']) for (const step of [0, 1])
      await db.prepare("INSERT INTO funnel_daily_counts VALUES ('sembom',1,'2026-10-08',?,'{}',?,?,?)")
        .bind(funnel, step, 7 - step, now).run();
    const queries = ['event', 'funnel', 'funnel-breakdown'].map(kind => {
      const captured: { sql: string; values: SqlValue[] }[] = [];
      const capture = { prepare(sql: string) {
        const entry = { sql, values: [] as SqlValue[] }; captured.push(entry);
        const statement = { bind(...values: SqlValue[]) { entry.values = values; return statement; } }; return statement;
      } } as SqlDatabase;
      queryStatements(capture, principal, { projectId: 'sembom', version: 1, kind: kind as 'event' | 'funnel' | 'funnel-breakdown',
        name: kind === 'event' ? 'tool_view' : 'conversion', from: '2026-10-08', to: '2026-10-09' }, 'browser');
      return captured.at(-1)!;
    });
    const rows = () => Promise.all(queries.map(q => db.prepare(q.sql).bind(...q.values).all()));
    const plans = () => Promise.all(queries.map(async q => (await db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
      .bind(...q.values).all<{ detail: string }>()).results.map(row => row.detail).join('\n')));
    const before = await rows(), oldPlans = await plans();
    const upgrade = statements.slice(boundary);
    await assert.rejects(db.batch([...upgrade.map(sql => db.prepare(sql)), db.prepare('SELECT * FROM missing_upgrade_table')]));
    assert.deepEqual(await initialize(db, false), { migrations: ['0011_analytics_lookup.sql'], applied: false });
    await initialize(db, true);
    assert.deepEqual((await rows()).map(row => row.results), before.map(row => row.results));
    assert.ok(before.every(row => row.results.length > 0));
    const newPlans = await plans();
    assert.match(oldPlans[0]!, /TEMP B-TREE/);
    assert.match(newPlans[0]!, /event_daily_counts_lookup/); assert.doesNotMatch(newPlans[0]!, /TEMP B-TREE/);
    for (const plan of newPlans.slice(1)) assert.match(plan, /funnel_daily_counts_lookup.*funnel_id=\?/);
    assert.doesNotMatch(newPlans[1]!, /TEMP B-TREE/);
    t.diagnostic(`D1 query plans after upgrade: ${newPlans.join(' | ')}`);
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    await db.prepare('DROP INDEX event_daily_counts_lookup').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
    await db.prepare('CREATE INDEX event_daily_counts_lookup ON event_daily_counts(project_id)').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
    await db.batch(['event_daily_counts_lookup', 'funnel_daily_counts_lookup'].map(name => db.prepare(`DROP INDEX ${name}`)));
    assert.deepEqual(await initialize(db, true), { migrations: ['0011_analytics_lookup.sql'], applied: true });
  } finally { await mf.dispose(); }
});
