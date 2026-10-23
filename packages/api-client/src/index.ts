import type { ApiProblem, HealthResponse } from '@arata/shared-types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem | undefined,
  ) {
    super(problem?.title ?? `HTTP ${status}`);
  }
}

export function createApiClient(baseUrl = '') {
  const csrf = () =>
    document.cookie
      .split('; ')
      .find((part) => part.startsWith('arata_csrf=') || part.startsWith('__Host-arata_csrf='))
      ?.split('=')[1];
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrf()
          ? { 'X-CSRF-Token': csrf()! }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      let problem: ApiProblem | undefined;
      try {
        problem = (await response.json()) as ApiProblem;
      } catch {
        /* retain status */
      }
      throw new ApiError(response.status, problem);
    }
    return (await response.json()) as T;
  }
  return {
    request,
    async live(signal?: AbortSignal): Promise<HealthResponse> {
      const response = await fetch(`${baseUrl}/api/v1/health/live`, {
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        let problem: ApiProblem | undefined;
        try {
          problem = (await response.json()) as ApiProblem;
        } catch {
          /* preserve HTTP status */
        }
        throw new ApiError(response.status, problem);
      }
      return (await response.json()) as HealthResponse;
    },
  };
}
