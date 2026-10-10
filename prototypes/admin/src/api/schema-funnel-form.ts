import { readDraft } from './schema-contract.ts';
import type { SchemaValidation } from './schema-contract.ts';
import { readEventForm } from './schema-event-form.ts';
import type { EventFormDraft, FormEvent } from './schema-event-form.ts';

export type FormStep = Record<string, unknown> & { eventName: string; source: 'browser' | 'server' };
export type FormFunnel = Record<string, unknown> & { id: string; label: string; steps: FormStep[]; dimensions: string[] };
export type FunnelFormDraft = Omit<EventFormDraft, 'funnels'> & { funnels?: FormFunnel[] };
export type FunnelChange = { kind: 'add' } | { kind: 'remove'; index: number } |
  { kind: 'edit'; index: number; field: 'id' | 'label'; value: string } |
  { kind: 'dimensions'; index: number; value: string[] } |
  { kind: 'add-step'; index: number } | { kind: 'remove-step'; index: number; step: number } |
  { kind: 'move-step'; index: number; step: number; direction: -1 | 1 } |
  { kind: 'event'; index: number; step: number; eventName: string; source: 'browser' | 'server' };
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const emptyStep = (): FormStep => ({ eventName: '', source: 'browser' });

/** Accept representable, unfinished drafts without repairing or discarding unknown fields. */
export function readFunnelForm(text: string): FunnelFormDraft {
  const draft = readEventForm(text);
  if (draft.funnels && (draft.funnels.length > 10 || draft.funnels.some(f => !record(f) || typeof f.id !== 'string' ||
    typeof f.label !== 'string' || !Array.isArray(f.steps) || f.steps.length > 10 || f.steps.some(s => !record(s) ||
      typeof s.eventName !== 'string' || (s.source !== 'browser' && s.source !== 'server')) ||
    !Array.isArray(f.dimensions) || !f.dimensions.every(d => typeof d === 'string'))))
    throw Error('폼으로 편집할 수 없는 퍼널이에요. JSON에서 정의를 확인해 주세요.');
  return draft as FunnelFormDraft;
}
export function changeFunnelForm(text: string, change: FunnelChange): string {
  const draft = readFunnelForm(text), funnels = draft.funnels ?? [];
  if (change.kind === 'add') {
    if (funnels.length >= 10) throw Error('퍼널은 최대 10개까지 등록할 수 있어요.');
    let suffix = 1; while (funnels.some(f => f.id === `funnel_${suffix}`)) suffix++;
    draft.funnels = [...funnels, { id: `funnel_${suffix}`, label: '', steps: [emptyStep(), emptyStep()], dimensions: [] }];
  } else {
    if (!Number.isInteger(change.index) || !funnels[change.index]) throw Error('편집할 퍼널을 확인해 주세요.');
    const funnel = funnels[change.index]!;
    if (change.kind === 'remove') funnels.splice(change.index, 1);
    else if (change.kind === 'edit') {
      if (change.field === 'id' && funnels.some((f, i) => i !== change.index && f.id === change.value))
        throw Error('이미 사용 중인 퍼널 ID예요. 다른 퍼널을 덮어쓰지 않았어요.');
      funnels[change.index] = { ...funnel, [change.field]: change.value };
    } else if (change.kind === 'dimensions') {
      if (change.value.length > 4 || new Set(change.value).size !== change.value.length || !change.value.every(d => NAME.test(d)))
        throw Error('비교 기준은 올바른 속성 이름으로 최대 4개까지 중복 없이 선택하세요.');
      funnel.dimensions = [...change.value];
    } else if (change.kind === 'add-step') {
      if (funnel.steps.length >= 10) throw Error('퍼널 단계는 최대 10개까지 등록할 수 있어요.');
      funnel.steps.push(emptyStep());
    } else {
      if (!Number.isInteger(change.step) || !funnel.steps[change.step]) throw Error('편집할 단계를 확인해 주세요.');
      if (change.kind === 'remove-step') {
        if (funnel.steps.length <= 2) throw Error('퍼널에는 최소 2개 단계가 필요해요.');
        funnel.steps.splice(change.step, 1);
      } else if (change.kind === 'move-step') {
        const target = change.step + change.direction;
        if ((change.direction !== -1 && change.direction !== 1) || target < 0 || target >= funnel.steps.length)
          throw Error('단계를 이동할 위치를 확인해 주세요.');
        [funnel.steps[change.step], funnel.steps[target]] = [funnel.steps[target]!, funnel.steps[change.step]!];
      } else {
        if (!draft.events.some(e => e.name === change.eventName && e.source === change.source && NAME.test(e.name)))
          throw Error('등록된 이벤트와 발행 출처를 선택하세요.');
        funnel.steps[change.step] = { ...funnel.steps[change.step]!, eventName: change.eventName, source: change.source };
      }
    }
  }
  const next = JSON.stringify(draft, null, 2); readDraft(next); return next;
}
function signature(value: unknown): string | null {
  if (!record(value) || value.required !== true) return null;
  if (value.type === 'boolean') return JSON.stringify(['boolean']);
  if (value.type === 'enum' && Array.isArray(value.values) && value.values.every(v => typeof v === 'string'))
    return JSON.stringify(['enum', [...value.values].sort()]);
  if (value.type === 'integer' && Number.isSafeInteger(value.minimum) && Number.isSafeInteger(value.maximum))
    return JSON.stringify(['integer', value.minimum, value.maximum]);
  return null;
}
export function funnelDimensionChoices(draft: FunnelFormDraft, index: number): string[] {
  const funnel = draft.funnels?.[index]; if (!funnel) return [];
  const choices = new Set(funnel.dimensions);
  for (const step of funnel.steps) {
    const event = draft.events.find(e => e.name === step.eventName && e.source === step.source);
    if (event) for (const [name, value] of Object.entries(event.properties))
      if (NAME.test(name) && record(value) && value.required === true) choices.add(name);
  }
  return [...choices];
}
export function funnelEventChoices(draft: FunnelFormDraft): FormEvent[] {
  return draft.events.filter(e => NAME.test(e.name)).filter((e, i, list) =>
    list.findIndex(other => other.name === e.name && other.source === e.source) === i);
}
export type FunnelWarning = { field: 'steps' | 'dimensions'; step?: number; message: string };
export function funnelWarnings(draft: FunnelFormDraft, index: number): FunnelWarning[] {
  const funnel = draft.funnels?.[index]; if (!funnel) return [];
  const warnings: FunnelWarning[] = [];
  if (funnel.steps.length < 2) warnings.push({ field: 'steps', message: '최소 2개 단계를 추가하세요.' });
  const events = funnel.steps.map((s, step) => {
    const event = draft.events.find(e => e.name === s.eventName && e.source === s.source);
    if (!event || !NAME.test(s.eventName)) warnings.push({ field: 'steps', step, message: '등록된 이벤트와 발행 출처를 선택하세요.' });
    if (s.eventName && funnel.steps.filter(other => other.eventName === s.eventName).length > 1)
      warnings.push({ field: 'steps', step, message: '같은 퍼널에서는 이벤트를 한 단계에만 연결하세요.' });
    return event;
  });
  if (funnel.dimensions.length > 4 || new Set(funnel.dimensions).size !== funnel.dimensions.length || !funnel.dimensions.every(d => NAME.test(d)))
    warnings.push({ field: 'dimensions', message: '비교 기준은 올바른 속성 이름으로 최대 4개까지 중복 없이 선택하세요.' });
  for (const key of funnel.dimensions) {
    const signatures = events.map(e => signature(e?.properties[key]));
    if (events.length < 2 || signatures.some(s => s === null) || new Set(signatures).size !== 1)
      warnings.push({ field: 'dimensions', message: `${key}: 모든 단계에 같은 자료형과 허용 값을 가진 필수 속성이 필요해요.` });
  }
  return warnings;
}
export function funnelFocusAfterChange(change: FunnelChange, count: number, stepCount = 0): string | null {
  if (change.kind === 'add') return `schema-funnel-${count}-id`;
  if (change.kind === 'remove') return count <= 1 ? 'schema-funnel-add' : `schema-funnel-${Math.min(change.index, count - 2)}-id`;
  if (change.kind === 'add-step') return `schema-funnel-${change.index}-step-${stepCount}-event`;
  if (change.kind === 'remove-step') return `schema-funnel-${change.index}-step-${Math.min(change.step, stepCount - 2)}-event`;
  if (change.kind === 'move-step') return `schema-funnel-${change.index}-step-${change.step + change.direction}-event`;
  return null;
}
export function funnelIssueTarget(text: string, issue: SchemaValidation['issues'][number]): string | null {
  let draft: FunnelFormDraft; try { draft = readFunnelForm(text); } catch { return null; }
  if (issue.path === '/funnels') return 'schema-funnel-heading';
  const match = /^\/funnels\/(\d+)(?:\/(id|dimensions)(?:\/\d+)?|\/steps\/(\d+)(?:\/(eventName|source))?)?$/.exec(issue.path);
  if (!match) return null;
  const index = Number(match[1]), funnel = draft.funnels?.[index]; if (!funnel) return null;
  const base = `schema-funnel-${index}`;
  if (match[2]) return `${base}-${match[2]}`;
  if (match[3] !== undefined) return funnel.steps[Number(match[3])] ? `${base}-step-${match[3]}-event` : null;
  if (!NAME.test(funnel.id)) return `${base}-id`;
  if (!funnel.label.trim() || funnel.label.length > 80 || /[\x00-\x1f\x7f]/.test(funnel.label)) return `${base}-label`;
  if (funnel.steps.length < 2) return `${base}-add-step`;
  if (funnelWarnings(draft, index).some(w => w.field === 'dimensions')) return `${base}-dimensions`;
  return null;
}
