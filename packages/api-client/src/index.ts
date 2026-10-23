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
  return {
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
