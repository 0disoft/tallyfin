export const CALLBACK_PATH = '/auth/callback';
export interface LoginConfig {
  issuer: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  resource?: string;
  passwordChangeUrl?: string;
  idTokenAlgorithm: 'RS256' | 'ES256';
}

export function loginConfig(env: Record<string, unknown>, origin: string): LoginConfig | null {
  const names = ['VITE_OIDC_ISSUER', 'VITE_OIDC_CLIENT_ID', 'VITE_OIDC_SCOPE'];
  if (names.every(name => !env[name])) return null;
  const text = (name: string) => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2048)
      throw new Error('관리자 로그인 설정을 확인해 주세요.');
    return value;
  };
  const issuer = text(names[0]!);
  secureEndpoint(issuer);
  const scope = text(names[2]!);
  if (!scope.split(/ +/).includes('openid') || /[^\x21-\x7e ]/.test(scope)) throw new Error('openid를 포함한 로그인 scope가 필요해요.');
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    throw new Error('관리자 로그인은 HTTPS 또는 로컬 개발 주소에서만 사용할 수 있어요.');
  const resource = env.VITE_OIDC_RESOURCE ? text('VITE_OIDC_RESOURCE') : undefined;
  if (resource) { const url = new URL(resource); if (url.hash || url.username || url.password) throw new Error('로그인 resource 설정을 확인해 주세요.'); }
  const idTokenAlgorithm = env.VITE_OIDC_ID_TOKEN_ALG || 'RS256';
  if (idTokenAlgorithm !== 'RS256' && idTokenAlgorithm !== 'ES256') throw new Error('지원하지 않는 ID token 서명 알고리즘이에요.');
  const passwordChangeUrl = env.VITE_OIDC_PASSWORD_CHANGE_URL === undefined ? undefined : text('VITE_OIDC_PASSWORD_CHANGE_URL');
  if (passwordChangeUrl) {
    secureEndpoint(passwordChangeUrl);
    if (new URL(passwordChangeUrl).origin !== new URL(issuer).origin) throw new Error('비밀번호 변경 주소의 로그인 제공자를 확인해 주세요.');
  }
  return { issuer, clientId: text(names[1]!), scope, redirectUri: `${base.origin}${CALLBACK_PATH}`,
    ...(resource ? { resource } : {}), ...(passwordChangeUrl ? { passwordChangeUrl } : {}), idTokenAlgorithm };
}

export function secureEndpoint(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('로그인 제공자의 HTTPS 주소를 확인해 주세요.');
}
