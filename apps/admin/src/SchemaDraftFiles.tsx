import { useEffect, useRef, useState } from 'react';
import type { SchemaEditor } from './api/schema-editor.ts';
import { parseSchemaDraftFile, SCHEMA_DRAFT_FILE_LIMIT } from './api/schema-draft-file.ts';

export default function SchemaDraftFiles({ editor, editable, projectId }: { editor: SchemaEditor; editable: boolean; projectId: string }) {
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const stopRead = useRef<(() => void) | null>(null);
  useEffect(() => {
    setStatus(null);
    return () => { stopRead.current?.(); stopRead.current = null; };
  }, [editor, editable]);
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
  function read(file: File) {
    stopRead.current?.(); stopRead.current = null; setStatus(null);
    if (file.size > SCHEMA_DRAFT_FILE_LIMIT) {
      setStatus({ error: true, text: '초안 파일은 128KiB 이하로 선택해 주세요.' }); return;
    }
    const reader = new FileReader(); let active = true;
    const stop = () => {
      active = false; clearTimeout(timer); reader.onload = reader.onerror = reader.onabort = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
      if (stopRead.current === stop) stopRead.current = null;
      setReading(false);
    };
    const fail = (text: string) => { if (!active) return; stop(); setStatus({ error: true, text }); };
    const timer = setTimeout(() => fail('파일 읽기 시간이 길어졌어요. 다시 선택해 주세요.'), 10000);
    stopRead.current = stop; setReading(true);
    reader.onerror = () => fail('초안 파일을 읽지 못했어요. 다시 선택해 주세요.');
    reader.onabort = () => fail('초안 파일 읽기가 취소됐어요.');
    reader.onload = () => {
      if (!active) return;
      try {
        const text = String(reader.result);
        parseSchemaDraftFile(text, projectId);
        if (editor.hasUnsavedChanges && !window.confirm('작성 중인 초안을 파일 내용으로 바꿀까요? 현재 초안과 발행할 버전 입력은 사라져요.')) { stop(); return; }
        editor.importDraft(text, { discardDraft: true }); stop();
      } catch (error) { fail(error instanceof Error ? error.message : '초안 파일을 읽지 못했어요.'); }
    };
    try { reader.readAsText(file); } catch { fail('초안 파일을 읽지 못했어요. 다시 선택해 주세요.'); }
  }
  return <div className="schema-draft-files" aria-busy={reading || undefined}>
    <button className="secondary-button" type="button" disabled={!editable || reading} onClick={download}>초안 파일 저장</button>
    <label className="field-label" htmlFor="schema-draft-file">초안 파일 불러오기 (128KiB 이하)</label>
    <input className="text-input" id="schema-draft-file" type="file" accept=".json,application/json" disabled={!editable || reading}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) read(file); }} />
    <p className="field-help">작성 중인 JSON과 발행할 버전을 파일로 보관해요. 파일은 이 브라우저에서 읽고, 불러온 뒤 검증과 개인정보 검토를 다시 해야 해요.</p>
    {reading && <p role="status">초안 파일을 읽고 있어요.</p>}
    {status && <p className={status.error ? 'form-error' : 'context-note'} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
  </div>;
}
