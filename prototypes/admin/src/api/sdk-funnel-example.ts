import type { EventSource, FunnelDefinition, Registry } from './types.ts';

/** Comments only: generating setup must never emit a milestone or request a credential. */
export function funnelExample(registry: Registry, source: EventSource, funnel: FunnelDefinition): string {
  const local = funnel.steps.flatMap((step, index) => step.source === source ? [{ ...step, index }] : []);
  const lines = [`퍼널 ${funnel.id} 사용 예제 — 실제 단계가 일어났을 때만 실행하세요.`,
    '아래 속성 값은 등록 범위의 예시예요. 실제 작업의 분류 값으로 바꾸고 모든 단계에서 유지하세요.',
    source === 'browser' ? 'const analytics = connectBrowserAnalytics();' : 'const analytics = connectServerAnalytics(getPublisherToken);',
    funnel.steps[0]!.source === source ? `const run = analytics.createFunnelRun(${JSON.stringify(funnel.id)});`
      : 'const run = validatedTaskContext.funnel; // 호스트가 업무 요청에서 검증한 연결 정보',
    'if (run) {'];
  for (const step of local) {
    const event = registry.events.find(event => event.name === step.eventName && event.source === source)!;
    const properties = Object.fromEntries(Object.entries(event.properties).filter(([, rule]) => rule.required)
      .map(([key, rule]) => [key, rule.type === 'boolean' ? false : rule.type === 'enum' ? rule.values[0] : rule.minimum]));
    lines.push(`  // ${step.index + 1}번째 단계 ${step.eventName}의 실제 발생 시각을 한 번 기록하세요.`,
      `  const occurredAt${step.index} = ${step.index === 0 ? 'run.startedAt' : 'new Date().toISOString()'};`);
    if (source === 'browser') lines.push(`  analytics.trackFunnel(${JSON.stringify(step.eventName)}, ${JSON.stringify(properties)}, run, occurredAt${step.index});`);
    else lines.push(`  const event${step.index} = analytics.createEvent(${JSON.stringify(step.eventName)}, ${JSON.stringify(properties)},`,
      `    { funnel: run, occurredAt: occurredAt${step.index} });`, `  const result${step.index} = await analytics.send([event${step.index}]);`);
  }
  lines.push('}', '다른 출처로 넘길 때 같은 run을 업무 컨텍스트에 유지하세요. 연결 정보는 인증 수단이 아니에요.',
    '재전송에는 같은 run·분류 값·원래 occurredAt을 사용하세요. 서버 이벤트는 eventId도 유지하세요.',
    '실패 뒤 새 작업으로 다시 시작할 때만 새 run을 만드세요.');
  return '\n' + lines.map(line => '// ' + line).join('\n') + '\n';
}
