# 검증 이력 12

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

## 인증된 서버 이벤트 수집 API — 2026-10-11

`POST /v1/projects/{projectId}/server-batches`를 별도 발행자 검증기와 연결했다.
관리자 grant와 독립인 발행 권한을 admission 전에 확인하고, 기존 commitServer가 쓰기
직전에 다시 검사한다. 브라우저와 같은 분당·UTC 일일 한도를 쓰며 JSON 전용·16KiB·
20개 한도, POST 전용, 쿼리 거부, CORS 없음·Origin 무시, 동일 ID 재시도와 전체 배치
충돌 거부를 적용한다. 기본은 401로 닫힌다. `PUBLISHER_AUTH_MODE`와 별도
`PUBLISHER_OIDC_*` 설정을 runtime에 연결했고, 서버 토큰은 단일 audience만 받는다.
관리자·발행자 audience를 같게 설정하면 구성 단계에서 거부한다. 발행자 변수가 없는
이전 구성도 disabled로 동작한다.

루트 `npm run check`의 타입 검사·전체 테스트 218/218·브라우저 SDK 크기 검사 통과.
신규 HTTP 테스트 6/6에서는 실제 Miniflare Worker와 D1, 메모리에서 생성한 임시 RSA
서명과 격리된 공개 JWKS transport로 인증과 저장까지 확인했다. 관리자 토큰·다중
audience·잘못된 issuer·만료·서명 변조 거부, owner 권한만 있을 때 발행 거부,
미등록 프로젝트 비공개 403, 발행 권한 회수 전후·저장 전 회수, 중복·충돌·공유
할당량, 잘못된 메서드·미디어 타입·UTF-8·크기·스키마·출처·attempt 입력 거부를
확인했다. 인증·발행 권한 초기 거부는 admission을 쓰지 않으며 그 뒤 잘못된 요청은
한도를 쓴다. OpenAPI lint 경고 없이 통과·계약 검사 42/42 통과.
SDK gzip 2667 bytes·Sembom 예제 포함 2949 bytes로 3072-byte 예산을 유지한다.

OpenAPI 요청 경로·발행자 security scheme, 제품 명세·로드맵·수집/서버 이벤트·OIDC·
실행 문서를 변경했다. DB 구조·마이그레이션·브라우저 SDK·의존성·CI 러너·위생
정책은 변경하지 않았다. UI 변경이 없어 UI 빌드/브라우저 화면 검증은 생략했고 일반
소스 lint 스크립트도 없다. 실제 제공자 자격증명 발급·원격 DB·부하·배포·Sembom
활성화는 실행하지 않았다. 발행자 권한 관리 도구·서버 SDK·서버 출처 조회와
server-only 레지스트리 허용은 후속이다.

## 소유자 전용 변경 이력 조회 API — 2026-10-11

`GET /v1/projects/{projectId}/changes`·코어 AdminChangePage·AdminStore.changes와 D1
reader를 연결했다. 현재 owner와 기록을 같은 batch에서 검사하고 최신 시각·UUID
내림차순으로 기본 25·최대 100건을 읽는다. 프로젝트에 묶인 최대 512자 커서는 기록
시각·UUID만 담고 계정 정보나 권한을 담지 않는다. 물리 정리가 지연돼도 요청 시각 기준
90일 rolling 밖과 미래 기록은 제외한다. API actor와 식별자 없는 CLI actor를 구분하며
각 동작의 최소 필드만 투영하고 recorded-changes-only·생성 시각·보존 기간을 반환한다.

루트 `npm run check`의 타입 검사·전체 테스트 199/199·SDK 크기 검사 통과.
관련 HTTP/기존 관리자 테스트 19/19를 먼저 실행했고, 최대 페이지 검사 추가는 위 전체
실행에 포함했다. 실제 Miniflare D1에서 동시각 페이지·기준 행 삭제·새 기록 재조회,
기본/최대 한도, 보존 경계·만료 행 숨김·타 프로젝트 격리, reader/권한 회수·쓰기 직전
회수, 잘못된 커서/쿼리/메서드, 손상 데이터의 503과 비공개 오류를 확인했다. 기존
native Worker smoke에 변경 이력 조회·다음 페이지·grant 회수 후 403을 추가해 통과했다.
OpenAPI lint·계약 39/39·`git diff --check` 통과. SDK gzip 2667 bytes·예제 포함 2949 bytes.

