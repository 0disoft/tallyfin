# SDK 패키지 확인

```powershell
npm run verify:sdk-packages
```

Node 24 이상과 저장소의 기존 개발 의존성을 사용한다. 기본 검사와 CI에는 넣지 않았다.
공개 전에 실제 tarball 소비 경로를 확인할 때 명시적으로 실행한다.

1. browser/server `dist`에 회귀 검사용 오래된 파일을 넣고 기존 workspace build를 실행한다.
   빌드는 해당 SDK의 실제 경로가 저장소 안에 있는지 확인하고 `dist`만 정리한다.
2. `npm pack --offline --ignore-scripts`로 두 로컬 tarball을 `.tmp/sdk-packages/run-*`에 만든다.
   현재 배포 파일 목록과 정확히 맞는지 검사해 소스·테스트·설정·이전 선언 파일 혼입을 막는다.
3. 작업공간 밖의 새 임시 npm 프로젝트에 그 tarball만 설치한다. 오프라인·스크립트 금지·
   lockfile 미생성·audit/fund 비활성 상태이며 실제 설치 경로가 workspace symlink가 아닌지 확인한다.
4. 그 프로젝트에서 세 ESM 진입점(`@tallyfin/browser`, `@tallyfin/browser/funnels`,
   `@tallyfin/server`)과 선언 파일을 TypeScript NodeNext로 컴파일하고 Node에서 실행한다.
   browser는 비활성 상태로 생성·해제하고 server는 이벤트 하나만 만든다.
   네트워크·토큰 콜백 호출이 없음을 검사한다. 실제 전송·브라우저 동작 검사는 별도다.

성공하면 `report.json`과 stdout의 `tallyfin.sdk-packages/v1` 보고서에 tarball 이름·크기·
SHA-256·파일 목록·타입/실행 결과를 남긴다. 실패는 종료 코드 1과 고정 phase/code만 출력한다.
대상 없는 `--help`도 지원한다. 임시 소비 프로젝트는 성공·실패 뒤 제거하며 tarball과 보고서는
Git 제외 경로에 남긴다. 자식 명령에는 45초, 전체에는 120초 상한을 둔다.

상위 `npm run`이 `.npmrc`의 allow-scripts를 환경 변수로 다시 전달하면 최신 npm이 이를
프로젝트 설치용 CLI 허용 정책으로 오해해 `EALLOWSCRIPTS`로 거부할 수 있다. 자식 환경의
해당 재전달 값만 제거해 원래 `.npmrc` 정책을 읽게 한다. 사용자 설정은 수정하지 않고,
pack/install의 `--ignore-scripts`는 유지한다.

이 명령은 registry 조회·로그인·게시·의존성 추가·버전 변경을 하지 않는다. 두 SDK는
여전히 `private: true`, `0.0.0`이며 라이선스·공개 scope·릴리스 방식은 운영자가 확정해야 한다.
검증 기록은 [VALIDATION.md](../../VALIDATION.md), 패키지 경계는
[workspace-boundaries.md](../../docs/monorepo/workspace-boundaries.md)를 따른다.
