# 검증 이력 10

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

## 설정 묶음 기반 관리자 빌드 — 2026-10-11

`admin:build-configured`는 설치 스냅샷을 다시 검증하고 네 설정 파일과 비교한 뒤
공개 로그인 값만 Vite define으로 주입한다. `.env`·부모 `VITE_` 값·개발 proxy는
제외하고 production 모드로 새 `admin-assets`에 빌드한다. 기존 산출물·기본 앱 dist는
덮어쓰지 않는다. 성공 기록은 `admin-build.json`이며 실패한 부분 파일은 보존한다.
admin dry-run은 선택 config 하나만 전달하고 dry-run을 고정하며 원격·중복 옵션을 거부한다.

실행·통과: `node --test --test-timeout=30000 tools/runtime/test/configured-build.test.ts
apps/admin/tests/local-proxy.test.mjs` 3/3. 실제 관리자 앱을 임시 설치 디렉터리에
production 빌드했다. 부모 NODE_ENV=development·상이한 VITE client ID·불필요한
VITE 값·원격 개발 proxy 환경을 넣어도 승인 client/issuer만 번들에 있고 DB/account ID·
JWKS 설정·환경 sentinel은 없었다. 실제 manifest의 초기 gzip JS는 100KiB 이내이고
로그인 청크는 지연 로딩이다. 두 설정이 다른 경우·32KiB 초과·누락 설정을 거부하고
검증 실패 전 자산을 만들지 않았다. 재빌드는 이전 자산/성공 기록을 보존한다.

추가 실행·통과: 루트 `npx --no-install tsc --noEmit`, 로그인·설치 검사 12/12,
기본 관리자 빌드와 번들 검사 2/2, 계약 검사 53/53, 기본 admin dry-run.
백엔드 전체 검사는 소스가 바뀌지 않아 반복하지 않았다.

같은 검사는 생성한 관리자 config를 지정해 실제 설치 Wrangler dry-run을 수행했다.
새 자산과 지정 test collector 바인딩을 패키징했고 업로드는 없었다. 원격 플래그와
중복 config 옵션은 Wrangler 호출 전에 거부했다. 런타임 키·운영 자격 증명은 쓰지 않았다.
실제 로그인 제공자·remote D1·grant·DNS·서비스 연결·배포는 설정 미정이라 미실행이다.
API·DB·SDK·의존성·CI·위생 정책 변경과 푸시는 없다. 설치/앱/개발 안내·로드맵과 검증
기록을 갱신했다. Vite proxy 변경은 개발 서버에만 적용되며 위 실제 proxy 검사도 통과했다.

## 운영 설치·로그인 설정 묶음 — 2026-10-11

`install:prepare`는 관리자·수집기·공개 OIDC login 설정을 함께 검증하고 새 디렉터리에
두 Wrangler config·공개 login JSON·제공자 등록 요구 값·입력 스냅샷을 쓴다. 계정·
서비스 바인딩·관리자 HTTPS 출처·issuer 일치를 검사한다. 비밀 키·추가 키·잘못된
scope/알고리즘·32KiB 초과·기존 출력·원격 플래그는 거부하며 서버·DB 값은 공개 login
설정에 복사하지 않는다. 원격 작업과 discovery는 실행하지 않는다.

실행·통과: 설치·관리자 타깃·수집기 타깃의 집중 검사 9/9(설치 신규 3개),
루트 `npx --no-install tsc --noEmit`, 계약 검사 53/53. 검사는 격리된 문법용 식별자로 두 설정의 일치·
callback/CORS·resource와 audience 구분·프론트엔드 값 분리·잘못된 조합·검증 전 쓰기
없음·덮어쓰기 거부·원문 없는 CLI 오류를 확인했다. 실제 제공자·원격 계정/도메인/DB·
로그인·grant·배포는 값이 미정이라 미실행이다. 프론트엔드·수집기 동작을 바꾸지 않아
해당 전체 검사는 반복하지 않았다. API·DB·SDK·의존성·CI·위생 정책 변경과 푸시는 없다.
OIDC·런타임 안내·로드맵·설치 안내와 검증 기록을 갱신했다.

## 관리자 Worker 같은 출처 API 경로 — 2026-10-11

