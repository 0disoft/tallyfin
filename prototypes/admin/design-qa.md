# Tallyfin prototype design QA — 2026-10-08

final result: passed

## Comparison target and evidence

- Source visual truth: `docs/frontend/assets/project-overview-selected.png` (1487 × 1058).
- URL: `http://127.0.0.1:5180/`, Codex in-app browser.
- State: ModuFile / overview / 7 days / normal / scroll at top.
- CSS viewport: 1487 × 1058; browser reports devicePixelRatio 0.9.
- Raw browser screenshot: `.tmp/prototype-qa/desktop-final-raw.png` (1633 × 1174). The capture includes extra blank browser canvas outside the CSS viewport. Comparison crops that canvas to 1487 × 1058; no page rescaling.
- Implementation screenshot: `.tmp/prototype-qa/desktop-final.png` (1487 × 1058).
- Full side-by-side: `.tmp/prototype-qa/comparison-final.png` (2974 × 1058), source left / implementation right. Both were opened together for comparison.
- Focused captures: `.tmp/prototype-qa/comparison-header.png` and `comparison-table.png`. Typography, controls, KPI separators, logo, table header and rows were inspected in these comparisons.
- Responsive evidence: `.tmp/prototype-qa/mobile-overview.png`, `mobile-drawer.png`; tested CSS widths 320 and 390. Temporary viewport override was reset afterwards. Screenshots are local ignored evidence, not production source.

## Findings and iteration history

1. **P2 — Vertical spacing pushed the event table down.** Initial capture `comparison-before.png` showed a taller chart, excessive gaps and the final table row below the viewport. Reduced chart height and section gaps; changed table-header margin and metric padding. Final full and table captures show all four rows with the intended flat table structure. The extra accessible “수치 보기” control accounts for the remaining small offset.
2. **P2 — Table count alignment and legend drift.** Initial counts sat at the far right and the legend used a bar icon. Counts now align at a stable 72% first-column boundary in overview, and the legend uses a blue circle from Phosphor. Other analytical tables retain right-aligned numbers.
3. **P2 — Mobile horizontal overflow.** A tooltip retained its desktop coordinates on resize, expanding document width to 780px. Chart overflow is now contained, and native details use block layout. At CSS 320px and 390px, document width is within the viewport; the event table scrolls inside its own container (271px client / 540px contents at 320px).
4. **P1 — Period-dependent fixture counts.** Overlapping dates changed when selecting 14 versus 30 days. Fixtures now use a stable calendar index; a regression test checks identical overlapping records for all projects. This was a data-correctness issue rather than a source-visual mismatch.
5. **P2 — Unknown goal rendered a zero progress bar.** Empty goal data now omits the progress indicator and displays an unknown rate rather than implying 0%.

Post-fix captures were reopened in full-view and focused comparison. No actionable P0/P1/P2 differences remain for this sample prototype.

## Required fidelity surfaces

- **Fonts and typography:** Inter / Noto Sans KR, title 44px, desktop KPI 56px, body/table/chart 16–18px, mobile title 32px and KPI 34px. Korean font CSS includes Unicode subsets. Hierarchy, numeric weight and line breaks follow the selected visual; exact generated-image typeface is unknown. Initial documented font sizes were candidates, not final limits.
- **Spacing and layout rhythm:** 250px fixed sidebar, open four-column metrics with hairlines, wide chart and flat table. Mobile uses a drawer and two-column metrics. No card grid or nested surfaces were added to overview.
- **Colors and tokens:** white main area, #F8FAFC navigation, #155EEF emphasis, #0F172A text, #64748B secondary text, #E2E8F0 hairlines. Active navigation and focus states are visible. Slight source background shading is intentionally replaced with flat surfaces.
- **Image quality:** generated transparent blue fin raster is sharp at 40 × 30, with no visible white rectangle on the sidebar. Standard icons use Phosphor; charts use Recharts. No handcrafted asset substitute.
- **Copy/content:** sample project names, headings, metric labels and event names match the chosen overview. The displayed totals and denominator match the reference. Chart values deliberately sum to the total rather than reproducing the reference's inconsistent illustrative line. Fixed sample date and static KST label avoid implying a live clock or functional timezone selector.

## Interaction verification

- Project switching: ModuFile, Sembom and Orchid Pass update labels, metrics and event definitions. Settings names reset independently when switching projects.
- Periods: 7, 14 and 30 update totals and chart; 7-day ModuFile has 24,680 total, 4,800 starts, 4,128 successes, 96 errors, 3,560 downloads, 86.0% (4,128 / 4,800).
- Events: search, empty result, reset, name sorting, count sorting, row selection and event-specific chart. Initial text-entry simulation conflicted with the input method; actual text selection/paste confirmed settings editing without changing application code for the browser tool.
- Settings: saved a changed name, rejected a whitespace-only name with field error, reset to the default, and confirmed another project's default stayed intact. Values are memory-only.
- States: loading, empty, error, unauthorized and stale display correctly; retry and refresh restore normal state. Empty rate is “—” with 0 / 0 context.
- Mobile: drawer open/close, Escape, navigation and project switching; event table stays locally scrollable. Focus-trap code is present; a complete screen-reader and keyboard traversal audit was not performed.
- Browser console checked after interactions: no captured warning or error.

