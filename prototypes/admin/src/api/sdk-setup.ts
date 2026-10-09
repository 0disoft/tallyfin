import type { Registry } from './types.ts';

/** Project only the published browser schema. No bearer or server-only definitions enter this output. */
export function sdkSetup(registry: Registry, collectorOrigin: string): string {
  const originError = '수집 서버의 출처만 입력해 주세요. HTTPS 또는 로컬 개발 주소를 사용하세요.';
  let url: URL;
  try { url = new URL(collectorOrigin.trim()); } catch { throw Error(originError); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== collectorOrigin.trim() || url.username || url.password ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && local)) throw Error(originError);
  if (registry.project.status !== 'active' || registry.schemaStatus !== 'active') throw Error('사용 중인 프로젝트와 스키마만 연결할 수 있어요.');
  const rule = (r: Registry['events'][number]['properties'][string]) => r.type === 'boolean' ? ['boolean', r.required]
    : r.type === 'enum' ? ['enum', r.required, r.values] : ['integer', r.required, r.minimum, r.maximum];
  const schema = { version: registry.schemaVersion,
    events: Object.fromEntries(registry.events.filter(e => e.source === 'browser').map(e => [e.name, Object.fromEntries(Object.entries(e.properties).map(([k, r]) => [k, rule(r)]))])),
    workflows: Object.fromEntries(registry.workflows.map(w => [w.id, { start: w.startEvent, success: w.successEvent,
      ...(w.failureEvent === null ? {} : { failure: w.failureEvent }), dimensions: w.dimensions }])),
  };
  return `import { createTallyfin } from '@tallyfin/browser';\n\nconst analytics = createTallyfin({\n  endpoint: ${JSON.stringify(`${url.origin}/v1/projects/${registry.project.id}/batches`)},\n  schema: ${JSON.stringify(schema, null, 2).replaceAll('\n', '\n  ')},${url.protocol === 'http:' ? '\n  allowLocalHttp: true,' : ''}\n});\n\n// 서비스에서 해당 행동이 일어났을 때 등록한 이벤트를 명시적으로 보내세요.\n// 일반 이벤트: analytics.track(name, properties)\n// 작업 흐름: analytics.start(workflowId, properties)\n// 화면 종료 시 analytics.destroy()\n`;
}
