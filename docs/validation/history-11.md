# 검증 이력 11

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

## 서버 SDK 퍼널 연결 전송 — 2026-10-11

서버 SDK에 선택 funnel 링크·createFunnelRun과 서버 참여 퍼널의 스키마 투영을 연결했다.
브라우저 단계는 null로 위치만 남기고 브라우저 이름·규칙·label·purpose는 투영하지 않는다.
입력을 복사·동결하고 재전송 본문·재시작 복원 metadata를 유지한다.

`node --test apps/collector/test/funnels.test.ts packages/server/test/*.test.ts` 21/21,
`node --test apps/collector/test/server-sdk.test.ts` 2/2, 합계 23개 테스트와
`npm run typecheck`를 통과했다. `npm run build:server`도 통과했고 번들 8864 bytes·gzip
3631 bytes·런타임 의존성 0이다. native Worker producer의 퍼널 SDK 전송은 서명 JWT와
실제 로컬 D1에서 중복·발행 권한 회수를 확인했고 Node는 응답 유실 뒤 중복을 확인했다.
이 결과는 서버 SDK 슬라이스만의 검증이며 브라우저 기본 SDK 바이트는 바꾸지 않았다.

`tools/contracts`의 `npm run check` 51/51과 문서 링크·`git diff --check`도 통과했다.
공개 HTTP·DB 계약·CI·의존성 변경은 없다. 운영 인증·원격 DB·푸시·배포는 실행하지 않았다.
브라우저 SDK 전송·관리자 SDK 코드 생성·퍼널 조회 API와 화면은 후속이다.

## 퍼널 연결 수집·저장과 0007 마이그레이션 — 2026-10-11

BrowserBatch·ServerBatch가 이벤트별 선택 funnel 링크를 받고, 한 이벤트에 attempt와 funnel을
함께 넣으면 거부한다. funnel 링크가 있으면 workflow로 해석하지 않는다. 연결 이벤트의
payload hash는 funnel-v1 접두사를 쓰며 funnel이 없는 기존 일반·workflow 해시는 그대로다.
코어 `prepareFunnelStage`가 등록 정의의 출처·단계 이름·24시간 창을 검사하고,
`funnel_runs`·`funnel_daily_counts`(0007)와 저장 어댑터의 `funnelStatements`가 영수증·
할당량·시도·이벤트·목표 집계·`projects.ingest_revision` CAS와 같은 D1 batch에서 연결
상태·연속 도달 단계를 반영한다. 정리는 연결 상태 72시간·단계 집계 90일을 같은 순회
한도로 지운다.

루트 `npm run check`가 타입 검사·268/268 테스트·SDK 크기 검사를 통과했다. SDK gzip
2667 bytes·SDK+Sembom gzip 2949 bytes는 예산 3072 bytes 안이다. `tools/contracts`의
`npm run lint`(OpenAPI)는 오류 없이 FunnelCounts 후속 조회 미사용 경고 1건만 남았고
`npm run check`는 51/51을 통과했다. 신규 저장 테스트 7개는 역순 browser/server 도착과
영수증·단계 재전송 중복, 실행·영수증·버전·시간 충돌의 batch 롤백, 동시 쓰기와 발행 권한
회수의 공유 revision 가드, 카운터 상한·SQL 시각/순서 가드의 부분 반영 방지, 20 runs·
10 steps·20 dimensions 지연 시작의 100 bind·50 statement 예산, 선택 프로젝트만 지우는
bounded cleanup, 0007 추가 전용과 트리거 누락 감지를 확인한다. native Worker 실제 D1
ephemeral·서명 JWT HTTP 통합 1개는 공개 browser 단계와 인증 server 단계를 같은 run에
연결해 저장하는 것을 확인한다.

OpenAPI·DBML 계약, 코어·저장 어댑터와 수집기 통합 테스트, 0007 마이그레이션과 계약 검사 스크립트를
바꿨다. 제품 스펙·로드맵·이벤트 계약·저장 모델·정리·마이그레이션·서버 이벤트 문서도
함께 갱신했다. 의존성·CI 워커플로·위생 정책 변경은 없다. 원격 D1 적용·운영 OIDC·푸시·
배포·Sembom 연동은 실행하지 않았다. 다음은 브라우저·서버 SDK 전송과 reader/owner 조회
API·관리자 퍼널 집계 화면이다.

