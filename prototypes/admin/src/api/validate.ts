// Minimal runtime validation for administration responses. Missing or mistyped
// fields raise ContractError instead of being coerced, so a failed or partial
// response is never rendered as a real zero.

import type {
  EventDefinition,
  EventSeriesResponse,
  Project,
  ProjectPage,
  ProjectSettings,
  PropertyDefinition,
  QueryMeta,
  Registry,
  SummaryResponse,
  WorkflowDefinition,
  WorkflowResponse,
  WorkflowSummary,
} from './types.ts';

export class ContractError extends Error {
  path: string;
  constructor(message: string, path = '') {
    super(message);
    this.name = 'ContractError';
    this.path = path;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new ContractError(`${path} ${message}`, path);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be an object');
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'must be an integer');
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a number');
  return value;
}

function expectNullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return expectInteger(value, path);
}

function expectEnum(value: unknown, allowed: readonly string[], path: string): string {
  const text = expectString(value, path);
  if (!allowed.includes(text)) fail(path, `must be one of ${allowed.join('|')}`);
  return text;
}

function expectMin(value: number, minimum: number, path: string): number {
  if (value < minimum) fail(path, `must be >= ${minimum}`);
  return value;
}

function expectMax(value: number, maximum: number, path: string): number {
  if (value > maximum) fail(path, `must be <= ${maximum}`);
  return value;
}

function parseProject(value: unknown, path: string): Project {
  const record = expectRecord(value, path);
  return {
    id: expectString(record.id, `${path}.id`),
    name: expectString(record.name, `${path}.name`),
    status: expectEnum(record.status, ['active', 'paused'], `${path}.status`) as Project['status'],
    timeZone: expectString(record.timeZone, `${path}.timeZone`),
  };
}

export function parseProjectSettings(value: unknown): ProjectSettings {
  const record = expectRecord(value, 'response');
  const project = parseProject(record.project, 'response.project');
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(project.id) || project.name.length < 1 || project.name.length > 80)
    fail('response.project', 'invalid identity or name');
  const limits = expectRecord(record.limits, 'response.limits');
  const allowedOrigins = expectArray(record.allowedOrigins, 'response.allowedOrigins').map((value, index) => {
    const origin = expectString(value, `response.allowedOrigins[${index}]`);
    let url: URL;
    try { url = new URL(origin); } catch { fail('response.allowedOrigins', 'invalid origin'); }
    if (origin.length > 256 || url.origin !== origin || url.username || url.password || origin.includes('*') ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
      fail('response.allowedOrigins', 'invalid origin');
    return origin;
  });
  if (allowedOrigins.length < 1 || allowedOrigins.length > 16 || new Set(allowedOrigins).size !== allowedOrigins.length)
    fail('response.allowedOrigins', 'invalid origin count');
  const hash = expectString(record.settingsHash, 'response.settingsHash');
  if (!/^[0-9a-f]{64}$/.test(hash)) fail('response.settingsHash', 'invalid hash');
  return { project, allowedOrigins, limits: {
    requestsPerMinute: expectMax(expectMin(expectInteger(limits.requestsPerMinute, 'response.limits.requestsPerMinute'), 1, 'response.limits.requestsPerMinute'), 600, 'response.limits.requestsPerMinute'),
    newReceiptsPerUtcDay: expectMax(expectMin(expectInteger(limits.newReceiptsPerUtcDay, 'response.limits.newReceiptsPerUtcDay'), 1, 'response.limits.newReceiptsPerUtcDay'), 1_000_000, 'response.limits.newReceiptsPerUtcDay'),
  }, settingsHash: hash, canEdit: expectBoolean(record.canEdit, 'response.canEdit') };
}

export function parseProjectPage(value: unknown): ProjectPage {
  const record = expectRecord(value, 'response');
  const data = expectArray(record.data, 'response.data').map((item, index) =>
    parseProject(item, `response.data[${index}]`),
  );
  if (data.length > 100) fail('response.data', 'must have at most 100 items');
  const page = expectRecord(record.page, 'response.page');
  const limit = expectMax(
    expectMin(expectInteger(page.limit, 'response.page.limit'), 1, 'response.page.limit'),
    100,
    'response.page.limit',
  );
  const nextCursor = page.nextCursor === null ? null : expectString(page.nextCursor, 'response.page.nextCursor');
  return { data, page: { limit, nextCursor } };
}

