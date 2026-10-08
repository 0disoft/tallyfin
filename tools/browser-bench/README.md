# 브라우저 SDK 로컬 측정

같은 덧셈 화면에서 SDK를 불러오지 않는 `disabled`와 SDK·예시 스키마를 연결한
`enabled`를 번갈아 측정한다. 초기 실행과 동기 호출 비용을 확인하고, 실제 로컬
수집기·D1에 집계된 값이 기대값과 맞는지 검증한다. 실제 서비스의 성능 측정은 별도다.

## 설치와 실행

저장소 루트에서 Node 24 이상을 사용한다. Playwright는 이 폴더에만 설치되는
개발용 의존성(`^1`)이며 SDK·수집기·기본 CI 검사에는 포함되지 않는다.

```sh
npm ci --ignore-scripts
npm ci --prefix tools/browser-bench --ignore-scripts
npm run bench:browser -- --channel chrome --samples 5
```

설치된 Edge는 `--channel msedge`로 선택한다. Chromium을 사용할 때는 아래 명령으로
전용 브라우저를 설치하고 채널 옵션 없이 실행한다. 브라우저 설치는 측정 실행 중
자동으로 하지 않는다. 설치된 개인 브라우저 프로필도 사용하지 않는다.

```sh
node tools/browser-bench/node_modules/playwright/cli.js install chromium
npm run bench:browser
```

`--samples`는 모드별 반복 횟수이며 기본 5, 허용 범위 2..20이다. 각 화면에서
정상 계산 11회와 필수 입력 오류 1회를 확인한다. 활성 화면당 조회 1건·시작 11건·
성공 11건·오류 1건, 총 24개 이벤트가 저장되어야 한다. 입력 숫자는 전송하지 않는다.

## 격리와 장애 확인

매 실행마다 새 임시 로컬 D1과 무작위 포트의 `127.0.0.1` 서버를 사용한다.
기존 등록 예시의 origin만 측정 서버 주소로 바꾸고 이 임시 DB에 등록한다.
운영 DB·자격 증명은 사용하지 않는다. 브라우저 페이지 요청은 측정 서버 출처만
허용한다. 신뢰된 로컬 DB 접근으로 집계를 읽으며 관리자 인증 우회 HTTP 경로는 없다.

비활성 화면의 SDK 다운로드·수집 요청이 0건인지 확인한다. 활성 화면의 200 응답과
DB 집계를 확인한 뒤 실제 수집기를 종료하고 `outage` 화면을 실행한다. 입력·계산·
오류 복구가 계속 동작하고 프록시가 503을 반환하는지 관찰한다. SDK `destroy()` 이후
재시도가 멈추는지도 확인한다. 종료·실패·Ctrl+C 시 소유한 서버와 브라우저를 닫고
임시 DB를 삭제한다. 결과 JSON은 남긴다.

## 결과와 해석

원시 기록과 요약은 `.tmp/browser-bench/<타임스탬프>.json`에 저장한다. 실행 환경·
브라우저 버전·반복별 측정값·DB 집계·요청 건수·본문 바이트·상태 코드를 포함한다.
전송 본문과 자격 증명은 기록하지 않는다. 요청의 Origin 존재 여부와 쿠키·인증·
Referer 부재도 검사한다.

- `sdkImportMs`: 다운로드·모듈 컴파일/연결·평가를 포함한 동적 import 시간.
- `sdkInitMs`, `sdkCallsMs`, `handlersMs`: 클라이언트 초기화, 동기 SDK 호출, 입력/계산 핸들러 실행 시간.
- `handlerToSecondFrameMs`: 핸들러 시작부터 두 번째 rAF 콜백까지의 시간. 실제 화면 표시 시각이나 INP가 아니다.
- FCP, 임계값 16ms의 Event Timing, long task: 지원되는 브라우저에서만 수집한다. Event Timing/long task는 원시 기록에 있다.
- SDK 리소스의 전송/인코딩/디코딩 바이트와 별도로 계산한 gzip 크기. 측정 서버는 SDK 파일을 압축 없이 제공한다.

새 컨텍스트·no-store·headless 1280×800·CPU/네트워크 제한 없음 조건이다. 같은 브라우저
프로세스는 재사용한다. FCP가 SDK import보다 먼저 찍힐 수 있고 초기 브라우저 실행
편차도 섞인다. 호출/핸들러 p95는 여러 화면의 호출을 합친 분포이며 독립적인 사용자
표본으로 해석하지 않는다. 소표본 결과로 운영 지연이나 Core Web Vitals 점수를
확정하지 않는다. 0ms 측정은 브라우저 시계 해상도 아래일 수 있다. Event Timing이
비어 있는 경우도 임계값 미만 또는 미지원일 수 있다.

실행 결과는 [성능 예산](../../docs/engineering/03-performance-budget.md)에 기록한다.
API 정의는 [Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming),
[Event Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming), 브라우저 선택은
[Playwright 안내](https://playwright.dev/docs/browsers)를 따른다.

브라우저 실행 파일을 찾지 못하면 설치된 채널을 선택하거나 위 Chromium 설치를
실행한다. 설치 오류·저장 불일치·계산 오류는 성공으로 처리하지 않으며 비정상 종료한다.
이 도구는 필요할 때 로컬에서 실행하며 기본 `npm run check`에는 연결하지 않는다.
