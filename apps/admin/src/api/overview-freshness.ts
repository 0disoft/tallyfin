import { shiftDate, todayInZone } from './dates.ts';
import { ContractError } from './validate.ts';

export type OverviewPeriod = { timeZone: string; from: string; to: string; previousFrom: string; previousTo: string };
export function parseOverviewPeriod(value: unknown, generatedAt: string): OverviewPeriod {
  const fail = (): never => { throw new ContractError('Service overview period is inconsistent.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>, keys = ['timeZone', 'from', 'to', 'previousFrom', 'previousTo'];
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k) || typeof row[k] !== 'string') ||
    (row.timeZone as string).length > 64 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(row.timeZone as string)) return fail();
  let today: string;
  try { today = todayInZone(row.timeZone as string, new Date(generatedAt)); } catch { return fail(); }
  if (row.to !== today || row.from !== shiftDate(today, -6) || row.previousFrom !== shiftDate(today, -13) || row.previousTo !== shiftDate(today, -7)) return fail();
  return { timeZone: row.timeZone, from: row.from, to: row.to, previousFrom: row.previousFrom, previousTo: row.previousTo } as OverviewPeriod;
}
/** The device clock only controls the notice, never the server's query windows. */
export function overviewDateChanged(rows: readonly { period?: OverviewPeriod | null; generatedAt?: string }[], now: Date): boolean {
  return rows.some(row => row.generatedAt && now.toISOString().slice(0, 10) !== row.generatedAt.slice(0, 10) ||
    row.period && todayInZone(row.period.timeZone, now) !== row.period.to);
}
export type OverviewClockPorts = { visibility: EventTarget & { visibilityState: string }; focus: EventTarget;
  clock: () => Date; everyMinute: (callback: () => void) => () => void };
/** Only local clock checks; no HTTP polling. Suspend the timer while hidden and dispose all listeners. */
export function watchOverviewClock(onTick: (now: Date) => void, ports: OverviewClockPorts = {
  visibility: document, focus: window, clock: () => new Date(),
  everyMinute: callback => { const timer = setInterval(callback, 60_000); return () => clearInterval(timer); },
}): () => void {
  let stopTimer: (() => void) | undefined;
  const tick = () => onTick(ports.clock());
  const resume = () => {
    stopTimer?.(); stopTimer = undefined; tick();
    if (ports.visibility.visibilityState !== 'hidden') stopTimer = ports.everyMinute(tick);
  };
  ports.visibility.addEventListener('visibilitychange', resume); ports.focus.addEventListener('focus', tick);
  resume();
  return () => { stopTimer?.(); ports.visibility.removeEventListener('visibilitychange', resume); ports.focus.removeEventListener('focus', tick); };
}