## 퍼널의 공용 수집 계획 연결 — 2026-10-11

PreparedEvent와 IngestSnapshot/Plan에 최소 퍼널 관찰·연결 상태·단계 delta를 연결했다.
planIngest가 먼저 source별 영수증 중복을 검사하고 새 영수증·프로젝트 일일 한도와 함께
작업의 연속 도달 단계를 계획한다. browser/server는 같은 runId 상태를 공유하며 일반
이벤트와 기존 workflow 계획은 유지한다. 같은 단계의 새 ID 재전송은 영수증 한도를
소모하되 이벤트/단계 집계를 더하지 않는다. 입력 snapshot은 변경하지 않는다.

타입 검사·코어 44/44 테스트·SDK 크기 검사를 통과했다. 새 2개 테스트는 역순 server
완료→browser 시작/중간→server 중간 연결, 자정 전 시작일 집계, 원래 ID/새 ID 중복,
할당량·영수증·분류 충돌과 snapshot 보존을 확인했다. SDK gzip 2667·Sembom 포함
2949 bytes를 유지한다. 현재 HTTP parser는 아직 funnel 필드를 거부하며 D1 어댑터도
내부 PreparedEvent에 funnel이 있으면 저장 연결 전에는 503으로 닫는다.

다음 커밋에서 DBML·0007·원자 저장·정리와 wire 준비 경로를 연결한다. 아직 신규 퍼널의
D1 통합은 실행하지 않았고 API·DB·SDK·화면·의존성·CI·위생 정책은 변경하지 않았다.
전체 DB/HTTP 테스트는 실제 저장 연결 커밋에서 실행한다. 푸시·배포는 없다.

## 퍼널 정의의 버전별 등록·검증·발행·읽기 — 2026-10-11

Registry·SchemaDraft·SchemaPublication에 선택 funnels를 연결했다. 공용 검증기는
기존 events/workflows 규칙 뒤에 2~10개 출처 고정 단계·최대 10개 퍼널·동일 필수
분류 도메인을 검사한다. 정의 전체의 32KiB 예산을 공유한다. 퍼널 검증을 schema로
옮겨 코어 수집 계산과 스키마 검증이 순환 import를 만들지 않게 했다.

D1의 기존 definitions_json·owner 발행·reader/owner 정의 읽기·오프라인 등록 CLI는
선택 funnels를 저장/보존한다. schemaDefinitions가 생략 필드를 추가하지 않아 기존
정의 해시·재요청 비교를 유지한다. 명시한 퍼널은 버전 불변성과 재요청 해시에 포함한다.
정의 JSON 구조만 확장했고 DBML 주석을 맞췄으며 SQL·테이블·마이그레이션은 바꾸지 않았다.

관리자 클라이언트는 출처·단계·분류 참조를 검사해 퍼널을 읽고, JSON 초안·발행 해시·
응답 유실 재확인에도 보존한다. 이벤트/속성/흐름 폼은 기존 퍼널을 버리지 않고 연결
이름·출처·필수 분류 도메인을 잠근다. 퍼널 오류는 JSON 편집에 남긴다. SDK 안내와
JSON 도움말은 정의 등록과 아직 미지원인 연결 수집을 구분한다.

관련 29/29 테스트에서 실제 로컬 D1 owner의 검증·발행·읽기·동일 재요청·충돌·잘못된
출처와 reader 제한, CLI preview/적용/재요청/다음 버전·구버전 보존을 확인했다.
이후 루트 npm run check의 타입 검사·258/258 테스트·SDK gzip 예산 검사를 통과했다.
SDK 2667 bytes·SDK+Sembom 2949 bytes를 유지한다. 관리자 관련 23/23 및 전체 테스트,
typecheck·build·test:sites 4/4 통과. 마지막 JSON 도움말 문구 수정 뒤 typecheck·build를
다시 통과했고 로직이 같은 전체 테스트는 앞의 결과를 재사용했다.
계약 lint는 유효하며 아직 경로에 연결하지 않은 FunnelEvent/FunnelCounts의 미사용
경고 2개가 남는다. 계약 check 51/51·git diff --check도 통과했다.

