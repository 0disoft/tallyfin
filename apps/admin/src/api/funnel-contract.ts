import type { FunnelDefinition, QueryMeta, Registry } from './types.ts';
import { ContractError } from './validate.ts';
import { rangeError, shiftDate, todayInZone, type DateRange } from './dates.ts';

export type FunnelCounts = { startedRuns: number; completedRuns: number; completionRate: number | null;
  steps: { stepIndex: number; reachedRuns: number; reachRate: number | null; conversionRate: number | null; notReachedNext: number | null }[] };
export type FunnelResponse = { meta: Omit<QueryMeta, 'source'>; funnelId: string; definition: FunnelDefinition;
  cohortBasis: 'startedAt'; summary: FunnelCounts; days: (FunnelCounts & { date: string; provisional: boolean })[] };
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const countKeys = ['startedRuns', 'completedRuns', 'completionRate', 'steps'];
function invalid(): never { throw new ContractError('퍼널 응답의 정의·기간·단계 건수·비율이 계약과 맞지 않아요.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum) invalid(); return value;
}
function name(value: unknown): string { const result = text(value, 48); if (!NAME.test(result)) invalid(); return result; }
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 30), time = Date.parse(result);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(result) || !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 19) !== result.slice(0, 19)) invalid();
  return result;
}
function rate(value: unknown, numerator: number, denominator: number): number | null {
  if (!denominator) { if (value !== null) invalid(); return null; }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 ||
    Math.abs(value - numerator / denominator * 100) > 1e-8) invalid(); return value;
}
function definition(value: unknown): FunnelDefinition {
  const row = object(value, ['id', 'label', 'steps', 'dimensions']);
  if (!Array.isArray(row.steps) || row.steps.length < 2 || row.steps.length > 10 ||
    !Array.isArray(row.dimensions) || row.dimensions.length > 4) invalid();
  const steps = row.steps.map(value => {
    const step = object(value, ['eventName', 'source']);
    if (step.source !== 'browser' && step.source !== 'server') invalid();
    return { eventName: name(step.eventName), source: step.source as 'browser' | 'server' };
  });
  const dimensions = row.dimensions.map(name);
  if (new Set(steps.map(step => step.eventName)).size !== steps.length || new Set(dimensions).size !== dimensions.length) invalid();
  return { id: name(row.id), label: text(row.label, 80), steps, dimensions };
}
export function parseFunnelCounts(value: unknown, length: number, extra: string[] = []): FunnelCounts {
  const row = object(value, [...countKeys, ...extra]), startedRuns = count(row.startedRuns), completedRuns = count(row.completedRuns);
  if (!Array.isArray(row.steps) || row.steps.length !== length) invalid();
  const steps = row.steps.map(value => object(value, ['stepIndex', 'reachedRuns', 'reachRate', 'conversionRate', 'notReachedNext']));
  const reached = steps.map(step => count(step.reachedRuns));
  if (startedRuns !== reached[0] || completedRuns !== reached.at(-1) || reached.some((n, i) => i > 0 && n > reached[i - 1]!)) invalid();
  return { startedRuns, completedRuns, completionRate: rate(row.completionRate, completedRuns, startedRuns),
    steps: steps.map((step, index) => {
      if (step.stepIndex !== index || step.notReachedNext !== (index + 1 < length ? reached[index]! - reached[index + 1]! : null) ||
        index === 0 && step.conversionRate !== null) invalid();
      return { stepIndex: index, reachedRuns: reached[index]!, reachRate: rate(step.reachRate, reached[index]!, startedRuns),
        conversionRate: index === 0 ? null : rate(step.conversionRate, reached[index]!, reached[index - 1]!),
        notReachedNext: step.notReachedNext as number | null };
    }) };
}
/** Validate closed wire shape and all aggregate invariants before rendering or exporting. */
export function parseFunnelHeader(row: Record<string, unknown>) {
  const rawMeta = object(row.meta, ['projectId', 'schemaVersion', 'from', 'to', 'timeZone', 'generatedAt', 'latestReceivedAt', 'coverage']);
  const projectId = text(rawMeta.projectId, 48), version = count(rawMeta.schemaVersion), zone = text(rawMeta.timeZone, 64);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(projectId) || !version || version > 2147483647 || rawMeta.coverage !== 'observed-only') invalid();
  const generatedAt = timestamp(rawMeta.generatedAt), generated = Date.parse(generatedAt);
  const from = text(rawMeta.from, 10), to = text(rawMeta.to, 10);
  try { if (rangeError({ from, to }, todayInZone(zone, new Date(generated)))) invalid(); } catch { invalid(); }
  const meta: FunnelResponse['meta'] = { projectId, schemaVersion: version, from, to, timeZone: zone, generatedAt,
    latestReceivedAt: rawMeta.latestReceivedAt === null ? null : timestamp(rawMeta.latestReceivedAt), coverage: 'observed-only' };
  const def = definition(row.definition), funnelId = name(row.funnelId);
  if (funnelId !== def.id || row.cohortBasis !== 'startedAt') invalid();
  return { meta, funnelId, definition: def, cohortBasis: 'startedAt' as const };
}
export function parseFunnelResponse(value: unknown): FunnelResponse {
  const row = object(value, ['meta', 'funnelId', 'definition', 'cohortBasis', 'summary', 'days']);
  const { meta, funnelId, definition: def } = parseFunnelHeader(row);
  const { from, to, timeZone: zone } = meta, generated = Date.parse(meta.generatedAt);
  if (!Array.isArray(row.days)) invalid();
  const length = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (row.days.length !== length) invalid();
  const summary = parseFunnelCounts(row.summary, def.steps.length), totals = Array<number>(def.steps.length).fill(0);
  const provisionalFrom = todayInZone(zone, new Date(generated - 2 * 86400000));
  const days = row.days.map((value, index) => {
    const day = object(value, [...countKeys, 'date', 'provisional']), date = shiftDate(from, index);
    if (day.date !== date || day.provisional !== (date >= provisionalFrom)) invalid();
    const parsed = parseFunnelCounts(day, def.steps.length, ['date', 'provisional']);
    parsed.steps.forEach((step, i) => { totals[i] = count(totals[i]! + step.reachedRuns); });
    return { date, ...parsed, provisional: day.provisional as boolean };
  });
  if (totals.some((n, index) => n !== summary.steps[index]!.reachedRuns)) invalid();
  return { meta, funnelId, definition: def, cohortBasis: 'startedAt', summary, days };
}
export function validateFunnelResponse(response: Pick<FunnelResponse, 'meta' | 'funnelId' | 'definition'>, registry: Registry, range: DateRange, funnelId: string): void {
  const def = registry.funnels?.find(funnel => funnel.id === funnelId), meta = response.meta, actual = response.definition;
  if (!def || response.funnelId !== funnelId || meta.projectId !== registry.project.id || meta.schemaVersion !== registry.schemaVersion ||
    meta.timeZone !== registry.project.timeZone || meta.from !== range.from || meta.to !== range.to || def.label !== actual.label ||
    def.steps.length !== actual.steps.length || def.steps.some((step, i) => step.eventName !== actual.steps[i]!.eventName || step.source !== actual.steps[i]!.source) ||
    JSON.stringify(def.dimensions) !== JSON.stringify(actual.dimensions)) invalid();
}
