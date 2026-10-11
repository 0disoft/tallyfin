# 운영 계약

상태: 문서 전용 초안이다. 실제 운영 배포·SLO 확정·알림 수신자 지정은 하지 않았다. 여기 적은
수치는 현재 구현의 확인된 성질이고 새 목표를 만들지 않는다.

## 핵심 사용자 여정

1. browser 수집: 페이지가 batch를 보내고 집계에 반영된다.
2. server 수집: 서버 SDK가 발행자 토큰으로 batch를 보내고 집계에 반영된다.
3. 관리자 조회: owner/reader가 로그인해 프로젝트별 지표를 읽는다.
4. 관리자 쓰기: owner가 설정·스키마·grant·발행 권한을 바꾸고 변경 이력이 남는다.
5. 만료 정리: scheduled 실행이 오래된 행을 지운다.

## 우선순위

1. 테넌트 격리·권한 경계.
2. 수집 정확성(중복·유실 최소화).
3. 관리자 조회·쓰기 가용성.
4. 정리·보존.
5. 관측.

## 의존 계층

| 계층 | 대상 | 로컬 증거 | 운영 상태 |
| --- | --- | --- | --- |
| 1 | D1(저장) | 저장 어댑터·마이그레이션 `0001`~`0009` Miniflare 검증 | 원격 DB 미적용 |
| 1 | OIDC 검증(인증) | 임시 서명 토큰·로컬 D1 검증 | 실제 provider 없음 |
| 2 | 수집기 Worker | 로컬 workerd 검증 | 원격 배포 없음 |
| 2 | 관리자 Worker·프록시 | 로컬 프록시·스모크 검증 | 원격 배포 없음 |
| 3 | Cron 정리 | 로컬 scheduled 검증 | Cron Trigger 미등록 |
| 3 | 관측 로그 | 로컬 검증 | 수집·대시보드·알림 없음 |

## 현재 로컬 전용 증거

- 마이그레이션 `0001`~`0009` 아홉 개·애플리케이션 테이블 16개, Miniflare에서만 적용.
- 복구 연습 `verify:restore`는 로컬 합성 DB만 사용한다. 운영 RTO 근거가 아니다.
- 설치·검사 도구(`install:prepare`·`install:check`·`install:database-check`·
  `install:access-check`)는 로컬·fixture 검증까지다. 실제 provider·원격 DB·원격 쓰기는 없다.
- 운영 로그는 완료 관측 한 줄과 정리 로그다. 대시보드·알림 수신자·헬스 프로브는 없다.

## 릴리스 차단 조건

- 준비 묶음 SHA-256 불일치 또는 수정·이동.
- 마이그레이션 head 불명 또는 로컬·원격 불일치.
- 적용 전 백업 미확인.
- 개인정보·비밀값 노출.
- 인증·권한 게이트(issuer·audience·PKCE·owner/reader·테넌트) 실패.
- 필수 검사 실패·미확인.

[릴리스 런북](./release.md)과 같은 기준이며 새 게이트를 추가하지 않는다.

## 미정 항목

- SLO, RTO, RPO: UNDECIDED.
- 담당자(Primary·Backup owner), 에스컬레이션 경로, 알림 수신자: UNASSIGNED·UNDECIDED.
- 임계값·로그 보존 기간: UNDECIDED.

숫자 목표는 근거가 생길 때까지 만들지 않는다.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED

## 근거

- [릴리스 런북](./release.md), [롤백 런북](./rollback.md), [장애 대응](./incident-response.md)
- [운영 관측](./observability.md), [백업·복구](./backup-and-restore.md)
