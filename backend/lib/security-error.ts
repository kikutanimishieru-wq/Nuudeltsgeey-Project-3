export class SecurityError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}

export function safeError(error: unknown) {
  if (error instanceof SecurityError) return { error: error.code, status: error.status };
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return { error: 'UNAUTHORIZED', status: 401 };
  if (error instanceof Error && error.message === 'FORBIDDEN') return { error: 'FORBIDDEN', status: 403 };
  return { error: 'OPERATION_FAILED', status: 500 };
}
