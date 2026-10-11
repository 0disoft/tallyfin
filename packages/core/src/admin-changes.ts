/** Control-plane history; never contains visitor data, request bodies or setting values. */
export const ADMIN_CHANGE_RETENTION_DAYS = 90;
export const ADMIN_CHANGE_FIELDS = ['name', 'status', 'allowedOrigins', 'requestsPerMinute', 'newReceiptsPerUtcDay'] as const;
export type AdminChangeField = typeof ADMIN_CHANGE_FIELDS[number];
export type AdminChangeDetail =
  | { action: 'project.created' }
  | { action: 'project.settings_changed'; fields: AdminChangeField[] }
  | { action: 'schema.published' | 'schema.status_changed'; schemaVersion: number }
  | { action: 'grant.created' | 'grant.role_changed' | 'grant.revoked';
      target: { issuer: string; subject: string }; beforeRole: 'reader' | 'owner' | null; afterRole: 'reader' | 'owner' | null }
  | { action: 'publisher.granted' | 'publisher.revoked'; target: { issuer: string; subject: string } };
export type AdminChangeActor = { kind: 'administrator'; issuer: string; subject: string } | { kind: 'local_operator' };
export interface AdminChange { id: string; occurredAt: string; actor: AdminChangeActor; change: AdminChangeDetail }
export interface AdminChangePage {
  projectId: string; generatedAt: string; retentionDays: 90; coverage: 'recorded-changes-only';
  data: AdminChange[]; page: { limit: number; nextCursor: string | null };
}