OpenAPI·예제·코어 저장 포트·DBML의 조회 보존 설명·관리자/제품 문서를 변경했다.
DB 구조·SQL 마이그레이션·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.
화면 연결은 다음 단계라 UI 빌드/브라우저 UI 검사는 실행하지 않았다. 원격 D1·운영
OIDC·부하·푸시·배포·Sembom 활성화는 이번 범위에 포함하지 않았다.

## 관리자 변경 이력 저장 — 2026-10-11

`0005_admin_changes.sql`과 DBML에 프로젝트별 제어 영역 이력을 추가했다. API의
프로젝트 생성·설정 변경·스키마 발행·grant 변경과 로컬 Provisioner의 등록·설정·
스키마 상태·grant 변경은 실제 쓰기와 같은 DB batch에 이력을 넣는다. 실제 변경 없는
설정 요청·동일 상태 재요청·권한 거부·충돌은 이력을 추가하지 않는다. 검증된 관리자
issuer/subject와 CLI의 식별자 없는 local_operator를 구분하며 CLI 변경 대상을 실행자로
추정하지 않는다. 설정 필드명·스키마 번호·grant 이전/이후 역할만 보관하고 설정값·
정의·원시 본문·토큰·방문자 자료는 넣지 않는다.

90일 rolling 보존과 프로젝트별 기본 500행·최대 1000행 정리를 기존 scheduled 경로에
추가했다. 과거 변경은 backfill하지 않고 정상 브라우저 수집에는 기록 쓰기를 추가하지
않았다. UPDATE 불변 트리거·동작별 NULL 관계·설정 필드명 허용 목록과 중복 거부를
DB에서도 검사한다. 신규 owner 전용 조회 API·화면은 다음 단계다.

루트 `npm run check`의 타입 검사·전체 테스트 192/192·SDK 크기 검사 통과.
마지막 필드 제약·CLI rollback 검사 추가 후 관련 D1 테스트 6/6을 다시 실행해 통과했다.
실제 로컬 Miniflare D1에서 API/CLI 이력 실패 시 전체 rollback, 재시도/충돌/동일 값
무기록, 보존 경계·테넌트 격리·삭제 한도, 기존 DB upgrade/재적용·무 backfill·원본 보존,
신규 DB CLI 초기화를 확인했다. 계약 검사 37/37과 `git diff --check` 통과.
SDK gzip 2667 bytes·Sembom 예제 포함 2949 bytes를 유지한다.

DB 구조·마이그레이션·코어 저장 포트의 선택적 설정 저장 시각을 변경했다. HTTP 요청/
응답 형태·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다. 화면 변경이 없어 UI 빌드/
브라우저 검사는 생략했다. 원격 마이그레이션·운영 OIDC·부하·직접 SQL 변경의 기록은
검증 범위에 포함하지 않는다. 푸시·배포·Sembom 활성화는 하지 않았다.

## 관리자 권한 변경 화면 — 2026-10-11

`LiveGrants`에 접힌 계정 추가 폼·행별 역할 변경/회수 버튼을 연결하고,
`GrantChangePanel`에서 대상 식별자와 기존/변경 역할을 검토한 뒤 저장한다.
자기 강등/회수 가능성을 안내하며, 응답 유실 때는 같은 고정 요청만 재확인한다.
권한 상실은 목록·폼을 즉시 제거하고 `LiveSettings` 편집을 잠근다. 설정 초안은
보존하고 관련 스키마/진단/SDK 설정도 재조회한다. 설정 새로고침 중에는 진행 중인
권한 저장/응답 유실 상태를 유지하며, 프로젝트/연결 전환의 늦은 응답은 버린다.

관리자 `npm run typecheck`·`npm run build`·`npm run test:sites` 4/4 통과.
동일 변경 클라이언트의 전체 테스트 118/118은 앞 단계 결과를 재사용했고 UI 연결에는
실브라우저 smoke를 실행했다. 일반 lint 스크립트는 없어 생략했다.

