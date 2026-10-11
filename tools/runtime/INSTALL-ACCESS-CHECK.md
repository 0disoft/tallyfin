# 관리자 접근 확인 — `install:access-check`

```powershell
npm run install:access-check -- --dir <prepared-installation> --token-stdin
```

`install:prepare`로 만든 설치 묶음의 다섯 파일을 먼저 재검증한다. 따로 수정한 파일,
이동한 묶음, 알려지지 않은 옵션은 표준 입력을 읽기 전에 거부한다. `--dir`·`--token-stdin`과
`--help`만 지원한다.

토큰은 비대화형 표준 입력에서만 읽는다. 인자·파일·보고서·진단 예외 어디에도 남기지 않는다.
운영자가 이미 쓰는 안전한 토큰 소스가 표준 입력에 연결돼 있어야 한다. 표준 입력이 터미널(TTY)이면
거부하고, 30초 안에 8192바이트 이하 한 줄을 받지 못하면 실패한다. 끝의 한 줄바꿈은 무시한다.
토큰 값을 대화에 붙이거나 파일로 만들거나 명령줄에 넣지 않는다. 파이프 연결은 운영자의 기존
토큰 소스가 맡는다. 위 명령 자체가 파이프를 만들지는 않으므로 표준 입력을 운영자의 소스에
연결해 두고 실행한다.

준비 묶음을 검증한 뒤 검토한 관리자 HTTPS 출처로 순서대로 GET 세 개만 보낸다.
`GET /v1/identity`로 서버가 검증한 issuer가 설정한 발행자와 정확히 같은지 확인하고,
`GET /v1/health`가 `{status:'ok', scope:'administrator_storage_read'}`인지 확인한 뒤,
마지막으로 `GET /v1/projects?limit=1`을 읽는다. 앞 검사가 실패하면 뒤 검사는 요청하지 않는다.
같은 출처·HTTPS·리다이렉트 거부·자격 증명 생략·no-referrer·no-store·재시도 없음을 적용한다.
요청당 5초·토큰 입력 후 검사 15초·본문 16KiB 상한이다.

CLI는 자체적으로 DB에 접근하지 않는다. `admin-storage-read`는 관리자 Worker에 HTTP로 물어본
결과이고, 서버 쪽이 `projects`·`project_grants` 두 제어면 테이블을 읽기 전용으로 확인한다는
뜻이다. 그 성공은 두 제어 테이블 읽기까지이고 서비스 전체 정상 판정이 아니다.

출력은 `tallyfin.install-access-check/v2` JSON이다. `checks`는 `admin-identity`·
`admin-storage-read`·`project-list` 순서이고 각 항목은 고정 `id`·`status(pass|fail|unknown)`·
`code`만 담는다. `accessChecksPassed`는 검사 세 개가 모두 pass일 때만 true이고 이때 종료
코드는 0이다.
`visibleProjectObserved`는 프로젝트 한 건을 읽었으면 true, 목록이 비었으면 false, 프로젝트
조회를 하지 않았으면 null이다. `operationalReadinessVerified`·`remoteChanges`·
`tokensRequested`는 항상 false이고 `manualRequired`가 후속 확인을 나열한다. 원문 토큰·계정
이름·subject·URL·응답 본문·오류 원문은 출력하지 않는다.

빈 프로젝트 목록은 접근 가능한 API를 뜻하지만 최초 프로젝트 권한·생성을 증명하지 않는다.
issuer가 다르면 `identity-issuer-mismatch`로 끝난다. identity 검사가 pass가 아니면
`admin-storage-read`와 `project-list`가 나란히 `identity-check-required` unknown으로 남고
추가 요청은 없다. health 검사만 실패하면 `project-list`가 `storage-check-required` unknown으로
남고 추가 요청은 없다. health 응답의 여분 필드·원문·다른 scope는 fail
`api-response-invalid`다. 네트워크 없음·잘못된 응답·audience 거부처럼 확인하지 못한 결과는
통과로 바꾸지 않는다. 401은 `administrator-authentication-rejected`, 403은
`administrator-access-rejected`, 그 밖의 HTTP 상태는 `api-http-response-unverified`다.

로그인·코드 교환·토큰 발급·갱신·클라이언트 등록·Cloudflare 조회·CLI의 직접 DB 접근·grant 부여·배포·
파일 쓰기는 하지 않는다. 이 검사는 실제 브라우저 로그인·토큰 갱신·최초 owner/생성자 권한·
수집과 Cron·백업/복구를 대신하지 않는다.

3단계 확장 뒤 로컬 집중 검사 7/7이 통과했고 루트 `npm exec -- tsc --noEmit`은 종료 코드 0,
`--help` 출력도 확인했다. Windows 로컬 workerd가 `WSARecv` #64 경고 두 건을 stderr에 냈지만
전체 검사는 통과했고 CLI 성공과 검사 전후 DB 원상 상태까지 확인했다. 이번 확장은 CLI만 바뀌고
API·DB·수집기 코드는 바꾸지 않았다. 실제 제공자·원격 배포는 아직 없다. 검증 기록은
[VALIDATION.md](../../VALIDATION.md)를 따른다. 근거는 [설치 안내](../../docs/backend/installation.md)를
따른다.
