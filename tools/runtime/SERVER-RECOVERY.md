# 서버 SDK 복구 확인 — `verify:server-recovery`

```powershell
npm run verify:server-recovery
```

이 명령은 `--help`만 지원한다. 엔드포인트·대상·자격 증명·기존 DB 경로 같은 옵션은 받지 않고,
`--help`가 아닌 인자를 주면 거부하고 종료 코드 1로 끝난다. CI와 `npm run check`에는 들어 있지
않으므로 필요할 때만 직접 실행한다. 실행할 때마다 새 합성 환경만 만들고 기존·원격 DB와 외부
발행자에는 접속하지 않는다.

`@tallyfin/server` SDK를 주입 없이 그대로 쓴다. 즉 SDK의 기본 플랫폼(실제 `fetch`·타이머·
`crypto`)이 실제 루프백 소켓으로 요청을 보낸다. 한 번의 실행에서 확인하는 것은 "실패 뒤 재시도가
같은 바이트를 다시 보내고, 그 중복이 수집기에서 걸러지는가"까지다.

이 문서는 `tools/runtime/server-recovery.ts`, `tools/runtime/collector-harness.ts`,
`packages/server/src/index.ts`의 현재 코드를 기준으로 쓰고, 끝에 한 번의 로컬 실행 결과를
덧붙인다.

## 실행 구조

매 실행은 `.tmp/server-recovery/run-<random>/`를 만들고 그 안에 상태를 둔다.

- `collectorHarness(dir, undefined, 3)`이 `collector-0`·`collector-1`·`collector-2` 세 수집기를
  Miniflare로 띄우고 `DB` 하나를 공유한다. DB ID는 `crypto.randomUUID()`로 매번 새로 만든다.
- 발행자·관리자 토큰은 매 실행 메모리에서 생성한 RS256 키쌍과 합성 JWKS로만 서명한다. 외부 발행자
  로그인·JWKS 조회·토큰 갱신은 없다. SDK의 `getToken`은 호출 때마다 이 메모리 토큰을 돌려주고,
  SDK는 토큰을 저장하지 않는다.
- relay는 `127.0.0.1`의 임의 포트에 `node:http` 서버로 뜬다. SDK가 보는 endpoint는 이 relay의
  `http://127.0.0.1:<port>/v1/projects/recovery-funnel/server-batches`이고, 루프백이라
  `allowLocalHttp: true`를 준다.
- 브라우저 시드는 relay를 거치지 않고 `collector-0`에 직접 `POST`해 `file_selected`·
  `upload_finished` 두 이벤트를 넣는다(200, accepted 2). 같은 `runId`로 서버 단계 `job_started`·
  `job_finished`가 뒤따라 4단계를 완성한다.
- 합성 레지스트리의 `job_finished.kind` 허용 값 순서를 뒤집어, Core에서 같은 집합으로
  인정한 규칙을 SDK도 받아들이는지 실제 전송 경로에서 확인한다. 원본 예제 파일은 바꾸지 않는다.

relay는 `POST`와 정확한 경로가 아니면 404, 본문이 16KiB를 넘으면 413으로 끝낸다. 받은 본문은
sha256만 계산해 메모리 배열에 담고, 본문 자체는 밖으로 내보내지 않는다. 통과한 요청은
`collector-(n % 3)`로 순서대로 넘기고, 수집기가 붙인 `X-Tallyfin-Bench-Worker` 헤더가 의도한
이름과 같은지, 응답 본문이 1024바이트 이하인지 확인한다.

## 두 번의 fault 단계

각 단계에서 SDK는 `send()`를 한 번 호출하고, 결과가 아래 표와 정확히 같은지 본다.

| 단계 | relay 동작 | SDK 결과 |
| --- | --- | --- |
| `before-commit` | 첫 요청을 커밋 전으로 간주하고 `503` + `Retry-After: 1` | 재시도 성공: `delivered`, accepted 2, duplicates 0, attempts 2 |
| `after-commit` | 첫 요청은 한 수집기로 전달해 `200` ack을 받은 뒤 클라이언트 소켓만 종료 | 같은 본문 재시도가 다른 수집기로 전달: `delivered`, accepted 0, duplicates 2, attempts 2 |

두 단계 모두 relay에 도착한 SDK 본문이 정확히 두 건이고 그 두 건의 sha256이 같아야 한다. 즉
재시도가 같은 바이트를 다시 보냈는지를 확인한다. after-commit에서 재시도가 향한 수집기는 첫
전달과 달라야 한다.

## 커밋 뒤 소켓 손실의 의미

after-commit 단계의 소켓 종료는 "수집기가 커밋을 끝내고 200 ack까지 준 뒤, 클라이언트에는 응답이
돌아가지 않게" 일부러 만든 상황이다. 클라이언트는 실패로 보고 같은 본문을 다시 보내고, 두 번째
시도에서 중복 2건으로 정리된다.

이것은 전원 장애나 프로세스 강제 종료를 재현한 것이 아니고, relay나 클라이언트에 durable outbox나
exactly-once 전달을 넣었다는 뜻도 아니다. 확인하는 것은 재시도 중복 제거가 수집기 쪽에서
동작한다는 점과, 재시도를 위해 같은 본문이 그대로 유지된다는 점이다.

## 무결성 확인과 발행자 회수

두 단계가 끝나면 다음을 D1 SQL로 직접 확인한다.

- `event_daily_counts`를 `source`·`event_name`으로 묶은 `SUM(count)`가 등록 이벤트 네 개
  (`file_selected`·`upload_finished`·`job_started`·`job_finished`) 모두 2다.
- `event_receipts`가 8건이다(단계마다 브라우저 2 + 서버 2).
- `funnel_runs`가 2건이고, 두 run 모두 `json_array_length(step_times_json)`이 4이며 단계
  시각이 null 없이 채워져 있다.