인앱 Chromium·로컬 Vite(127.0.0.1:5185)에서 실제 LiveSdkSetup에 토큰 없는 합성
transport와 공개 예제 정의를 주입했다. 퍼널 미지원 안내·browser/server 선택·서버 코드의
source별 이벤트 투영을 확인하고 ignore된 prototypes/admin/.tmp/funnel-registration-ui/
desktop.png에 화면을 저장했다. 임시 harness가 처음 default export를 named import로
읽어 오류가 났고 수정·새로고침 뒤 화면을 확인했으며 이후 새 콘솔 오류는 없었다.
검증 서버·탭을 종료하고 임시 html/tsx를 삭제했다.

OpenAPI·DBML 주석·ADR·제품 명세/로드맵·관리자/서버/프론트엔드 문서를 갱신했다.
계약 검사 도구는 새 예제를 검증하도록 확장했고 CI 러너·의존성·위생 정책 변경은 없다.
퍼널 연결 상태·단계 집계 저장/수집·SDK·집계 조회/화면은 후속이다. 신규 연결 이벤트의
D1 수집 통합·운영 인증·원격 DB·서비스 파일럿·푸시·배포는 실행하지 않았다.

## 순서 작업 퍼널 계약·코어 — 2026-10-11

OpenAPI의 독립 FunnelDefinition·FunnelLink·FunnelEvent·FunnelCounts와
packages/core/src/funnel.ts를 추가했다. 2~10개 단계·고정 발행 출처·동일 필수 분류
도메인·작업별 UUID·24시간 진행 창·시작 시각 + 72시간 연결 상태를 정의한다.
prepareFunnelObservation은 기존 이벤트 검증을 재사용하고 연결 내용을 포함한 별도
정규 해시를 만든다. planFunnelProgress는 원본 snapshot을 바꾸지 않고 연속 관찰한
단계의 delta만 돌려준다. 영수증 중복 제거와 인증·원자 저장은 저장/수집 연결에서 맡는다.

새 테스트 8/8은 4단계 browser/server의 전체 24개 수신 순열, 시작·중간 단계 누락,
자정 전후 시작일 집계, 동일 시각 단계, 재전송·상반된 단계 시각, 프로젝트/버전/분류
충돌, 정확한 24시간/만료 경계, 유한 등록 속성·출처·정의 검증과 null 분모를 확인한다.
현재 Registry·BrowserBatch·ServerBatch가 신규 funnel 필드를 계속 거부함도 확인했다.

루트 npm run check의 타입 검사·255/255 테스트·브라우저 gzip 예산 검사를 통과했다.
SDK는 2667 bytes·SDK+Sembom은 2949 bytes로 그대로다. 최초 타입 검사의 unknown
좁히기와 attempt 타입 문제를 수정한 뒤 전체 check를 재실행했다. 계약 npm run lint는
유효하지만 아직 endpoint에 연결하지 않은 신규 타입의 no-unused-components 경고
3개가 있다. npm run check의 계약 검사 50/50과 git diff --check도 통과했다.

ADR 0006·제품 명세·로드맵·서버 이벤트 문서를 갱신했다. API에는 독립 타입만 추가했고
실제 HTTP 요청/응답·DBML·SQL·SDK·의존성·CI·위생 정책 변경은 없다. 저장·수집·SDK·
조회·화면 연결은 후속이라 신규 퍼널의 D1 통합·브라우저 화면 검증은 실행하지 않았다.
기존 전체 테스트의 D1/Worker 통합은 통과했지만 신규 퍼널 저장 증거로 사용하지 않는다.
운영 인증·원격 DB·서비스 파일럿·푸시·배포는 실행하지 않았다.

## 관리자 서버 SDK 안내·출처별 진단 — 2026-10-11

