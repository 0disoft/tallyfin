# 검증 이력 15

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

## 2026-10-10 거부 원인 수집·관리자 조회 연결

GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}를 연결했다.
reader/owner는 스키마가 없거나 중지된 프로젝트도 조회하며 from/to는 오늘을 포함한
최근 7개 UTC 날짜 안에서 필수다. meta는 UTC/receivedAt/retentionDays=7/coverage=
best-effort, 전체 summary와 모든 날짜의 days, 고정 10개 reason/count/lastRejectedAt
버킷을 반환한다. 기록 수가0이면 시각은 null이고 날짜/권한/저장 손상 실패를0으로
채우지 않는다. 분당/일일 quota_exceeded는 minute_limit/daily_limit로 구분한다.

실제 수집기에서 admission 통과 뒤 발생한 거부만 추가 기록하며 분당 초과는 이미
기존 admission SQL에서 기록된다. 알려지지 않은 프로젝트·관리자 실패·admission DB
실패는 제외한다. 진단 저장은 Worker ctx.waitUntil에 묶고 그 포트가 없는 호스트는
await한다. 저장 실패는 원래 응답을 바꾸지 않고 재시도/원문 로그를 만들지 않는다.
정상 요청의 진단 기록 쓰기/DB 왕복은 추가하지 않는다. 같은 분의 카운터를 한도+1로
낮추는 기존 동작을601 포화로 보완하여 설정을 낮췄다가 올려도 카운터가 줄지 않고
허용/추가 기록 요청이 최대600개에 머물게 했다. 원문·Origin·IP·토큰·requestId는 진단
DB/응답에 없다. 응답 뒤 기록·진단 저장소 오류·과거 backfill 없음으로 누락될 수 있어
완전한 거부율이나 전달 증거로 쓰지 않는다. 프로토타입 화면 연결은 다음 슬라이스다.

루트 npm test171/171, npm run typecheck(생성 Worker 타입 포함), OpenAPI의 Bun.YAML
파싱·새 경로와 응답 예제 버킷/합계 확인, git diff --check를 통과했다. 새 HTTP 테스트
4개는 실제 거부 요청과 분당/일일 구분·Retry-After·응답/DB 원문 비포함, reader/owner·
미인증/다른 프로젝트/없는 프로젝트/날짜/중복 파라미터/메서드·권한 회수, 늦은 sink의
응답 비차단과 실패 무시·재시도 없음, native Worker 실행 컨텍스트와 실제 D1 기록/조회
smoke를 확인한다. native smoke의 첫 esbuild 실행은 테스트 문자열의 JSON 반환 괄호가
없어 실패했고 이를 고친 뒤4/4·최종171/171을 통과했다. 저장 테스트에 설정 변경 시
카운터 비감소·동시12건 기록의 건수/최종 시각 보존을 추가했다. 전체 검증은 약59.5초였고
변경 없는 관리자 빌드/브라우저 UI를 반복하지 않았다.

OpenAPI·예제, DBML, 제품 명세(source of truth), 관리자·로그·수집·마이그레이션 문서,
로드맵과 화면 문서의 API 미지원 표현·이 기록을 갱신했다. 최초 DB 변경은0004 additive
열 확장이고 원격 적용은 하지 않았다. core의 저장/관리자 포트와 Worker 컨텍스트 전달을
확장했다. SDK·의존성·위생 정책·CI·러너·검증 명령 변경은 없다. lint는 명령이 없어 생략했다.
운영 부하/실제 인증 제공자/원격 DB/배포·화면 연결은 미검증/후속이다. 단위 테스트 임시
Miniflare와 개발 서버는 각 테스트가 정리했다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 관리자 수집 거부 집계 화면

API 연결 모드 설정의 CollectionDiagnostics에 CollectionRejections를 연결했다.
최근 7개 UTC 날짜·프로젝트 전체의 기록된 거부 요청 건수와 마지막 거부 시각을
보여주며 고정 10종 원인별 표·최근 날짜부터의 일별 표는 details로 접었다. 원문·
Origin·IP·토큰을 진단에 추가하지 않고 UTC 수신일과 best-effort 누락·과거 backfill
없음을 안내한다. 거부율·잔여 할당량은 추론하지 않는다. 설정·스키마·거부 조회는
병렬로 읽고 스키마가 있을 때만 수신 요약을 읽는다. 각 실패는 독립적으로 표시하며
0건이나 기록 없음으로 바꾸지 않는다. 기존 취소/클라이언트/프로젝트 키와 수동 갱신
방식을 유지하고 추가 폴링·시험 이벤트를 보내지 않는다.