관리자 Worker는 `/v1`·`/v1/*`를 정적 자산보다 우선해 고정 `COLLECTOR` 서비스
바인딩으로 전송한다. 경로·쿼리·Origin·Authorization·쓰기 본문과 응답을 유지하고,
스트리밍으로 한 번만 호출하며 리다이렉트·자동 재시도·API 캐시는 사용하지 않는다.
바인딩 누락·호출 예외는 고정 503 JSON이고 HTML fallback을 거치지 않는다.
HEAD 오류 본문은 없고 `Retry-After: 5`를 보낸다. 화면에서도 저장소 오류와 구분한다.
실제 계정·Worker·공개 진입점을 받는 로컬 전용 `admin:config`, 기본 Wrangler config,
타입 생성/checkJs와 dry-run 명령을 추가했다.

실행·통과: `npm run check:admin`(타입 검사, 테스트 156/156, 빌드, 번들 2/2,
Sites/게이트웨이 검사 9/9), 루트 `npm run typecheck`(수집기·관리자 타입 생성 포함),
`node --test --test-timeout=30000 tools/runtime/test/admin-target.test.ts apps/admin/test/edge.test.ts`
4/4, 계약 `npm run check` 53/53, `npm run admin:dry-run`(업로드 없음).
단위 검사는 메서드·Accept와 무관한 API 예약, 본문·쿼리·헤더 유지, upstream
401/403/404/409/429/503/307 유지, 예외 고정 메시지, callback/demo/v10 분리와 누락 JS
404를 확인했다. 설정 검사는 자기 바인딩·불완전 진입점·추가/비밀 키·잘못된 도메인·
출력 덮어쓰기·8KiB 초과·원격 플래그를 거부했다.

실제 로컬 Miniflare Worker 두 개와 임시 D1에 모든 마이그레이션·프로젝트·grant를
적용했다. 메모리에서 만든 단기 테스트 JWT/JWKS로 무인증 401·owner 200·grant 회수 후
403을 확인했고, 충돌하는 API 정적 파일이 있어도 API가 우선했다. 없는 API는 HTML
Accept에도 404 JSON이며 callback/demo/v10은 HTML이고 없는 JS는 404였다.
검증 런타임과 임시 디렉터리는 finally에서 정리한다. 원격 리소스·운영 자격 증명을 쓰지 않았다.

초기 신규 날짜 `2026-10-11`은 현재 Miniflare가 미래 호환성 날짜 오류로 거부했다.
기존 검증 베이스라인 `2026-08-06`으로 config·타깃·검사를 맞춘 뒤 위 검사를 통과했다.
호환성 날짜 승격은 도구 갱신과 함께 별도 검증한다. traces/자동 invocation 로그를 끄고
query redaction을 유지하는 것은 기존 개인정보 정책을 따른다.

ADR 0007·런타임 안내·로드맵·앱 안내와 이 검증 기록을 갱신했다. API·DB·마이그레이션·
SDK·의존성·CI 러너·위생 정책 변경은 없고 루트 실행/타입 명령만 추가했다.
백엔드 전체 검사는 변경 범위 밖이라 반복하지 않았다. 실제 OIDC 제공자·원격 서비스
바인딩·DNS·D1·배포·Sembom 활성화는 값이 미정이라 미실행이다. 푸시는 하지 않았다.
다음은 운영 로그인 구성과 설치 절차 정리다.

## 운영 API 기본 진입·데모 분리 — 2026-10-11

`apps/admin`의 기본 주소와 `/auth/callback`은 API 관리자 모드로 시작한다.
`/demo`·`/demo/` 경로에서만 Sample/API 전환을 제공하고 제목에 샘플 데모를 표시한다.
일반 주소의 쿼리를 모드 선택에 사용하지 않는다. 실제 관리자 진입에는 가상 프로젝트·
샘플 KPI·Sample 버튼이 없으며 인증 미설정 상태는 기존 비활성화 안내를 사용한다.

실행·통과: 루트 `npm run check:admin`(타입 검사, 테스트 155/155, 빌드, 번들 검사 2/2,
Sites 검사 4/4), 변경한 실제 stack 검사 2/2, 계약 `npm run check` 53/53. stack은 관리자 제목·demo HTML·callback
경로·프록시된 401 JSON과 종료를 확인한다. 프로덕션 preview/Chromium에서 기본 주소의
로그인 진입·Sample 버튼 0개·샘플 지표 0개, `/demo`의 샘플 지표와 제목·모드 전환,
`/?mode=sample`의 API 유지, callback error 쿼리 제거, 콘솔 오류 0건과 CSS 320px의
문서 폭 320px를 확인했다. 증거는 ignore된 `.tmp/admin-workspace-ui/operational-entry.jpg`·
`demo.jpg`에 둔다. 검증 탭·서버는 종료했다.