프로젝트 생성·설정 입력과 응답 파서가 빈 allowedOrigins를 처리한다. SDK 안내는
browser/server 선택 출처만 투영하고 server-only면 서버를 기본 선택한다. 서버 코드는
실제 서비스가 토큰을 제공하는 ServerOptions.getToken 함수를 받는 TypeScript 팩토리다.
자격 증명이나 운영 제공자를 지어내지 않으며 코드 생성으로 이벤트를 전송하지 않는다.
브라우저 정의가 없는 투영 도구는 오류를 내고 browser 허용 출처가 비면 UI 코드를 만들지 않는다.
스키마 조회는 client·프로젝트·갱신 키를 검사해 전환·실패 뒤 이전 코드를 가린다.

수집 진단은 server-only면 오늘의 서버 건수를 기본 조회한다. 선택 출처의 meta·정의·
합계를 검사하고 출처를 바꾸면 요청을 취소하며 조회 키가 다른 데이터를 가린다. 마지막
수신과 거부 기록은 기존 프로젝트 전체 범위를 유지한다. server 진단은 Origin 비교 대신
전용 발행자 인증·권한·send 응답 확인을 안내하고, browser의 빈 출처에는 차단 안내를 표시한다.

관리자 타입 검사·132/132 테스트·빌드·test:sites 4/4·git diff --check 통과.
신규 4개 테스트는 빈 출처 생성/저장과 코어 계약 일치, 실제 projection 도구와 생성 코드의
일치, TypeScript 변환 후 실제 서버 SDK 팩토리 실행·토큰 조회/전송 없는 이벤트 생성,
server 자동 진단·명시적인 빈 browser 조회·잘못된 출처 응답 거부를 확인한다.
SDK 크기 검사도 다시 통과해 gzip 2667 bytes·SDK+Sembom 2949 bytes를 유지했다.
마지막 화면 수정은 select 레이블·로딩 중 포커스 유지라 타입 검사·빌드와 브라우저 확인을
마쳤고 숫자/전송 테스트는 앞의 유효한 132개 결과를 재사용했다.

인앱 Chromium·로컬 Vite(127.0.0.1:5185)에서 실제 LiveSdkSetup·CollectionDiagnostics에
자격 증명 없는 합성 ApiClient transport를 주입했다. server-only의 서버 자동 선택·
browser SDK 선택 불가·서버 코드 생성·오늘 서버 4건, 명시 browser 조회의 0건/차단 안내,
혼합 스키마의 browser 코드와 서버 선택을 확인했다. SDK 스키마 503이면 이전 코드가 사라지고
명시 재조회로 복구했다. 진단 선택의 정확한 accessible name을 붙이고 로딩 중 컨트롤을 유지했다.
임시 검증 페이지 HMR에서 createRoot 중복 경고가 한 번 있었고 새로고침 뒤 새 오류는 없었다.
320px 실제 innerWidth(기존 90% 확대, override 288px)에서 문서 303px·주소 입력 253px·
코드 영역 236px로 문서 넘침이 없었다. 뷰포트 복원·검증 탭/서버 종료·임시 페이지 삭제를
마쳤으며 ignore된 .tmp/server-setup-ui-qa/desktop.jpg·mobile.jpg에 화면을 보관했다.

제품 명세·로드맵·프론트엔드 설계·서버 이벤트 문서·프로토타입 안내를 갱신했다.
API·DB·SDK 런타임·의존성·CI·위생 정책은 바꾸지 않았다. 일반 소스 lint 명령은 없고
백엔드 247개는 앞의 코어 커밋 검증을 재사용했다. 운영 인증·원격 DB·Sembom·푸시·배포는
실행하지 않았다. 다음은 다단계 퍼널·브라우저/서버 작업 연결 계약이다.

## 서버 전용 스키마·빈 브라우저 허용 출처 — 2026-10-11

공용 스키마 검증에서 최소 browser 이벤트 조건을 제거했다. 전체 이벤트 1~50개·
browser 전용 workflow 참조·속성 한도·개인정보 검토는 유지한다. 프로젝트의
allowedOrigins는 0~16개이며 빈 배열은 browser 수집을 origin_denied로 거부한다.
발행자는 기존 전용 인증·프로젝트 권한으로만 server-batches를 사용한다.
browser_event_required는 구버전 호환 코드로 남지만 현재 검증기는 내보내지 않는다.
job-registry 예제에서 임시 browser 이벤트와 허용 출처를 없애 서버 전용 예제로 바꿨다.