관리자 npm test 첫 실행은 기존/관련 82개를 통과했고 9개는 새 테스트의 공식 JSON
예제 상대경로를 한 단계 더 올라가도록 잘못 적어 실패했다. 경로를 고친 뒤 관련
10/10, 최종 전체 91/91과 npm run typecheck를 통과했다. 날짜/원인/합계/중복/안전정수/
UTC 시각·0/null·7개 날짜·프로젝트/기간 일치·부분 실패·중지/스키마 미확인·취소를
검사했다. npm run build와 npm run test:sites 4/4를 통과했다. 빌드에는 기존 주요 JS
청크 500kB 초과 경고가 남아 있으며 이번 작업에서 의존성이나 번들 구성을 바꾸지 않았다.

기존 로컬 Vite 5180과 별도 in-memory Miniflare D1 5188에서 실제 관리자 reader 조회를
확인했다. origin_denied 1건/invalid_event 2건·고정 10종·7일 표, UTC 날짜와 서울 오늘의
구분, 503에서 다른 진단 값 유지·0으로 미표시, 복구 후 재조회·진짜 0건/null 화면을
확인했다. 360px에서는 페이지 가로 넘침 없이 표 영역만 스크롤되고 글자는 16px이었다.
브라우저 콘솔 오류는 없었다. 테스트용 viewport 변경과 Miniflare를 정리했다.
지정 CommandCode DeepSeek 4.1 Flash high의 문서/레이아웃 제안을 검토해 반영했다.

FRONTEND_DESIGN.md(화면 source of truth)·프로토타입 README·제품 로드맵·이 기록을
갱신했다. API·DB 계약·SDK·의존성·위생 정책·CI/러너 변경은 없다. 백엔드는 변경이 없어
직전 커밋의 171/171 검증 결과를 재사용했다. lint는 명령이 없어 생략했다. 실제 운영
인증/원격 DB/운영 부하·배포는 미검증이고 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 조회 기간 직접 선택

API 연결의 조회 기간에 직접 선택과 DateRangePicker를 추가했다. 프로젝트-local 오늘,
최근90일 보존/양끝 포함31일 한도를 기존 서버 규칙과 맞췄다. 입력 중엔 기존 결과와
CSV를 유지하고 미적용 안내를 내며 적용 때만 조회한다. 빈 값/잘못된 날짜/역순/미래/
보존·기간 초과를 거부한다. 실제 적용 값은 개요/이벤트/목표/속성별상세/비교/CSV의
조회 키에 함께 반영한다. 프로젝트/시간대/기본기간/재연결은 초기화하고 뷰/버전 변경은
적용 기간을 유지한다. 보존 범위 밖의 직전 비교는 요청 전에 막고 현재 결과를 유지하며
비교를 끄면 현재 CSV를 허용한다. 과거 기간에는 오늘 집계 중 안내를 표시하지 않는다.
Sample/설정 수집 진단 범위는 유지한다. 날짜 영속 저장·새 의존성·자동 폴링은 없다.

관리자 npm test94/94, npm run typecheck, npm run build, npm run test:sites4/4와
 git diff --check를 통과했다. 신규 날짜 테스트3개는 실제 core.queryDates와의 경계
일치, 정확히31일/90일 경계, 미래/역순/빈 값/유효하지 않은 날짜, 윤년/연말/DST와
프로젝트-local 오늘, 이전 비교 기간 보존 경계를 확인한다. 백엔드 코드는 변경하지 않아
이전171/171 결과를 재사용했다. 기존 JS500kB 초과 빌드 경고는 남았고 이번엔 번들
분리를 하지 않았다. lint는 등록 명령이 없어 생략했다.

