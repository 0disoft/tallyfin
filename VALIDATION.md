# 검증

상태: 현재 문서 검증만 해당. 가짜 통과 테스트/CI 없음.

## 검증 이름

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 현재 검사
- `docs`: 변경 문서의 상대 Markdown 링크, 계획/구현 상태, 명세·ADR 사이의 일관성을 확인한다.
- `format`: `git diff --check`로 공백 오류를 확인한다.
- `check`: 외부 CLI의 `ssealed doctor . --strict`로 스캐폴드 상태를 확인한다. 의도적인 문서 수정은 `ssealed update . --yes`로 인정한 후 확인한다. 파일 내용을 덮어쓰는 `--force`는 사용하지 않는다.

## 패키지 스크립트 없음
`package.json`과 실행 러너는 아직 없다. 구현 전에는 `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`를 미구성으로 기록하고 통과했다고 표시하지 않는다.

## 아직 실행하지 않음
다음은 미래 범위이며 이번 슬라이스에서 실행/검증하지 않는다:
- 스키마 검증
- 코호트 완료 계산
- 중복 제거(idempotency)
- 프라이버시 허용/금지 목록
- 런타임 테스트

서술(prose) 테스트는 작성하지 않는다.