관련 schema·settings·server query·server SDK 테스트 23/23을 통과한 뒤, 루트
`npm run check`의 타입 검사·247/247 테스트·SDK 크기 검사도 통과했다. SDK gzip
2667 bytes·SDK+Sembom 2949 bytes는 이전과 같다. owner의 실제 HTTP 설정 변경·
초안 검사·v2 발행·server 수집·같은 ID 재전송·server 조회·빈 browser summary·
없는 workflow 404·browser Origin 거부를 로컬 D1에서 확인했다. native Worker의
server-only 스키마 조회와 기존 Node·Worker SDK 발행/충돌/권한 회수 통합도 통과했다.

OpenAPI lint·계약 검사 46/46·git diff --check 통과. 처음 추가한 YAML description이
기존 키와 중복되어 검사가 실패했고 기존 설명에 합친 뒤 lint·계약 검사를 재실행했다.
OpenAPI·등록 예제·DBML의 출처 설명·제품 스펙·로드맵·서버/관리자 계약·예제 안내를
갱신했다. DBML은 주석만 바꿨고 SQL·마이그레이션·SDK 런타임·의존성·CI·위생 정책은
변경하지 않았다. 관리자 서버 연결 안내·빈 출처 편집·진단은 다음 슬라이스다.
운영 인증·원격 D1·Sembom·푸시·배포는 연결 환경이 없어 실행하지 않았다.

## 관리자 발행 출처 선택 화면 — 2026-10-11

`LiveDashboard`의 개요·이벤트 분석에서 browser/server 출처를 고르도록 연결했다.
출처를 조회·기간 비교·CSV·로딩 키에 포함하고 전환 시 선택 이벤트와 분류를 초기화한다.
`SourceEventTable`과 `SourceMetrics`를 분리해 기존 표시 규칙을 공유하며 server 개요에는
브라우저 시작·성공·완료율을 넣지 않는다. 목표는 browser 작업 흐름만 조회한다.
다른 출처 행은 건수 0 대신 `다른 출처`로 표시하고 빈 server 집계 안내에서 완료율 문구를 뺀다.

관리자 `npm run typecheck`, `npm test` 128/128, `npm run test:sites` 4/4,
`npm run build`, `git diff --check` 통과. build는 Sites용 client/server/hosting 파일을 만들었다.
API·DB·SDK를 바꾸지 않아 백엔드 검사는 반복하지 않았고 일반 소스 lint 스크립트는 없다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5184)에서 실제 화면과 ApiClient에 합성
fetch transport를 연결했다. 토큰을 비운 채 연결해 자격 증명을 만들거나 전송하지 않았다.
browser 총 35건·20회 시작·15회 성공·75% 완료율, server 총 12건과 이전 6건·100% 증감,
server 일별 그래프·retried 속성의 false/null 구분·값별 비교, 목표의 browser 고정을 확인했다.
server 조회에는 workflow 요청이 없었고 내려받은 CSV 파일명에 `-server`가 들어가며
선택하지 않은 browser 행은 `not_selected`·빈 건수였다. 503 오류 때 결과와 CSV를 잠그고
재시도로 복구하며, 지연된 server 응답을 browser 전환 뒤 전달해도 35건·75%가 유지됐다.
임시 검증 페이지 HMR에서 createRoot 중복 경고가 한 번 기록됐고 연결이 끊겨 새로고침했다.
새로고침 후 최종 코드의 정상 조회를 확인했으며 이후 새 콘솔 오류는 발생하지 않았다.

기존 브라우저 90% 확대에서 실제 innerWidth 320px(override 288px), 문서 폭 303px,
표 540px·스크롤 영역 255px·셀 18px를 확인했다. 표 영역에 키보드 포커스를 두고
ArrowRight로 가로 스크롤했으며 뷰포트는 복원했다. 검증 화면은 ignore된
`prototypes/admin/.tmp/source-ui-qa/desktop.jpg`·`mobile.jpg`에 보관한다.
운영 OIDC·원격 D1·Sembom 연결·푸시·배포는 실행하지 않았다. 로컬 검증 서버와 탭은 종료한다.
제품 스펙·로드맵·프론트엔드 설계·서버 이벤트 문서·프로토타입 안내를 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.