로컬 Vite5180와 isolated in-memory Miniflare D15188에서 reader 조회를 확인했다.
단일10월9일을 적용해 전체75→62건과 해당 일별 차트, 직전10월8일 비교, 이벤트/목표/
속성별 완료율, 실제 CSV 파일의 current/previous from/to와62건을 확인했다. 입력 중에는
이전 결과를 유지했고31일 초과 오류와90일 경계의 비교 차단/현재 결과 보존을 확인했다.
브라우저 자동 입력에서는 date 값이 DOM에만 바뀌어 onChange가 반영되지 않았고,
날짜 칸을 onInput 처리로 바꾼 뒤 초안 안내/적용 동작을 확인했다. 기본7일 복귀와
다시 직접 선택 시 초기화,360px에서 페이지 가로 넘침 없음과 날짜 입력16px을 확인했다.
브라우저 콘솔 오류는 없었다. 검증 viewport와 실행한 개발/Miniflare 서버를 정리했다.
지정 CommandCode DeepSeek4.1 Flash high의 라벨/최소 폼 디자인/문서 초안을 검토해
반영했다. 첫 초안은 토큰 제한으로 잘려 같은 모델의 예산을 늘려 완전한 결과를 받았다.

제품 명세02-spec.md와 화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증/원격 DB/운영 부하/배포는 미검증이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 작업 흐름 속성별 직전 기간 비교

목표의 등록 속성별 완료율에 직전 같은 길이 기간 비교를 연결했다. 기존 breakdown
API를 비교를 켰을 때만 추가 조회하고, 현재와 이전에 관찰된 값을 자료형대로 합쳐
시작·성공·완료율을 현재/이전 순서로 보여준다. 완료율 변화는 %p다. 관찰되지 않은
값의 건수는 0, 시작 0인 기간의 완료율과 그 차이는 null/—다. 현재·이전 조회와 재시도는
분리했고 취소한 요청의 응답은 버린다. 비교 조회 실패는 현재 표를 유지한다. CSV에는
이전 속성별 합계·일별 내역과 workflow_property_comparison 행을 더하고 metric 열로
시작·성공·완료율을 구별한다. 활성 비교가 미완료/실패하면 내보내기를 잠그며 비교를
끄면 현재 CSV를 허용한다. 이벤트 속성 비교와 값별 이전 일별 화면은 이번 범위 밖이다.

관리자 npm test 97/97, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. 신규 테스트 3개는 가중 완료율과 %p, false/숫자0 키,
두 기간 값 합집합·빈 결과·시작0·집계 중 상태, 다른 프로젝트/버전/시간대/분류/기간
거부, 이전 값별 일별 CSV와 현재에 없는 값·계산 불가 변화량·누락 비교 거부를 확인한다.
lint는 등록 명령이 없어 생략했다. 백엔드·API·DB는 변경하지 않아 백엔드 테스트는
반복하지 않았다. 기존 JS500kB 초과 빌드 경고는 남아 있다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 조회를 브라우저에서
확인했다. tool=loan의 시작20/10·성공16/6·완료율80%/60%·+20%p, grade/timer의
이전0건과 계산 불가 완료율을 확인했다. 이전 breakdown만 503으로 실패시켜 현재
속성 표 유지·CSV 잠금·비교 해제 시 내보내기 허용·비교 재시도 복구를 확인했다.
실제로 내려받은 CSV의 비교9행과 이전 데이터·metric·단위를 확인했다. 현재10월4~5일
0건/이전10월2~3일10건에서 이전에만 있는 loan 값이 0/10·0/6·—/60%로 남았다.
모바일 viewport360 설정 요청은 환경에서 실제400px로 적용됐고 페이지383px·표 내부
가로 스크롤을 확인했다. 360px 자체는 미검증이다. 콘솔 오류는 없었다. 비교 표 화면은
.tmp/prototype-qa/workflow-property-comparison.jpg에 저장했고 검증 서버와 탭을 정리했다.

CommandCode DeepSeek4.1 Flash high에 문서 갱신을 맡겨 결과를 코드와 대조했다.
제품 명세02-spec.md·화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증·원격 DB·운영 부하·배포는 미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 이벤트 속성별 직전 기간 비교

