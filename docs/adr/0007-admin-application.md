# ADR 0007 — 관리자 앱의 소유 경계

- 상태: 채택, 로컬 구현. 운영 인증·원격 배포는 후속.
- 날짜: 2026-10-11

## 결정

사용자가 선택한 시안과 구현·검증한 React 19·Vite 8 관리자 화면을 `apps/admin`으로
이전한다. React·Recharts·Phosphor와 기존 폰트·OIDC 클라이언트를 유지한다. 별도 UI를
복제하거나 다른 프레임워크로 다시 만들지 않는다. 이는 ADR 0001의 관리자 프레임워크
미결정을 대체하며 수집기의 네이티브 fetch와 SDK 의존성 경계는 바꾸지 않는다.

관리자는 private npm workspace `@tallyfin/admin`이다. 의존성은 루트 lockfile에서
관리하고 루트의 admin 전용 실행·검증 명령과 기존 통합 dev 감독기로 실행한다.
backend NodeNext 타입 검사와 frontend bundler 타입 검사를 나누며 루트 typecheck는
두 검사를 모두 실행한다. Sites 어댑터·패키징·관련 테스트의 내용은 그대로 이전한다.
수집 API·인증 제공자·DB·원격 라우팅 계약을 앱 이전만으로 바꾸지 않는다.

`prototypes/admin`에는 초기 디자인 QA와 이전 위치 안내만 남긴다. 실행 가능한 관리자는
한 곳에서만 유지한다. 기본 주소와 OIDC callback은 API 모드로 시작하고 샘플은
명시적인 `/demo`·`/demo/` 경로에서만 제공한다. 실제 제공자 로그인·배포·서비스
파일럿을 검증하기 전에는 운영 완료라고 표시하지 않는다.

## 검증과 되돌리기

`npm run check:admin`, 루트 typecheck와 실제 로컬 collector/admin 통합 실행을 확인한다.
실행 경로 변경 후 401 JSON 응답·SPA callback 경로와 두 서버 종료를 검증한다.
이전 커밋을 되돌리면 소스 경로·실행 명령·lockfile을 함께 복원해야 하며 데이터 변경은
없다. 배포는 이 결정에 포함하지 않는다.

## 같은 출처 API 경로 — 2026-10-11

관리자 Worker는 정적 자산과 `/v1`·`/v1/*` API를 함께 제공한다. API는 고정
`COLLECTOR` HTTP 서비스 바인딩으로 별도 수집기 Worker에 전달한다. 관리자·발행자
인증과 프로젝트 권한 검사는 수집기가 맡는다. 임의 외부 URL을 전달 대상으로 받지 않는다.
경로·쿼리·본문·Authorization·Origin은 유지하고 본문을 버퍼링하지 않는다.
호출은 한 번만 하며 리다이렉트·자동 재시도·API 캐시를 사용하지 않는다.

`assets.run_worker_first`가 정적 자산과 충돌하는 API 경로도 우선한다. 수집기의
응답 상태·본문·헤더를 유지하고 API 응답은 `no-store`로 둔다. 바인딩 누락·호출
예외는 고정 `admin_api_unavailable` 503 JSON이고 HTML로 대체하지 않는다.
callback·demo 등 앱 탐색만 기존 HTML fallback을 쓰고 누락 JS는 404다.

실제 타깃은 `admin:config`로 운영자가 제공한 계정·Worker 이름·공개 진입점을 받아
새 파일만 만든다. 자기 Worker로 연결하는 설정과 공개 진입점 없는 설정은 거부한다.
운영 인증·원격 리소스·배포는 후속이다. Sites에도 같은 Worker를 싣지만 기본 Sites
hosting 설정에는 `COLLECTOR` 바인딩이 없으므로 API 운영 연결은 Wrangler 구성으로 검증한다.

호환성 날짜는 기존 검증 베이스라인 `2026-08-06`을 유지한다. 현재 Miniflare는
`2026-10-11`을 거부하므로 승격은 도구 갱신과 함께 별도로 검증한다. 로그·query
redaction·자동 invocation 로그/trace 비활성화는 기존 프라이버시 정책을 유지하고
어댑터는 예외 원문·요청·토큰을 로그에 쓰지 않는다.

근거: [서비스 바인딩 HTTP](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/),
[정적 자산 Worker 우선 경로](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).