## 관리자 서버 출처 클라이언트·비교·CSV — 2026-10-11

관리자 `ApiClient`의 summary·event daily에 선택 source를 연결했다. 파서는 두 이벤트
출처를 받고 요청한 출처와 응답 meta.source가 다르면 거부한다. workflow 응답은 browser
전용으로 계속 검사한다. 기간 조회·스냅샷 검증·속성 분석·직전 기간 비교·CSV가 서버 출처를
지원하며 server 기간에는 workflow 요청/완료율을 넣지 않는다. 출처가 다른 기간·선택
이벤트를 섞으면 거부한다. CSV에서 미선택 출처 건수는 빈 값·not_selected로 구분하고
서버 파일명에는 server를 넣는다. 기본 browser 호출과 파일명은 유지한다.

관리자 `npm run typecheck`, `npm test` 128/128 통과. 새 5개 테스트는 명시 source 전송,
서로 다른 출처 응답과 잘못된 입력의 거부, browser 전용 workflow 파서, 서버 기간의
workflow 요청 없음, 빈 정의, 타입별 속성/기간 비교, 교차 출처 CSV 거부를 확인한다.
화면은 아직 이 source 옵션을 선택하지 않으므로 서버 조회 화면 완료로 주장하지 않는다.
관련 상태 표시·출처 선택·그래프·CSV 버튼 배선은 다음 UI 슬라이스다.

API·DB·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다. UI 마크업 변경이 없어 시각
검증은 생략하고 백엔드 검사 245/245는 이전 API 커밋 결과를 재사용한다. 일반 소스 lint
스크립트는 없다. 원격 인증·DB·Sembom 연결·푸시·배포는 실행하지 않았다.

## 서버 출처 집계 조회 API — 2026-10-11

`GET .../summary`와 `GET .../events/{eventName}/daily`에 선택 `source=browser|server`를
추가했다. 생략하면 기존 browser 조회다. D1의 출처 조건은 bind하며 한 번에 한 출처의
등록 정의·집계만 읽는다. 새 API나 테이블을 만들지 않고 기존 쿼리 한도·권한 조건·일관
batch를 유지했다. 잘못된 출처와 중복 파라미터는 400, 선택 출처에 없는 이벤트는 404다.
workflow 조회는 browser 전용이고 source 파라미터를 받지 않는다. 선택 출처에 정의가
없으면 summary는 events=[]·totalEvents=0으로 응답한다. meta.latestReceivedAt는 여전히
프로젝트 전체의 마지막 신규 수신이며 출처·버전·조회 기간별 수신 시각이 아니다.

루트 `npm run check`의 타입 검사·전체 테스트 245/245·브라우저 크기 검사 통과.
신규 7개 테스트는 실제 D1에 서버/브라우저 이벤트를 같은 ID로 저장하고 중복 재전송,
출처 분리·기본값·날짜 경계·false/0/누락 속성·빈 정의·버전 분리·retired/paused 조회,
발행자 조회 거부·다른 issuer/프로젝트·권한 회수·잘못된 source·저장 손상 거부를 확인한다.
실제 Miniflare Worker에서도 서버 합계·일별 속성 조회와 grant 회수 후 403을 확인했다.
관리자 인증 포트는 테스트용 검증기를 주입했고 실제 제공자 토큰 검증을 새로 실행하지
않았다. 운영 인증은 기존 검증 어댑터 범위다. 관리자 `npm run typecheck`도 통과했다.
OpenAPI lint와 계약/문서 링크 검사 46/46, `git diff --check` 통과.