이벤트 분석에서 등록 속성으로 분류하고 직전 기간 비교를 켜면 기존 event daily API로
같은 이벤트·속성·프로젝트·스키마·시간대의 직전 같은 길이 기간을 조회한다.
useEventPropertyComparison이 이전 조회의 상태·재시도·취소를 맡고, 별도
EventPropertyComparison 표는 현재/이전 건수·증감률(%)·비중·비중 변화(%p)를 보여준다.
비중의 분모는 각 기간의 선택한 이벤트 전체 건수다. 값의 자료형을 유지해 두 기간의
관찰 값 합집합을 비교한다. 없는 값의 건수는0, 전체 이벤트가 있으면 해당 비중은0,
전체가0이면 비중과 차이는null/—다. 이전 건수0의 증감률도null/—다.
분류 없는 상세에는 이전 속성 요청을 하지 않는다. 실패 시 현재 표와 차트는 유지하고
이전 속성만 다시 조회한다. 조건 변경·비교 해제·언마운트는 요청을 취소하고 늦은 응답을
버린다. 활성 분류 비교가 미완료/오류면 CSV를 잠근다. 비교 해제는 현재 기간 CSV를,
분류 해제는 전체 이벤트 기간 비교를 유지한 CSV를 허용한다. CSV는 이전 상세 합계·일별·
속성 값별 행과 property_comparison 행을 담는다.
metric=count/share, 변화 단위percent/percentage_point, 값 자료형과 계산 불가를 보존한다.

관리자 npm test101/101, npm run typecheck, npm run build, npm run test:sites4/4,
git diff --check를 통과했다. 신규 테스트4개는 건수 변화와 비중 차이의 구별, 새로 생긴/
사라진/null·false·숫자0 값, 빈 기간·0분모, 잘못된 메타/날짜/분류/합계 거부,
실제 ApiClient의 기존 조회 경로·그룹·기간·신호 전달과 취소/늦은 응답 거부,
이전 일별 CSV와 비중 변화·계산 불가·누락/잘못된 이전 데이터 거부를 확인한다.
lint는 등록 명령이 없어 생략했고 백엔드 코드는 변경하지 않아 재검증하지 않았다.
기존 JS500kB 초과 빌드 경고는 유지된다. LiveDashboard.tsx는41.7kB로 추후 분리 후보다.
이번 이전 조회 상태와 비교 표는 별도 파일로 두었다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 데이터로 확인했다.
tool_view의 loan12/10·+20%와 비중44.4%/66.7%·-22.2%p, grade10/5·+100%,
timer5/0·증감률계산불가·비중18.5%/0%를 확인했다. 실제 다운로드 CSV의 비교6행과
이전 값별 일별 행·숫자·단위가 화면과 일치했다. 이전 그룹 시계열만503으로 실패시켜
현재 표27건·차트 유지, CSV잠금, 비교·분류 해제 시 해제, 별도 재시도 복구를 확인했다.
직접 기간10월4~5일의 현재0건/이전10월2~3일에서 이전 loan·grade가 남고 -100%와
현재 비중/차이—를 표시했다. 브라우저 확대율을 반영한 실제 CSS320px에서 페이지303px,
표221px/내용575px로 표 내부만 스크롤하고 페이지 넘침은 없었다. 콘솔 오류는 없었다.
.tmp/prototype-qa/event-property-comparison.jpg에 화면을 저장했고 viewport·탭·검증
서버를 정리했다. 브라우저 확대율 자체는 변경하지 않았다.

CommandCode DeepSeek4.1 Flash high의 문서 갱신을 코드와 대조했다. 제품 명세02-spec.md·
화면source of truth FRONTEND_DESIGN.md·프로토타입README·로드맵·이 기록을 갱신했다.
API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다. 운영 인증·원격 DB·운영 부하·배포는
미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-11 관리자 차트 지연 로드

개요의 일별 추이 차트를 `Dashboard.tsx`의 `Trend`에서 `useEffect`의
`import('./TrendChart')`로 지연 로드하고 Recharts JSX를 `TrendChart.tsx`로
옮겼다. 불러오는 동안 자리 표시자는 `role="status"`로 알리고 실패해도 일별 수치 표와
나머지 화면을 유지하며 `화면 새로고침` 버튼으로 새 문서에서 복구한다. 언마운트 뒤
늦게 도착한 import 결과는 버린다. API/DB·SDK·의존성·CI·위생 정책 변경은 없다.