ADR·설계·로드맵·앱 안내를 갱신했다. API·DB·마이그레이션·SDK·의존성·CI 러너·위생
정책 변경은 없다. 백엔드 전체 검사는 반복하지 않았고 운영 OIDC·원격 DB·배포·Sembom
활성화는 미실행이다. 푸시는 하지 않았다. 다음은 운영 같은 출처 경로와 인증 설정이다.

## 관리자 앱 워크스페이스 이전 — 2026-10-11

기존 관리자 소스·자산·설정·검사를 `apps/admin`으로 이전하고 private workspace
`@tallyfin/admin`으로 등록했다. React/Vite 채택과 범위는 ADR 0007에 기록했다.
`prototypes/admin`에는 초기 디자인 QA와 이전 안내만 남긴다. 관리자 의존성은 루트
lockfile에 통합하고 별도 prototype lockfile을 제거했다. 캐시를 사용한
`npm install --ignore-scripts --offline --no-audit --no-fund`로 설치했다. 관리자 직접
의존성 13개의 버전이 모두 이전 lockfile과 일치함을 확인했다.

루트 `dev:admin`·`build:admin`·`typecheck:admin`·`test:admin`·`check:admin`을 추가했다.
통합 dev 감독기는 새 앱의 dev-local을 실행한다. 루트 NodeNext 타입 검사에서 admin은
제외하고 별도 bundler/React 타입 검사를 루트 typecheck에 연결한다. 이전 단계의
Sample/API 전환 동작은 유지하며 API 기본·데모 분리는 다음 슬라이스다.

실행·통과: 루트 `npm run check:admin`(타입 검사, 관리자 테스트 155/155, 빌드,
번들 검사 2/2, Sites 검사 4/4), `npm run typecheck`,
`node --test --test-timeout=30000 tools/runtime/test/stack.test.ts` 2/2.
통합 검사에서 실제 로컬 D1 초기화·등록 후 SPA·auth/callback·프록시된 관리자 401 JSON,
두 서버 정상 종료·형제 프로세스 실패 시 종료와 계약 `npm run check` 53/53을 확인했다. Sites hosting 설정·worker·
패키징 스크립트·Sites 테스트 4개 파일의 내용이 이전 경로와 byte 단위로 같았다.
첫 JS는 262,512 B로 코드 분리 결과를 유지했다.

실제 루트 `npm run dev:admin -- --host 127.0.0.1 --port 5186 --strictPort`와 Chromium으로
샘플 설정·API 로그인 진입, 설정 없는 로그인 비활성화, callback error 쿼리 제거를
확인했다. 콘솔 오류 0건, CSS 320px에서 문서 폭 320px였다. 증거는 ignore된
`.tmp/admin-workspace-ui/login.jpg`·`mobile.jpg`에 있다. 검증 탭·서버는 종료했다.

앱 경로·워크스페이스/타입 검사·개발 실행·의존성 소유권과 ADR·명세·로드맵·설계·실행
안내를 변경했다. API·DB·마이그레이션·SDK·의존성 버전·CI 러너·위생 정책은 바꾸지 않았다.
전체 백엔드 회귀 검사는 반복하지 않았고 영향받은 실제 stack만 검사했다. 운영 인증·
원격 D1·배포·Sembom 활성화는 환경 연결 전으로 미실행이며 푸시도 하지 않았다.

## 관리자 화면 코드 분리 — 2026-10-11

`App`에서 API 관리자 모드를 지연 로드하고 `LiveDashboard`에서 설정 작업 공간·목표·
프로젝트 생성 화면을 지연 로드한다. 진단·설정·권한·이력·스키마·SDK 안내를
`LiveSettingsWorkspace`로 추출했다. 부모 client·선택 프로젝트·조회 상태는 유지하고
projectId key로 설정 컨트롤러를 교체한다. `DeferredPanel`은 로딩·청크 실패 안내와
새로고침을 제공하며 새로고침 때 초안·직접 연결 토큰의 초기화를 안내한다.
OIDC callback URL 정리는 첫 엔트리에 유지한다.