OpenAPI의 출처 파라미터·QueryMeta와 browser 전용 workflow meta를 확장했다. 응답 예제와
계약 검사에 서버 응답·빈 합계·서버 workflow 거부를 추가했다. DB·마이그레이션·SDK·
의존성·CI 러너·위생 정책은 변경하지 않았다. UI 코드를 바꾸지 않아 화면 빌드/시각 검증은
반복하지 않았고 일반 소스 lint 명령은 없다. 서버 이벤트 화면 연결과 서버 전용 등록은
후속이다. 원격 DB·운영 연결·Sembom 활성화·푸시·배포는 실행하지 않았다.

## 서버 SDK Node·Worker·D1 통합 — 2026-10-11

`apps/collector/test/server-sdk.test.ts`에서 서버 작업 예제와 등록 정의 투영을 확인했다.
Node 기본 fetch의 루프백 HTTP 전송과 Worker 기본 fetch의 outbound service 전송이
전용 audience로 서명한 메모리 임시 토큰·발행 권한 검사를 거쳐 실제 로컬 D1에 저장된다.
테스트 전용 키/JWT는 메모리에서 생성하고 실제 제공자·자격증명은 사용하지 않는다.
응답 유실 뒤 본문·ID를 유지한 재전송은 신규 집계/할당량을 늘리지 않고, 저장된 이벤트의
수동 복원도 duplicate다. 같은 ID·다른 내용은 409이며 권한 회수 뒤 두 런타임 모두
403이고 신규 영수증을 만들지 않는다. 서버 발행은 브라우저 작업 흐름 상태를 만들지 않는다.

기존 `redirect: 'error'`는 현재 Worker 런타임에서 요청 전에 실패하는 것으로 재현됐다.
SDK를 `redirect: 'manual'`로 수정해 리다이렉트를 따라가지 않으며, Node와 Worker 모두
302에서 한 번만 시도하고 다른 주소로 토큰을 보내지 않는지 확인했다. 응답 유실 테스트의
Miniflare 영수증 스트림은 소진 후 버려 로컬 연결 오류 로그 없이 실패를 재현한다.

관련 테스트 15/15, 루트 `npm run check`의 타입 검사·전체 테스트 238/238·브라우저 크기
검사, OpenAPI lint와 계약/문서 링크 검사 43/43 통과. `npm run build:server`의 ESM/타입
선언 빌드 통과: 7179 bytes/gzip 3154 bytes, 런타임 의존성 0개다. 브라우저 SDK는 gzip
2667 bytes, Sembom 포함 2949 bytes로 3KiB 예산을 유지했다.

예제 Registry를 추가했고 API/DB 계약·마이그레이션·의존성·CI 러너·위생 정책은 변경하지
않았다. 아키텍처·개발 안내·SDK/패키지 경계·로드맵을 갱신했다. UI 변경이 없어 화면 검사는
반복하지 않았고 일반 소스 lint 스크립트는 없다. 실제 제공자·원격 DB·서비스 활성화·푸시·
배포는 실행하지 않았다. 서버 출처 조회 화면과 서버 전용 등록은 다음 구현이다.

## 의존성 없는 서버 SDK — 2026-10-11

`packages/server`에 별도 ESM SDK `createTallyfinServer`를 구현했다. 검토한 서버 이벤트
규칙으로 이름·속성·UUID·UTC 시각을 검사하고, 반환 이벤트·속성을 얼린다. 호출자가
`send` 결과를 기다리며 하나의 1~20개/16KiB 배치를 보낸다. 자동 큐·DOM·백그라운드
전송을 두지 않고, 재시도는 처음 만든 본문과 이벤트 ID·발생 시각을 그대로 쓴다.
토큰만 시도마다 호스트 callback에서 다시 얻는다. 자격증명 실패와 영구 4xx는 자동
재시도하지 않고 408·429·5xx·네트워크/응답 실패는 횟수·총 시간·취소로 제한한다.
`Retry-After`가 예산 밖이면 오래 대기하지 않고 재시도를 호스트에 넘긴다.
단일 요청의 시간 제한에는 토큰 획득·요청·응답 읽기가 모두 포함된다.

