# 검증

Tallyfin의 변경을 어떤 명령으로 확인할지 고르는 안내다. 아래 명령은 저장소 루트의 `package.json`, `apps/admin/package.json`, `tools/contracts/package.json`에 선언된 스크립트를 기준으로 한다.

명령과 검증 기록의 인라인 경로는 별도 표기가 없으면 저장소 루트(`apps/admin/...` 등도 이 밑)에서 해석한다요. 루트 문서와 `docs/validation/history-NN.md`에 있는 날짜별 report는 작성 당시의 증거다요. 최신 코드나 현재 원격 상태를 자동으로 대신하지 않으므로, 재현할 때는 같은 명령과 범위로 새 기록을 남긴다요.

이번 작업의 검증 결과는 아래 최신 기록에 두고, 과거 기록은 원문 순서대로 나눈 이력 파일에 보존한다. 원문 섹션 순서와 문장은 유지하며, 새 위치에 맞춰 Markdown 링크만 고쳤다. 루트에는 이력 색인과 명령 안내를 남긴다. 새 기록이 쌓이면 오래된 구간을 이력으로 옮긴다.

이번 라운드의 검증은 관련 suite와 범위만 다룬다요. 기록에는 실제로 실행한 대상과 결과 범위만 남기고, 실행하지 않은 전체 점검이나 배포 성공을 일반적인 통과로 쓰지 않는다요.

| 안정된 이름 | 명령 | 선택 기준 |
| --- | --- | --- |
| typecheck | 루트 `npm run typecheck`; admin `npm run typecheck:admin` | 루트 명령은 collector, 루트, admin typecheck를 묶는다요. admin만 바뀌면 admin 명령을 먼저 고른다요. |
| test | 루트 `npm test`; admin `npm run test:admin` | 변경된 package, 앱, 도구 경계에 맞춰 범위를 고른다요. |
| contract/docs | `npm run check --prefix tools/contracts` | 예제, DBML, 문서 링크를 확인한다요. 런타임 동작의 증거는 아니다요. |
| lint | `npm run lint --prefix tools/contracts` | OpenAPI만 검사한다요. 일반 소스 lint는 별도로 설정되어 있지 않다요. |
| build | `npm run build:admin` | admin 배포 산출물의 구성을 확인한다요. |
| migration-check/smoke | `npm run verify:restore`; 관련 `verify:admin-*` | 옵트인인 합성·로컬 검사다요. 원격 마이그레이션이나 배포 상태를 증명하지 않는다요. |
| check | 루트 `npm run check`; admin `npm run check:admin` | 여러 검증을 묶은 넓은 범위다요. 필요한 경우에만 실행한다요. |

독립된 `format` 스크립트는 없다. `.editorconfig`·`.gitattributes`를 따르고 변경 파일의 공백·줄바꿈은 `git diff --check`로 확인한다.

검증 결과에 적는 범위는 그 명령이 실제로 본 범위와 같아야 한다요. 관련 suite만 돌렸다면 그 suite를, 일부 경로만 확인했다면 그 경로를 기록한다요.

## 스키마 버전 간 정의 비교 — 2026-10-24

발행 정의 비교를 React·I/O 없는 `schema-comparison.ts` 계산과 두 버전 읽기로 나눴다.
이름/ID로 이벤트·속성·흐름·퍼널을 대응하고 필드별 추가·삭제·변경, 대표 흐름과 배열 순서를
보존한다. 객체 키 순서는 무시하며 생략한 funnels와 빈 배열은 같다. 결과 값은 입력에서 복사한다.
조회는 기존 getSchema만 사용하고 한쪽 실패·취소 시 나머지를 취소한다. 요청 신원과 버전을
확인하고 취소를 무시한 늦은 응답도 거부한다. 자동 재시도·쓰기·API·DB 계약 변경은 없다.