같은 Node gzip 설정으로 첫 JS를 비교했다. 524,427 B / gzip 142,248 B에서
262,512 B / gzip 78,634 B로 감소했다(원본 49.94%, gzip 44.72%). 모든 JS 파일의
합계는 약 911 kB이며 로딩 시점 분리다. 500 kB 경고는 없어졌고 LiveDashboard는
38,139 B다. Vite manifest를 생성하고 빌드 후 별도 `npm run test:bundle`로 첫 정적
그래프 gzip 100KiB·개별 JS 500kB 예산과 설정/목표/생성/로그인/차트의 지연 경계·
CSS 자산 존재를 검사한다. 일반 테스트는 빌드를 요구하지 않고 CI 러너는 바꾸지 않았다.

실행·통과: 관리자 `npm run typecheck`, `npm test` 155/155, `npm run build`,
`npm run test:bundle` 2/2, `npm run test:sites` 4/4, 계약 `npm run check` 53/53.
Vite preview의 프로덕션 자산을 Chromium으로 확인했다. 캐시를 끈 첫 Script 요청은
index·TrendChart뿐이고 API 모드 진입 때 LiveDashboard·client·OidcLogin이 추가됐으며
설정/목표/생성 코드는 요청되지 않았다. 로그인 전 endpoint 초안은 설정 메뉴 전환에도
유지됐다. 실제 제공자 로그인은 실행하지 않았다. CDP로 LiveDashboard 파일만 임시
차단해 오류 경계·새로고침 버튼을 확인했고 차단 해제 후 새로고침으로 정상 복구했다.
차단·cache override는 복원했다. 새 탭 정상 진입의 콘솔 오류 0건, CSS 320px에서
document scrollWidth 320px였다. 스크린샷은 ignore된
`prototypes/admin/.tmp/admin-split-ui/`, 크기 기록은 `.tmp/admin-split-result.json`에 둔다.
Web Vitals trace 도구가 없어 LCP·INP·CLS 개선이나 운영 지연 수치는 측정하지 않았다.

설계·로드맵·프로토타입 안내를 갱신했다. API·DB·마이그레이션·SDK·의존성·위생 정책은
변경하지 않았고 백엔드 실행 테스트는 반복하지 않았다. 검증 탭·preview 서버는 종료했다.
운영 인증·원격 D1·배포·Sembom
활성화는 미실행이고 푸시도 하지 않았다. 다음은 운영 관리자 앱 구조 정리다.

## 관리자 퍼널 단계 편집 폼 — 2026-10-11

`LiveSchemas`에 `SchemaFunnelForm`과 공유 JSON 초안 변환기를 연결했다. 퍼널 ID·표시
이름·출처별 이벤트 선택, 단계 추가/삭제·순서 변경, 필수 속성 비교 기준을 편집한다.
기존 서버 검증·개인정보 검토·새 버전 발행을 사용하며 편집 때 승인을 초기화한다.
표현 불가 JSON과 추가 키·미완성 참조·이벤트/속성/작업 흐름은 보존한다. 단계마다 이름과
출처를 함께 설정하고 오류 경로·추가/삭제/이동 후 포커스를 해당 필드로 연결한다.

실행·통과: 관리자 `npm run typecheck`, `npm test` 155/155(신규 7개), `npm run build`,
`npm run test:sites` 4/4, 루트 `npm run typecheck`, 계약 `npm run check` 53/53. 집중 폼·스키마 검사 30/30은 실제
코어 validator로 중복·출처·단계/퍼널 수·필수 도메인·32KiB 경계와 발행 승인 재설정·reader
잠금을 검증했다. 메인 관리자 번들은 524.42 kB(gzip 143.48 kB)이고 기존 500 kB 경고는
후속 앱 분리·성능 개선으로 남긴다.

127.0.0.1:5186의 임시 검증 페이지에서 실제 `LiveSchemas`·`SchemaEditor`·폼과 실제 코어
validator에 합성 API 응답만 제공했다. 실제 자격 증명·운영 API는 쓰지 않았다. 브라우저에서
단계 이동 후 포커스, 추가·중복 이벤트 오류 필드 포커스, 삭제 후 정상 검증·개인정보
확인·v2 발행, 새 퍼널 추가/삭제와 승인 초기화, 중복 ID 오류, reader 제어 잠금,
깨진 JSON 보존과 복구를 확인했다. 기존 90% 확대의 CSS innerWidth 320px에서 문서
scrollWidth 303px로 가로 넘침이 없었고 단계 select는 225px·16px 글꼴이었다.
최종 코드를 새로고침한 뒤 콘솔 오류 0건이다. 검증 탭·서버를 종료하고 임시 페이지 코드는
삭제했다. 스크린샷은 ignore된
`prototypes/admin/.tmp/funnel-form-ui/desktop.jpg`·`mobile.jpg`에 보관한다.

