import type { EventSource, Registry } from './types.ts';
import { funnelExample } from './sdk-funnel-example.ts';

export type SdkProfile = 'standard' | 'funnels';
export function sdkFunnels(registry: Registry, source: EventSource) {
  return (registry.funnels ?? []).filter(funnel => funnel.steps.some(step => step.source === source));
}

/** Project one published source; credentials are supplied by the hosting service, never embedded here. */
export function sdkSetup(registry: Registry, collectorOrigin: string, source: EventSource = 'browser',
  options: { profile?: SdkProfile; funnelId?: string } = {}): string {
  const originError = '수집 서버의 출처만 입력해 주세요. HTTPS 또는 로컬 개발 주소를 사용하세요.';
  let url: URL;
  try { url = new URL(collectorOrigin.trim()); } catch { throw Error(originError); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== collectorOrigin.trim() || url.username || url.password ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && local)) throw Error(originError);
  if (registry.project.status !== 'active' || registry.schemaStatus !== 'active') throw Error('사용 중인 프로젝트와 스키마만 연결할 수 있어요.');
  if (!['browser', 'server'].includes(source)) throw Error('SDK 발행 출처를 확인해 주세요.');
  const profile = options.profile ?? 'standard';
  if (!['standard', 'funnels'].includes(profile)) throw Error('SDK 종류를 확인해 주세요.');
  const funnels = sdkFunnels(registry, source), linked = source === 'server' || profile === 'funnels';
  if (profile === 'funnels' && !funnels.length) throw Error('이 출처가 참여하는 등록 퍼널이 없어요.');
  const selected = options.funnelId === undefined ? funnels[0] : funnels.find(funnel => funnel.id === options.funnelId);
  if (options.funnelId !== undefined && (!linked || !selected)) throw Error('선택한 퍼널과 SDK 출처를 확인해 주세요.');
  const legacy = new Set(registry.workflows.flatMap(workflow => [workflow.startEvent, workflow.successEvent, workflow.failureEvent]));
  const stages = new Set(funnels.flatMap(funnel => funnel.steps.filter(step => step.source === source).map(step => step.eventName)));
  const events = registry.events.filter(event => event.source === source &&
    !(source === 'browser' && profile === 'funnels' && legacy.has(event.name) && !stages.has(event.name)));
  if (!events.length) throw Error(`등록된 ${source === 'browser' ? '브라우저' : '서버'} 이벤트가 없어요.`);
  if (source === 'browser' && !registry.allowedOrigins.length) throw Error('브라우저 허용 출처가 비어 있어요. 프로젝트 설정에서 서비스 출처를 추가하세요.');
  const rule = (r: Registry['events'][number]['properties'][string]) => r.type === 'boolean' ? ['boolean', r.required]
    : r.type === 'enum' ? ['enum', r.required, r.values] : ['integer', r.required, r.minimum, r.maximum];
  const schema = { version: registry.schemaVersion,
    events: Object.fromEntries(events.map(e => [e.name, Object.fromEntries(Object.entries(e.properties).map(([k, r]) => [k, rule(r)]))])),
    ...(linked ? (funnels.length ? { funnels: Object.fromEntries(funnels.map(funnel => [funnel.id, {
      steps: funnel.steps.map(step => step.source === source ? step.eventName : null), dimensions: [...funnel.dimensions],
    }])) } : {}) : { workflows: Object.fromEntries(registry.workflows.map(w => [w.id, { start: w.startEvent, success: w.successEvent,
      ...(w.failureEvent === null ? {} : { failure: w.failureEvent }), dimensions: w.dimensions }])),
    }),
  };
  const example = linked && selected ? funnelExample(registry, source, selected) : '';
  if (source === 'server') return `import { createTallyfinServer, type ServerOptions, type ServerPlatform } from '@tallyfin/server';\n\n// 실제 서비스가 전용 발행자 토큰을 얻는 함수를 전달하세요.\nexport function connectServerAnalytics(getToken: ServerOptions['getToken'], host?: ServerPlatform) {\n  return createTallyfinServer({\n    endpoint: ${JSON.stringify(`${url.origin}/v1/projects/${registry.project.id}/server-batches`)},\n    schema: ${JSON.stringify(schema, null, 2).replaceAll('\n', '\n    ')},\n    getToken,${url.protocol === 'http:' ? '\n    allowLocalHttp: true,' : ''}\n  }, host);\n}\n\n// 등록한 서버 작업이 실제로 완료됐을 때 이벤트를 만들고 전송 결과를 확인하세요.\n// const event = analytics.createEvent(name, properties);\n// const result = await analytics.send([event]);\n// 재전송할 때 eventId·occurredAt·속성을 그대로 보존하세요.\n${example}`;
  if (profile === 'funnels') return `import { createTallyfinFunnels, type BrowserPlatform } from '@tallyfin/browser/funnels';\n\nexport function connectBrowserAnalytics(host?: BrowserPlatform) {\n  return createTallyfinFunnels({\n    endpoint: ${JSON.stringify(`${url.origin}/v1/projects/${registry.project.id}/batches`)},\n    schema: ${JSON.stringify(schema, null, 2).replaceAll('\n', '\n    ')},${url.protocol === 'http:' ? '\n    allowLocalHttp: true,' : ''}\n  }, host);\n}\n\n// 일반 이벤트: analytics.track(name, properties)\n// 기존 작업 흐름은 기본 @tallyfin/browser 프로필을 별도로 사용하세요.\n// 화면 종료 시 analytics.destroy()\n${example}`;
  return `import { createTallyfin } from '@tallyfin/browser';\n\nconst analytics = createTallyfin({\n  endpoint: ${JSON.stringify(`${url.origin}/v1/projects/${registry.project.id}/batches`)},\n  schema: ${JSON.stringify(schema, null, 2).replaceAll('\n', '\n  ')},${url.protocol === 'http:' ? '\n  allowLocalHttp: true,' : ''}\n});\n\n// 서비스에서 해당 행동이 일어났을 때 등록한 이벤트를 명시적으로 보내세요.\n// 일반 이벤트: analytics.track(name, properties)\n// 작업 흐름: analytics.start(workflowId, properties)\n// 화면 종료 시 analytics.destroy()\n`;
}