- `funnel_daily_counts`가 `step_index` 0..3 모두 `reached_count` 2다.
- 발행자 grant를 회수한 뒤 `send()`가 `rejected`, httpStatus 403, attempts 1, retryable false로
  끝난다.
- 이때 relay가 받은 본문은 1건이고, `event_daily_counts` 스냅샷과 `event_receipts` 8건은 회수
  전과 같다.
- 발행자가 회수돼도 관리자 읽기는 살아 있다. 세 수집기의 `funnels/conversion/daily` 읽기가 모두
  200이고 `startedRuns` 2, `completedRuns` 2, `completionRate` 100이다.

## 예산과 종료

- SDK 요청 타임아웃 5초(`requestTimeoutMs`), 재시도 예산 15초(`retryBudgetMs`), 최대 시도
  3회(기본값). 타임아웃은 자격 증명 획득·요청·응답 본문 읽기를 모두 덮는다.
- relay 자체의 `requestTimeout`·`headersTimeout`은 각각 15초다.
- CLI는 전체 60초 예산을 걸고 `SIGINT`·`SIGTERM`으로 중단할 수 있다.
- 종료는 `finally`에서 한다. relay는 `closeAllConnections()` 뒤 `close()`로 닫고, 진행 중이던
  요청 promise를 모두 기다린 다음 `mf.dispose()`로 런타임을 정리한다. 실패해도 같은 경로를 탄다.

## 보고서

`tallyfin.server-recovery/v1` JSON을 실행 디렉터리의 `report.json`에 쓴다(`wx`라 이미 있으면
실패한다). CLI는 표준 출력에 이 JSON을 그대로 쓰되 실행 디렉터리를 가리키는 `output`을 더한다.
실패하면 `failure.json`을 남기고 `phase`와 경로를 담은 메시지를 stderr에 쓴 뒤 종료 코드 1로
끝난다. `phase`는 `provision`·단계 이름·`verify-and-revoke` 중 하나다.

| 필드 | 값 |
| --- | --- |
| `local`·`syntheticData`·`verified` | true |
| `defaultSdkFetch` | true (SDK 플랫폼을 주입하지 않음) |
| `workerCount` | 3 |
| `existingDatabasesAccessed`·`remoteChanges` | false |
| `responseLoss` | `socket-closed-after-verified-commit` |
| `results` | 단계별 `{ mode, status, accepted, duplicates, attempts }` |
| `denied` | `{ attempts: 1, httpStatus: 403 }` |
| `receipts`·`completedRuns` | 8·2 |
| `unchangedAfterDenial`·`byteIdenticalRetries` | true |
| `observations` | relay가 기록한 `{ mode, upstreamStatus, worker, responseLost }` |

보고서에는 본문·토큰·자격 증명·원문 식별자를 넣지 않는다. 본문 sha256도 진단용 메모리에만 남고
보고서에는 들어가지 않는다.

## 실행 결과

`npm.cmd run verify:server-recovery`를 Windows 로컬에서 실행해 종료 코드 0과 보고서의
`verified: true`를 확인했다(결과 파일 `.tmp/server-recovery/run-yHHyGG/report.json`). 이
실행에서 본 값은 다음과 같다.

- `local`·`syntheticData`·`verified`·`defaultSdkFetch` 모두 true, `workerCount` 3,
  `existingDatabasesAccessed`·`remoteChanges` false, `responseLoss`는
  `socket-closed-after-verified-commit`이다.
- before-commit: 첫 요청이 `503` + `Retry-After: 1`이고, 재전송이 accepted 2·duplicates 0·
  attempts 2로 끝났다.
- after-commit: 첫 전달이 한 수집기에 저장되고 `200` ack까지 받은 뒤 클라이언트 소켓만
  끊겼고, 재시도가 다른 수집기로 가 accepted 0·duplicates 2·attempts 2로 정리됐다.
- 두 단계 모두 relay에 도착한 SDK 본문의 sha256이 서로 같았다(`byteIdenticalRetries` true).
- 각 단계에 브라우저 시드 2 + 서버 2가 들어가 `event_daily_counts`의 이벤트별 `SUM(count)`가
  네 이벤트 모두 2, `event_receipts` 8건, `funnel_daily_counts`의 step 0..3 모두
  `reached_count` 2, `completedRuns` 2를 확인했다.
- `funnel_runs`가 2건이고 두 run 모두 `step_times_json`에 4단계 시각이 null 없이 들어 있다.
- 발행자 grant를 회수한 뒤 `send()`가 403·attempts 1·retryable false로 끝나고, 이때 relay가
  받은 본문 1건과 함께 집계·receipts 8건은 회수 전과 같았다(`unchangedAfterDenial` true).
  회수 뒤에도 owner 읽기는 수집기 3곳 모두 200이고 `startedRuns` 2·`completedRuns` 2·
  `completionRate` 100이다.
- `--help`는 종료 코드 0, `--target https://example.invalid`는 거부되어 종료 코드 1이며 원격
  연결은 일어나지 않았다. 루트 `tsc`는 종료 코드 0이다.

이 실행은 문서와 테스트 자산만 늘렸고 API·DB·SDK·의존성·CI는 바꾸지 않았다. `verify:server-recovery`는
옵트인 명령이라 기본 `test`·`check`·CI에는 들어 있지 않다.

## 아직 확인하지 않은 것

- 실제 외부 OIDC 발행자 로그인과 JWKS 조회.
- 원격 D1, 다중 프로세스, 다중 지역.
- 절전과 강제 프로세스 종료, 프로세스 재시작을 넘는 중복 제거.
- relay·클라이언트의 지속 outbox와 exactly-once 전달.
