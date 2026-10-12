import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import type { ProjectSettings } from './api/types.ts';
import { ProjectCreator } from './api/project-creator.ts';
import type { CreatorState } from './api/project-creator.ts';
import type { CreationDraft } from './api/project-creation.ts';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import useUnloadWarning from './useUnloadWarning.ts';

const fields: { key: keyof CreationDraft; label: string; help: string; placeholder?: string; max?: number }[] = [
  { key: 'name', label: '프로젝트 이름', help: '관리자 목록에 표시할 이름, 1~80자.', placeholder: '예: 내 서비스', max: 80 },
  { key: 'id', label: '공개 프로젝트 ID', help: '소문자로 시작하며 소문자·숫자·하이픈을 사용해요. 생성 후에는 바꿀 수 없어요.', placeholder: 'my-service', max: 48 },
  { key: 'timeZone', label: '집계 시간대', help: 'IANA 시간대 이름이에요. 생성 후에는 바꿀 수 없어요.', placeholder: 'Asia/Seoul', max: 64 },
  { key: 'origins', label: '브라우저 허용 출처 (선택)', help: '한 줄에 출처 하나씩, 최대 16개. 서버 전용이면 비워 두세요. 빈 목록은 브라우저 수집을 차단해요. 경로는 제외하고 HTTP는 허용된 로컬 개발에만 사용해요.', placeholder: 'https://my-service.com' },
  { key: 'requestsPerMinute', label: '분당 요청 한도', help: '1~600 사이 정수. 기본 입력값은 120이에요.' },
  { key: 'newReceiptsPerUtcDay', label: 'UTC 하루 신규 수신 한도', help: '1~1,000,000 사이 정수. 기본 입력값은 100,000이에요.' },
];
export default function LiveProjectCreate({ client, onCreated, onClose, registerDraft }: { client: ApiClient; onCreated: (settings: ProjectSettings) => boolean | void; onClose: () => void; registerDraft?: DraftExitRegistration<ApiClient> }) {
  const [state, setState] = useState<CreatorState | null>(null), [limitsOpen, setLimitsOpen] = useState(false);
  const creator = useRef<ProjectCreator | null>(null), heading = useRef<HTMLHeadingElement>(null);
  useUnloadWarning(Boolean(creator.current?.hasUnsavedChanges));
  const opened = useRef(onCreated);
  opened.current = onCreated;
  useEffect(() => {
    const controller = new ProjectCreator(client, settings => opened.current(settings)); creator.current = controller;
    const removeExitCheck = registerDraft?.(client, null, () => controller.hasUnsavedChanges);
    const unsubscribe = controller.subscribe(setState);
    return () => { unsubscribe(); controller.destroy(); removeExitCheck?.(); if (creator.current === controller) creator.current = null; };
  }, [client, registerDraft]);
  const errorKey = fields.find(f => state?.errors[f.key])?.key;
  useEffect(() => { if (errorKey === 'requestsPerMinute' || errorKey === 'newReceiptsPerUtcDay') setLimitsOpen(true); }, [errorKey]);
  useEffect(() => { if (errorKey) document.getElementById(`create-${errorKey}`)?.focus(); }, [state?.errors, errorKey, limitsOpen]);
  useEffect(() => { heading.current?.focus(); }, [Boolean(state)]);
  if (!state) return null;
  const locked = state.phase !== 'ready', busy = state.phase === 'creating' || state.phase === 'opening';
  const renderField = (field: typeof fields[number]) => {
    const id = `create-${field.key}`, error = state.errors[field.key];
    const props = { id, className: 'text-input', value: state.draft[field.key], disabled: locked, autoComplete: 'off',
      'aria-invalid': error ? true : undefined, 'aria-describedby': `${id}-help${error ? ` ${id}-error` : ''}`,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => creator.current?.edit(field.key, event.target.value) };
    return <div className={`settings-field${field.key === 'origins' ? 'project-create-wide' : ''}`} key={field.key}>
      <label className="field-label" htmlFor={id}>{field.label}</label>
      {field.key === 'origins' ? <textarea {...props} rows={3} className="text-input settings-textarea" placeholder={field.placeholder} />
        : <input {...props} maxLength={field.max} placeholder={field.placeholder} inputMode={field.key.endsWith('Minute') || field.key.endsWith('Day') ? 'numeric' : 'text'} />}
      <p className="field-help" id={`${id}-help`}>{field.help}</p>
      {error && <p className="form-error" id={`${id}-error`} role="alert">{error}</p>}
    </div>;
  };
  return <section className="settings-section project-create" aria-labelledby="project-create-heading" aria-busy={busy || undefined}>
    <div className="settings-head"><h2 id="project-create-heading" tabIndex={-1} ref={heading}>새 프로젝트</h2></div>
    <ol className="setup-steps" aria-label="프로젝트 연결 순서"><li aria-current="step">1 프로젝트</li><li>2 이벤트 스키마</li><li>3 SDK 연결</li></ol>
    <p className="context-note">프로젝트 생성 권한은 서버에서 확인해요. 입력은 이 화면의 메모리에만 보관해요.</p>
    {state.message && <p className="notice" role="status">{state.message}</p>}
    <form onSubmit={event => { event.preventDefault(); void creator.current?.create(); }} noValidate>
      <div className="project-create-grid">{fields.slice(0, 4).map(renderField)}</div>
      <details className="project-create-limits" open={limitsOpen} onToggle={event => setLimitsOpen(event.currentTarget.open)}>
        <summary>수집 한도 · 분당 {state.draft.requestsPerMinute || '—'} / 하루 {state.draft.newReceiptsPerUtcDay || '—'}</summary>
        <div className="project-create-grid">{fields.slice(4).map(renderField)}</div>
      </details>
      {state.phase === 'uncertain' ? <div className="settings-recovery">
        <p>같은 내용으로 다시 요청해 생성 여부를 확인해요. 아직 저장되지 않았다면 이 요청으로 생성돼요.</p>
        <button className="primary-button" type="button" onClick={() => { void creator.current?.confirm(); }}>같은 요청으로 생성 확인</button>
        <p className="field-help">입력을 바꾸지 않고 확인해요. 연결을 끊거나 화면을 닫으면 이 초안이 사라져요.</p>
      </div> : <div className="form-actions">
        {state.receipt ? <button className="primary-button" type="button" disabled={busy} onClick={() => { void creator.current?.open(); }}>{busy ? '불러오는 중…' : '생성한 프로젝트 열기'}</button>
          : <button className="primary-button" type="submit" disabled={locked}>{busy ? '생성 확인 중…' : '프로젝트 만들기'}</button>}
        <button className="secondary-button" type="button" disabled={busy} onClick={() => {
          if (!creator.current?.hasUnsavedChanges || window.confirm('작성 중인 프로젝트 정보를 버리고 닫을까요?')) onClose();
        }}>닫기</button>
      </div>}
    </form>
  </section>;
}