명세·로드맵·ADR·프론트엔드 설계·프로토타입 안내를 갱신했다. API·DB·마이그레이션·SDK·
의존성·CI 러너·위생 정책 변경은 없다. 백엔드가 변경되지 않아 백엔드 실행 테스트는
반복하지 않았다. 운영 인증·원격 D1 연결은 환경 미설정으로 실행하지 않았고 푸시·배포·
Sembom 활성화는 하지 않았다. 다음은 운영 관리자 앱 정리와 코드 분리·성능 개선이다.

## 관리자 퍼널 분석 화면·CSV 연결 — 2026-10-11

API 연결 목표 화면에 `LiveGoals`·`LiveFunnels`를 연결했다. 퍼널 선택 전에는 요청하지
않고, 선택한 등록 정의의 모든 출처·차원 조합을 함께 표시한다. 단계별 이벤트/출처·도달
수·첫 단계 대비 도달률·직전 대비 전환율·다음 미도달 수와 일별 요약·날짜별 단계 표를
연결했다. 잠정값 안내를 결과 근처에 두고 미도달을 실패로 분류하지 않는다. 퍼널 CSV는
기존 작업 흐름 CSV와 별도이며 작업 흐름 없는 목표에는 기존 CSV/기간 비교를 숨긴다.

조회 effect는 선택 해제 때 cancel하고 context·client 소유 가드로 이전 표/CSV를 숨긴다.
같은 퍼널 재선택도 스냅샷을 즉시 비운다. cancel/dispose·늦은 응답을 테스트했고 목표
렌더링을 추출해 `LiveDashboard.tsx`는 40,575 B에서 39,027 B로 줄였다.

실행·통과: `prototypes/admin`의 `npm run typecheck`, `npm test` 148/148(퍼널 신규 8개),
`npm run build`, `npm run test:sites` 4/4. 마지막 표 선택 스타일·잠정값 안내·기존 비교
범위 표시 보완 후 typecheck·build·Sites 패키징 검사를 다시 통과했다. 관리자 메인 번들
510.27 kB(gzip 141.23 kB)의 500 kB 경고는 남았으며 후속 성능 정리 대상이다.

로컬 Vite 127.0.0.1:5186과 Codex 인앱 Chromium에서 실제 App→LiveDashboard→LiveGoals→
LiveFunnels에 합성 transport만 주입했다. 실제 자격 증명 없이 API 연결·목표 이동·등록
퍼널 선택, 91회 시작/42회 완료·단계별 browser/server 표시, 일별 날짜 선택 내역, 403과
응답 합계 오류 후 표 제거/CSV 잠금, 정상 재시도, 0건의 null 비율 표시, 지연 중 CSV
잠금·선택 해제, 프로젝트/기간 전환 선택 초기화, 연결 해제 후 표 제거를 확인했다.
실제 CSV를 내려받아 요약 4행·일별 28행과 source·미지 비율 빈 셀을 확인했다.

기존 90% 확대를 유지한 CSS innerWidth 320px(뷰포트 288px)에서 문서 scrollWidth 320px,
표 영역 288px/내용 797px, 표 셀 18px였다. 키보드 ArrowRight 내부 스크롤을 확인했다.
뷰포트는 복원하고 검증 탭·서버는 종료했다. HMR 중 hook 의존성 배열 크기 변경 경고가
1건 발생했으며 최종 코드를 새 탭에서 로드한 뒤 콘솔 오류는 없었다. 증거는 ignore된
`prototypes/admin/.tmp/funnel-report-ui/desktop.jpg`·`mobile.jpg`·`download.csv`에 있다.

명세·로드맵·ADR·프론트엔드 설계·프로토타입 안내를 갱신했다. API·DBML·마이그레이션·
SDK·의존성·CI 러너·위생 정책 변경은 없다. 루트 `npm run typecheck`도 통과했으며,
백엔드는 변경하지 않아 백엔드 테스트는 반복하지 않았다. 운영 OIDC·원격 D1은 환경
연결 전이라 실행하지 않았다. 푸시·배포·Sembom
활성화는 없다. 다음은 기존 JSON 초안/검증/발행을 사용하는 퍼널 단계 편집 폼이다.

