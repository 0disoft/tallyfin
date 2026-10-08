const mode = new URL(location.href).searchParams.get('mode');
const metrics = { sdkImportMs: null, sdkInitMs: null, sdkCallsMs: [], handlersMs: [],
  handlerToSecondFrameMs: [], events: [], longTasks: [], accepted: 0, calculations: 0, ready: false };
const observers = [];
for (const type of ['event', 'longtask']) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (type === 'event' && entry.interactionId) metrics.events.push({ name: entry.name, duration: entry.duration });
      if (type === 'longtask') metrics.longTasks.push(entry.duration);
    }
  });
  observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 16 } : { type, buffered: true });
  observers.push(observer);
}
let client;
if (mode !== 'disabled') {
  const importing = performance.now();
  const { connect } = await import('/sdk.mjs');
  metrics.sdkImportMs = performance.now() - importing;
  const initializing = performance.now();
  client = connect();
  metrics.sdkInitMs = performance.now() - initializing;
}
function sdk(call) {
  if (!client) return;
  const began = performance.now();
  const result = call();
  metrics.sdkCallsMs.push(performance.now() - began);
  if (result) metrics.accepted++;
  return result;
}
sdk(() => client.track('tool_view', { tool: 'loan' }));
const left = document.querySelector('#left');
const right = document.querySelector('#right');
const result = document.querySelector('#result');
let attempt;
function measured(handler) {
  const began = performance.now();
  handler();
  metrics.handlersMs.push(performance.now() - began);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    metrics.handlerToSecondFrameMs.push(performance.now() - began);
  }));
}
function input() {
  measured(() => { if (!attempt) attempt = sdk(() => client.start('calculation', { tool: 'loan' })); });
}
left.addEventListener('input', input);
right.addEventListener('input', input);
document.querySelector('#calculate').addEventListener('click', () => measured(() => {
  if (!left.value || !right.value) {
    result.textContent = 'Enter both numbers';
    sdk(() => client.track('validation_error', { tool: 'loan', error: 'required' }));
    return;
  }
  result.textContent = String(Number(left.value) + Number(right.value));
  metrics.calculations++;
  if (attempt) sdk(() => attempt.succeed());
  attempt = undefined;
}));
document.querySelector('#mode').textContent = `Mode: ${mode}`;
document.querySelector('#calculate').disabled = false;
metrics.ready = true;
window.__bench = {
  get ready() { return metrics.ready; },
  get pending() { return client?.pending ?? 0; },
  flush() { client?.flush(); },
  destroy() { client?.destroy(); },
  snapshot() {
    const resources = performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/sdk.mjs'));
    return { ...structuredClone(metrics), supportedEntryTypes: PerformanceObserver.supportedEntryTypes,
      fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      sdkResource: resources.map(entry => ({ durationMs: entry.duration, transferBytes: entry.transferSize,
        encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })) };
  },
};
window.addEventListener('pagehide', () => { client?.destroy(); observers.forEach(observer => observer.disconnect()); });
