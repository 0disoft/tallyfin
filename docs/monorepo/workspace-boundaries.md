# 워크스페이스 경계

상태: 계획. 아래 디렉터리/패키지는 아직 생성되지 않았고 워크스페이스가 초기화되지 않았다.

## 계획된 패키지 그래프
- packages/core — 스키마, 검증, 코호트 (비공개 ZDP·Cloudflare 의존 없음)
- packages/browser — 브라우저 SDK (외부 런타임 의존성 없음)
- packages/storage-d1 — D1 분석 저장 어댑터
- apps/collector — 네이티브 Cloudflare Worker fetch (프레임워크 없음)
- apps/admin — 대시보드 (프레임워크 미결정)
- examples/sembom — 예시

## 임포트 경계
- core/SDK는 비공개 ZDP나 Cloudflare에 의존하지 않는다.
- D1 저장은 어댑터로 분리한다.
- Sembom 전용 호스트 어댑터는 Sembom 저장소에 두며 엔진을 복사하지 않는다.
- zdp-data-platform은 내부 분석 통합 계약, zdp-platform-observability는 인프라 관측을 맡는다. Tallyfin core/SDK에는 두 저장소의 비공개 의존성을 추가하지 않는다.

## 범위 밖
결제/계정/리플레이/AI/광고/PostHog 동등 기능 제외.
