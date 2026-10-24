import { ADMIN_CLIENT_ID, SCOPES } from './auth.ts';

/** Private operator artifact only. Never return this SQL through an HTTP endpoint. */
export function bootstrapSql(input: { email: string; subject: string; passwordHash: string; adminOrigin: string }, now = new Date()) {
  const origin = new URL(input.adminOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== input.adminOrigin || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    !/^[a-zA-Z0-9-]{16,64}$/.test(input.subject) || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(input.passwordHash))
    throw new TypeError('Invalid administrator bootstrap');
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const user = q(input.subject), date = q(now.toISOString()), client = q(ADMIN_CLIENT_ID);
  const resource = q(`${input.adminOrigin}/v1`), scopes = q(JSON.stringify(SCOPES));
  return `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt)
SELECT ${user},'Tallyfin administrator',${q(input.email.toLowerCase())},0,${date},${date} WHERE NOT EXISTS (SELECT 1 FROM "user");
INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt)
SELECT ${q(`credential-${input.subject}`)},${user},'credential',${user},${q(input.passwordHash)},${date},${date}
WHERE EXISTS (SELECT 1 FROM "user" WHERE id=${user}) AND NOT EXISTS (SELECT 1 FROM account WHERE userId=${user} AND providerId='credential');
INSERT OR IGNORE INTO oauthClient (id,clientId,name,disabled,skipConsent,scopes,clientCredentialsScopes,redirectUris,postLogoutRedirectUris,
tokenEndpointAuthMethod,applicationType,grantTypes,responseTypes,requirePKCE,createdAt,updatedAt)
VALUES (${client},${client},'Tallyfin administrator',0,1,${scopes},'[]',${q(JSON.stringify([`${input.adminOrigin}/auth/callback`]))},'[]',
'none','web','["authorization_code","refresh_token"]','["code"]',1,${date},${date});
INSERT OR IGNORE INTO oauthResource (id,identifier,name,accessTokenTtl,signingAlgorithm,allowedScopes,disabled,createdAt,updatedAt)
VALUES ('tallyfin-admin-api',${resource},'Tallyfin administrator API',300,'ES256',${scopes},0,${date},${date});
INSERT OR IGNORE INTO oauthClientResource (id,clientId,resourceId,createdAt)
VALUES ('tallyfin-admin-api-client',${client},${resource},${date});\n`;
}
