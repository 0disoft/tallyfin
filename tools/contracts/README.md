# 계약 검사 도구

운영 앱/SDK와 분리한 개발 전용 패키지다. 저장소 루트에서 실행한다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

Redocly는 OpenAPI 구문/참조, Ajv는 JSON 예시와 거부 입력, DBML parser는 논리 구조를
검사한다. 추가 검사는 예시의 등록 정의·카디널리티·날짜 경계·합계·문서 링크만 확인한다.
수집 상태 머신·DB 트랜잭션·운영 인증·실제 마이그레이션을 실행하지 않는다.
개발 의존성은 메이저 범위와 lockfile로 관리하고 수집 SDK에 포함하지 않는다.