로컬 Vite(127.0.0.1:5182)와 Codex 인앱 Chromium에서 실제 컴포넌트에 합성 transport를
주입해 추가·승격·회수, 확인 전 요청 0건, 응답 유실의 동일 재확인, 마지막 owner 거부,
동시 변경 충돌 뒤 최신 목록, 자기 강등/회수·403 후 입력 잠금과 행 제거, 초안 보존,
저장 지연 중 설정 새로고침·프로젝트 전환 후 늦은 응답 폐기를 확인했다.
reader 전환 때 권한 요청 수가 늘지 않고 목록·추가 폼이 사라진다.
최종 코드를 새 탭에서 로드한 뒤 콘솔 오류가 없었다. 편집 도중 임시 파일 교체로 발생한
과거 HMR 오류는 최종 문서의 런타임 오류로 집계하지 않았다.

실제 CSS innerWidth 320px에서 문서 scrollWidth 303px·패널 253px로 페이지 넘침이 없고,
표 540px은 255px 영역 안에서만 스크롤된다. 508자 식별자를 자르지 않고 표/확인 값은
18px이며 키보드 ArrowRight로 표 스크롤을 확인했다. 뷰포트를 복원하고 검증 탭·서버를
종료했다. 화면은 `.tmp/grants-edit-qa/desktop.png`·`mobile.png`에 저장했다.

제품 명세·로드맵·프론트엔드 설계·관리자 문서·검증 기록을 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.

## 서버 배치 코어 검증·집계 계획 — 2026-10-11

`ServerBatch`·`ServerEvent`·`PreparedServerBatch`와 `parseServerBatch`·
`prepareServerBatch`를 추가했다. 기존 parser/preparer와 구조·등록 속성·시간 검증을
공유하고 server 출처 정의만 허용하며 attempt는 거부한다. canonicalEvent에 출처를
선택적으로 받아 기본 browser 해시 입력 바이트를 유지한다. `planIngest`는 서버 배치의
영수증·이벤트 delta만 만들고 시도·작업 흐름을 만들지 않는다. HTTP handler와 저장
어댑터에는 연결하지 않았으며 현재 공개 browser 경로는 여전히 server 배치를 거부한다.

신규 테스트의 첫 실행에서 기존 dimensionKey의 typed 값 직렬화를 잘못 적은 예상값
한 건이 실패했다. 소스의 기존 직렬화 형식에 맞춰 기대값을 수정하고 루트
`npm run check`를 실행해 타입 검사·203/203 테스트(서버 배치 신규 4개 포함)·브라우저
크기 검사를 통과했다. 기존 Worker/Miniflare·D1 원자 저장·관리자 권한·CLI 회귀도 함께
실행됐다. SDK gzip 2667 bytes, Sembom 연동 포함 2949 bytes로 3072 bytes 예산 이내다.

`tools/contracts`의 `npm run check` 41/41과 `npm run lint`가 통과했다. OpenAPI의
ServerBatch는 아직 HTTP 경로에 연결하지 않은 계약이라 no-unused-components 경고
한 건이 있다. 이 경고를 없애려고 browser 경로에 서버 스키마를 허용하거나 검사 규칙을
완화하지 않았다. ServerBatch·ServerEvent 스키마와 예제를 더하고, 별도 출처·attempt
금지·닫힌 객체·20개 한도·공개 browser 경로의 기존 요청 스키마를 검사한다.

제품 명세·로드맵·서버 이벤트 계약·백엔드 안내·README와 검증 기록을 갱신했다. API의
컴포넌트 스키마만 추가했고 HTTP 경로·인증·DB·마이그레이션·SDK·의존성·CI 러너·위생
정책을 바꾸지 않았다. 새 HTTP 서버 인증/저장 smoke와 서버-only 스키마 등록은 아직
구현하지 않아 실행하지 않았다. 운영 인증·원격 DB 적용·푸시·배포·Sembom 활성화는 없다.

## 서버 발행 권한·출처별 저장 — 2026-10-11

