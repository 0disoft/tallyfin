# 오류 응답

상태: 형식 확정, 런타임 구현 전.

오류는 [OpenAPI](../../api/openapi.yaml)의 ErrorResponse를 사용한다. code는 고정 enum,
message는 안전한 짧은 안내이며 requestId는 해당 요청의 임시 무작위 UUIDv4다.
원문/속성 값·토큰·URL·IP·계정 정보와 스택을 메시지에 넣지 않는다.
400/403/404/409/413/415/422/429/503을 수집 상황에 맞게 구분한다.
관리자 조회는 401/403을 구분하며 저장 실패를 빈 통계로 바꾸지 않는다.
어떤 배치 오류도 부분 accepted를 내보내지 않는다.
[오류 예시](../../api/examples/error-response.json)와 [전체 계약](./event-contract.md)을 참고한다.