- `node --test apps/admin/src/api/schema-comparison.test.mjs`: 12/12 통과.
- `npm run typecheck:admin`: 최종 UI 포함 통과.
- `npm run test:admin`: 359/359 통과. 신규 비교 테스트 12개를 포함한다.
- `npm run build:admin`: 최종 UI 포함 통과.
- `npm run test:bundle --workspace @tallyfin/admin`: 2/2 통과. 설정 비교는 기존 지연 로딩 경계를 따른다.
- `npm run check --prefix tools/contracts`: 68/68 통과. 런타임 동작 검증과 구분한다.
- `npm run verify:admin-schema-comparison`: Chromium 156.0.8078.4에서 10개 시나리오 통과.
  합성 OIDC·실제 로컬 D1·27개 버전으로 페이지 나누기/사용 중지 버전, 초안/검증/개인정보
  검토 보존, 역방향/같은 버전, 동일 정의, 503/명시적 재시도, 선택 변경 뒤 늦은 응답,
  프로젝트 변경, reader 조회, 390px 화면과 실제 권한 회수를 확인했다. 비교 추가 쓰기 0,
  페이지 오류 0이다. 초안 검증 POST 한 번은 비교 쓰기와 별도로 센다.
  최종 보고서·화면은 `.tmp/admin-schema-comparison-kqrl5v/`에 있다. 첫 실행의 마지막 집계는
  초안 검증 POST를 쓰기로 세어 실패했고, 비교 전후 증가분으로 수정 후 재실행해 통과했다.
- `git diff --check`: 통과.

설정에 두 발행 버전의 필드별 차이 표를 연결했다. 초안과 독립된 선택/조회 수명을 사용하며
권한/목록 잠금·선택·프로젝트·세션 변경에서 이전 결과를 숨기고 요청을 취소한다. 오류는
이전 결과 대신 재시도를 안내한다. reader 조회·사용 중지 버전·버전 부족·동일 정의도 구분한다.
표는 키보드 가로 스크롤과 행/열 헤더를 제공하고, 모바일 선택은 세로 배치한다.
퍼널 단계는 번호·이벤트·출처로 표시하고 추가/삭제한 전체 정의는 펼쳐 본다.
정의 비교는 호환성 판정이나 버전 간 집계 비교가 아니다.

원격 연결·배포와 전체 backend/SDK suite는 관련 코드가 바뀌지 않아 실행하지 않았다.
API·DB·SDK·의존성·CI 러너·저장소 위생 설정 변경은 없고, 로컬 명령에 옵트인 브라우저
검증 하나를 추가했다. 제품 스펙·로드맵·위험 등록부·프론트엔드 설계를 현재 구현에 맞췄다.

## 검증 기록 분리와 유지보수 점검 — 2026-10-23

기존 229개 구간 중 최신 3개는 이 파일에 유지하고, 나머지 226개는 32KiB 미만의 이력 16개로 나눴다.
제목·본문·순서를 보존하고 Markdown 상대 링크만 새 위치에 맞췄다. 링크를 원래 위치로 되돌린
본문을 원문과 대조해 누락·중복·변경이 없음을 확인했다. 이력 파일의 링크도 기존 계약 검사에 포함했고 68/68을 통과했다.

전체 소스 목록·파일 크기와 Core 전이·D1 원자 쓰기·Collector 자원 수명·SDK 입력 사본/전송 경계를 살폈다.
SDK의 크기 예산과 기존 순수 계산·주입 포트는 유지하고, 변경 부담이 큰 마이그레이션 목록·관리자 전송·
대시보드 계산을 분리했다. 실행한 검사와 운영 미검증 범위는 아래 세 기록에 구분했다.

명령 안내는 현재 package scripts에 맞췄다. 과거의 prototypes 경로·이전 테스트 수·예전 예산은
이력으로만 보존한다. API·DB 계약·의존성·CI 러너·저장소 위생 설정과 원격 환경은 바꾸지 않았다.

## 대시보드 계산·CSV 준비 분리와 통합 확인 — 2026-10-23