function parsePropertyDefinition(value: unknown, path: string): PropertyDefinition {
  const record = expectRecord(value, path);
  const type = expectEnum(record.type, ['boolean', 'enum', 'integer'], `${path}.type`);
  const required = expectBoolean(record.required, `${path}.required`);
  const purpose = expectString(record.purpose, `${path}.purpose`);
  if (type === 'enum') {
    return {
      type,
      required,
      purpose,
      values: expectArray(record.values, `${path}.values`).map((item, index) =>
        expectString(item, `${path}.values[${index}]`),
      ),
    };
  }
  if (type === 'integer') {
    return {
      type,
      required,
      purpose,
      minimum: expectInteger(record.minimum, `${path}.minimum`),
      maximum: expectInteger(record.maximum, `${path}.maximum`),
    };
  }
  return { type: 'boolean', required, purpose };
}

function parseEventDefinition(value: unknown, path: string): EventDefinition {
  const record = expectRecord(value, path);
  const propertiesRecord = expectRecord(record.properties, `${path}.properties`);
  const properties: Record<string, PropertyDefinition> = {};
  for (const [key, item] of Object.entries(propertiesRecord)) {
    properties[key] = parsePropertyDefinition(item, `${path}.properties.${key}`);
  }
  return {
    name: expectString(record.name, `${path}.name`),
    label: expectString(record.label, `${path}.label`),
    source: expectEnum(record.source, ['browser', 'server'], `${path}.source`) as EventDefinition['source'],
    properties,
  };
}

function parseWorkflowDefinition(value: unknown, path: string): WorkflowDefinition {
  const record = expectRecord(value, path);
  return {
    id: expectString(record.id, `${path}.id`),
    label: expectString(record.label, `${path}.label`),
    source: expectEnum(record.source, ['browser'], `${path}.source`) as 'browser',
    startEvent: expectString(record.startEvent, `${path}.startEvent`),
    successEvent: expectString(record.successEvent, `${path}.successEvent`),
    failureEvent: record.failureEvent === null ? null : expectString(record.failureEvent, `${path}.failureEvent`),
    dimensions: expectArray(record.dimensions, `${path}.dimensions`).map((item, index) =>
      expectString(item, `${path}.dimensions[${index}]`),
    ),
  };
}

export function parseRegistry(value: unknown): Registry {
  const record = expectRecord(value, 'response');
  const limits = expectRecord(record.limits, 'response.limits');
  return {
    project: parseProject(record.project, 'response.project'),
    schemaVersion: expectMin(expectInteger(record.schemaVersion, 'response.schemaVersion'), 1, 'response.schemaVersion'),
    schemaStatus: expectEnum(record.schemaStatus, ['active', 'retired'], 'response.schemaStatus') as Registry['schemaStatus'],
    allowedOrigins: expectArray(record.allowedOrigins, 'response.allowedOrigins').map((item, index) =>
      expectString(item, `response.allowedOrigins[${index}]`),
    ),
    limits: {
      requestsPerMinute: expectInteger(limits.requestsPerMinute, 'response.limits.requestsPerMinute'),
      newReceiptsPerUtcDay: expectInteger(limits.newReceiptsPerUtcDay, 'response.limits.newReceiptsPerUtcDay'),
    },
    events: expectArray(record.events, 'response.events').map((item, index) =>
      parseEventDefinition(item, `response.events[${index}]`),
    ),
    workflows: expectArray(record.workflows, 'response.workflows').map((item, index) =>
      parseWorkflowDefinition(item, `response.workflows[${index}]`),
    ),
  };
}

function parseMeta(value: unknown, path: string): QueryMeta {
  const record = expectRecord(value, path);
  return {
    projectId: expectString(record.projectId, `${path}.projectId`),
    schemaVersion: expectInteger(record.schemaVersion, `${path}.schemaVersion`),
    source: expectEnum(record.source, ['browser'], `${path}.source`) as 'browser',
    from: expectString(record.from, `${path}.from`),
    to: expectString(record.to, `${path}.to`),
    timeZone: expectString(record.timeZone, `${path}.timeZone`),
    generatedAt: expectString(record.generatedAt, `${path}.generatedAt`),
    latestReceivedAt:
      record.latestReceivedAt === null ? null : expectString(record.latestReceivedAt, `${path}.latestReceivedAt`),
    coverage: expectEnum(record.coverage, ['observed-only'], `${path}.coverage`) as 'observed-only',
  };
}

