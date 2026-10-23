import { useEffect, useRef, useState } from 'react';
import type { SchemaEditor } from './api/schema-editor.ts';
import { parseSchemaDraftFile, SCHEMA_DRAFT_FILE_LIMIT } from './api/schema-draft-file.ts';
import { readSchemaDraftFile } from './api/read-schema-draft-file.ts';

export default function SchemaDraftFiles({ editor, editable, projectId }: { editor: SchemaEditor; editable: boolean; projectId: string }) {
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
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
      setStatus({ error: false, text: '초안 파일 다운로드를 요청했어요.' });
    } catch (error) {
      setStatus({ error: true, text: error instanceof Error ? error.message : '초안 파일을 만들지 못했어요.' });
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
      setStatus({ error: true, text: '초안 파일은 128KiB 이하로 선택해 주세요.' }); return;
    }
    const controller = new AbortController(); pendingRead.current = controller; setReading(file.name || '이름 없는 파일');
    // Observe the editor synchronously, even if React batches a busy -> ready transition.
    const unsubscribe = editor.subscribe(() => { if (!canImport()) controller.abort('editor_changed'); });
    try {
      const text = await readSchemaDraftFile(file, { signal: controller.signal });
      if (pendingRead.current !== controller || controller.signal.aborted) return;
      parseSchemaDraftFile(text, projectId);
      if (editor.hasDraftInputChanges && !window.confirm('작성 중인 초안을 파일 내용으로 바꿀까요? 현재 초안과 발행할 버전 입력은 사라져요.')) {
        setStatus({ error: false, text: '초안 교체를 취소했어요. 기존 입력과 검토 상태는 그대로예요.' }); return;
      }
      if (!controller.signal.aborted && !editor.importDraft(text, { discardDraft: true }))
        setStatus({ error: true, text: '편집 상태가 바뀌어 가져오지 않았어요. 상태를 확인한 뒤 파일을 다시 선택해 주세요.' });
    } catch (error) {
      if (pendingRead.current !== controller) return;
      if (controller.signal.aborted) setStatus({ error: false, text: controller.signal.reason === 'user_cancelled'
        ? '파일 읽기를 취소했어요. 기존 입력과 검토 상태는 그대로예요.' : '편집 상태가 바뀌어 파일 읽기를 중단했어요. 다시 선택해 주세요.' });
      else setStatus({ error: true, text: error instanceof Error ? error.message : '초안 파일을 읽지 못했어요. 다시 선택해 주세요.' });
    } finally {
      unsubscribe();
      if (pendingRead.current === controller) { pendingRead.current = null; setReading(null); }
    }
  }
  return <div className="schema-draft-files" aria-busy={Boolean(reading) || undefined}>
    <button className="secondary-button" type="button" disabled={!editable || Boolean(reading)} onClick={download}>초안 파일 저장</button>
    <label className="field-label" htmlFor="schema-draft-file">초안 파일 불러오기 (128KiB 이하)</label>
    <input className="text-input" id="schema-draft-file" type="file" accept=".json,application/json" disabled={!editable || Boolean(reading)} aria-describedby="schema-draft-file-help"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void read(file); }} />
    <p className="field-help" id="schema-draft-file-help">Tallyfin에서 저장한 UTF-8 초안 파일을 선택해 주세요. 미완성 JSON과 버전 입력도 그대로 복원해요. 파일은 브라우저에서만 읽고, 가져온 뒤 검증과 개인정보 검토를 다시 해야 해요.</p>
    {reading && <><p role="status">초안 파일을 읽고 있어요: {reading}</p>
      <button className="secondary-button" type="button" onClick={() => pendingRead.current?.abort('user_cancelled')}>파일 읽기 취소</button></>}
    {status && <p ref={statusRef} tabIndex={status.error ? -1 : undefined} className={status.error ? 'form-error' : 'context-note'} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
  </div>;
}
