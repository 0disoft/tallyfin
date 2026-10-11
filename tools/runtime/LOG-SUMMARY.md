# 앱 로그 요약 — `logs:summary`

```powershell
# PowerShell 예시: 앱 로그를 직접 node로 파이프한다
Get-Content -LiteralPath app-log.ndjson -Encoding utf8 | node tools/runtime/summarize-observations.ts --stdin

# npm 별칭(Windows는 npm.cmd). 입력을 파이프로 넘긴다
Get-Content -LiteralPath app-log.ndjson -Encoding utf8 | npm.cmd run --silent logs:summary -- --stdin
```

표준 입력의 앱 로그(NDJSON)를 집계해 JSON 한 건을 표준 출력에 쓴다. 옵션은 `--stdin`과 `--help`
둘뿐이고 그 밖은 `invalid_arguments`다. `--help`는 입력을 읽지 않고 사용법만 출력한다. 파일 인자·
URL·대상 설정·자격 증명을 받지 않고 네트워크·Cloudflare export·파일 쓰기를 하지 않는다.

PowerShell의 `npm.ps1` 래퍼로 파이프한 경로는 로컬 스모크에서 실패했다(종료 코드 1, CLI 보고서
없음). 이 경로를 검증된 것으로 쓰지 않고 직접 node나 `npm.cmd` 별칭을 쓴다. `npm run`은
non-silent일 때 배너를 섞으므로 정확한 JSON stdout에는 `--silent`가 필요하다.

## 입력 계약

- 비대화형(TTY 아님) 표준 입력, UTF-8, 줄마다 JSON 레코드 하나. TTY 입력은 `stdin_required`다.
- 상한: 원시 스트림 8MiB, 물리 줄 5만(빈 줄·무시 줄 포함), 줄당 16KiB, 입력 마감 30초.
- 줄 예산은 줄마다 개행 1바이트를 더해 세고, 마지막 개행 없는 줄도 포함한다. 원시 스트림 8MiB는
  별도 예산이다.
- CRLF와 청크 사이에서 잘린 UTF-8은 이어 붙여 처리하고, 잘못되거나 잘린 UTF-8은 `invalid_log`다.
- `event`가 `http_request`인 레코드는 고정 7필드(`event`·`requestId`·`operation`·`status`·`code`·
  `latencyBucket`·`samplingDenominator`)가 정확히 맞아야 한다. 여분·누락 키나 형식 오류는
  `invalid_log`다.
- 아래 정리 로그와 `http_request`에 해당하지 않는 JSON 객체는 무시하고 `ignoredOtherLogLines`로 센다. 문자열·수·
  `null`·배열처럼 객체가 아닌 JSON은 `invalid_log`다. 플랫폼 래퍼(`{logs:[...]}` 등)는
  풀지 않는다.
- 빈 줄은 `blankLines`로 센다.

## 중복과 거부

- 같은 `requestId`의 정규화 필드가 같으면 `duplicateLogLines`로 세고 한 번만 집계한다. 키 순서나
  UUID 대소문자가 달라도 같게 본다.
- 같은 `requestId`의 필드가 다르면 `request_conflict`로 보고서 전체를 거부한다.
- 정리 로그의 같은 종류 중복도 `duplicateLogLines`에 포함한다. 상세 보고와 실패 표시는 별도 종류다.

## 실패 코드

입력 검증 실패는 stdout에 부분 보고서를 내지 않고 보고서는 EOF 뒤 한 번만 쓴다. 입력 실패는 stdout을
비우고 stderr에 `{"code":"..."}` 한 줄과 0이 아닌 종료 코드를 남긴다. 다만 `output_unavailable`
(stdout 쓰기 실패)은 전송이 중간에 끊겼을 수 있어 stdout이 비어 있다고 보장하지 못한다. 받는 쪽은
종료 코드와 유효한 JSON 여부를 함께 확인한다.

| 코드 | 뜻 |
| --- | --- |
| `invalid_arguments` | 옵션 불일치 |
| `stdin_required` | TTY 입력 |
| `invalid_log` | 형식·여분 필드·UTF-8 오류 |
| `input_limit` | 스트림 바이트·줄 수·줄 길이 초과 |
| `request_conflict` | 같은 UUID의 필드 충돌 |
| `no_observations` | 집계할 HTTP·정리 로그가 모두 없음 |
| `run_conflict` | 같은 runId의 상세 정리 보고가 서로 다름 |
| `input_timeout` | 30초 입력 마감 초과 |
| `input_unavailable` | 입력 스트림 오류·조기 종료 |
| `output_unavailable` | 표준 출력 쓰기 실패(닫힌 파이프 등) |

## 출력

`schemaVersion: tallyfin.observation-summary/v2` JSON이다. 패키지 버전을 올리는 것이 아니라 보고서 모양과
인식 규칙을 바꾸는 표시다. `requestId`·프로젝트 ID·원문 `runId`·경로는 넣지 않는다.

