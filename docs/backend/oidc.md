# 관리자 JWT 검증 어댑터

상태: `packages/auth-oidc`의 서명·클레임 검증과 `createOidcWorker` 연결을 로컬에서
구현·검증했다. 실제 인증 제공자, 로그인 리다이렉트/PKCE, 토큰 발급·갱신과 운영
배포는 연결하지 않았다. 이 어댑터는 JWT access token을 검증한다.

## 호스트 연결

`createOidcVerifier(options)`는 기존 `createWorker(verifyBearer)` 포트에 맞는 검증기를
돌려준다. `createOidcWorker(options)`는 두 호출을 묶는다. 기존 커스텀 검증기와
검증기 없는 기본 export도 유지한다. 기본 export는 관리자 API를 401로 닫는다.

```ts
import { createOidcWorker } from './apps/collector/src/index.ts';
import type { OidcOptions } from '@tallyfin/auth-oidc';

// 호스트가 실제 제공자 설정을 읽은 뒤 호출한다. 설정 읽기/배포는 호스트 책임이다.
export function configureAdministrator(options: OidcOptions) {
  return createOidcWorker(options);
}
```

| 설정 | 동작 |
| --- | --- |
| issuer | 필수. 신뢰할 발급자의 HTTPS URL과 `iss`를 정확히 비교한다. 끝의 `/`도 구분한다. |
| audience | 필수. Tallyfin 관리자 API의 대상 값. 브라우저 로그인 클라이언트 ID와 분리한다. |
| jwksUri | 필수. 운영자가 지정한 HTTPS 공개키 주소. 토큰이나 요청에서 받지 않는다. |
| algorithms | 기본 `['RS256']`. 호스트가 `RS256`·`ES256` 중 명시 선택한다. |
| tokenType | 기본 `at+jwt`(RFC 9068). 제공자가 `JWT`를 쓰면 명시 선택하고 API 전용 audience를 요구한다. |
| clockToleranceSeconds | 기본 5초, 0~60초. 시간 클레임 검사에 적용한다. |
| fetchImpl | 선택. 호스트가 신뢰하는 transport 또는 격리 테스트용 fetch 구현. |

설정 오류는 생성 시 예외가 나고 네트워크 요청을 보내지 않는다. 프로토타입은 계속
bearer 직접 입력을 사용한다. 실제 제공자와 API audience는 미정이다.

## 토큰·권한 정책

서명과 `iss`·`aud`·`exp`를 검증하고 `iss`·`sub`·`aud`·`exp`·`iat`를 필수로 요구한다.
`nbf`가 있으면 검증하며 미래 `iat`, `exp <= iat`, 빈/512자 초과 `sub`를 거부한다.
기본 프로필은 JWT access token이다. ID token을 관리자 인증에 사용하지 않는다.
opaque token·introspection·자동 discovery는 지원하지 않는다.

`kid`를 요구하고 대칭키 알고리즘·unsigned token·토큰의 `jku`/`x5u`를 거부한다.
성공하면 `{ issuer, subject }`만 반환한다. 이메일·이름·토큰의 role을 권한으로 쓰지
않고 기존 D1 `project_grants`를 매 조회마다 적용한다. 검증 상세·클레임·토큰을 로그나
응답에 넣지 않는다. 검증·키 조회 실패는 기존 401, 프로젝트 권한 부족은 403이다.

## 공개키 조회와 캐시

HTTPS 주소의 userinfo·쿼리·해시와 리다이렉트를 거부한다. 자격증명·bearer·referrer를
보내지 않는다. 응답은 최대 64KiB·32개 공개키로 제한하고 비밀키 필드를 거부한다.
헤더부터 본문 읽기까지 5초 제한을 적용한다.

공개키 캐시 수명은 10분이다. 새 `kid` 갱신은 성공한 조회 후 30초 간격으로 제한하고,
조회 실패 후에도 30초 동안 재시도를 막는다. 키 변경 직후 새 토큰은 갱신 간격 동안
거부될 수 있고 삭제한 키는 캐시 수명 동안 남을 수 있다. 토큰별 폐기·로그아웃 반영은
제공자의 짧은 access token 수명 또는 별도 후속 정책이 필요하다.

호스트는 같은 설정의 Worker 인스턴스를 재사용한다. 요청마다 검증기를 새로 만들거나
다른 제공자 설정 사이에서 검증기를 공유하지 않는다. 캐시는 영속 권한 저장이 아니다.

## 의존성·검증

`jose ^6`을 사용하며 설치 시점 버전은 lockfile에 기록한다. MIT 라이선스, 추가 런타임
의존성 없음, Web Crypto 기반이다. Cloudflare·D1 의존성은 없고 core/SDK에 포함하지
않는다. SDK+Sembom gzip 2949 bytes는 유지한다.

실행 중 생성한 키로 정상/변조/만료/클레임 누락, 키 갱신, 실패 재시도 제한, 크기·시간
제한을 검증했다. Worker에서도 실제 서명 검증과 D1 grant 회수를 확인했다. private
key와 bearer를 파일·로그에 남기지 않는다. 외부 제공자·운영 토큰으로는 검증하지 않았다.

근거: [jose jwtVerify](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md),
[remote JWKS 설정](https://github.com/panva/jose/blob/main/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md),
[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068).
