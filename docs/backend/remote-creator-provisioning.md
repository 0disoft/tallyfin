# 원격 프로젝트 생성 권한 등록

신뢰된 DB 운영자가 첫 관리자 계정의 생성 권한을 부여·변경·회수하는 도구다.
로컬 등록 CLI와 별개이며 `project_creators`만 변경한다. 프로젝트 reader/owner grant,
서버 발행 권한, 생성 이력, 관리자 변경 이력, 스키마와 자격증명은 변경하지 않는다.

## 준비

- [설치 설정 묶음](./installation.md)을 준비하고 대상 원격 D1에 기존 마이그레이션을 적용한다.
  이 도구는 DB나 테이블을 만들지 않는다.
- 해당 계정·DB를 조회/편집할 수 있는 기존 Wrangler 인증을 운영자 환경에 준비한다.
  토큰 값을 명령 인자나 입력 JSON에 넣지 않는다. 인증 제공자 등록과 로그인도 자동 수행하지 않는다.
- 관리자가 실제 로그인 후 `로그인 계정 확인`에서 서버가 검증한 issuer/subject를 복사한다.
  운영자는 실제 계정과 대조한 뒤 사용한다. 이메일, 공개 client ID, Origin을 subject로 추측하지 않는다.
- Git이 추적하지 않는 입력 파일에 복사한 두 필드와 허용할 `maxProjects`(1~1000)를 넣는다.
  회수 입력은 issuer/subject만 담는다. 모르는 필드·다른 설치 발급자·잘못된 문자는 거부한다.

## 미리보기와 적용

```powershell
npm run provision:remote-creators -- --help
npm run provision:remote-creators -- creator-grant --remote --dir .tmp/installation --file .tmp/creator-grant.json
npm run provision:remote-creators -- creator-grant --remote --dir .tmp/installation --file .tmp/creator-grant.json --apply --expect-plan <미리보기의-planHash>
npm run provision:remote-creators -- creator-revoke --remote --dir .tmp/installation --file .tmp/creator-revoke.json
```

기본 미리보기도 **원격 DB를 읽는다**. 출력의 계정 ID·DB ID·DB 이름·수집기 이름,
principalHash, 현재 한도·생성 개수·변경 전후 한도를 확인한다. 실제 쓰기는
`--apply --expect-plan`을 함께 지정해야 한다. 회수도 미리보기 후 같은 방식으로 적용한다.

설치 스냅샷과 생성한 네 설정 파일을 다시 검사한다. 임의 Wrangler 설정·환경 선택·SQL·
프로필·로그인·마이그레이션 옵션은 받지 않는다. 계정·DB·수집기·발급자·입력·DB 상태를
계획 해시에 포함하므로 다른 대상이나 바뀐 상태에 이전 해시를 적용할 수 없다.
출력에는 issuer/subject 원문이나 토큰을 넣지 않으며 해시는 암호화가 아니다.

적용은 권한 한도·권한 생성 시각·생성 개수를 조건에 넣은 단일 SQL 쓰기다. 조건이 바뀌면
`apply_conflict`로 멈춘다. 한도 변경은 최초 부여 시각을 보존하며 동일 상태는 no-op이다.
회수해도 기존 프로젝트 권한과 생성 이력은 남는다. 한도를 사용 개수 이하로 낮추면
추가 생성만 막힌다. 최초 프로젝트를 생성하면 기존 생성 API가 그 계정의 첫 owner를
프로젝트 생성과 함께 저장한다.

## 실행 경계와 실패 처리

설치된 Wrangler의 `d1 execute --remote --json --command`로 한 쿼리씩 실행한다.
SQL 파일 실행의 DB import 경로는 쓰지 않는다. 확인한 CLI 동작의 근거는
[D1 Wrangler 명령](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)과
설치된 Wrangler 소스 및 로컬 실행 검사다.

선택한 계정과 DB만 들어간 임시 설정·빈 env 파일을 사용한다. 부모의 API 주소·계정·환경
재지정과 별도 출력 파일을 제외하고 로그 파일·사용량/오류 전송은 비활성화한다.
SQL은 내부에서만 만들며 식별자는 UTF-8 hex 리터럴로 넣어 SQL 구문과 분리한다.
이 인코딩은 비밀 저장 방식이 아니며 SQL을 받는 Cloudflare와 로컬 프로세스 검사자는
식별자를 해석할 수 있다. bearer/Cloudflare 토큰은 SQL·명령 인자에 넣지 않는다.
설치된 CLI 엔트리를 직접 실행하고 30초 제한을 적용한다. 임시 경로가 이번 실행이 만든
하위 디렉터리인지 확인한 뒤 Wrangler 캐시까지 정리한다.

- `invalid_arguments` / `invalid_input`: 명령 옵션·입력 형식을 수정한다.
- `invalid_target` / `issuer_mismatch`: 설치 묶음과 실제 관리자 계정을 다시 확인한다.
- `plan_changed` / `apply_conflict`: 새 미리보기를 읽고 변경을 다시 검토한다.
- `database_unavailable`: 인증·테이블·응답을 확인한다. 쓰기는 이미 반영됐을 수 있다.
  자동 재전송하지 않으며 새 미리보기로 현재 한도를 확인한 뒤 진행한다.
- `cleanup_failed`: DB 반영 여부와 별도로 임시 디렉터리 정리가 필요하다.

현재 증거는 로컬 D1 SQL 검증, 합성 원격 transport, 실제 Wrangler의 로컬 실행이다.
실제 운영 계정·원격 DB·로그인·권한 적용은 아직 검증하지 않았다.
