type DateReader = (milliseconds: number) => string;
const MAX_CACHED_TIME_ZONES = 32;
const readers = new Map<string, DateReader>();

/** Cache only fixed-locale formatters, never timestamps, dates or project data. */
export function calendarDateReader(timeZone: string): DateReader {
  let reader = readers.get(timeZone);
  if (!reader) {
    const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    reader = milliseconds => {
      const parts = formatter.formatToParts(milliseconds);
      const part = (type: string) => parts.find(p => p.type === type)!.value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    };
  }
  // Refresh LRU order only after construction succeeds; invalid zones cannot evict entries.
  readers.delete(timeZone); readers.set(timeZone, reader);
  if (readers.size > MAX_CACHED_TIME_ZONES) readers.delete(readers.keys().next().value!);
  return reader;
}