루트 `npm run check` 타입 검사·전체 테스트 236/236·브라우저 크기 검사 통과.
SDK 단위 13/13에서 동일 ID/본문 재전송·입력/스키마 변경 격리, false·0·필수/범위·
잘못된 UTC/캘린더·배치/출처 입력 거부, 자격증명 오류 비공개, 초/HTTP-date backoff·
단조 시계 예산·인증/요청/본문/대기 취소, 지연된 토큰의 요청 차단, 1KiB 응답 한도와
정확한 accepted+duplicates만 성공으로 인정하는 처리를 확인했다.
`npm run build:server`의 ESM·타입 선언 빌드 통과. esbuild graph에서 런타임 import·
외부/코어/저장/브라우저 코드 유입이 없고, 빌드한 ESM을 Node에서 실행했다.
서버 SDK는 7178 bytes/gzip 3150 bytes다. 서버 크기/운영 지연 목표는 아직 정하지
않았고, 브라우저의 3072-byte 예산과는 별개다. 기존 브라우저 SDK gzip 2667 bytes·
Sembom 포함 2949 bytes를 유지했다.

새 private workspace와 build:server·test:server 명령, workspace link만 lockfile에
추가했다. 외부 의존성·버전·API·DB·마이그레이션·CI 워크플로·위생 정책은 바꾸지
않았다. 제품 명세·로드맵·서버 SDK/서버 이벤트·수집 안내를 갱신했다. 일반 소스
lint 명령은 없다. UI 변경이 없어 UI 빌드/브라우저 화면 확인은 생략했다.
실제 Worker/D1 SDK 통합은 다음 슬라이스다. 영속 큐·업무와 전송의 원자적 보장·
토큰 발급·원격 제공자/D1·부하·푸시·배포·서비스 활성화는 검증하지 않았다.

## 로컬 서버 발행 권한 관리 CLI — 2026-10-11

`publisher-grant`·`publisher-revoke`를 기존 로컬 등록 CLI에 추가했다.
닫힌 JSON의 projectId·issuer·subject만 받으며 role·토큰·자격증명 발급은 받지 않는다.
미리보기 출력에는 원본 발행자 식별자 대신 principalHash를 넣고, 현재 권한·변경
계획·planHash를 표시한다. 기본은 미리보기, 쓰기는 `--apply`만 수행하며
`--expect-plan`이 있으면 현재 계획과 대조한다. 한 번만 적용할 수 있는 계획을 도구
인스턴스에 보관하고 프로젝트 생성 시각·발행자 행의 생성 시각/부재를 조건부 SQL로
비교한다. 같은 상태 재요청은 생성 시각을 바꾸지 않고, 회수는 관리자 grant를
건드리지 않는다.

`npm run typecheck` 통과. 기존 등록·관리자 grant와 신규 publisher CLI 관련 테스트
11/11 통과. CLI 시험의 영속 DB 재개방 횟수를 줄인 뒤 신규 5/5를 다시 실행해 통과했다.
실제 Miniflare D1에서 미리보기 무쓰기, 부여·회수·동일 상태 재시도, 원래 생성 시각
보존, 다른 프로젝트 격리, 경쟁 부여·회수/재부여·프로젝트 생성 시각 변경의 오래된
계획 거부, 도구/계획 사본/재사용·변조 입력 분리, DB 오류 비공개 처리를 확인했다.
영속 CLI에서 planHash를 검토한 적용·오래된 hash의 쓰기 전 거부·원격 옵션과
관리자 role 필드 거부까지 확인했다. 계약/문서 링크 검사 42/42 통과.

API·DB 구조·마이그레이션·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.
제품 명세·로드맵·서버 이벤트·프로비저닝 안내를 현재 구현에 맞췄다. 이 변경은
CLI 범위여서 전체 테스트는 서버 수집 API 커밋의 218/218 결과를 재사용하고 관련
11개만 실행했다. API lint·SDK 크기도 해당 커밋의 결과를 재사용한다. UI 변경이
없어 화면 빌드/브라우저 검증은 생략했다. 일반 소스 lint 스크립트는 없다.
publisher CLI 변경은 현재 admin_changes에 기록하지 않는다. 해당 이력의 닫힌
action 계약 확장은 후속이다. 실제 제공자·원격 DB·토큰 발급·서비스 활성화·푸시·
배포는 실행하지 않았다.
