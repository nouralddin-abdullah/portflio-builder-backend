export interface ApiOk<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string> | Array<unknown>;
  };
}

export function isWrappedResponse(value: unknown): value is ApiOk<unknown> | ApiErrorBody {
  if (value === null || typeof value !== 'object') return false;
  return 'data' in value || 'error' in value;
}
