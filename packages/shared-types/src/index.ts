/** Wire shapes match the versioned OpenAPI health contract. */
export type HealthStatus = 'ok' | 'degraded' | 'unavailable';
export interface HealthResponse {
  data: {
    status: HealthStatus;
    checkedAt: string;
    components?: { name: string; status: string }[];
  };
  requestId: string;
}
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  requestId: string;
  detail?: string;
}