`ServerPrincipal`·`ServerCollectionStore`와 `D1Store.publisherAccess`·`commitServer`를
추가했다. 새 `project_publishers`는 관리자 reader/owner와 독립인 프로젝트·issuer·subject
권한이며 자동 부여하지 않는다. 호스트의 인증 검증이 끝난 주체만 이 포트로 전달해야
한다. 저장 어댑터 자체가 토큰 서명·audience·expiry를 검증하거나 토큰을 발급하지 않는다.
서버 commit은 일관 읽기에서 권한과 출처별 영수증을 읽고 쓰기 batch의 CAS 조건에서
현재 권한을 다시 검사한다. 회수 경쟁이면 쓰기 전부가 롤백되고 재조회에서 403이다.
같은 ID도 browser/server 영수증은 분리되며 UTC 일일 할당량은 프로젝트 전체가 공유한다.

0006은 event_receipts·event_daily_counts의 source CHECK를 browser|server로 넓히기
위해 두 테이블을 복사·재생성하고 기존 인덱스를 복구한다. project_publishers는 빈
테이블로 추가한다. 로컬 initialize는 새 marker와 두 확장 CHECK를 함께 확인해 반복
적용을 막고 임시 테이블·부분 적용 상태를 거부한다. DBML·마이그레이션 안내를 갱신했다.

`node --test packages/storage-d1/test/server-collection.test.ts` 신규 7/7이 통과했고,
루트 `npm run check`의 타입 검사·210/210 테스트·브라우저 크기 검사도 통과했다.
테스트는 관리자 권한과의 분리·project/issuer/subject 격리·동일 ID의 출처 분리·재시도·
충돌·공유 할당량·권한 회수 경쟁·20개 동시 중복 전달·집계 overflow 전체 롤백·보존
정리를 확인한다. 기존 browser·관리자·등록 CLI·로컬 supervisor 회귀도 실행했다.
SDK gzip 2667 bytes, Sembom 포함 2949 bytes로 3072 bytes 예산 이내다.

Miniflare의 빈 DB에 0001~0006을 적용하는 경로와 0001~0005의 기존 browser 영수증·
집계·시도·설정·grant를 가진 DB에 0006만 적용하는 경로를 확인했다. 업그레이드 직전과
직후 행을 대조했고 인덱스 두 개·foreign_key_check·새 권한 0건·재초기화 no-op를 확인했다.
마이그레이션 마지막에 count=-1 제약 실패를 주입했을 때 원래 행·테이블 제약을 유지하고
새 marker와 임시 테이블도 남지 않았다. 확장된 표만 있고 marker를 지운 불완전 상태는
partial_database로 거부한다. 실제 운영 규모의 table copy 시간·원격 D1은 미검증이다.

`tools/contracts`의 `npm run check` 41/41과 `npm run lint`가 통과했다. ServerBatch의
미연결 HTTP 컴포넌트 경고 1건은 유지한다. 일반 소스 lint 명령은 없으며 HTTP 서버
인증 smoke·실제 자격증명·원격 마이그레이션·운영 부하 검증은 아직 연결하지 않아 생략했다.
API 경로와 기존 인증·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.
API 설명·제품 명세·로드맵·서버 이벤트 계약·README도 현재 범위에 맞춰 갱신했다.
실제 OIDC 계정과 원격 D1은 환경이 연결되지 않아 이번 UI 검증에 사용하지 않았다.

## 관리자 권한 변경 클라이언트 — 2026-10-11

관리자 `ApiClient.changeGrant`와 `GrantEditor`를 추가했다. 닫힌 PUT/DELETE 본문과
응답의 프로젝트·계정·역할을 검사하며 모든 변경은 검토 뒤 명시적으로 확인한다.
응답 유실·503·응답 계약 오류는 입력을 고정한 상태에서 같은 요청만 재확인한다.
충돌·마지막 owner 거부는 별도 오류로 표시하고, 권한 상실·언마운트 때 추가 변경과
늦은 응답을 차단한다. 자동 재전송·식별자 저장·로그는 없다.

