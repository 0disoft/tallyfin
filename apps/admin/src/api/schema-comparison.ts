import type { Registry } from './types.ts';
import type { ApiClient } from './client.ts';
import { ApiError } from './api-error.ts';
import { canonicalDefinitions } from './schema-contract.ts';

type Definitions = Pick<Registry, 'events' | 'workflows' | 'funnels' | 'representativeWorkflowId'>;
export type SchemaChange = {
  section: 'event' | 'property' | 'workflow' | 'funnel' | 'schema';
  name: string; field: string; kind: 'added' | 'removed' | 'changed';
  before: unknown; after: unknown;
};
export type SchemaComparison = { from: number; to: number; changes: SchemaChange[] };

/** Compare validated, published definitions. Identity is name/id; array order is preserved. */
export function compareSchemaDefinitions(before: Definitions, after: Definitions): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const add = (section: SchemaChange['section'], name: string, field: string, a: unknown, b: unknown) => {
    if (canonicalDefinitions(a) === canonicalDefinitions(b)) return;
    changes.push({ section, name, field, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
      before: structuredClone(a), after: structuredClone(b) });
  };
  const fields = (section: SchemaChange['section'], name: string, a: object, b: object, keys: string[]) => {
    for (const key of keys) add(section, name, key, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
  };
  const entities = <T extends object>(section: SchemaChange['section'], a: readonly T[], b: readonly T[],
    key: (item: T) => string, compare: (name: string, a: T, b: T) => void) => {
    const old = new Map(a.map(item => [key(item), item])), next = new Map(b.map(item => [key(item), item]));
    for (const [name, item] of old) {
      const replacement = next.get(name);
      if (replacement === undefined) add(section, name, 'definition', item, undefined);
      else compare(name, item, replacement);
    }
    for (const [name, item] of next) if (!old.has(name)) add(section, name, 'definition', undefined, item);
    // Add/remove rows already describe membership changes. Report display order separately only for the same members.
    if (old.size === next.size && [...old.keys()].every(name => next.has(name)))
      add('schema', section, 'order', [...old.keys()], [...next.keys()]);
  };
  entities('event', before.events, after.events, event => event.name, (name, a, b) => {
    fields('event', name, a, b, ['label', 'source']);
    const names = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    for (const property of names) {
      const old = Object.hasOwn(a.properties, property) ? a.properties[property] : undefined;
      const next = Object.hasOwn(b.properties, property) ? b.properties[property] : undefined, identity = `${name}.${property}`;
      if (old === undefined || next === undefined) add('property', identity, 'definition', old, next);
      else fields('property', identity, old, next, ['type', 'required', 'purpose', 'values', 'minimum', 'maximum']);
    }
  });
  entities('workflow', before.workflows, after.workflows, flow => flow.id, (name, a, b) =>
    fields('workflow', name, a, b, ['label', 'source', 'startEvent', 'successEvent', 'failureEvent', 'failureReasonProperty', 'dimensions']));
  entities('funnel', before.funnels ?? [], after.funnels ?? [], funnel => funnel.id, (name, a, b) =>
    fields('funnel', name, a, b, ['label', 'dimensions', 'steps']));
  add('schema', 'representativeWorkflowId', 'representativeWorkflowId', before.representativeWorkflowId, after.representativeWorkflowId);
  return changes;
}

/** Two bounded reads under one lifetime. A failed side cancels the sibling; no write or automatic retry. */
export async function loadSchemaComparison(client: Pick<ApiClient, 'getSchema'>, projectId: string,
  from: number, to: number, signal: AbortSignal): Promise<SchemaComparison> {
  signal.throwIfAborted();
  if (![from, to].every(v => Number.isInteger(v) && v >= 1 && v <= 2147483647) || from === to)
    throw new ApiError('invalid_request', '비교할 서로 다른 두 버전을 골라 주세요.');
  const controller = new AbortController(), abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const [before, after] = await Promise.all([from, to].map(version => client.getSchema(projectId, version, { signal: controller.signal })));
    signal.throwIfAborted();
    if (before.project.id !== projectId || after.project.id !== projectId || before.schemaVersion !== from || after.schemaVersion !== to)
      throw new ApiError('contract', '비교 응답의 프로젝트나 버전이 요청과 달라요.');
    return { from, to, changes: compareSchemaDefinitions(before, after) };
  } finally {
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
