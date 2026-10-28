import { useEffect, useRef, useState } from 'react';
import type { SchemaEditor } from './api/schema-editor.ts';
import { parseSchemaDraftFile, SCHEMA_DRAFT_FILE_LIMIT } from './api/schema-draft-file.ts';
import { readSchemaDraftFile } from './api/read-schema-draft-file.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

type Status = { error: boolean; key?: 'downloadRequested' | 'downloadFailed' | 'tooLarge' | 'replaceCancelled' | 'importChanged' | 'readCancelled' | 'readInterrupted' | 'readFailed'; message?: string };

export default function SchemaDraftFiles({ editor, editable, projectId }: { editor: SchemaEditor; editable: boolean; projectId: string }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [status, setStatus] = useState<Status | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const pendingRead = useRef<AbortController | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setStatus(null); setReading(null);
    return () => { pendingRead.current?.abort('scope_changed'); pendingRead.current = null; };
  }, [editor, editable, projectId]);
  useEffect(() => { if (status?.error) statusRef.current?.focus(); }, [status]);
  function download() {
    let url: string | undefined, link: HTMLAnchorElement | undefined;
    try {
      const file = editor.exportDraft(); if (!file) return;
      url = URL.createObjectURL(new Blob([file.text], { type: 'application/json;charset=utf-8' }));
      link = document.createElement('a'); link.href = url; link.download = file.filename;
      document.body.append(link); link.click();
      setStatus({ error: false, key: 'downloadRequested' });
    } catch (error) {
      setStatus(error instanceof Error ? { error: true, message: error.message } : { error: true, key: 'downloadFailed' });
    } finally {
      link?.remove();
      if (url) { const release = url; setTimeout(() => URL.revokeObjectURL(release), 1000); }
    }
  }
  async function read(file: File) {
    const canImport = () => editor.state.phase === 'ready' && !editor.state.more && editor.canEdit;
    if (!editable || !canImport()) return;
    pendingRead.current?.abort('replaced'); pendingRead.current = null; setStatus(null); setReading(null);
    if (file.size > SCHEMA_DRAFT_FILE_LIMIT) {
      setStatus({ error: true, key: 'tooLarge' }); return;
    }
    const controller = new AbortController(); pendingRead.current = controller; setReading(file.name);
    // Observe the editor synchronously, even if React batches a busy -> ready transition.
    const unsubscribe = editor.subscribe(() => { if (!canImport()) controller.abort('editor_changed'); });
    try {
      const text = await readSchemaDraftFile(file, { signal: controller.signal });
      if (pendingRead.current !== controller || controller.signal.aborted) return;
      parseSchemaDraftFile(text, projectId);
      if (editor.hasDraftInputChanges && !window.confirm(t('settings:confirmReplaceDraftWithFile'))) {
        setStatus({ error: false, key: 'replaceCancelled' }); return;
      }
      if (!controller.signal.aborted && !editor.importDraft(text, { discardDraft: true }))
        setStatus({ error: true, key: 'importChanged' });
    } catch (error) {
      if (pendingRead.current !== controller) return;
      if (controller.signal.aborted) setStatus({ error: false, key: controller.signal.reason === 'user_cancelled' ? 'readCancelled' : 'readInterrupted' });
      else setStatus(error instanceof Error ? { error: true, message: error.message } : { error: true, key: 'readFailed' });
    } finally {
      unsubscribe();
      if (pendingRead.current === controller) { pendingRead.current = null; setReading(null); }
    }
  }
  const statusText = !status ? '' : status.message ? messageText(status.message)
    : status.key === 'downloadRequested' ? t('settings:draftDownloadRequested')
    : status.key === 'downloadFailed' ? t('settings:draftDownloadFailed')
    : status.key === 'tooLarge' ? t('settings:draftTooLarge')
    : status.key === 'replaceCancelled' ? t('settings:draftReplaceCancelled')
    : status.key === 'importChanged' ? t('settings:draftImportChanged')
    : status.key === 'readCancelled' ? t('settings:draftReadCancelled')
    : status.key === 'readInterrupted' ? t('settings:draftReadInterrupted')
    : t('settings:draftReadFailed');
  return <div className="schema-draft-files" aria-busy={Boolean(reading) || undefined}>
    <button className="secondary-button" type="button" disabled={!editable || Boolean(reading)} onClick={download}>{t('settings:saveDraftFile')}</button>
    <label className="field-label" htmlFor="schema-draft-file">{t('settings:loadDraftFile')}</label>
    <input className="text-input" id="schema-draft-file" type="file" accept=".json,application/json" disabled={!editable || Boolean(reading)} aria-describedby="schema-draft-file-help"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void read(file); }} />
    <p className="field-help" id="schema-draft-file-help">{t('settings:draftFileHelp')}</p>
    {reading !== null && <><p role="status">{t('settings:readingDraftFile', { name: reading || t('settings:unnamedFile') })}</p>
      <button className="secondary-button" type="button" onClick={() => pendingRead.current?.abort('user_cancelled')}>{t('settings:cancelFileRead')}</button></>}
    {status && <p ref={statusRef} tabIndex={status.error ? -1 : undefined} className={status.error ? 'form-error' : 'context-note'} role={status.error ? 'alert' : 'status'}>{statusText}</p>}
  </div>;
}
