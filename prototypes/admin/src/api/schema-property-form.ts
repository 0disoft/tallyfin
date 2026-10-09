import { readDraft } from './schema-contract.ts';
import type { SchemaValidation } from './schema-contract.ts';
import { readEventForm } from './schema-event-form.ts';
import type { EventFormDraft } from './schema-event-form.ts';

export type FormProperty = Record<string, unknown> & { type: 'boolean' | 'enum' | 'integer'; required: boolean; purpose: string;
  values?: string[]; minimum?: number | string; maximum?: number | string };
export type PropertyRow = { name: string; definition: FormProperty };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const ENUM = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export function readPropertyForm(draft: EventFormDraft, eventIndex: number): PropertyRow[] {
  const event = draft.events[eventIndex];
  if (!event || Object.keys(event.properties).length > 4) throw Error('이벤트와 속성 개수를 확인해 주세요.');
  return Object.entries(event.properties).map(([name, value]) => {
    if (!record(value) || typeof value.required !== 'boolean' || typeof value.purpose !== 'string' ||
      (value.type !== 'boolean' && value.type !== 'enum' && value.type !== 'integer') ||
      value.type === 'enum' && (!Array.isArray(value.values) || !value.values.every(v => typeof v === 'string')) ||
      value.type === 'integer' && (![value.minimum, value.maximum].every(v => typeof v === 'number' || typeof v === 'string')))
      throw Error('폼으로 편집할 수 없는 속성이에요. JSON에서 정의를 확인해 주세요.');
    return { name, definition: value as FormProperty };
  });
}
export function propertyIsDimension(draft: EventFormDraft, eventIndex: number, name: string): boolean {
  const event = draft.events[eventIndex];
  return !!event && draft.workflows.some(workflow => record(workflow) && Array.isArray(workflow.dimensions) && workflow.dimensions.includes(name) &&
    ['startEvent', 'successEvent', 'failureEvent'].some(key => workflow[key] === event.name));
}
export type PropertyChange = { kind: 'add' } | { kind: 'remove'; name: string } | { kind: 'rename'; name: string; value: string } |
  { kind: 'type'; name: string; value: FormProperty['type'] } | { kind: 'required'; name: string; value: boolean } |
  { kind: 'purpose' | 'values' | 'minimum' | 'maximum'; name: string; value: string };
function integerInput(text: string): number | string {
  const number = Number(text);
  return /^-?\d+$/.test(text) && Number.isSafeInteger(number) ? number : text;
}
export function changePropertyForm(text: string, eventIndex: number, change: PropertyChange): string {
  const draft = readEventForm(text), rows = readPropertyForm(draft, eventIndex), event = draft.events[eventIndex]!;
  if (change.kind === 'add') {
    if (rows.length >= 4) throw Error('속성은 이벤트마다 최대 4개까지 등록할 수 있어요.');
    let suffix = 1; while (Object.hasOwn(event.properties, `property_${suffix}`)) suffix++;
    rows.push({ name: `property_${suffix}`, definition: { type: 'boolean', required: false, purpose: '' } });
  } else {
    const row = rows.find(row => row.name === change.name);
    if (!row) throw Error('편집할 속성을 확인해 주세요.');
    if (propertyIsDimension(draft, eventIndex, change.name) && change.kind !== 'purpose')
      throw Error('작업 흐름의 비교 기준 속성이에요. JSON에서 연결된 정의와 함께 수정해 주세요.');
    if (change.kind === 'remove') rows.splice(rows.indexOf(row), 1);
    else if (change.kind === 'rename') {
      if (change.value !== change.name && Object.hasOwn(event.properties, change.value)) throw Error('이미 사용 중인 속성 이름이에요. 다른 속성을 덮어쓰지 않았어요.');
      row.name = change.value;
    } else if (change.kind === 'type') {
      if (!['boolean', 'enum', 'integer'].includes(change.value)) throw Error('자료형을 확인해 주세요.');
      if (row.definition.type !== change.value) {
        const { values: _values, minimum: _minimum, maximum: _maximum, ...base } = row.definition;
        row.definition = { ...base, type: change.value, ...(change.value === 'enum' ? { values: [] } : change.value === 'integer' ? { minimum: 0, maximum: 1 } : {}) };
      }
    } else if (change.kind === 'values') {
      if (row.definition.type !== 'enum') throw Error('선택값 속성이 아니에요.');
      row.definition = { ...row.definition, values: change.value.split(/\r?\n/) };
    } else if (change.kind === 'minimum' || change.kind === 'maximum') {
      if (row.definition.type !== 'integer') throw Error('정수 속성이 아니에요.');
      row.definition = { ...row.definition, [change.kind]: integerInput(change.value) };
    } else row.definition = { ...row.definition, [change.kind]: change.value };
  }
  event.properties = Object.fromEntries(rows.map(row => [row.name, row.definition]));
  const next = JSON.stringify(draft, null, 2); readDraft(next); return next;
}
export function propertyChoices(property: FormProperty): number | null {
  if (property.type === 'boolean') return 2 + (property.required ? 0 : 1);
  if (property.type === 'enum') {
    if (!property.values?.length || !property.values.every(v => ENUM.test(v)) || new Set(property.values).size !== property.values.length) return null;
    return property.values.length + (property.required ? 0 : 1);
  }
  if (typeof property.minimum !== 'number' || typeof property.maximum !== 'number' || !Number.isSafeInteger(property.minimum) || !Number.isSafeInteger(property.maximum) ||
    property.minimum < -1000000 || property.maximum > 1000000 || property.maximum < property.minimum) return null;
  return property.maximum - property.minimum + 1 + (property.required ? 0 : 1);
}
export function propertyIssueTarget(text: string, issue: SchemaValidation['issues'][number]): string | null {
  const match = /^\/events\/(\d+)(?:\/properties(?:\/([^/]+))?)?$/.exec(issue.path);
  if (!match) return null;
  const eventIndex = Number(match[1]), prefix = `schema-event-${eventIndex}`;
  let rows: PropertyRow[];
  try { rows = readPropertyForm(readEventForm(text), eventIndex); } catch { return null; }
  if (issue.path === `/events/${eventIndex}`) return issue.code === 'cardinality_limit' ? `${prefix}-properties-heading` : null;
  if (issue.path === `/events/${eventIndex}/properties` && issue.code === 'cardinality_limit') return `${prefix}-properties-heading`;
  const propertyIndex = match[2] === undefined ? rows.findIndex(row => !NAME.test(row.name)) : rows.findIndex(row => row.name === match[2]);
  if (propertyIndex < 0) return null;
  const row = rows[propertyIndex]!, property = row.definition, base = `${prefix}-property-${propertyIndex}`;
  if (!NAME.test(row.name)) return `${base}-name`;
  if (!property.purpose.length || property.purpose.length > 240) return `${base}-purpose`;
  if (property.type === 'enum' && (propertyChoices(property) === null || (property.values?.length ?? 0) > 32)) return `${base}-values`;
  if (property.type === 'integer') {
    if (typeof property.minimum !== 'number' || !Number.isSafeInteger(property.minimum) || Math.abs(property.minimum) > 1000000) return `${base}-minimum`;
    if (typeof property.maximum !== 'number' || !Number.isSafeInteger(property.maximum) || Math.abs(property.maximum) > 1000000 || property.maximum < property.minimum || property.maximum - property.minimum + 1 > 32) return `${base}-maximum`;
  }
  return null;
}
