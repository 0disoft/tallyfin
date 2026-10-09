import { readDraft } from './schema-contract.ts';
import type { SchemaValidation } from './schema-contract.ts';
import { readEventForm } from './schema-event-form.ts';
import type { EventFormDraft } from './schema-event-form.ts';

export type WorkflowPhase = 'startEvent' | 'successEvent' | 'failureEvent';
export type FormWorkflow = Record<string, unknown> & { id: string; label: string; source: 'browser';
  startEvent: string; successEvent: string; failureEvent: string | null; dimensions: string[] };
export type WorkflowFormDraft = Omit<EventFormDraft, 'workflows'> & { workflows: FormWorkflow[] };
export type WorkflowChange = { kind: 'add' } | { kind: 'remove'; index: number } |
  { kind: 'edit'; index: number; field: 'id' | 'label' | WorkflowPhase; value: string | null } |
  { kind: 'dimensions'; index: number; value: string[] };
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const phases: WorkflowPhase[] = ['startEvent', 'successEvent', 'failureEvent'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Preserve incomplete references and extra keys; unsupported structures stay in JSON. */
export function readWorkflowForm(text: string): WorkflowFormDraft {
  const draft = readEventForm(text);
  if (draft.workflows.length > 10 || draft.workflows.some(workflow => !record(workflow) || typeof workflow.id !== 'string' ||
    typeof workflow.label !== 'string' || workflow.source !== 'browser' || typeof workflow.startEvent !== 'string' ||
    typeof workflow.successEvent !== 'string' || (workflow.failureEvent !== null && typeof workflow.failureEvent !== 'string') ||
    !Array.isArray(workflow.dimensions) || !workflow.dimensions.every(key => typeof key === 'string')))
    throw Error('폼으로 편집할 수 없는 작업 흐름이에요. JSON에서 정의를 확인해 주세요.');
  return draft as WorkflowFormDraft;
}
export function changeWorkflowForm(text: string, change: WorkflowChange): string {
  const draft = readWorkflowForm(text);
  if (change.kind === 'add') {
    if (draft.workflows.length >= 10) throw Error('작업 흐름은 최대 10개까지 등록할 수 있어요.');
    let suffix = 1; while (draft.workflows.some(workflow => workflow.id === `workflow_${suffix}`)) suffix++;
    draft.workflows.push({ id: `workflow_${suffix}`, label: '', source: 'browser', startEvent: '', successEvent: '', failureEvent: null, dimensions: [] });
  } else {
    if (!Number.isInteger(change.index) || !draft.workflows[change.index]) throw Error('편집할 작업 흐름을 확인해 주세요.');
    const workflow = draft.workflows[change.index]!;
    if (change.kind === 'remove') draft.workflows.splice(change.index, 1);
    else if (change.kind === 'dimensions') {
      if (change.value.length > 4 || new Set(change.value).size !== change.value.length || !change.value.every(key => NAME.test(key)))
        throw Error('비교 기준은 올바른 속성 이름으로 최대 4개까지 중복 없이 선택하세요.');
      draft.workflows[change.index] = { ...workflow, dimensions: [...change.value] };
    } else {
      if (change.value === null && change.field !== 'failureEvent') throw Error('실패 이벤트만 없음으로 설정할 수 있어요.');
      if (change.field === 'id' && draft.workflows.some((row, index) => index !== change.index && row.id === change.value))
        throw Error('이미 사용 중인 작업 흐름 ID예요. 다른 흐름을 덮어쓰지 않았어요.');
      draft.workflows[change.index] = { ...workflow, [change.field]: change.value } as FormWorkflow;
    }
  }
  const next = JSON.stringify(draft, null, 2); readDraft(next); return next;
}
export function workflowFocusAfterChange(change: WorkflowChange, count: number): string | null {
  if (change.kind === 'add') return `schema-workflow-${count}-id`;
  if (change.kind !== 'remove') return null;
  return count <= 1 ? 'schema-workflow-add' : `schema-workflow-${Math.min(change.index, count - 2)}-id`;
}
export function workflowDimensionChoices(draft: WorkflowFormDraft, index: number): string[] {
  const workflow = draft.workflows[index];
  if (!workflow) return [];
  const choices = new Set(workflow.dimensions);
  for (const phase of phases) {
    const event = draft.events.find(event => event.source === 'browser' && event.name === workflow[phase]);
    if (event) for (const [name, property] of Object.entries(event.properties)) {
      if (record(property) && property.required === true && NAME.test(name)) choices.add(name);
    }
  }
  return [...choices];
}
function signature(property: unknown): string | null {
  if (!record(property) || property.required !== true) return null;
  if (property.type === 'boolean') return JSON.stringify(['boolean']);
  if (property.type === 'enum' && Array.isArray(property.values) && property.values.every(value => typeof value === 'string'))
    return JSON.stringify(['enum', [...property.values].sort()]);
  if (property.type === 'integer' && Number.isSafeInteger(property.minimum) && Number.isSafeInteger(property.maximum))
    return JSON.stringify(['integer', property.minimum, property.maximum]);
  return null;
}
export type WorkflowWarning = { field: WorkflowPhase | 'dimensions'; message: string };
export function workflowWarnings(draft: WorkflowFormDraft, index: number): WorkflowWarning[] {
  const workflow = draft.workflows[index]; if (!workflow) return [];
  const warnings: WorkflowWarning[] = [], events = [];
  for (const phase of phases) {
    const name = workflow[phase]; if (phase === 'failureEvent' && name === null) continue;
    const event = draft.events.find(event => event.source === 'browser' && event.name === name);
    if (!name || !NAME.test(name) || !event) warnings.push({ field: phase, message: '등록된 브라우저 이벤트를 선택하세요.' });
    else events.push(event);
    if (name && draft.workflows.reduce((count, row) => count + phases.filter(key => row[key] === name).length, 0) > 1)
      warnings.push({ field: phase, message: '이 이벤트가 다른 단계나 작업 흐름에도 연결되어 있어요. 한 단계에만 연결하세요.' });
  }
  if (workflow.dimensions.length > 4 || new Set(workflow.dimensions).size !== workflow.dimensions.length || !workflow.dimensions.every(key => NAME.test(key)))
    warnings.push({ field: 'dimensions', message: '비교 기준은 올바른 속성 이름으로 최대 4개까지 중복 없이 선택하세요.' });
  for (const key of workflow.dimensions) {
    const signatures = events.map(event => signature(event.properties[key]));
    if (events.length !== (workflow.failureEvent === null ? 2 : 3) || signatures.some(value => value === null) || new Set(signatures).size !== 1)
      warnings.push({ field: 'dimensions', message: `${key}: 모든 단계에 같은 자료형과 허용 값을 가진 필수 속성이 필요해요.` });
  }
  return warnings;
}
export function workflowIssueTarget(text: string, issue: SchemaValidation['issues'][number]): string | null {
  if (issue.path === '/workflows') return 'schema-workflow-heading';
  const match = /^\/workflows\/(\d+)(?:\/(id|startEvent|successEvent|failureEvent|dimensions)(?:\/\d+)?)?$/.exec(issue.path);
  if (!match) return null;
  let draft: WorkflowFormDraft; try { draft = readWorkflowForm(text); } catch { return null; }
  const index = Number(match[1]), workflow = draft.workflows[index]; if (!workflow) return null;
  const base = `schema-workflow-${index}`;
  if (match[2]) return `${base}-${match[2]}`;
  if (!NAME.test(workflow.id)) return `${base}-id`;
  if (!workflow.label.trim() || workflow.label.length > 80 || /[\x00-\x1f\x7f]/.test(workflow.label)) return `${base}-label`;
  if (workflow.dimensions.length > 4 || new Set(workflow.dimensions).size !== workflow.dimensions.length || !workflow.dimensions.every(key => NAME.test(key)))
    return `${base}-dimensions`;
  return null;
}
