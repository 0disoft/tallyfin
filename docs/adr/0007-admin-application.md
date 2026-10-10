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
