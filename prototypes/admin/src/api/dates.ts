// Project-local calendar helpers. Dates are derived from the project time zone
// and the browser clock; no built-in fixture date is used in API mode.

export const PERIODS: number[] = [7, 14, 30];
export const MAX_QUERY_DAYS = 31;
export const RETENTION_DAYS = 90;
export type DateRange = { from: string; to: string };

function dateMillis(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === value ? result : null;
}

/** Calendar dates, not elapsed hours: DST must not change the inclusive day count. */
export function rangeError(range: DateRange, today: string): string | null {
  const from = dateMillis(range.from), to = dateMillis(range.to), end = dateMillis(today);
  if (from === null || to === null || end === null) return '시작일과 종료일에 올바른 날짜를 입력해 주세요.';
  if (from > to) return '종료일은 시작일과 같거나 이후여야 해요.';
  if (to > end) return '프로젝트 시간대의 오늘 이후는 조회할 수 없어요.';
  if (from < end - (RETENTION_DAYS - 1) * 86400000) return '데이터는 오늘을 포함한 최근 90일 안에서 조회할 수 있어요.';
  if ((to - from) / 86400000 + 1 > MAX_QUERY_DAYS) return '한 번에 최대 31일을 조회할 수 있어요. 시작일과 종료일도 포함해요.';
  return null;
}

export function comparisonRangeError(range: DateRange, today: string): string | null {
  if (rangeError(range, today)) return '현재 조회 기간을 먼저 확인해 주세요.';
  const length = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000 + 1;
  return rangeError({ from: shiftDate(range.from, -length), to: shiftDate(range.from, -1) }, today)
    ? '직전 비교 기간이 최근 90일 보존 범위를 벗어나요. 현재 기간은 계속 볼 수 있어요.' : null;
}

export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function periodRange(today: string, period: number): { from: string; to: string } {
  return { from: shiftDate(today, 1 - period), to: today };
}

export function rangeLabel(from: string, to: string): string {
  return `${from.replaceAll('-', '.')} – ${to.slice(5).replace('-', '.')}`;
}