function parseCount(value: unknown, path: string): number {
  return expectMin(expectInteger(value, path), 0, path);
}

export function parseSummaryResponse(value: unknown): SummaryResponse {
  const record = expectRecord(value, 'response');
  return {
    meta: parseMeta(record.meta, 'response.meta'),
    totalEvents: parseCount(record.totalEvents, 'response.totalEvents'),
    events: expectArray(record.events, 'response.events').map((item, index) => {
      const bucket = expectRecord(item, `response.events[${index}]`);
      return {
        name: expectString(bucket.name, `response.events[${index}].name`),
        count: parseCount(bucket.count, `response.events[${index}].count`),
      };
    }),
  };
}

export function parseEventSeriesResponse(value: unknown): EventSeriesResponse {
  const record = expectRecord(value, 'response');
  return {
    meta: parseMeta(record.meta, 'response.meta'),
    eventName: expectString(record.eventName, 'response.eventName'),
    groupBy: record.groupBy === null ? null : expectString(record.groupBy, 'response.groupBy'),
    totalEvents: parseCount(record.totalEvents, 'response.totalEvents'),
    days: expectArray(record.days, 'response.days').map((item, index) => {
      const day = expectRecord(item, `response.days[${index}]`);
      return {
        date: expectString(day.date, `response.days[${index}].date`),
        count: parseCount(day.count, `response.days[${index}].count`),
        breakdown: expectArray(day.breakdown, `response.days[${index}].breakdown`).map((entry, entryIndex) => {
          const bucket = expectRecord(entry, `response.days[${index}].breakdown[${entryIndex}]`);
          const bucketValue = bucket.value;
          if (bucketValue !== null && typeof bucketValue !== 'boolean' && typeof bucketValue !== 'number' && typeof bucketValue !== 'string') {
            fail(`response.days[${index}].breakdown[${entryIndex}].value`, 'must be boolean, number, string or null');
          }
          return {
            value: bucketValue as boolean | number | string | null,
            count: parseCount(bucket.count, `response.days[${index}].breakdown[${entryIndex}].count`),
          };
        }),
      };
    }),
  };
}

function parseWorkflowSummary(value: unknown, path: string): WorkflowSummary {
  const record = expectRecord(value, path);
  const completionRate = record.completionRate === null ? null : expectNumber(record.completionRate, `${path}.completionRate`);
  if (completionRate !== null) expectMax(expectMin(completionRate, 0, `${path}.completionRate`), 100, `${path}.completionRate`);
  return {
    startedAttempts: parseCount(record.startedAttempts, `${path}.startedAttempts`),
    succeededAttempts: parseCount(record.succeededAttempts, `${path}.succeededAttempts`),
    failedAttempts: expectNullableInteger(record.failedAttempts, `${path}.failedAttempts`),
    pendingAttempts: parseCount(record.pendingAttempts, `${path}.pendingAttempts`),
    completionRate,
  };
}

export function parseWorkflowResponse(value: unknown): WorkflowResponse {
  const record = expectRecord(value, 'response');
  return {
    meta: parseMeta(record.meta, 'response.meta'),
    workflowId: expectString(record.workflowId, 'response.workflowId'),
    cohortBasis: expectEnum(record.cohortBasis, ['startedAt'], 'response.cohortBasis') as 'startedAt',
    summary: parseWorkflowSummary(record.summary, 'response.summary'),
    days: expectArray(record.days, 'response.days').map((item, index) => {
      const day = expectRecord(item, `response.days[${index}]`);
      const summary = parseWorkflowSummary(
        {
          startedAttempts: day.startedAttempts,
          succeededAttempts: day.succeededAttempts,
          failedAttempts: day.failedAttempts,
          pendingAttempts: day.pendingAttempts,
          completionRate: day.completionRate,
        },
        `response.days[${index}]`,
      );
      return {
        date: expectString(day.date, `response.days[${index}].date`),
        ...summary,
        provisional: expectBoolean(day.provisional, `response.days[${index}].provisional`),
      };
    }),
  };
}
