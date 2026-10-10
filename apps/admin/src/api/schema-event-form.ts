import { readDraft } from './schema-contract.ts';
import type { SchemaDraft, SchemaValidation } from './schema-contract.ts';

export type FormEvent = Record<string, unknown> & { name: string; label: string; source: 'browser' | 'server'; properties: Record<string, unknown> };
export type EventFormDraft = Omit<SchemaDraft, 'events'> & { events: FormEvent[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;

/** Only project representable fields; never repair or drop unsupported JSON contents. */
export function readEventForm(text: string): EventFormDraft {
  const draft = readDraft(text);
  if (draft.events.length > 50 || draft.events.some(event => !record(event) || typeof event.name !== 'string' ||
    typeof event.label !== 'string' || (event.source !== 'browser' && event.source !== 'server') || !record(event.properties)))
    throw Error('폼으로 편집할 수 없는 정의예요. JSON 직접 편집에서 이벤트 형식을 확인해 주세요.');
  return draft as EventFormDraft;
}
export function eventIsLinked(draft: EventFormDraft, index: number): boolean {
  const name = draft.events[index]?.name;
  return typeof name === 'string' && name.length > 0 && (draft.workflows.some(workflow => record(workflow) &&
    ['startEvent', 'successEvent', 'failureEvent'].some(key => workflow[key] === name)) ||
    (draft.funnels ?? []).some(funnel => record(funnel) && Array.isArray(funnel.steps) &&
      funnel.steps.some(step => record(step) && step.eventName === name)));
}
export type EventChange = { kind: 'add' } | { kind: 'remove'; index: number } |
  { kind: 'edit'; index: number; field: 'name' | 'label' | 'source'; value: string };
export function changeEventForm(text: string, change: EventChange): string {
  const draft = readEventForm(text);
  if (change.kind === 'add') {
    if (draft.events.length >= 50) throw Error('이벤트는 최대 50개까지 등록할 수 있어요.');
    draft.events.push({ name: '', label: '', source: 'browser', properties: {} });
  } else {
    if (!Number.isInteger(change.index) || !draft.events[change.index]) throw Error('편집할 이벤트를 확인해 주세요.');
    if (eventIsLinked(draft, change.index) && (change.kind === 'remove' || change.field !== 'label'))
      throw Error('작업 흐름·퍼널에 연결된 이벤트의 이름·출처·삭제는 JSON에서 연결 정의와 함께 수정해 주세요.');
    if (change.kind === 'remove') draft.events.splice(change.index, 1);
    else {
      if (change.field === 'source' && change.value !== 'browser' && change.value !== 'server') throw Error('발행 출처를 확인해 주세요.');
      draft.events[change.index] = { ...draft.events[change.index]!, [change.field]: change.value };
    }
  }
  const next = JSON.stringify(draft, null, 2);
  readDraft(next); // Keep the existing request-size boundary before changing the shared draft.
  return next;
}
/** Property/workflow errors stay in JSON; basic event errors focus the corresponding form control. */
export function eventIssueTarget(text: string, issue: SchemaValidation['issues'][number]): string | null {
  let draft: EventFormDraft;
  try { draft = readEventForm(text); } catch { return null; }
  if (issue.path === '/events') {
    if (draft.events.length === 0) return 'schema-event-add';
    if (issue.code === 'browser_event_required') return 'schema-event-0-source';
  }
  const match = /^\/events\/(\d+)(?:\/(name))?$/.exec(issue.path);
  if (!match) return null;
  const index = Number(match[1]), event = draft.events[index];
  if (!event) return null;
  if (match[2] || !NAME.test(event.name)) return `schema-event-${index}-name`;
  if (!event.label.trim() || event.label.length > 80 || /[\x00-\x1f\x7f]/.test(event.label)) return `schema-event-${index}-label`;
  return null;
}