관련 요청/컨트롤러/기존 목록 테스트 13/13, 관리자 `npm run typecheck`와 전체
`npm test` 118/118 통과. UI 콜백 실패가 확인된 저장을 응답 유실로 바꾸지 않는 것도
검사했다. 아직 화면 연결 전이므로 이번 단계에서는 브라우저 UI smoke·build를
실행하지 않았다. API·DB·SDK·의존성·CI 러너 변경은 없고 푸시·배포도 없다.

## 프로젝트 권한 변경 API — 2026-10-11

owner 전용 `PUT/DELETE /v1/projects/{projectId}/grants`를 로컬 구현했다.
조회한 `expectedRole`로 동시 변경을 검사하고 마지막 owner의 강등·회수를 거부한다.
권한 검사·변경·결과 조회는 같은 D1 batch에 두며, 같은 목표 상태의 재요청은
추가 변경 없이 성공한다. 기존 생성 시각은 보존하고 자기 권한을 바꾸면 결과의
`canManage`에 남은 owner 권한을 반영한다.

루트 `npm run check`의 타입 검사·전체 테스트 186/186·브라우저 크기 검사 통과.
신규 요청 검증 1개와 변경 API 8개, 기존 목록 6개를 함께 실행한 관련 테스트도
15/15 통과했다. 동시 변경·마지막 owner 보호·권한 회수 경합·다른 프로젝트 접근 거부·
재요청·DB 실패 롤백을 확인했고 기존 Worker smoke에서 실제 PUT/DELETE도 실행했다.
`tools/contracts` OpenAPI lint와 계약 검사 37/37, `git diff --check` 통과.
SDK gzip 2667 bytes, Sembom 예제 포함 2949 bytes로 유지된다.

OpenAPI·코어 저장 포트·수집기 오류 계약을 변경했다. DB 구조·마이그레이션·SDK·
의존성·CI 러너·위생 정책 변경은 없다. 화면은 조회만 지원하므로 변경 폼 연결이
남았다. 실제 OIDC 계정·원격 D1·운영 배포는 환경이 연결되지 않아 검증하지 않았고,
푸시·배포·Sembom 활성화도 하지 않았다.

상태: 코어·D1 저장·수집기·브라우저 SDK·관리자 조회/설정 변경 API·OIDC 검증 어댑터와 v0.1 계약·샘플 UI를 로컬에서 검증했다. 브라우저 SDK는 커밋 `cb3f2ff`와 뒤이은 예제·크기 검사·수집기 통합 테스트 및 합성 화면의 실브라우저 측정으로 확인했다. Sembom 예제는 저장소 안에만 두었고 실제 서비스에는 설치·활성화하지 않았다. 실제 인증 제공자·운영 로그인·원격 DB 마이그레이션과 운영 배포는 아직 없다.

2026-10-08 관리자 조회 슬라이스 검증: `apps/collector/src/admin.ts`에 관리자 GET 조회를, `index.ts`에 `createWorker(verifyBearer)` 검증기 포트를 구현했고, 모킹한 trusted 검증기와 실제 D1 grant 경계를 Miniflare에서 확인하는 native Worker 팩토리 smoke 테스트 1개를 추가했다. `node --test`로 `apps/collector/test/admin.test.ts` 9/9 통과. 부모 검증은 루트 `npm run check`(typecheck + 테스트 86개 + SDK+Sembom gzip 2949 bytes 예산)와 `tools/contracts` lint/check 27개 통과다. 이후 추가한 관리자 테스트 1개로 현재 전체 테스트는 87개지만 루트 full check 87은 다시 돌리지 않았다(루트 check 86 → 이후 관리자 9/9). DB 스키마·SQL 마이그레이션 변경은 없고 OpenAPI는 관리자 GET 405 응답 추가와 설명 문구 갱신만 있었다(경로·본문 형태는 그대로). 검증기는 테스트에서만 모킹했고 실제 서명 검증·인증 제공자·토큰 발급은 미구현·미검증이다. 자격증명·토큰은 만들지 않았다. backend 커밋 `404875c`, smoke 추가는 별도 커밋.

## OIDC 검증 어댑터

