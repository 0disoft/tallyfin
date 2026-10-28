import { CaretDown, FileText, FolderSimple, Leaf } from '@phosphor-icons/react';
import { projects, type ProjectId } from './data';
import { useI18n } from './i18n';

/** Sample-only navigation stays out of the signed-in administrator's initial graph. */
export default function SampleProjects({ projectId, names, onSelect }: {
  projectId: ProjectId; names: Record<ProjectId, string>; onSelect: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  return <>
    <div className="project-switcher"><label htmlFor="project-switch">{t('admin:project')}</label><div className="project-select-wrap"><FolderSimple size={24} color="#155EEF" /><select id="project-switch" aria-label={t('admin:selectProject')} value={projectId} onChange={event => onSelect(event.target.value as ProjectId)}>{projects.map(item => <option key={item.id} value={item.id}>{names[item.id]}</option>)}</select><CaretDown size={16} /></div></div>
    <div className="project-list">{projects.filter(item => item.id !== projectId).map(item => { const Icon = item.id === 'orchid' ? Leaf : item.id === 'sembom' ? FileText : FolderSimple; return <button key={item.id} type="button" className="project-button" onClick={() => onSelect(item.id)}><Icon size={23} /><span>{names[item.id]}</span></button>; })}</div>
  </>;
}
