# 공개 제공자 검사 — `install:check`

```powershell
npm run install:check -- --dir <prepared-installation>
```

`install:prepare`로 만든 설치 묶음의 다섯 파일을 먼저 재검증한다. 따로 수정한 파일,
이동한 묶음, 알려지지 않은 옵션은 네트워크 요청 전에 거부한다. `--dir`와 `--help`만
지원한다. 실제 제공자 값은 운영자가 확인한 것을 사용한다.

공개 OIDC discovery·JWKS를 GET하고 token endpoint에는 진단용 OPTIONS만 보낸다.
관리자와 같은 출처인 endpoint는 CORS 헤더가 필요 없고 OPTIONS도 생략한다. 발행자
인증을 켰으면 별도 설정의 JWKS도 읽는다. 서명키는 공개 필드만 허용하고 알고리즘·용도·
kid와 실제 import를 확인한다. RSA는 2048비트 이상, ES256은 P-256이어야 한다.

HTTPS·주소 자격 증명/쿼리/해시 거부·리다이렉트 거부·자격 증명 생략·no-referrer·
no-store를 적용한다. 요청당 5초·CLI 전체 45초·본문 64KiB·JWKS 32키 상한이다.
취소를 무시하는 전송도 대기를 끝내고 응답 스트림 정리가 검사 결과를 지연시키지 않는다.
검토한 설치 묶음에서 지정하거나 제공자가 선언한 공개 endpoint만 요청하므로,
신뢰하지 않는 설정을 받아 대신 검사하는 서버 API로 사용하지 않는다.

출력은 `tallyfin.install-check/v1` JSON이다. `checks`의 각 항목은 `id`·
`status(pass|fail|unknown)`·`required`·`code`를 담는다. `publicChecksPassed`는 필수
검사가 모두 pass일 때 true이고 이때 종료 코드는 0이다. 필수 fail/unknown이나 입력
실패는 1이다. `--help`는 0이다. 원문 설정·응답 본문·키·주소·식별자를 출력하지 않는다.

token OPTIONS는 진단일 뿐 실제 코드 교환·토큰 갱신의 증거가 아니다. OPTIONS 실패는
비차단 unknown으로 둔다. `operationalReadinessVerified`·`remoteChanges`·
`tokensRequested`는 항상 false이고 `manualRequired`가 후속 확인을 나열한다.
제공자의 public client·callback·출처·scope·resource/audience·JWT type 실제 등록과
로그인·갱신·운영 Worker/D1/Cron·최초 관리자 권한은 별도로 확인해야 한다.
필수 공개 검사 통과가 운영 준비 완료를 뜻하지 않는다.

명령은 로그인·코드 교환·토큰 발급·클라이언트 등록·Cloudflare 호출·DB 접근·배포·
파일 쓰기를 하지 않는다. 네트워크 fixture 검사와 실제 제공자 검사를 구분한다.
현재 실제 제공자 검사는 미실행이며 [설치 안내](../../docs/backend/installation.md)를 따른다.