2026-10-08 OIDC 슬라이스 검증: `packages/auth-oidc`와 `createOidcWorker(options)`를
구현했다(코드 커밋 `7e85001`). 서명/issuer/API audience/만료/발행 시각/필수 클레임,
알고리즘·토큰 타입, JWKS 키 갱신·실패 재시도 제한·크기·본문 시간 제한을 검증한다.
실행 중 생성한 키로 실제 서명을 검증하며 운영용 자격증명은 생성하지 않는다.

관련 테스트 10/10, 루트 `npm run check`(타입 검사 + 전체 테스트 97/97 + 크기 검사)
통과. Miniflare Worker에서도 정상 토큰 200, 잘못된 audience/변조 401, grant 회수 후
403을 확인했다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
`jose ^6`을 서버용 어댑터에 추가했고 새 workspace는 기존 루트 명령으로 검사한다.
OpenAPI·DB·마이그레이션·브라우저 UI·루트 러너 변경은 없다.

실제 인증 제공자·원격 JWKS·브라우저 로그인/PKCE·토큰 발급/갱신·운영 배포는
설정값과 연동 환경이 없어 실행하지 않았다. 공개키 캐시 수명은 10분이고 키 갱신
재조회 간격은 30초다. 토큰별 폐기/로그아웃 반영은 아직 구현하지 않았다.
운영 외부 키 조회·동시 부하는 미검증이며 로컬 transport와 Worker 암호 런타임을
확인한 결과다. 상세 정책은 [OIDC 어댑터](../backend/oidc.md)를 따른다.

## 만료 데이터 예약 정리 — 2026-10-08

Worker `scheduled` 핸들러·D1 순회 커서·0002 추가 마이그레이션을 로컬 구현했다.
회당 최대 5개 프로젝트·6개 테이블별 500행을 처리하고, 중지된 프로젝트를 포함하며
개별 실패 뒤에도 진행한다. CAS로 겹친 실행의 오래된 커서 갱신을 거부한다.

루트 `npm run check`(타입 검사 + 테스트 102/102 + 브라우저 크기 검사) 통과.
추가한 테스트 5개는 프로젝트 순회/재생성/끝 순환/삭제된 대상/중지 프로젝트,
실패 격리/DB 실패/커서 충돌, 실제 workerd 예약 핸들러와 D1 삭제를 확인한다.
501개 만료 영수증 중 500개만 첫 실행에 삭제하고 아직 만료되지 않은 1개는 유지한다.
프로젝트-local 오늘을 포함한 90일 집계 경계와 ingest revision 유지도 확인했다.
기존 0001 데이터가 있는 DB에 0002를 적용해 프로젝트·영수증이 유지됨을 검사했다.

처음 예약 실패 검사는 Miniflare 호출의 reject를 기대해 실패했다. 실제 호스트는
예약 결과의 `outcome: exception`으로 전달하므로 그 결과를 검사하도록 수정했고
단독 예약 검사 3/3 및 위 루트 102/102에서 통과했다.

`tools/contracts` 검사 27/27, `git diff --check` 통과. SDK gzip 2667 bytes,
SDK+Sembom gzip 2949 bytes로 유지된다. DBML에 운영용 커서 테이블을 추가하고
0002와 테스트의 마이그레이션 로더·DB 계약 검사 기대값을 갱신했다. OpenAPI·
브라우저 SDK·루트 package scripts·의존성·CI는 변경하지 않았다.

원격 Cron Trigger 등록·배포·D1 적용은 승인한 배포 범위와 리소스 설정이 없어 실행하지
않았다. 장기 적체·처리량·비용은 운영 측정 전이다. 관리자 UI 검사는 이번 서버 정리
변경 범위 밖이므로 반복하지 않았다. 조건과 롤백은
[자동 정리](../backend/retention-cleanup.md)에 기록한다.

## 로컬 프로젝트 등록·권한 관리 CLI — 2026-10-08

`tools/provision`에 init/register/grant/revoke를 구현했다(코드 커밋 `d8019cf`).
Node 24·Miniflare 영속 로컬 D1을 사용하며 기본은 미리보기다. `--apply`로만
반영하고 `--expect-plan`으로 검토한 입력·DB 상태와 일치하는지 확인한다.
시간대·발행 스키마 불변성, 새 버전 증가, 마지막 owner 보호, CAS 충돌 시
원자적 롤백을 검사한다. CLI는 신뢰된 파일시스템 운영자용이며 로그인을 검사하지 않는다.

