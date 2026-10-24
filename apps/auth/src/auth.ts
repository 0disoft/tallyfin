import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';

export const ADMIN_CLIENT_ID = 'tallyfin-admin';
export const SCOPES = ['openid', 'profile', 'offline_access'];
export interface AuthSettings {
  database: BetterAuthOptions['database'];
  origin: string;
  adminOrigin: string;
  secret: string;
  adminEmail: string;
}

export function authOptions(settings: AuthSettings) {
  for (const origin of [settings.origin, settings.adminOrigin]) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port)
      throw new TypeError('Invalid authentication origin');
  }
  if (settings.secret.length < 32) throw new TypeError('Missing authentication secret');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.adminEmail)) throw new TypeError('Missing administrator email');
  const issuer = `${settings.origin}/api/auth`;
  return {
    appName: 'Tallyfin', baseURL: settings.origin, basePath: '/api/auth',
    secret: settings.secret, database: settings.database,
    trustedOrigins: [settings.origin, settings.adminOrigin],
    logger: { disabled: true }, telemetry: { enabled: false },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 14, maxPasswordLength: 128 },
    session: { expiresIn: 86400, updateAge: 3600, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: true, ipAddress: { ipAddressHeaders: ['cf-connecting-ip'], ipv6Subnet: 128 } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/change-password': { window: 60, max: 5 } } },
    databaseHooks: { session: { create: { before: async (session, context) => {
      const user = await context?.context.internalAdapter.findUserById(session.userId);
      if (user?.email.toLowerCase() !== settings.adminEmail.toLowerCase()) return false;
      return { data: { ...session, ipAddress: null, userAgent: null } };
    } } } },
    disabledPaths: ['/sign-up/email', '/token', '/delete-user', '/change-email', '/update-user'],
    plugins: [
      jwt({ jwks: { keyPairConfig: { alg: 'ES256' } }, jwt: { issuer, audience: `${settings.adminOrigin}/v1` } }),
      oauthProvider({ loginPage: '/sign-in', consentPage: '/sign-in', scopes: SCOPES,
        resources: [{ identifier: `${settings.adminOrigin}/v1`, allowedScopes: SCOPES, accessTokenTtl: 300 }],
        cachedTrustedClients: new Set([ADMIN_CLIENT_ID]),
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: false, clientPrivileges: () => false, resourcePrivileges: () => false,
        accessTokenExpiresIn: 300, idTokenExpiresIn: 300, refreshTokenExpiresIn: 86400 }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(settings: AuthSettings) { return betterAuth(authOptions(settings)); }
