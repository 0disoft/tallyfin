import { ApiError } from './api-error.ts';

export type Load<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data?: T; error?: ApiError };

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('contract', error.message);
  return new ApiError('network', '알 수 없는 오류가 발생했어요.');
}

