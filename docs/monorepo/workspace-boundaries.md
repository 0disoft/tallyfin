# 워크스페이스 경계

상태: 계획. 아래 디렉터리/패키지는 아직 생성되지 않았고 워크스페이스가 초기화되지 않았다.

## 계획된 패키지 그래프
- packages/core — 프로젝트별 이벤트/속성 정의, 검증, 목표·집계 기준 (비공개 ZDP·Cloudflare 의존 없음)
- packages/browser — 브라우저 SDK (외부 런타임 의존성 없음)
- packages/storage-d1 — D1 분석 저장 어댑터
- apps/collector — 네이티브 Cloudflare Worker fetch (프레임워크 없음)
- apps/admin — 대시보드 (프레임워크 미결정)
- examples/sembom — 예시

## 임포트 경계
- core/SDK는 비공개 ZDP나 Cloudflare에 의존하지 않는다.
- D1 저장은 어댑터로 분리한다.
- 서비스별 이벤트 연결 코드는 해당 서비스 저장소에서 관리한다. Sembom의 계산 엔진이나 필드명을 공통 코어/SDK에 넣지 않는다. Sembom의 등록 예시는 [연동 문서](../integrations/sembom.md)에 둔다.
- zdp-data-platform은 내부 분석 통합 계약, zdp-platform-observability는 인프라 관측을 맡는다. Tallyfin core/SDK에는 두 저장소의 비공개 의존성을 추가하지 않는다.

## 범위 밖
Tallyfin 자체의 결제·소비 서비스 계정 관리, 리플레이·AI·광고 분석은 제외한다. 회원가입·구매 완료 같은 서비스 행동은 등록된 이벤트로 집계할 수 있으며, 개인정보·금액·주문 원문은 수집하지 않는다. 서버 SDK와 추가 저장 어댑터는 후속 구현이다.