LiveDashboard의 이벤트 행/일별 기록 계산과 CSV 준비를 React·I/O 없는 모듈로 분리했다.
이벤트 이름은 Map/Set으로 대조하고 정의 순서 뒤 응답의 미등록 순서를 유지한다. 중복
합계의 기존 마지막 값 규칙·0/null·다른 출처·검색과 인자 불변성을 유지한다. CSV 잠금은
현재 데이터→현재 흐름 오류→직전 흐름 오류→비교 범위/조회→이벤트 상세/속성 비교→
흐름 분류 순서의 early return이다. 조회·권한·범위 상태의 소유자는 기존 컨트롤러다.

순수 계산 집중 3/3·전체 관리자 최종 347/347·관리자 타입/빌드·bundle 2/2·Sites 11/11·
계약/문서 링크 68/68을 통과했다. 겹치는 검사 수는 합산하지 않는다. 동결 인자·미완료/
동시 차단 사유 우선순위·조회 완료된 선택만 포함·설정 CSV 제외·실제 CSV 생성을 확인했다.

기존 `verify:admin-analysis-access`의 CSV 마지막 열 단언은 최근 추가된 열을 반영하지 않아
other-project에서 실패했다. 현재 CSV_COLUMNS 전체 헤더를 실제 파일과 대조하도록 고친 뒤
최종 Chromium 156.0.8078.4·합성 로그인/실제 D1에서 최신 버전·프로젝트 격리·크기/시간대
복구·이벤트 표·권한 회수/복구·CSV 차단·늦은 거부·연결 해제를 통과했다. 읽기 43·쓰기 0·
pageErrors 0·routeError false이며 `.tmp/admin-analysis-access-uQa6jk/report.json`에 남겼다.

`verify:admin-goal-access`도 같은 Chromium·합성 로그인/실제 D1로 16개 시나리오를 통과했다.
현재/직전 기간 분류·퍼널·소요시간/실패 원인·부분 실패/CSV 잠금·실제 권한 회수 7경로·
늦은 응답·복구를 확인했다. 읽기 116·쓰기 2는 기존 초안 검증 POST이며 발행/수집은 없다.
pageErrors 0·routeError false, 증거는 `.tmp/admin-goal-access-LTlb4K/report.json`이다.
개요와 목표 데스크톱/390px 캡처를 확인했다. 검사 브라우저·Vite·Miniflare 프로세스는 정리했다.

제품/HTTP API·DB·SDK 계약·의존성·보존 정책·저장소 위생·CI 러너는 바꾸지 않았다.
프론트엔드 설계와 이 기록을 갱신했다. 변경 없는 전체 백엔드·실제 제공자/운영 부하·원격
DB는 반복하지 않았으며 일반 소스 lint 명령은 없다. 푸시·배포·원격 변경은 없다.

## 관리자 전송·오류 정책 분리 — 2026-10-23

ApiClient의 필수 시그니처·상수/타입 export·ApiError 클래스 식별을 유지하고 endpoint 검증과
AdminTransport의 토큰·요청 큐·기한·취소·본문 정리 수명을 분리했다. 하위 계산/파서/
편집기는 ApiError를 별도 오류 모듈에서 읽어 client와의 실행 시 순환 의존성을 줄였다.
권한 상실 관측 콜백의 예외는 확정 401/403을 덮지 않는다. destroy는 콜백 참조를 먼저
해제하고 onDestroy를 호출하며 기존 오류 전파는 유지한다.

관련 client/요청 수명 집중 66/66과 후속 수명/큐/관측 검사 33/33을 통과했다. 관리자 타입·
빌드·bundle 2/2·Sites 11/11도 통과했다. 전체 검사에서 가상 타이머와 실제 monotonic
시계를 섞던 기존 검사가 CPU 경합으로 1회 실패했다(346/347). 두 시계를 함께 제어하게
수정한 뒤 전체 관리자 347/347이 통과했다. 검사 범위는 겹치므로 합산하지 않는다.
원본 cause·취소 이유·응답 크기·동시 실행 한도·쓰기 재시도 없음·폐기와 늦은 응답을
확인했으며, 새 관측/폐기 예외 검사도 포함한다.

