# 검증

상태: 문서·v0.1 계약·샘플 UI의 로컬 검증이 해당한다. 실제 수집·조회·DB 마이그레이션 검증은 미구성이다.

## 검증 이름

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 현재 검사
- `docs`: 변경 문서의 상대 Markdown 링크, 계획/구현 상태, 명세·ADR 사이의 일관성을 확인한다.
- `format`: `git diff --check`로 공백 오류를 확인한다.
- `check`: 외부 CLI의 `ssealed doctor . --strict`로 스캐폴드 상태를 확인한다. 의도적인 문서 수정은 `ssealed update . --yes`로 인정한 후 확인한다. 파일 내용을 덮어쓰는 `--force`는 사용하지 않는다.

## 패키지 스크립트 없음
저장소 루트의 운영 패키지와 실행 러너는 아직 없다.
`prototypes/admin/`에는 `typecheck`·`test`·`build` 명령이 있다.
UI smoke와 디자인 비교는 [design-qa.md](./prototypes/admin/design-qa.md)에 기록한다.
개발 전용 계약 검사 패키지는 `tools/contracts/`이며 루트 운영 러너는 추가하지 않는다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

`lint`는 Redocly의 OpenAPI 3.1 구문·참조 검사다. `contract`는 JSON 예시 8종,
잘못된 wire 입력 12종, 예시의 등록/카디널리티/날짜/집계 일치와 DBML 파싱·문서 링크
등 27개 검사다. 상태 머신·DB 트랜잭션·권한 강제의 실행 테스트로 해석하지 않는다.
운영 lint·typecheck·test·smoke와 SQL `migration-check`는 구현이 없어 실행하지 않는다.

## 아직 실행하지 않음
다음은 미래 범위이며 이번 슬라이스에서 실행/검증하지 않는다:
- 운영 스키마 검증
- 코호트 완료 계산
- 중복 제거(idempotency)
- 프라이버시 허용/금지 목록
- 런타임 테스트

서술(prose) 테스트는 작성하지 않는다.