`prototypes/admin`에서 npm test 101/101, npm run typecheck, npm run build,
npm run test:sites 4/4를 통과했고 `git diff --check`도 통과했다. 빌드에서 기존
500kB 초과 JS 경고가 사라졌다. 루트 `npm run check`와 계약 검사는 이 슬라이스에서
돌리지 않았다.

번들: 기준선 커밋 `53aa645`의 첫 JS 800.26kB/gzip 228.43kB가 446.61kB/gzip
125.83kB로 약 44.9% 줄었고 차트 청크는 353.93kB/gzip 102.84kB다. 개요는 기본 화면에
차트가 있어 개요 총 JS gzip이 228.43kB에서 228.67kB로 거의 같고 요청 수가 1건에서
2건으로 는다. 모든 화면의 총량·로드 시간이 줄었다는 뜻이 아니다.

브라우저 확인은 로컬 `vite preview`(127.0.0.1:5180, 프로덕션 빌드)와 Codex 인앱
Chromium에서 캐시를 끄고 같은 탭에서 기준선 3회 뒤 지연 로드 3회를 연속 실행했다.
CPU·네트워크 제한은 없었다. FCP는 452/376/296ms에서 308/252/296ms로 중앙값이
376ms에서 296ms, DCL은 351.5/266.3/216.5ms에서 179.4/175.6/168.8ms로 중앙값이
266.3ms에서 175.6ms가 됐다. 개요 main fetch 종료는 기준선 302/213.4/139.1ms, 지연
로드 77.3/93.3/88.4ms였고 차트 청크 fetch 종료는 378/541.2/433ms였다. `load` 이벤트는
비동기 차트 완료 시각이 아니다. Resource Timing의 encodedBody는 기준선 226491 bytes,
지연 로드 entry 124796 bytes와 차트 101925 bytes를 합쳐 226721 bytes다. 로컬 preview
서버의 압축값은 Vite 빌드의 gzip과 달라 두 값을 서로 바꿔 쓰지 않는다. 표본 3회·
순차 측정이라 warmup이 섞이고 개선을 보장하지 않으며 운영 CWV·INP·LCP·full trace는 측정하지 않았다.
warmup이 섞이고 개선을 보장하지 않으며 운영 CWV·INP·LCP·full trace는 측정하지 않았다.
원시 수치는 로컬 무시 파일 `.tmp/prototype-qa/chart-load-metrics.json`이다.

차트 청크를 차단한 화면에서도 일별 수치 표와 요약 지표가 유지됐고, 브라우저가 실패한
import를 문서 단위로 기억해 다시 불러오는 시도로는 복구되지 않는다는 것을 직접 확인한
뒤 네트워크 차단을 풀고 `화면 새로고침` 버튼으로 차트가 복구되는 것을 확인했다.
실패 자리 표시자의 데스크톱 높이는 280px였다. 차트가 없는 `/auth/callback` 실제
화면에서는 entry 124796 bytes와 OidcLogin 10773 bytes만 요청됐고 차트 청크는 받지
않았다(인증 값은 입력하지 않았다).

7일에서 14일로 기간을 바꿔 차트 합계가 43440, 이벤트 상세 `conversion_started` 합계가
8825로 갱신되는 것을 확인했다. 실제 CSS 320px(innerWidth 320, viewport 288은 기존 90%
확대가 반영된 값이며 확대율 자체는 바꾸지 않았다)에서 정상·차트 다운로드 차단 실패
화면 모두 페이지 303px, 차트 자리 높이 285px에 가로 넘침이 없었고 실패 화면의
`role=status`와 새로고침 복구도 다시 확인했다. 최종 전체 화면은
`.tmp/prototype-qa/chart-lazy-load.png`다. 브라우저 캐시·차단 URL·viewport 설정을
되돌리고 검증 탭을 닫았으며 로컬 검증 서버 종료 후 5180 리스너가 없는 것을 확인했다.

운영 인증·실 DB·실 서버 부하·Sembom 연동·원격 푸시와 배포는 실행하지 않았다.

## 2026-10-11 관리자 폰트 로딩 정리