API/DB 계약·의존성·저장소 위생·CI 러너 변경은 없다. 브라우저 통합은 대시보드 계산 분리와
함께 다음 기록에 남긴다. 변경 없는 백엔드 전체·실제 제공자/원격 DB 검사는 반복하지 않았고
일반 소스 lint 명령은 없다. 푸시·배포·원격 변경은 없다.

## 마이그레이션 목록·SQL 분리 공통화 — 2026-10-23

초기화 도구·저장 테스트 fixture·복원 보고서가 같은 검토된 마이그레이션 목록과 SQL 분리
함수를 사용한다. 실제 디렉터리의 SQL과 목록이 다르면 초기화의 DB 조회/적용 전에 실패한다.
트리거 본문과 적용 순서·raw SQL hash는 유지하며 새 목록을 읽을 때 배열을 공유하지 않는다.

기존 설치 메타데이터 검사의 고정 11개 단언은 수정 전 현재 13개에서 실패하는 걸 재현했다.
현재 목록 전체를 대조하게 고친 뒤 루트 `npx tsc --noEmit`과 마이그레이션/프로비저닝/
설치 검사/소요시간/실패 원인 검사 17/17을 통과했다. 목록 누락·추가·중복·트리거 분리,
원자 롤백·재초기화·로컬 CLI·실제 D1의 스키마 누락/변경 검사를 포함한다.

SQL 파일·API/DB 계약·의존성·CI 러너·저장소 위생 변경은 없다. 원격 적용은 하지 않았다.
변경 없는 전체 테스트와 전체 복원 연습은 반복하지 않고 관련 실제 D1 검사로 확인했다.
일반 소스 lint 명령은 없으며 저장소 SQL 분리기는 인용된 세미콜론 없는 기존 규칙을 따른다.


## 이전 검증 기록

원문 구간 순서를 보존했으며, 날짜순으로 다시 정렬하지 않았다. 기록 안의 통과는 당시 실행 범위에만 적용된다.

| 파일 | 기록 수 | 첫 기록 |
| --- | ---: | --- |
| [history-01.md](docs/validation/history-01.md) | 15 | 현재 구현과 운영 문서 대조 — 2026-10-23 |
| [history-02.md](docs/validation/history-02.md) | 24 | 통합 현황의 조회 기준·실제 기간·날짜 변경 안내 (2026-10-23) |
| [history-03.md](docs/validation/history-03.md) | 26 | 자원 수명·경합 개선 최종 검증 (2026-10-23) |
| [history-04.md](docs/validation/history-04.md) | 10 | 관리자 요청 제한의 동기 지연 강제 (2026-10-12) |
| [history-05.md](docs/validation/history-05.md) | 14 | 설정 저장 전 실패·저장 후 응답 유실 실브라우저 검증 (2026-10-12) |
| [history-06.md](docs/validation/history-06.md) | 12 | 설정·스키마 사이 권한 갱신 — 2026-10-12 |
| [history-07.md](docs/validation/history-07.md) | 13 | 누적 데이터·수집 Worker 3개의 동시 부하 — 2026-10-11 |
| [history-08.md](docs/validation/history-08.md) | 11 | 로그 기반 진단 — 2026-10-11 |
| [history-09.md](docs/validation/history-09.md) | 14 | 관리자 서버 발행자 화면 — 2026-10-11 |
| [history-10.md](docs/validation/history-10.md) | 13 | 설정 묶음 기반 관리자 빌드 — 2026-10-11 |
| [history-11.md](docs/validation/history-11.md) | 13 | 서버 SDK 퍼널 연결 전송 — 2026-10-11 |
| [history-12.md](docs/validation/history-12.md) | 15 | 인증된 서버 이벤트 수집 API — 2026-10-11 |
| [history-13.md](docs/validation/history-13.md) | 17 | 브라우저 SDK |
| [history-14.md](docs/validation/history-14.md) | 10 | 2026-10-09 관리자 이벤트 기본 정보 편집 폼 |
| [history-15.md](docs/validation/history-15.md) | 10 | 2026-10-10 거부 원인 수집·관리자 조회 연결 |
| [history-16.md](docs/validation/history-16.md) | 9 | 관리자 요청 대기·취소 개선 — 2026-10-11 |
