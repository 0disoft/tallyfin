import { CollectionError } from '@tallyfin/core';
import type { Properties, Registry } from '@tallyfin/core';

export function readDimensions(key: string, definitions: Registry['events'][number]['properties']): Properties {
  const tuples: unknown = JSON.parse(key);
  if (!Array.isArray(tuples) || tuples.length !== Object.keys(definitions).length) throw new CollectionError('storage_unavailable', 503);
  const result: Properties = {}; const seen = new Set();
  for (const tuple of tuples) {
    if (!Array.isArray(tuple) || !Object.hasOwn(definitions, tuple[0]) || seen.has(tuple[0])) throw new CollectionError('storage_unavailable', 503);
    seen.add(tuple[0]); const rule = definitions[tuple[0]]!;
    if (tuple[1] === 'absent' && tuple.length === 2 && !rule.required) continue;
    const value: unknown = tuple[2];
    if (tuple.length !== 3 || tuple[1] !== typeof value || !(rule.type === 'boolean' ? typeof value === 'boolean' : rule.type === 'enum'
      ? typeof value === 'string' && rule.values.includes(value) : typeof value === 'number' && Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum))
      throw new CollectionError('storage_unavailable', 503);
    result[tuple[0]] = value as string | number | boolean;
  }
  return result;
}