관리자 프로토타입의 폰트를 굵기별 정적 CSS 9개에서 가변 폰트 CSS 2개
(`@fontsource-variable/inter/wght.css`, `@fontsource-variable/noto-sans-kr/wght.css`)로
바꿨다. `App.tsx`의 import 9줄을 2줄로 줄이고 정적 의존성 `@fontsource/inter`·
`@fontsource/noto-sans-kr`를 빼고 `@fontsource-variable/inter`·
`@fontsource-variable/noto-sans-kr` `^5`(설치 5.3.0)를 넣었다. `vite.config.mjs`에
`scripts/font-assets.mjs` 플러그인을 연결해 실제 패키지 `@font-face`의 family와 굵기만
alias한다. Inter는 `400 800`(CSS 900은 800), Noto Sans KR은 `400 500`·`700`·`900`
(600과 800은 700과 900)이고 원본 `unicode-range`와 서브셋은 그대로 둔다. 플러그인이
두 OFL 원문을 `dist/client/fonts/inter-OFL.txt`·`noto-sans-kr-OFL.txt`로 동봉한다.

`tests/font-assets.test.mjs`를 테스트 러너에 넣어 실제 패키지의 모든 unicode 범위와
원본 src 유지, 서브셋별 중복 파일 다운로드가 늘지 않음, 기존 굵기 호환, 원본 변경 감지,
라이선스 동봉을 검사한다. `prototypes/admin`에서 npm test 105/105, npm run typecheck,
npm run build, npm run test:sites 4/4를 통과했다. 빌드 CSS는 380.42kB/gzip
119.38kB에서 264.85kB/gzip 35.91kB로 줄었고 초기 JS 446.61kB/gzip 125.83kB는 그대로다.
lint는 등록 명령이 없어 생략했고 백엔드는 바꾸지 않아 반복하지 않았다.

브라우저 확인은 로컬 `vite preview`(127.0.0.1:5180, 프로덕션 빌드)와 Codex 인앱
Chromium에서 캐시를 끄고 같은 탭으로 기준선과 가변 폰트를 한 번씩 비교했다.
`document.fonts.ready`를 기다린 뒤 Resource Timing을 봤다. 실제 preview가 내려준
encoded CSS는 113783에서 33732 bytes다. 첫 화면 폰트는 28건/324224 bytes에서
9건/178064 bytes로, CSS와 폰트 본문 합계는 438007에서 211796 bytes로 줄었다. 헤더는
뺐고 preview 서버의 압축값과 Vite 빌드 gzip은 서로 바꿔 쓰지 않는다. 개요 제목·지표·표의
전후 geometry 일치를 확인했고 글리프 전수 검증은 하지 않았다.

`document.fonts.load`로 Inter 600의 그리스·키릴·라틴 서브셋 face 4개, Noto Sans KR
700의 한글·한자 서브셋 face 6개가 실제로 로드되는 것을 확인했다. 지원 서브셋이
내려받는지 본 것이고 글리프 전수 검증은 하지 않았다. 로컬 dev(5181)의 폰트 CSS
요청에서 alias한 Inter와 굵기 범위 `400 800` 반영을 봤고 `dist/client/fonts`에 OFL
원문 2개가 실제로 동봉된 것을 확인했다. 이벤트 분석 `conversion_started` 상세 차트는
4800건으로 유지됐다.

실제 CSS 320px(innerWidth 320, viewport 288은 기존 90% 확대가 반영된 값이며 확대율은
바꾸지 않았다)에서 정상 화면과 WOFF2 전체 차단 실패 화면 모두 페이지 303px에 가로
넘침이 없었고, 차단 화면은 379개 face 오류에도 지표 24680/4800/4128/86.0%와
표·차트·메뉴가 읽혔다. 차단을 풀고 캐시와 viewport 설정을 되돌린 뒤 검증 탭을 닫았고
검증 서버도 종료하고 5180·5181 리스너가 없는 것을 확인했다. 원시 수치는 `.tmp/prototype-qa/font-load-metrics.json`이고 화면은
`font-before.png`·`font-after.png`다. 다른 화면 전체 확인과 운영 CWV·구형 브라우저
테스트는 실행하지 않았다.

