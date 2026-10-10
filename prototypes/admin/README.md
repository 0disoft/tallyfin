# 관리자 프로토타입 기록

실행 가능한 관리자 소스는 [apps/admin](../../apps/admin/README.md)으로 이전했다.
이 폴더에는 [초기 디자인 QA](./design-qa.md) 기록만 유지한다. 이전 위치의 독립 설치·
실행 명령은 사용하지 않는다.

저장소 루트에서 `npm ci --ignore-scripts`, `npm run dev:admin`, `npm run check:admin`을
사용한다. 수집기와 함께 실행하는 `npm run dev -- --local --state-dir ...`도 새 관리자
앱을 실행한다. 운영 인증·원격 배포 검증은 후속이다.