## 관리자 퍼널 조회·CSV 계층 — 2026-10-11

관리자 `ApiClient.getFunnelDaily`에 같은 출처·메모리 bearer·취소·no-store 전송을 연결했다.
닫힌 응답의 날짜·정의·단계 건수·분모·합계·잠정값을 검증하고 선택한 레지스트리와
다르면 표시하지 않는다. `FunnelReport`는 새 요청·오류에서 이전 데이터를 지우고 취소와
세대 번호로 늦은 결과를 폐기한다. CSV는 검증한 요약/일별 전체 단계, 각 단계 출처,
미지의 비율 빈 셀과 잠정값 여부를 담으며 기존 UTF-8 BOM·수식 방어 직렬화를 재사용한다.

`prototypes/admin`의 `node --test src/api/funnel-analysis.test.mjs` 7/7와 `npm run
typecheck`를 실행해 통과했다. 날짜/합계/비율 불일치·0 분모·DST 잠정값 경계·선택 정의
불일치·403·재시도·취소·늦은 응답·dispose·CSV 수식 방어를 확인했다. 화면 연결 전 조회
계층 검증이며 실제 브라우저 화면·다운로드는 다음 UI 작업에서 확인한다.

OpenAPI·DBML·마이그레이션·SDK·의존성·CI 러너·위생 정책은 바꾸지 않았다. API·DB를
변경하지 않아 백엔드 검증은 반복하지 않았고 운영 인증·원격 DB·배포·Sembom 연동은
환경 연결 전이므로 실행하지 않았다. 푸시는 하지 않았다.

## 작업 퍼널 일별 조회 API — 2026-10-11

`GET /v1/projects/{projectId}/funnels/{funnelId}/daily`와 코어 응답 타입, D1 조회·응답
투영을 추가했다. 프로젝트·스키마·단계 건수를 같은 D1 batch에서 reader/owner grant로
검사하며 모든 차원 조합과 등록 단계 출처를 함께 센다. 응답의 meta에는 단일 source를
넣지 않고 등록 definition에 단계별 출처를 둔다. 시작일 기준 최대 31일을 채워 반환하고,
기간 전환율은 합산한 건수로 계산한다. 0 분모는 null, 첫 단계 conversionRate와 마지막
단계 notReachedNext도 null이다. 잠정값은 프로젝트-local 날짜 끝 + 48시간까지다.

실행·통과:
- `node --test --test-timeout=30000 apps/collector/test/funnel-query.test.ts`: 8/8.
  실제 로컬 D1에 browser/server 역순 수집·새 eventId 단계 재시도, 시작일 귀속, 차원 합산,
  빈 날짜, 서버 전용 정의, reader/owner와 publisher 권한 분리, 준비 후 권한 회수,
  retired/paused·프로젝트/버전 격리, 정의 없는 버전, 31일·90일 경계, 잠정값 경계,
  405와 불허 source/groupBy, 안전 정수 경계·합산 초과·저장 실패를 확인했다.
  응답 투영은 중복/범위 밖 행과 날짜별 단계 순서 위반을 별도로 거부한다.
- `node --test --test-timeout=30000 apps/collector/test/admin.test.ts apps/collector/test/server-query.test.ts apps/collector/test/funnels.test.ts packages/storage-d1/test/funnels.test.ts packages/core/test/funnel*.test.ts`: 39/39.
  기존 관리자·서버 출처 조회와 실제 Worker/D1 수집·원자 저장·정리를 회귀 검증했다.
- 루트 `npm run typecheck` 통과. 마지막 테스트 보완 후 `npx --no-install tsc --noEmit`와
  `npx --no-install tsc -p apps/collector/tsconfig.runtime.json`도 통과했다.
- `tools/contracts`의 `npm run lint`(OpenAPI) 오류·경고 없음, `npm run check` 53/53.
  새 응답 예제·닫힌 형태·분모·날짜 개수·개인 식별자 제외 계약을 확인했다.
- `git diff --check` 통과. 문서 링크 검사도 마지막 문서 변경 후 통과했다.

API source of truth `api/openapi.yaml`과 예제·계약 검사를 변경했다. DBML·마이그레이션·
SDK·의존성·CI 러너·저장소 위생 정책은 변경하지 않았다. 관련 범위만 검사했고 전체
릴리스 검사·운영 OIDC/원격 D1·부하·관리자 브라우저 검증은 이번 로컬 API 변경 범위에서
실행하지 않았다. 푸시·배포·Sembom 활성화도 없다. 관리자 퍼널 화면·CSV는 다음 작업이다.

