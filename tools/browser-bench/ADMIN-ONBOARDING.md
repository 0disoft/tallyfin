# 첫 프로젝트 연결 검증

`verify:admin-onboarding`은 실제 관리자 UI와 브라우저 SDK를 격리된 로컬 환경에서 실행한다.
빈 프로젝트 목록에서 프로젝트 생성 → 정의 검증·검토·v1 발행 → 생성된 SDK 실행 →
첫 이벤트 조회까지 확인한다. 기본 검사와 CI에는 포함하지 않는다.

## 실행

Node 24 이상과 [로그인 검증 안내](ADMIN-LOGIN.md)의 Playwright 준비가 필요하다.
브라우저는 실행 중 자동 설치하지 않는다.

```powershell
npm run build:browser
npm run verify:admin-onboarding -- --channel chromium
```

`--channel`은 `chromium`, `chrome`, `msedge`를 받는다. `--help`는 실행 없이 사용법을 출력한다.

## 검증 범위

- 합성 서명 제공자로 로그인한 뒤 빈 프로젝트 목록에서 UI로 프로젝트를 만든다.
- 이벤트 `action_complete`를 정의하고 검증·개인정보 검토·첫 버전 발행을 수행한다.
- UI가 생성한 코드를 현재 빌드한 `@tallyfin/browser`와 함께 컴파일하고 실제 브라우저에서
  전송한다. DB의 브라우저 집계와 관리자 이벤트 표가 각각 정확히 1건인지 확인한다.
- 스키마 발행 후 상단이 `3 SDK 연결`로 갱신되는지 확인한다. 이 단계 자체는 이벤트 수신
  증명이 아니다.
- 관리자 요청의 bearer와 브라우저 배치의 자격 증명 없음, 쿠키·local/session storage 비어
  있음, 페이지 오류 없음을 확인한다.

## 격리와 출력

실행마다 새 Miniflare D1과 Vite 캐시를 만든다. onboarding 프로필에서만 합성 계정에
프로젝트 생성 권한을 주고 루프백 HTTP를 허용한다. 기본 로그인 검증의 GET 전용 프로필은
유지한다. 외부 출처 요청은 합성 제공자 응답을 제외하고 중단하며 운영 설정·DB는 바꾸지 않는다.

성공하면 표준 출력과 `.tmp/admin-onboarding-*/report.json`에 검증 여부와 고정 횟수를 기록한다.
실패하면 고정 단계와 코드 `admin_onboarding_failed`를 출력하고 종료 코드 1을 낸다.
실패 보고서·합성 화면 스크린샷도 해당 로컬 임시 폴더에만 남는다. 보고서에는 토큰·계정
식별자·원문 URL을 넣지 않는다. 임시 자료는 Git에서 제외하며 자동 삭제하지 않는다.

90초 뒤 브라우저를 닫아 작업을 중단하고 종료 처리에서 브라우저·Vite·Miniflare를 닫는다.
환경 초기화·정리 시간 때문에 총 실행 시간은 더 길 수 있다.

실제 OIDC 제공자·운영 도메인·원격 DB·배포와 실서비스 연동은 이 검증 범위 밖이다.
실행 결과는 [VALIDATION.md](../../VALIDATION.md)를 따른다.
