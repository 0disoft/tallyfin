import { ApiClient, ApiError } from './client.ts';
import { parseFunnelCounts, parseFunnelHeader, parseFunnelResponse, validateFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import type { Registry } from './types.ts';
import { ContractError } from './validate.ts';
import type { DateRange } from './dates.ts';

export type FunnelBucketValue = string | number | boolean;
export type FunnelBreakdown = Omit<FunnelResponse, 'days'> & { groupBy: string;
  buckets: { value: FunnelBucketValue; summary: FunnelResponse['summary']; days: FunnelResponse['days'] }[] };
function invalid(): never { throw new ContractError('퍼널 분류의 정의·자료형·단계·날짜·합계가 맞지 않아요.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
function bucketValue(value: unknown): FunnelBucketValue {
  if (typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value) && value >= -1000000 && value <= 1000000 ||
    typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) return value as FunnelBucketValue;
  return invalid();
}
export function parseFunnelBreakdown(value: unknown): FunnelBreakdown {
  const row = object(value, ['meta', 'funnelId', 'definition', 'cohortBasis', 'groupBy', 'summary', 'buckets']);
  const header = parseFunnelHeader(row);
  if (typeof row.groupBy !== 'string' || !header.definition.dimensions.includes(row.groupBy) || !Array.isArray(row.buckets) || row.buckets.length > 32) invalid();
  const totals = Array<number>(header.definition.steps.length).fill(0), seen = new Set<string>();
  const buckets = row.buckets.map(value => {
    const bucket = object(value, ['value', 'summary', 'days']), typed = bucketValue(bucket.value), key = JSON.stringify([typeof typed, typed]);
    if (seen.has(key)) invalid(); seen.add(key);
    const data = parseFunnelResponse({ ...header, summary: bucket.summary, days: bucket.days });
    data.summary.steps.forEach((step, index) => {
      const sum = totals[index]! + step.reachedRuns;
      if (!Number.isSafeInteger(sum)) invalid(); totals[index] = sum;
    });
    return { value: typed, summary: data.summary, days: data.days };
  });
  const summary = parseFunnelCounts(row.summary, header.definition.steps.length);
  if (summary.steps.some((step, index) => step.reachedRuns !== totals[index])) invalid();
  return { ...header, groupBy: row.groupBy, summary, buckets };
}
export function validateFunnelBreakdown(data: FunnelBreakdown, registry: Registry, range: DateRange, funnelId: string, groupBy: string) {
  validateFunnelResponse(data, registry, range, funnelId);
  if (data.groupBy !== groupBy || !data.definition.dimensions.includes(groupBy)) invalid();
  const first = data.definition.steps[0]!, rule = registry.events.find(event => event.name === first.eventName && event.source === first.source)?.properties[groupBy];
  if (!rule?.required) invalid();
  for (const { value } of data.buckets) {
    if (rule.type === 'boolean' ? typeof value !== 'boolean' : rule.type === 'enum' ? typeof value !== 'string' || !rule.values.includes(value)
      : typeof value !== 'number' || value < rule.minimum || value > rule.maximum) invalid();
  }
}
export type FunnelBreakdownState = { phase: 'idle' | 'loading' | 'ready' | 'error'; context: string; groupBy: string;
  data?: FunnelBreakdown; error?: ApiError };
export class FunnelBreakdownReport {
  #generation = 0; #controller?: AbortController; #disposed = false;
  readonly client: ApiClient; readonly onChange: (state: FunnelBreakdownState) => void;
  constructor(client: ApiClient, onChange: (state: FunnelBreakdownState) => void) { this.client = client; this.onChange = onChange; }
  async load(registry: Registry, range: DateRange, funnelId: string, groupBy: string, context: string) {
    if (this.#disposed) return;
    this.cancel(); const controller = new AbortController(), generation = this.#generation;
    this.#controller = controller; this.onChange({ phase: 'loading', context, groupBy });
    try {
      if (!registry.funnels?.find(funnel => funnel.id === funnelId)?.dimensions.includes(groupBy)) invalid();
      const data = await this.client.getFunnelBreakdown(registry.project.id, funnelId, { schemaVersion: registry.schemaVersion, ...range, groupBy, signal: controller.signal });
      if (controller.signal.aborted || this.#disposed || generation !== this.#generation) return;
      validateFunnelBreakdown(data, registry, range, funnelId, groupBy);
      this.onChange({ phase: 'ready', context, groupBy, data });
    } catch (error) {
      if (controller.signal.aborted || this.#disposed || generation !== this.#generation) return;
      this.onChange({ phase: 'error', context, groupBy, error: error instanceof ApiError ? error : new ApiError('contract', '퍼널 분류 응답을 확인할 수 없어요.') });
    }
  }
  cancel() { ++this.#generation; this.#controller?.abort(); this.#controller = undefined; }
  dispose() { this.#disposed = true; this.cancel(); }
}