API/DB·SDK·의존성 위생 정책·CI 러너·운영 인증은 바꾸지 않았고 프론트엔드 의존성과
Vite 플러그인·테스트 명령만 바뀌었다. 푸시·배포·Sembom 연동은 없다. Fontsource 가변 폰트
근거는 [Fontsource 가변 폰트 안내](https://fontsource.org/docs/getting-started/variable)다.

## 프로젝트 owner 전용 권한 목록 — 2026-10-11

`GET /v1/projects/{projectId}/grants`와 `AdminStore.grants`를 추가했다. 권한과 목록을
같은 D1 batch로 읽고 issuer/subject의 복합 기본키 순서로 페이지를 나눈다. limit은
기본 25·최대 100이고 커서는 프로젝트별 위치값이며 매 페이지에서 owner를 재검사한다.
응답은 최초 생성 시각과 등록 식별값·역할만 반환하고 no-store를 유지한다.

루트 `npm run check`가 타입 검사·177/177 테스트·SDK 크기 검사를 통과했다.
SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes는 그대로다. 이후 커서 상한을
12288자(쿼리 12352자)로 확장하고 Worker smoke에 실제 커서 왕복을 추가했다.
변경 후 `npm run typecheck`와 관리자 기존 테스트 13/13(Worker smoke 포함), 최종
`node --test --test-timeout=30000 apps/collector/test/grants.test.ts` 6/6이 통과했다.
마지막 상한·smoke 수정 이후 전체 177개는 반복하지 않고 해당 범위를 재검사했다.

추가 테스트는 다른 프로젝트 식별값 제외, reader/외부 owner/발급자 변경 차단,
삭제된 커서 위치 이후 조회, 페이지 사이 역할 강등과 batch 직전 회수, 긴 Unicode·따옴표
식별값 커서, 잘못된/다른 프로젝트 커서, 파라미터·인증·저장 오류와 비공개 예외를 확인한다.
Miniflare workerd에서 owner 목록과 커서 왕복도 확인했다. 신뢰하는 검증기를 테스트에서
주입했으며 실제 제공자의 로그인·운영 토큰·원격 DB는 연동 환경이 없어 실행하지 않았다.

`tools/contracts`의 `npm run lint`(OpenAPI)와 `npm run check` 36/36, `git diff --check`
통과. API·제품 스펙·로드맵·관리자 경계 문서와 검증 기록을 갱신하고 계약 검사에 새 응답
예제와 닫힌 형태·페이지 상한 검사를 더했다. 일반 소스 lint 명령은 없어 생략했다.
DB·마이그레이션·SDK·의존성·CI 러너·위생 정책 변경, 운영 배포·푸시·Sembom 연동은 없다.
각 페이지는 현재 DB를 읽으므로 앞쪽에 새로 추가된 grant는 처음부터 재조회해야 한다.
권한 관리 UI·grant 부여/변경/회수 API는 후속이며 기존 CLI를 유지한다.

## 관리자 권한 목록 화면 연결 — 2026-10-11

API 모드 설정 화면에 owner 전용 `LiveGrants`를 연결했다. `ApiClient.listGrants`가
기존 bearer·같은 출처·no-store·no-referrer·credentials omit 정책을 재사용하고, 닫힌
응답 형태·역할·식별자 길이·등록 시각·프로젝트·페이지 한도·진행하지 않는 커서를 검사한다.
`GrantList`는 현재 25건 페이지 하나만 보관하며 실패·새 조회·dispose 때 행을 비운다.
프로젝트/연결 변경의 이전 설정 스냅샷도 렌더링에서 제외해 reader에게 기존 owner 상태를
적용하지 않는다. 각 응답은 abort와 세대 번호를 함께 확인한다.

`prototypes/admin`에서 `npm test` 111/111(권한 목록 신규 6개 포함), `npm run typecheck`,
`npm run build`, `npm run test:sites` 4/4와 `git diff --check`가 통과했다. 테스트는
권한 회수·네트워크 오류 후 행 제거, 실패한 페이지 재시도, 커서 진행/새로고침, 중복 클릭,
늦은 응답·언마운트 폐기와 응답 계약 오류를 확인한다. 일반 lint 명령은 없어 생략했고,
백엔드는 변경하지 않아 루트 백엔드 검사와 원격 마이그레이션을 반복하지 않았다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5182)에서 실제 `LiveSettings`·`LiveGrants`
컴포넌트에 합성 transport를 주입한 무자격증명 검증 페이지를 사용했다. owner의 25건→2건
페이지 전환·끝 버튼 비활성화, reader 전환 후 요청 2건 유지/표 제거, 다음 페이지 403 후
표 제거, 빈 페이지 안내, 다른 프로젝트 데이터만 표시를 확인했다. 콘솔 오류는 없었다.
실제 CSS innerWidth 320px(기존 90% 확대에 viewport 288px)에서 페이지 scrollWidth
303px, 표 540px/스크롤 영역 255px로 전체 페이지 넘침이 없고, 508자 식별자를 자르지
않으며 셀은 18px였다. Tab으로 표 영역 포커스 후 ArrowRight 내부 스크롤을 확인했다.
뷰포트는 복원했고 검증 탭·서버는 종료했다. 화면은 `.tmp/grants-ui-qa/owner.png`·
`mobile.png`이며 임시 검증 페이지도 ignore된 `.tmp`에만 둔다.