| 필드 | 뜻 |
| --- | --- |
| `coverage` | `provided-app-log-lines-only` |
| `exactRequestCounts`·`latencyPercentilesAvailable`·`timeWindowAvailable` | 항상 false |
| `input` | `lines`·`blankLines`·`ignoredOtherLogLines`·`duplicateLogLines` |
| `observedResponses` | 중복을 뺀 관측 응답 줄 수 |
| `weightedRequestsEstimate` | 성공 로그×64 + 그 밖×1 |
| `operations` | `operation`별 합계와 `responses`(status·code), `latencyBuckets` |
| `cleanup` | 아래 실행 수·프로젝트 처리 횟수·커서 진행 보고 집계 |

## 정리(cleanup) 로그

앱은 scheduled에서 `{runId, code: 'retention_cleanup', attempted, completed, failed, cursorAdvanced}` 한
줄을 남기고, `failed>0`이거나 `cursorAdvanced=false`면 같은 `runId`로
`{runId, code: 'retention_cleanup_failed'}` 표시를 남긴다. 보고 전에 예외가 나면 표시만 남는다.
로그는 순서가 섞이거나 중복 export되거나 빠질 수 있다.

- 도구는 `runId`(UUIDv4)로 상세 보고와 표시를 이어 붙인다. 같은 종류의 중복 기록은 한 번만 세고,
  표시와 상세 보고는 서로 보완이지 중복이나 충돌이 아니다. 같은 `runId`의 상세 보고가 서로
  다르면 `run_conflict`로 보고서 전체를 거부한다.
- 검증: 상세 보고 6필드(`runId`·`code`·`attempted`·`completed`·`failed`·`cursorAdvanced`),
  표시 2필드(`runId`·`code`). `attempted`·`completed`·`failed`는 0~`CLEANUP_PROJECT_LIMIT`
  (현재 5) 정수이고 `completed + failed = attempted`, `cursorAdvanced`는 불리언이다.
- 실행별 카운트이고 프로젝트 수가 아니다. `attempted`는 프로젝트 시도 횟수 합계라 같은 프로젝트가
  여러 번 들어갈 수 있다. `completed`는 정리 호출이 성공한 수이지 삭제된 행 수나 만료 데이터를
  전부 지웠다는 뜻이 아니고, `cursorAdvanced=true`도 프로젝트 실패가 없었다는 뜻이 아니다.
- 상세 보고가 없는 실행은 미관측으로 남기고 0 성공으로 바꾸지 않는다. 합계는 상세 보고가 있는 실행만
  덮는다.
- 정리 기록만 있고 `http_request`가 없으면 `observedResponses=0`으로 정상 보고하고, 둘 다 없으면
  `no_observations`다.

`cleanup`은 다음 고정 필드만 담는다. HTTP 로그만 있으면 모두 0이다.

| 필드 | 뜻 |
| --- | --- |
| `observedRuns` | 상세 보고 또는 실패 표시가 있는 고유 실행 수 |
| `reportedRuns` | 상세 보고가 관측된 실행 수 |
| `failureMarkerRuns` | 실패 표시가 관측된 실행 수(상세 보고와 겹칠 수 있음) |
| `reportlessFailureRuns` | 실패 표시만 있고 상세 보고가 없는 실행 수 |
| `attemptedProjects`·`completedProjects`·`failedProjects` | 상세 보고의 시도·성공·실패 횟수 합계 |
| `cursorAdvancedReports`·`cursorNotAdvancedReports` | 상세 보고의 커서 진행·미진행 실행 수 |

프로젝트 처리 횟수와 커서 집계는 `reportedRuns`만 포함한다. `reportlessFailureRuns>0`이면 그
실행의 처리 횟수는 알 수 없으므로 `failedProjects=0`이어도 프로젝트 실패가 없었다고 판단하지
않는다. 실패 표시가 없더라도 상세 보고의 `failed>0` 또는 `cursorAdvanced=false`를 확인한다.

## 해석 한계

- `observedResponses`와 `weightedRequestsEstimate`는 다르다. 뒤쪽은 가중 어림이고 정확한 요청 수가
  아니다.
- 실패 비율·p95·엔드투엔드 지연·SLO 판정은 낼 수 없다. `latencyBucket`은 거친 분포다.
- 플랫폼 표본·절단과 중복 export 때문에 해석이 제한된다. 내장 시간 구간·구간 비교 기능은 없다.
- 로그가 없다고 장애가 없었다고 할 수 없다. 필드·측정 구간·한계는
  [로그 경계](../../docs/backend/06-logging-and-observability.md)와
  [운영 관측](../../docs/ops/observability.md)을 따른다.

## 부담과 근거

- 앱 emitter(`apps/collector/src/request-observation.ts`)는 그대로이며 로그를 더 만들지 않는다.
- 최초 슬라이스는 CLI 도구와 package script를 더했고, 이번 확장은 집계기·검사·문서를 바꾼다. 수집기·API·DB·SDK·환경 변수는 바뀌지 않았고
  CI 워크플로와 의존성도 바뀌지 않았다. 원격 자동화는 돌리지 않았고 성능 수치를 주장하지 않는다.
- 루트 기본 테스트 글롭은 이 도구의 검사 16개(집계기 9개·CLI 7개)를 포함한다.
- 필드·표본 규칙은 [로그 경계](../../docs/backend/06-logging-and-observability.md)에 있다.
