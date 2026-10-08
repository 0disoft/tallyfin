# Tallyfin 관리자 화면 프로토타입

선택한 [개요 시안](../../docs/frontend/SELECTED_VISUAL.md)을 검토하는 샘플 UI다.
ModuFile·Sembom·Orchid Pass는 가상의 데이터이며 실제 서비스를 조회하지 않는다.
헤더의 모드 전환으로 **Sample**과 **API 연결**(같은 출처 `/v1` 관리자 API 실조회)을
나눠 볼 수 있다. API 모드는 OIDC 로그인과 관리자 bearer 직접 연결을 제공한다.
실제 인증 제공자 설정과 운영 배포는 아직 연결하지 않았다.

## 실행

수집기와 함께 실행하려면 저장소 루트에서 Node 24 이상을 사용한다.
DB 초기화·등록과 의존성 설치를 마친 뒤 다음 명령을 실행한다.

```sh
npm run dev -- --local --state-dir .tmp/collector-db
```

관리자는 `http://127.0.0.1:5180`, 수집기는 `http://127.0.0.1:5188`에서 실행된다.
포트 변경·설정·종료 절차는 [통합 실행 안내](../../docs/backend/runtime.md#통합-개발-실행)에 있다.

이 폴더에서 Node.js 22.18 이상과 npm을 사용한다.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

이 독립 실행도 `/v1`을 기본 `http://127.0.0.1:5188` 수집기로 전달한다.
서버 환경 변수 `TALLYFIN_COLLECTOR_ORIGIN`으로 다른 루프백 HTTP 포트를 지정한다.
`/auth/callback`은 관리자 화면에서 처리한다. 수집기가 없으면 API 연결은 실패하지만
샘플 모드는 사용할 수 있다.

## 구현 범위

- 프로젝트별 개요·이벤트 분석·목표·설정과 7/14/30일 필터.
- 이벤트 검색·정렬·상세 추이와 차트의 수치 표.
- 이름 변경·검증·초기화. 변경은 메모리에만 유지하며 새로고침하면 초기화된다.
- 로딩·빈 데이터·조회 오류·오래된 데이터·권한 없음의 샘플 상태.
- 모바일 메뉴와 표 내부 가로 스크롤.

샘플 날짜는 2026-10-08로 고정한다. 전체 수집 건수에는 화면 조회도 포함하며,
개요 표는 주요 이벤트 4종만 보여준다. 완료율은 시작 대비 성공 건수이며 분모가
0이면 계산할 수 없음을 표시한다. 샘플 모드에서는 실제 코호트 계산·권한 강제·API·DB·SDK·수집기를
구현하지 않았다(API 연결 모드는 같은 출처 관리자 API를 실제로 조회한다). React와 Recharts는
프로토타입의 선택이며 운영 기술 스택의 확정은 아니다.

## 검증

```sh
npm run typecheck
npm test
npm run build
```

브라우저 검증과 시안 비교 기록은 [design-qa.md](./design-qa.md)에 있다.
운영 성능 예산은 수집 SDK와 관리자 UI를 나누어 검증해야 한다. 현재 관리자
번들은 크기 경고가 있으며 운영 전 코드 분할과 폰트 최적화가 필요하다.

## API 연결 모드

- 엔드포인트 기본값은 현재 출처의 `/v1`이고 다른 출처는 이번 범위가 아니라 거부한다.
- 관리자 bearer 토큰은 메모리에만 두고 localStorage·sessionStorage·쿠키·쿼리·로그에 쓰지 않는다. `연결 끊기`는 토큰을 지우고 진행 중 요청을 중단한 뒤 조회 데이터를 비운다.
- 사용 경로는 `GET /v1/projects`, `/projects/{id}/schemas/{version}`, `/summary`, `/events/{name}/daily`, `/workflows/{id}/daily`이며 `from`/`to`는 프로젝트 시간대의 오늘과 7/14/30일로 계산한다.
- 완료율과 시도 수는 작업 흐름 응답 값을 그대로 쓰고 이벤트 총수로 추론하지 않는다. 서버 출처 이벤트는 집계 경로가 없어 값을 표시하지 않는다.
- 401·403·404·503·네트워크·형식 오류·빈 등록·빈 집계를 구분하고, 실패를 0이나 샘플 수치로 채우지 않는다.

## OIDC 관리자 로그인

관리자 콘솔은 공개 클라이언트 OIDC와 PKCE(S256)로 로그인하고 access/refresh token은
메모리에만 보관한다. 콜백 주소는 현재 출처의 `/auth/callback`이며 state/nonce/verifier는
10분짜리 일회성 sessionStorage 기록으로 보관했다가 코드 교환 전에 지운다.
새로고침하면 재로그인이 필요하며 연결 해제는 로컬 세션을 지운다.

필수 빌드 환경 변수는 `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_SCOPE`
(`openid` 포함)다. 선택값과 CORS·회전 갱신·같은 출처 `/v1` 라우팅 조건은
[OIDC 연결 문서](../../docs/backend/oidc.md#브라우저-관리자-로그인)를 따른다.
실제 제공자와 API audience는 UNDECIDED이며 실제 제공자 로그인은 아직 검증하지 않았다.
