export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'storage_unavailable'
  | 'admin_api_unavailable'
  | 'settings_conflict'
  | 'schema_conflict'
  | 'schema_draft_conflict'
  | 'project_conflict'
  | 'project_limit_reached'
  | 'grant_conflict'
  | 'publisher_conflict'
  | 'last_owner'
  | 'http'
  | 'network'
  | 'timeout'
  | 'contract';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  code: string | null;
  requestId: string | null;
  constructor(kind: ApiErrorKind, message: string, details: { status?: number; code?: string | null; requestId?: string | null; cause?: unknown } = {}) {
    super(message, details);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = details.status ?? 0;
    this.code = details.code ?? null;
    this.requestId = details.requestId ?? null;
  }
}

export const KIND_MESSAGE: Record<ApiErrorKind, string> = {
  unauthorized: '관리자 인증이 필요해요. (HTTP 401)',
  forbidden: '이 프로젝트에 대한 권한이 없어요. (HTTP 403)',
  not_found: '프로젝트나 스키마를 찾지 못했어요. (HTTP 404)',
  invalid_request: '요청 범위가 계약과 맞지 않아요. (HTTP 400)',
  storage_unavailable: '저장소를 사용할 수 없어요. (HTTP 503)',
  admin_api_unavailable: '관리 API에 연결하지 못했어요. 잠시 후 다시 시도해 주세요. (HTTP 503)',
  settings_conflict: '다른 변경 사항이 있어요. 최신 설정을 확인해 주세요. (HTTP 409)',
  schema_conflict: '발행된 스키마가 바뀌었어요. 최신 버전을 확인해 주세요. (HTTP 409)',
  schema_draft_conflict: '다른 곳에서 서버 초안을 저장했어요. 최신 초안을 확인해 주세요. (HTTP 409)',
  project_conflict: '이미 사용 중이거나 다른 내용으로 생성된 프로젝트 ID예요. (HTTP 409)',
  project_limit_reached: '프로젝트 생성 개수 한도에 도달했어요. 운영자에게 한도를 확인해 주세요. (HTTP 409)',
  grant_conflict: '계정 권한이 바뀌었어요. 최신 목록을 확인한 뒤 다시 선택해 주세요. (HTTP 409)',
  publisher_conflict: '발행 권한이 바뀌었어요. 최신 목록을 확인한 뒤 다시 회수해 주세요. (HTTP 409)',
  last_owner: '마지막 소유자의 권한은 낮추거나 회수할 수 없어요. 다른 소유자를 먼저 추가해 주세요. (HTTP 409)',
  http: '요청이 실패했어요.',
  network: 'API 서버에 연결하지 못했어요.',
  timeout: '요청 대기 시간이 지났어요. 다시 조회해 주세요. 저장 요청이었다면 최신 상태를 먼저 확인해 주세요.',
  contract: 'API 응답이 계약과 맞지 않아요.',
};

export const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  503: 'storage_unavailable',
  409: 'settings_conflict',
};

export async function responseApiError(response: { status: number; json: () => Promise<unknown> }): Promise<ApiError> {
  let code: string | null = null;
  let requestId: string | null = null;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; requestId?: unknown } } | null;
    const detail = body?.error;
    if (detail && typeof detail === 'object') {
      if (typeof detail.code === 'string' && detail.code.length <= 64) code = detail.code;
      if (typeof detail.requestId === 'string' && detail.requestId.length <= 64) requestId = detail.requestId;
    }
  } catch {
    // Body is not JSON; keep the fixed status-based message.
  }
  const kind = response.status === 503 && code === 'admin_api_unavailable' ? 'admin_api_unavailable'
    : response.status === 409 && code && ['schema_conflict', 'schema_draft_conflict', 'project_conflict', 'project_limit_reached', 'grant_conflict', 'publisher_conflict', 'last_owner'].includes(code)
    ? code as ApiErrorKind : STATUS_KIND[response.status] ?? 'http';
  const message = kind === 'http' ? `요청이 실패했어요. (HTTP ${response.status})` : KIND_MESSAGE[kind];
  return new ApiError(kind, message, { status: response.status, code, requestId });
}
