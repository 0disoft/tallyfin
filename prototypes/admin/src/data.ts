export type ProjectId = 'modufile' | 'sembom' | 'orchid';
export type View = 'overview' | 'events' | 'goals' | 'settings';
export type Period = 7 | 14 | 30;
export type DisplayState = 'normal' | 'loading' | 'empty' | 'error' | 'stale' | 'unauthorized';
export type EventDefinition = { name: string; label: string; source: 'browser' | 'server'; properties: string[] };
export type ProjectDefinition = {
  id: ProjectId; name: string; startLabel: string; successLabel: string; goal: string;
  events: EventDefinition[]; version: number;
};
export type DailyRecord = { date: string; events: Record<string, number> };
export type Summary = { total: number; started: number; succeeded: number; failed: number; rate: number | null; events: { definition: EventDefinition; count: number }[] };
export const TODAY = '2026-10-08';
export const projects: ProjectDefinition[] = [
  { id: 'modufile', name: 'ModuFile', startLabel: '변환 시작', successLabel: '변환 완료', goal: '파일 변환 완료', version: 1,
    events: [
      { name: 'conversion_started', label: '변환 시작', source: 'browser', properties: ['format: pdf | png | jpg'] },
      { name: 'conversion_completed', label: '변환 완료', source: 'browser', properties: ['format: pdf | png | jpg'] },
      { name: 'validation_failed', label: '입력 검증 오류', source: 'browser', properties: ['code: format | size'] },
      { name: 'download_completed', label: '다운로드 완료', source: 'browser', properties: ['format: pdf | png | jpg'] },
      { name: 'page_view', label: '화면 조회', source: 'browser', properties: ['screen: convert | result'] },
    ] },
  { id: 'sembom', name: 'Sembom', startLabel: '입력 시작', successLabel: '계산 완료', goal: '계산 완료', version: 1,
    events: [
      { name: 'input_start', label: '입력 시작', source: 'browser', properties: ['tool: grade | loan | timer'] },
      { name: 'calculation_success', label: '계산 완료', source: 'browser', properties: ['tool: grade | loan | timer'] },
      { name: 'validation_error', label: '입력 검증 오류', source: 'browser', properties: ['code: required | range'] },
      { name: 'result_copy', label: '결과 복사', source: 'browser', properties: ['tool: grade | loan | timer'] },
      { name: 'tool_view', label: '도구 조회', source: 'browser', properties: ['tool: grade | loan | timer'] },
    ] },
  { id: 'orchid', name: 'Orchid Pass', startLabel: '확인 시작', successLabel: '확인 완료', goal: '확인 완료', version: 1,
    events: [
      { name: 'verification_started', label: '확인 시작', source: 'browser', properties: ['method: browser | challenge'] },
      { name: 'verification_completed', label: '확인 완료', source: 'browser', properties: ['method: browser | challenge'] },
      { name: 'verification_failed', label: '확인 실패', source: 'browser', properties: ['code: expired | rejected'] },
      { name: 'continue_clicked', label: '계속하기 선택', source: 'browser', properties: ['screen: result'] },
      { name: 'screen_view', label: '화면 조회', source: 'browser', properties: ['screen: start | result'] },
    ] },
];
const totals = [2500, 3300, 3600, 3000, 3500, 4100, 4680];
const starts = [550, 650, 700, 600, 650, 750, 900];
const successes = [470, 560, 600, 520, 560, 640, 778];
const failures = [8, 12, 15, 11, 14, 16, 20];
const downloads = [420, 480, 520, 450, 510, 570, 610];
export function dateAt(offset: number) {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function getRecords(project: ProjectDefinition, period: Period): DailyRecord[] {
  return Array.from({ length: period }, (_, index) => {
    const offset = index - period + 1;
    const lastWeek = offset >= -6;
    const day = offset + 6;
    const calendarIndex = offset + 29;
    const base = lastWeek ? [totals[day], starts[day], successes[day], failures[day], downloads[day]] :
      [2200 + (calendarIndex % 7) * 160, 440 + (calendarIndex % 7) * 45, 370 + (calendarIndex % 7) * 39, 8 + calendarIndex % 8, 280 + (calendarIndex % 7) * 34];
    const factor = project.id === 'modufile' ? 1 : project.id === 'sembom' ? 1.37 : 0.43;
    const counts = base.map(value => Math.round(value * factor));
    counts.push(counts[0] - counts.slice(1).reduce((a, b) => a + b, 0));
    return { date: dateAt(offset), events: Object.fromEntries(project.events.map((event, i) => [event.name, counts[i + 1]])) };
  });
}
export function summarize(project: ProjectDefinition, records: DailyRecord[]): Summary {
  const events = project.events.map(definition => ({ definition, count: records.reduce((sum, day) => sum + (day.events[definition.name] ?? 0), 0) }));
  const [started, succeeded, failed] = events.map(event => event.count);
  return { events, total: events.reduce((sum, event) => sum + event.count, 0), started, succeeded, failed, rate: started === 0 ? null : succeeded / started * 100 };
}
export function getSeries(records: DailyRecord[], event?: string) {
  return records.map(day => ({ date: day.date, label: day.date.slice(5).replace('-', '.'), count: event ? day.events[event] ?? 0 : Object.values(day.events).reduce((a, b) => a + b, 0) }));
}
export const formatCount = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
export const formatRate = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
export function periodLabel(period: Period) { return `${dateAt(1 - period).replaceAll('-', '.')} – ${TODAY.slice(5).replace('-', '.')}`; }
