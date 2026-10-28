import { useMemo } from 'react';
import { useI18n } from './index';
import { createMessageText, type MessageText, type MessageTextTranslator } from './message-text';

export type { MessageText, MessageTextKey, MessageTextSchema, MessageTextTranslator } from './message-text';

/** Retranslates stored helper text from the current Saylo snapshot on every render. */
export function useMessageText(): MessageText {
  const { t, locale } = useI18n();
  return useMemo(() => createMessageText(t as unknown as MessageTextTranslator, locale), [t, locale]);
}
