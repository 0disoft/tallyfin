import { useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import type { ProjectDefinition } from './data';
import { useI18n } from './i18n';
export default function Settings({ project, displayName, onSave, onReset }: { project: ProjectDefinition; displayName: string; onSave: (name: string) => void; onReset: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(displayName);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  return <>
    <section className="settings-section"><h2>{t('settings:projectInfo')}</h2><form className="settings-form" onSubmit={event => { event.preventDefault(); const clean = name.trim(); if (!clean || clean.length > 40) { setError(true); setSaved(false); return; } onSave(clean); setError(false); setSaved(true); }}>
      <label className="field-label" htmlFor="project-name">{t('settings:projectName')}</label><input id="project-name" className="text-input" value={name} onChange={event => { setName(event.target.value); setSaved(false); }} aria-invalid={error} aria-describedby={error ? 'project-name-error' : 'project-name-help'} />
      <p id="project-name-help" className="context-note">{t('settings:sampleNameHelp')}</p>
      {error && <p id="project-name-error" className="form-error" role="alert">{t('settings:nameLengthError')}</p>}
      <div className="form-actions"><button className="primary-button" type="submit">{t('settings:saveChanges')}</button><button className="secondary-button" type="button" onClick={() => { onReset(); setName(project.name); setError(false); setSaved(false); }}>{t('settings:resetName')}</button></div>
      {saved && <p className="form-success" role="status"><CheckCircle size={20} />{t('settings:sampleSaved')}</p>}
    </form></section>
    <section className="settings-section"><h2>{t('settings:registeredEventsAndProperties')}</h2><p className="context-note">{t('settings:sampleSchemaMeta', { version: project.version })}</p><div className="table-scroll" tabIndex={0} aria-label={t('settings:registeredDefinitionsTable')}><table className="event-table"><caption className="sr-only">{t('settings:sampleDefinitionsCaption')}</caption><thead><tr><th scope="col">{t('settings:event')}</th><th scope="col">{t('settings:source')}</th><th scope="col">{t('settings:allowedProperties')}</th></tr></thead><tbody>{project.events.map(event => <tr key={event.name}><th scope="row" className="event-name">{event.name}</th><td>{event.source}</td><td>{event.properties.join(', ')}</td></tr>)}</tbody></table></div><p className="context-note">{t('settings:sampleContractHelp')}</p></section>
  </>;
}