## 관리자 퍼널 SDK 코드 생성 — 2026-10-11

`sdkSetup`은 기존 세 인자 호출을 유지하고 선택 profile·funnelId를 받는다. 브라우저는
일반 이벤트/workflow가 기본이며 별도 퍼널 프로필을 고르면 `/funnels` 엔트리의 팩토리와
source별 압축 정의를 만든다. 서버 안내도 등록된 서버 참여 퍼널을 투영한다. 다른 출처의
단계 이름·규칙은 null 위치로만 남긴다. 선택 퍼널의 source별 사용 예제는 주석으로만
생성하며 등록된 필수 속성의 예시 값·작업 링크 전달·원래 발생 시각·서버 eventId 보존과
실제 단계 발생 뒤 발행할 조건을 안내한다. 생성만으로 이벤트나 인증 요청을 보내지 않는다.

`LiveSdkSetup`에 브라우저 SDK 종류와 source별 퍼널 예제 선택을 연결했다. 일반 프로필과
기존 workflow를 자동 전환하지 않는다. 유효하지 않은 이전 선택은 현재 등록에 맞춰
대체하고, 복사 상태는 client·조회 key·현재 코드에 묶어 늦은 결과를 새 코드에 표시하지
않는다. 실제 연결 수집 미지원이라는 오래된 문구를 제거했다.

관련 generator·프로젝트 생성·서버 안내 테스트 18/18, 관리자 typecheck·build와 생성된
브라우저/서버 TypeScript의 실제 패키지 선언 소비자 컴파일을 통과했다. 생성 코드와
고정 endpoint를 합친 최초 gzip 3091 bytes가 예산을 넘겨 SDK 내부 Batch의 여섯 필드만
`__tfBatch` 예약 이름으로 표시하고 빌드 때 짧게 만든다. HTTP 본문·공개 SDK 키는 그대로다.
이 최적화는 별도 로컬 커밋으로 나눴다. 브라우저 SDK·빌드·HTTP·native Worker/D1
48/48, 루트 typecheck·브라우저 build·크기 검사를 통과했다. 새 빌드 테스트 2개는
여섯 내부 키만 압축하는지, source와 압축 번들의 workflow/funnel 바디·ID·재시도·
destroy가 같은지 확인한다. generator의 새 1개 테스트는 dist가 없는 checkout에서도
source를 빌드해 고정 endpoint와 설정을 포함한 3072-byte 예산을 검사한다.
일반 SDK gzip 2743·Sembom 3022·퍼널 SDK 2912·참조 예제 3038 bytes다. 설치용 패키지에서
관리자 생성 코드를 번들한 실측도 gzip 3063 bytes로 한도 안이다. 생성/조회 외 관리자
흐름과 HTTP/DB 계약을 바꾸지 않아 전체 저장·관리자 테스트는 반복하지 않았다.
인앱 Chromium·직접 띄운 로컬 Vite(127.0.0.1:5185)에서 공개 예제 정의와 토큰 없는 합성
클라이언트를 실제 LiveSdkSetup에 연결했다. 기본/퍼널 프로필·server source·출처별
이름 분리·퍼널 예제·복사·프로젝트 전환 후 새 endpoint와 이전 코드/상태 제거를 확인했다.
뷰포트 360을 요청했지만 브라우저 실제 innerWidth는 400이었다. 관찰한 400px 화면에서
문서 scrollWidth 383으로 페이지 가로 넘침이 없고 코드 영역은 읽기 전용이었다.
새 콘솔 오류는 0이며 desktop/mobile 화면은 ignore된
`prototypes/admin/.tmp/funnel-setup-ui/`에 저장했다. 코드 갱신 후 폼 상태가 초기화되어
복사 버튼 조회가 한 번 실패했고, 현재 상태를 확인한 뒤 입력해 복사를 확인했다.
검증 서버·탭을 종료하고 임시 HTML·TSX·예제 JSON을 지웠다. 계약 검사 51/51·문서 링크·
`git diff --check`도 통과했고 문서 링크 검사 대상에 프론트엔드 설계를 추가했다.

제품 명세·로드맵·ADR·브라우저 SDK 안내·프론트엔드 설계를 갱신했다. HTTP API·DB 계약·
마이그레이션·의존성·CI·호스팅 파일 변경은 없다. 운영 인증·원격 DB·서비스 적용·푸시·
배포는 실행하지 않았다. 다음은 reader/owner 퍼널 조회 API와 관리자 단계 집계 화면이다.