제품 스펙·로드맵·프론트엔드 설계·검증 기록을 갱신했다. API·DB·SDK·의존성·CI 러너·
위생 정책 변경, 푸시·배포·Sembom 연동은 없다. 운영 OIDC/실제 계정 연동은 환경이
연결되지 않아 실행하지 않았고, 이번 화면은 조회만 하며 권한 변경은 기존 CLI가 맡는다.

## 관리자 변경 이력 화면 연결 — 2026-10-11

API 연결 설정의 권한 목록 아래 소유자 전용 `LiveAdminChanges`를 연결했다. 닫힌 응답
형태·프로젝트·90일 창·기록 정렬·페이지 한도·커서 진행을 검사하며 현재 25건 페이지
하나만 보관한다. 새 조회·실패·권한 상실 때 기록을 비우고 abort와 세대 번호로 늦은
응답을 막는다. 설정·권한 저장이 확인되면 첫 페이지를 다시 읽는다.

`prototypes/admin`의 `npm run typecheck`, `npm test` 123/123(변경 이력 신규 5개 포함),
`npm run build`, `npm run test:sites` 4/4를 실행해 통과했다. 신규 테스트는 응답 검증,
전송 정책, 실패 페이지 재시도, 중복 클릭, 끝 페이지, 401/403 기록 제거, 요청 취소와
늦은 응답·dispose를 확인한다. API·DB·SDK를 변경하지 않아 백엔드 검사는 반복하지
않았고 일반 소스 lint 명령은 없어 생략했다. 운영 OIDC·원격 D1 연동도 실행하지 않았다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5183)에서 실제 `LiveSettings`·`LiveGrants`·
`LiveAdminChanges`에 합성 transport를 주입한 무자격증명 페이지를 사용했다. 25건→3건
페이지 이동과 마지막 버튼 잠금, 네트워크 오류 후 같은 페이지 재시도, reader 전환 때
추가 이력 요청 없음, 다음 페이지 403 후 표 제거·부모 잠금, 빈 이력, 프로젝트 전환 후
늦은 응답 폐기, 설정·권한 저장 후 새 기록 표시를 확인했다. 로딩 때 행을 비우고 버튼을
잠그며 자동 폴링하지 않는다. 임시 검증 페이지 제목 수정의 HMR에서 createRoot 중복
경고가 한 번 발생했고 페이지를 다시 연 뒤 새 오류는 없었다. 검증 페이지는 ignore된
`.tmp`에만 있으며 운영 앱 변경이 아니다.

기존 브라우저 90% 확대를 유지한 실제 innerWidth 320px에서 문서 scrollWidth 303px,
표 540px·스크롤 영역 255px로 문서 넘침이 없었다. 508자 식별자를 자르지 않고 셀 상세와
표 머리글은 18px였다. Tab으로 표 영역 포커스 후 ArrowRight 내부 스크롤을 확인했다.
화면은 `.tmp/admin-changes-ui-qa/desktop.png`·`mobile.png`에 보관하고 뷰포트는 복원했다.

제품 명세·로드맵·관리자 경계·프론트엔드 설계·프로토타입 안내와 검증 기록을 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.
