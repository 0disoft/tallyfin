import { useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import type { ProjectDefinition } from './data';
export default function Settings({ project, displayName, onSave, onReset }: { project: ProjectDefinition; displayName: string; onSave: (name: string) => void; onReset: () => void }) {
  const [name, setName] = useState(displayName);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return <>
    <section className="settings-section"><h2>프로젝트 정보</h2><form className="settings-form" onSubmit={event => { event.preventDefault(); const clean = name.trim(); if (!clean || clean.length > 40) { setError('프로젝트 이름을 1~40자로 입력해 주세요.'); setSaved(false); return; } onSave(clean); setError(''); setSaved(true); }}>
      <label className="field-label" htmlFor="project-name">프로젝트 이름</label><input id="project-name" className="text-input" value={name} onChange={event => { setName(event.target.value); setSaved(false); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'project-name-error' : 'project-name-help'} />
      <p id="project-name-help" className="context-note">변경 사항은 현재 화면의 메모리에만 저장돼요. 새로고침하면 초기화돼요.</p>
      {error && <p id="project-name-error" className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" type="submit">변경 저장</button><button className="secondary-button" type="button" onClick={() => { onReset(); setName(project.name); setError(''); setSaved(false); }}>이름 초기화</button></div>
      {saved && <p className="form-success" role="status"><CheckCircle size={20} />샘플 설정을 저장했어요.</p>}
    </form></section>
    <section className="settings-section"><h2>등록 이벤트와 허용 속성</h2><p className="context-note">스키마 v{project.version} · 관리자(샘플) · 정의 조회</p><div className="table-scroll" tabIndex={0} aria-label="등록 정의 표"><table className="event-table"><caption className="sr-only">프로젝트별 이벤트 정의 예시</caption><thead><tr><th scope="col">이벤트</th><th scope="col">출처</th><th scope="col">허용 속성</th></tr></thead><tbody>{project.events.map(event => <tr key={event.name}><th scope="row" className="event-name">{event.name}</th><td>{event.source}</td><td>{event.properties.join(', ')}</td></tr>)}</tbody></table></div><p className="context-note">정의 편집과 실제 권한 관리는 서버 계약을 확정한 뒤 연결해요.</p></section>
  </>;
}
