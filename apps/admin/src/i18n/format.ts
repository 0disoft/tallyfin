import { useMemo } from 'react';
import { useI18n } from './index';

/** Display locale never changes the project's aggregation timezone or dates. */
export function useLocaleFormat() {
  const { locale } = useI18n();
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale);
    const percent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return {
      count: (value: number) => number.format(value),
      rate: (value: number | null) => value === null ? '—' : percent.format(value / 100),
      dateTime: (value: string, timeZone: string) => new Intl.DateTimeFormat(locale, {
        timeZone, calendar: 'gregory', dateStyle: 'short', timeStyle: 'medium',
      }).format(new Date(value)),
    };
  }, [locale]);
}