타입 검사, CLI 관련 테스트 6/6과 루트 `npm run check`의 전체 108/108 통과.
권한 회수 후 조회 목록에서 제외, 두 owner 제거 계획 사이 충돌, 변경 없는 계획의
오래된 스냅샷 거부, 재등록 no-op, 실제 CLI 프로세스의 help/실패 종료 코드와
영속 DB 재실행을 확인했다. `tools/contracts` 검사 27/27 통과.
SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 3072 bytes 예산 안이다.
`git diff --check` 통과. 설치된 `@types/node` 24.19.1을 개발 의존성 `^24`로
추가하고 CLI를 루트 타입 검사·테스트 러너에 포함했다. 실행 코드·설치 버전은 검사 후
변경하지 않았고 의존성 선언 범위만 같은 메이저로 넓혔다.

OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다.
권한 문서 `docs/backend/02-authorization.md`에 로컬 운영자와 조회 grant 경계를
명시하고 사용법·복구를 `docs/backend/provisioning.md`에 기록했다.
실제 인증 제공자 사용자·운영 권한·원격 DB·배포·부하는 환경 설정과 승인 범위가 없어
실행하지 않았다. UI 검사는 이번 CLI 범위 밖이므로 반복하지 않았다.
원격 푸시·배포·마이그레이션은 실행하지 않았다.

## 수집기 실행·배포 구성 — 2026-10-08

런타임 코드 커밋 `3eda6ef`: `apps/collector/src/runtime.ts`가 D1·OIDC 환경 설정을
검사하고 같은 설정의 검증기 캐시를 재사용한다. 공통 팩토리·닫힌 기본 export는
유지한다. `collector:dev`는 등록 CLI와 같은 영속 로컬 D1을 열고 초기화 상태를
확인한다. 127.0.0.1에서 구동하고 60초마다 정리를 예약하며 겹친 실행을 막고 종료 시
진행 중 정리·타이머·런타임을 정리한다. 코드·설정 변경 후 재시작이 필요하다.

`npm run check` 통과: Wrangler 생성 타입·공통/호스트 타입 검사, 전체 테스트 111/111,
브라우저 크기 검사. 추가한 config/runtime 검사 3/3은 설정 오류·네트워크 없는 검증,
환경 바인딩을 통한 실제 테스트 서명·401/200·grant 회수 후 403·scheduled 호출,
등록 CLI에서 만든 DB 재사용·초기화 없는 DB 거부·종료 후 리스너 해제를 확인했다.
60초 타이머 자체의 장시간 관측은 반복하지 않았고 정리 호출은 직접 검증했다.

`collector:config`는 입력한 계정·DB ID와 OIDC 설정의 형식을 검사하고 새 파일만 만든다.
원격 요청·리소스 생성·덮어쓰기는 없다. 이후 대상 준비 도구의 타입 검사와 관련 테스트
3/3 통과. 현재 테스트는 114개이며 전체 114개를 다시 돌리지 않았다(전체 111 + 추가 3).
`npm run collector:dev -- --help` 통과. `npm run collector:dry-run`으로 업로드 없이
기본 Worker 번들을 검사했다: 97.63KiB, gzip 24.61KiB. 실제 운영 대상 값이 없어
운영 설정으로 묶음을 만들거나 원격 ID 존재·소유권을 확인하지 않았다.

개발 의존성 `wrangler ^4`(설치 4.148.0)를 추가했다. 검증된 compatibility date
2026-08-06은 유지한다. 루트 타입 검사는 `.tmp`에 플랫폼 타입을 생성하고 별도 호스트
tsconfig로 검사한다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다. `.wrangler`·`.dev.vars`
무시 규칙을 추가했다. 실행 설정·로그 정책은 `wrangler.jsonc`와
`docs/backend/runtime.md`, 운영 설정 문서는 `docs/ops/config-and-env.md`에 반영했다.
구조화 앱 로그만 켜고 요청 URL을 담는 호출 로그·자동 traces는 프라이버시 계약에 따라
끈다. 플랫폼 자체 로그의 저장·반출은 원격 환경에서 추가로 검토해야 한다.

