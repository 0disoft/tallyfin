import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from './i18n';

type Props = { children: ReactNode; label: string };
type BoundaryProps = Props & { failedTitle: string; failedHelp: string; reload: string };

/** Chunk failures need a new document; React.lazy retains a rejected import. */
class PanelBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="state-panel" role="alert">
      <h2>{this.props.failedTitle}</h2>
      <p>{this.props.failedHelp}</p>
      <button type="button" className="secondary-button" onClick={() => window.location.reload()}>{this.props.reload}</button>
    </section>;
    return this.props.children;
  }
}

export default function DeferredPanel({ children, label }: Props) {
  const { t } = useI18n();
  return <PanelBoundary label={label} failedTitle={t('admin:panelFailed', { label })} failedHelp={t('admin:panelFailedHelp')} reload={t('admin:panelReload')}><Suspense fallback={<section className="state-panel" role="status" aria-busy="true">
    <h2>{t('admin:panelLoading', { label })}</h2>
  </section>}>{children}</Suspense></PanelBoundary>;
}