## 선택 브라우저 퍼널 SDK — 2026-10-11

`@tallyfin/browser/funnels`에서 별도 `createTallyfinFunnels` 진입점을 제공한다.
빌드 시점의 브라우저 투영은 서버 단계 이름·규칙을 넣지 않고 null 위치만 유지한다.
`createFunnelRun`은 작업마다 무작위 UUID·시작 시각을 복사·동결하며 이벤트를 만들지
않는다. `trackFunnel`은 등록된 브라우저 단계·유한 속성·UTC 링크·24시간 창을 검사하고
공통 메모리 전송 큐를 사용한다. 첫 단계는 시작 시각과 일치하고, 수동 재전송은 원래
발생 시각을 명시해야 한다. 일반 track은 퍼널 단계 이름을 거부한다. 기존 workflow SDK의
공개 API는 유지하며 두 프로필은 각자의 번들에 다른 프로필을 넣지 않는다.
공통 스키마 직렬화도 한 번만 실행해 크기를 검사한 바로 그 스냅샷을 검증한다.

브라우저 SDK·서버 퍼널 SDK·HTTP·native Worker/D1 관련 52/52 테스트를 통과했다.
마지막 테스트 보완 후 해당 8/8을 다시 통과했다. 스키마 단일 스냅샷 검증을 추가하고
브라우저 퍼널 8/8을 통과했으며 변경 없는 나머지 결과를 재사용해 총 53개를 확인했다.
브라우저 퍼널 테스트 8개는 투영·신규 작업·시작 시각·불변 입력·바이트 동일 재시도·
수동 복원·경계·잘못된 링크와 설정·비활성/파괴를 확인한다. 실제 로컬 D1 통합은
브라우저 SDK와 Node/Worker 서버 SDK를 같은 run에 연결하고 역순 수신·응답 유실·
분류 충돌·발행자 권한 회수를 확인한다. 브라우저 단계의 새 ID 재전송도 중복으로
처리해 영수증은 늘지만 이벤트 합계 4·각 단계 도달 수 1을 유지한다.

`npm run typecheck`·`npm run build:browser`·`npm run check:browser-size`와 두 공개
패키지 경로의 선언 소비자 컴파일을 통과했다. 기본 SDK gzip 2772 bytes·Sembom 포함
3053 bytes, 퍼널 SDK 2942 bytes·예제 설정 포함 3068 bytes로 각각 3072 bytes 예산 안이다.
계약 검사 51/51·문서 링크·`git diff --check`도 통과했다. 문서 링크 검사 대상에
브라우저 SDK 안내를 추가했다. 선언 소비자 검사는 TypeScript 7의 `--ignoreConfig` 없이 첫 실행이 실패했고 옵션을
명시한 재실행으로 통과했다. HTTP/DB 계약·마이그레이션·의존성·CI 변경은 없다.
운영 인증·원격 DB·실서비스 설치·푸시·배포는 실행하지 않았다. 관리자 SDK 코드 생성과
퍼널 조회 API·집계 화면은 후속이다.

## 브라우저 SDK 내부 전송 분리 — 2026-10-11

기존 공개 타입을 types.ts, 공통 검증·전송·수명 주기 처리를 common.ts로 분리하고
index.ts에는 workflow 검증과 track/start 진입점을 남겼다. 내부 enqueue의 연결 필드를
공통화했으며 기존 workflow의 {attempt} 형식과 공개 BrowserClient API는 유지한다.
빌드 tsconfig에 allowImportingTsExtensions를 추가하고 타입 전용 .js import로 선언 생성을
유지했다. 브라우저 퍼널 모듈은 아직 후속이다.

`npm run build:browser`·`npm run check:browser-size`·`npm run typecheck`와
`node --test packages/browser/test/*.test.ts apps/collector/test/collector.test.ts` 37/37
(SDK 19개·HTTP 18개)이 통과했다. 기본 SDK gzip 2774 bytes·SDK+Sembom 3053 bytes로
이전 2667·2949 bytes보다 증가했지만 둘 다 3072 bytes 예산 안이다.
공개 API·HTTP/DB 계약·CI 변경은 없다. 운영 인증·원격 DB·배포는 검증하지 않았고
푸시·배포도 실행하지 않았다.
