import { canonicalJson, closed, validateRegistry } from '@tallyfin/core';
import type { Registry } from '@tallyfin/core';
import type { ProjectRow, SchemaRow } from './sql.ts';

function key(project: ProjectRow, schema: SchemaRow): string {
  return JSON.stringify([project.id, project.name, project.status, project.time_zone, project.allowed_origins_json,
    project.requests_per_minute, project.new_receipts_per_utc_day, schema.version, schema.status, schema.definitions_json]);
}

/** One configuration per store, no I/O promises or caller-owned registry objects. */
export class RegistrySnapshot {
  private cached: { key: string; fingerprint: string } | undefined;
  private readonly allowLocalHttp: boolean;
  constructor(allowLocalHttp: boolean) { this.allowLocalHttp = allowLocalHttp; }
  read(project: ProjectRow, schema: SchemaRow): Registry {
    const definitions: unknown = JSON.parse(schema.definitions_json);
    if (!closed(definitions, ['events', 'workflows'], ['funnels', 'representativeWorkflowId'])) throw Error('invalid registry');
    const registry = validateRegistry({ ...definitions, project: { id: project.id, name: project.name, status: project.status, timeZone: project.time_zone },
      allowedOrigins: JSON.parse(project.allowed_origins_json), schemaVersion: schema.version, schemaStatus: schema.status,
      limits: { requestsPerMinute: project.requests_per_minute, newReceiptsPerUtcDay: project.new_receipts_per_utc_day } }, { allowLocalHttp: this.allowLocalHttp });
    this.cached = { key: key(project, schema), fingerprint: canonicalJson(registry) };
    return registry;
  }
  matches(project: ProjectRow, schema: SchemaRow, expected: string): boolean {
    // Revisions and received-at timestamps change on writes, not configuration.
    // Every actual configuration field must match before skipping revalidation.
    if (key(project, schema) !== this.cached?.key) this.read(project, schema);
    return this.cached!.fingerprint === expected;
  }
}
