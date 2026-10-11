import { observationReportText, REPORT_BYTE_LIMIT } from './observation-report.ts';

// JSON parsing and validation run off the UI thread. The file never leaves this local worker.
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (!(file instanceof File) || file.size > REPORT_BYTE_LIMIT) {
      self.postMessage({ ok: false, code: 'report_limit' }); return;
    }
    self.postMessage({ ok: true, report: observationReportText(await file.text()) });
  } catch { self.postMessage({ ok: false, code: 'invalid_report' }); }
};
