# Sembom 파일럿 통합 예시

Sembom은 Tallyfin의 첫 파일럿이며, 이 문서는 Tallyfin 코어가 아니라 프로젝트별 등록 스키마의 예시다. Sembom 전용 요구사항을 코어로 끌어올리지 않는다.

## 등록 이벤트

구현 시 Sembom 프로젝트에 다음 여섯 이벤트를 등록할 계획이다.

- tool_view: 도구 화면을 본 시점
- input_start: 사용자가 명시적으로 입력을 시작한 시점
- calculation_success: 계산이 성공한 시점
- validation_error: 검증 오류가 발생한 시점
- result_copy: 결과 복사가 성공한 시점
- feedback_submit: 피드백 제출이 성공한 시점

이 여섯 이름은 Sembom 프로젝트의 등록 예시일 뿐, Tallyfin의 전역 필수 이벤트가 아니다.

## 속성

tool, locale, mode, error, field 같은 속성을 선택적으로 둔다. 이는 프로젝트별 속성이며 코어 필수 필드가 아니다. error와 field는 검증 오류 맥락을 설명하기 위한 선택 항목이다.

## 수명주기와 소스 경계

input_start는 해당 도구 방문의 첫 사용자 입력에, calculation_success는 그 입력 이후 첫 성공에 한 번씩 기록한다. 자동 계산의 초기 결과는 성공으로 세지 않는다. result_copy는 복사가 성공했을 때만, feedback_submit은 제출이 성공했을 때만 보낸다. 각 행동을 확정하는 발행 출처는 브라우저 또는 서버 중 하나로 정해 이중 집계를 피한다.

## 경계

이벤트 이름과 속성 이름은 Sembom 저장소에서 정의하며, Tallyfin SDK는 이름을 하드코딩하지 않는다. 등록 스키마는 버전으로 관리해 변경 시 이전 집계와 섞이지 않게 한다. 호스트 어댑터는 Sembom 저장소에 남고, 이 문서는 Sembom 저장소를 수정하지 않는다. 현재 활성 데이터 수집은 없다.

상세 스키마 규칙은 제품 스펙 [02-spec.md](../product/02-spec.md)을 따른다.