원격 인증 제공자 연결·D1 마이그레이션·grant 등록·Cron Trigger·배포·부하는 실제
리소스/설정과 승인 범위가 없어 실행하지 않았다. UI 검사는 변경 범위 밖이다.
푸시·배포·원격 리소스 변경은 실행하지 않았다. 계약 검사 27/27,
`git diff --check`, `ssealed update . --yes`·`ssealed doctor . --strict` 통과.

## 검증 이름
스캐폴드 `ssealed update . --yes`, `ssealed doctor . --strict` 통과.
매니페스트의 기존 키 정렬을 유지해 체크섬 갱신만 남겼다.

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 루트 패키지
저장소 루트는 npm workspaces와 Node 24 실행 러너를 쓴다.

```sh
npm ci --ignore-scripts
npm ci --prefix prototypes/admin --ignore-scripts
npm run typecheck
npm test
npm run check
```

- `typecheck`: `tsc --noEmit`로 코어·저장 어댑터·수집기·브라우저 SDK 소스와 `examples/sembom` 예제 소스를 검사한다.
- `test`: `node --test`로 `packages/core`·`packages/storage-d1`·`packages/browser`·`apps/collector` 테스트를 실행한다.
- `test:core`: 코어 테스트만 실행한다. 등록·배치·시간·해시 검증은 통과 상태다.
- `test:browser`: 브라우저 SDK 테스트만 실행한다.
- `build:browser`: esbuild로 `packages/browser/dist/index.js`를 만들고 `tsc -p tsconfig.build.json`으로 타입 선언을 낸다.
- `check:browser-size`: 예제 스키마 투영 일치와 브라우저 번들 크기 예산을 검사한다.
- `check`: `typecheck`·`test`·`check:browser-size`를 순서대로 실행한다.

저장 어댑터 테스트는 Miniflare D1에 `db/migrations/0001_initial.sql`을 적용해 원자적
커밋·CAS 가드·중복·할당량·만료 정리를 확인한다. 수집기 테스트는 esbuild로 번들한
Worker를 Miniflare에서 호출해 HTTP 경계(오리진·본문 한도·CORS·오류 응답·관리자 401)를
확인한다. 테스트는 Node 24와 Miniflare 4의 workerd 바이너리를 쓰며 `compatibilityDate`는
`2026-08-06`이다. 더 새로운 날짜(예: 2026-10-08)는 아직 검증하지 않았다.

2026-10-08 검증: 루트 `npm run check`(실행 당시 typecheck + 테스트 78개)와 별도 `check:browser-size` 통과. 이후 기본 `check`에 크기 검사도 연결했다. 테스트는 기존 58개에 브라우저 SDK 19개와 SDK→Worker→D1 통합 1개를 더한 78개다. `npm run build:browser`와 `npm run check:browser-size` 통과, 크기는 SDK 5747 bytes/gzip 2667 bytes, SDK+Sembom 어댑터·스키마 6628 bytes/gzip 2949 bytes로 3072 bytes 예산 안이다. 개발 전용 계약 검사 `tools/contracts` lint/check 27개 통과, OpenAPI Redocly lint와 타입 검사 통과. `npm ci`는 기존 설치 상태라 이번에 다시 돌리지 않았고 `git diff --check` 통과.

루트 테스트에는 `tools/provision`·`tools/runtime`도 포함한다. 통합 실행 테스트가
관리자 서버를 사용하므로 `prototypes/admin` 의존성은 별도로 설치한다.

## 계약 검사
개발 전용 계약 검사 패키지는 `tools/contracts/`이며 운영 코드와 분리한다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

`lint`는 Redocly의 OpenAPI 3.1 구문·참조 검사다. `check`는 JSON 예시, 잘못된 wire
입력, 예시의 등록/카디널리티/날짜/집계 일치, DBML 파싱과 문서 링크를 검사한다.
수집 상태 머신·DB 트랜잭션·운영 인증·원격 마이그레이션을 실행하지 않는다.
