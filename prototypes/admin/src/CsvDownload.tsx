import { useState } from 'react';
import { analyticsCsv, type ExportInput } from './api/csv-export';

export default function CsvDownload({ input, unavailable }: { input: ExportInput | null; unavailable: string | null }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  function download() {
    if (!input || unavailable) return;
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const file = analyticsCsv(input);
      url = URL.createObjectURL(new Blob([file.text], { type: 'text/csv;charset=utf-8' }));
      link = document.createElement('a'); link.href = url; link.download = file.filename;
      document.body.append(link); link.click();
      setError(false); setMessage(`${file.rowCount}행 CSV 다운로드를 요청했어요.`);
    } catch {
      setError(true); setMessage('CSV를 만들지 못했어요. 조회 상태와 브라우저 다운로드 설정을 확인해 주세요.');
    } finally {
      link?.remove();
      if (url) { const release = url; setTimeout(() => URL.revokeObjectURL(release), 1000); }
    }
  }
  return <div className="csv-export">
    <button className="secondary-button" type="button" disabled={!input || !!unavailable} onClick={download} aria-describedby="csv-export-status">CSV 내려받기</button>
    <p id="csv-export-status" className={error && !unavailable ? 'form-error' : 'context-note'} role={error && !unavailable ? 'alert' : 'status'}>
      {unavailable ?? message ?? '현재 조회 조건·합계·일별 수치를 내려받아요. 분류를 선택했다면 모든 속성 값을 포함해요.'}
    </p>
  </div>;
}
