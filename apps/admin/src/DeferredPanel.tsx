import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

type Props = { children: ReactNode; label: string };

/** Chunk failures need a new document; React.lazy retains a rejected import. */
class PanelBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="state-panel" role="alert">
      <h2>{this.props.label} 화면을 불러오지 못했어요</h2>
      <p>네트워크 연결을 확인한 뒤 새로고침해 주세요. 새로고침하면 입력 중인 내용과 직접 연결한 토큰이 지워져요.</p>
      <button type="button" className="secondary-button" onClick={() => window.location.reload()}>화면 새로고침</button>
    </section>;
    return this.props.children;
  }
}

export default function DeferredPanel({ children, label }: Props) {
  return <PanelBoundary label={label}><Suspense fallback={<section className="state-panel" role="status" aria-busy="true">
    <h2>{label} 화면을 준비하고 있어요</h2>
  </section>}>{children}</Suspense></PanelBoundary>;
}