## Validation and remaining limits

- Passed: typecheck, 5 fixture/aggregation tests, production prototype build, git whitespace check, strict scaffold doctor after accepting intentional document changes.
- Build emits a JavaScript chunk-size warning (~610kB uncompressed). Prototype fonts also include more subsets than needed. Production code splitting and font budgeting remain necessary; this is not the browser collector's payload.
- Not run: production API/DB, authentication, privacy ingestion, cohort matching, load tests, migrations, deployment, full accessibility audit. Those implementations do not exist in this slice. No lint script is configured.
- API/DB contracts and root runner remain unchanged; the prototype has its own package manifest. Gitignore continues to exclude dependencies, build output and temporary captures.

## Follow-up polish

- P3: exact logo silhouette, icon stroke and reference's subtle background shading could be refined in a later visual pass.
- P3: table position differs slightly because the real UI adds accessible chart data and a sample-state footer absent from the generated mock.

## Implementation checklist

- [x] Source and rendered implementation compared together.
- [x] Actionable layout, tooltip overflow and data-consistency findings fixed.
- [x] Projects, periods, search, sorting, settings and sample states exercised.
- [x] Responsive widths and browser console checked.
- [x] Evidence and production limitations recorded.

## API 연결 모드 추가분 (2026-10-08)

- `src/api/*`(client·validate·dates·coverage·pagination)와 `src/LiveDashboard.tsx`가 실 API 조회를 맡고 기존 시각 시안과 레이아웃은 유지한다. 헤더의 `Sample`/`API 연결` 전환으로 나눈다.
- 같은 출처만 허용하고(userinfo·쿼리·해시 거부) `credentials: omit`, `cache: no-store`, `referrerPolicy: no-referrer`로 요청한다. 기본 fetch는 globalThis 컨텍스트로 호출한다.
- 토큰은 탭 메모리와 클라이언트 사설 필드에만 두고 서버 오류 문구는 반사하지 않는다(고정 안내 + requestId). `연결 끊기`는 토큰을 지우고 헤더 및 본문을 읽는 중인 요청을 중단한다.
- 계약 타입/최소 런타임 검증과 meta·이벤트·작업 흐름 ID 대조로 다른 프로젝트·버전·기간 응답을 거부하고, 값이 없으면 0으로 채우지 않는다.
- 로컬 검증: 타입체크, 샘플 모델·API 클라이언트 테스트 19/19, 프로덕션 빌드, Sites 패키징 테스트 4/4 통과. JS 번들 약 653kB(압축 전)의 크기 경고는 남아 있다.
- `http://127.0.0.1:5187/`에서 로컬 Miniflare D1의 관리자 조회 API(5188)를 프록시해 수집 3건·시작 1건·성공 1건·완료율 100%, 이벤트 일별 집계·속성 버킷, 목표·읽기 전용 설정을 확인했다. 증명: `.tmp/admin-api-d1-local-20261008.jpg`.
- 잘못된/빈 스키마 버전, 존재하지 않는 버전의 404, 토큰 없는 401, 연결 해제 후 초기화·재연결을 확인했다. 실제 인증 제공자와 서명 검증은 연결하지 않았고 검증기 포트만 모킹했다. 403·503은 클라이언트/관리자 테스트에서만 검증했다.

## OIDC 로그인 연결 추가분 (2026-10-08)

- API 모드에 지연 로드하는 관리자 로그인과 접힌 직접 토큰 입력을 연결했다. 설정이 없으면 로그인 버튼을 비활성화하고 안내한다. 진행 상태는 status, 실패는 alert로 표시한다.
- 로컬 Vite 5180의 React StrictMode 화면에서 설정 없음, 직접 연결 펼치기, 다른 출처 엔드포인트 거부, 샘플 복귀와 재진입을 확인했다. `/auth/callback?error=access_denied`는 즉시 쿼리가 지워지고 API 모드의 설정 오류를 표시하며 대기 상태가 끝난다. 콘솔 오류는 수집되지 않았다.
- 정상 로그인 화면 증거는 저장소 루트 `.tmp/admin-oidc-login-20261008.png`다. 실제 제공자 설정은 없으며 브라우저의 인증 성공·제공자 리다이렉트·갱신은 검증하지 않았다. 격리된 클라이언트 테스트는 실행 중 생성한 키로 ID 서명과 PKCE·state/nonce·갱신을 검증한다.
- 타입 검사와 테스트 31/31, 프로덕션 빌드와 Sites 패키징 테스트 4/4 통과. 로그인 청크 30.65kB/gzip 10.85kB, 메인 청크 657.25kB/gzip 191.91kB다. 메인 번들의 기존 크기 경고와 폰트 최적화 과제는 남아 있다. 새 전체 접근성 감사와 운영 제공자 smoke는 실행하지 않았다.
