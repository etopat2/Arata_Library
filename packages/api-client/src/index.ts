import type { ApiProblem, HealthResponse } from '@arata/shared-types';

export type CatalogueAccess = 'FREE' | 'SIGN_IN' | 'LOCKED' | 'UPCOMING';
export interface CatalogueCollection {
  slug: string;
  title: string;
  description: string | null;
  publicationCount: number;
}
export interface CatalogueFacets {
  subjects: string[];
  authors: { slug: string; name: string }[];
  volumes: { id: string; title: string }[];
  editions: { id: string; label: string }[];
  formats: string[];
}
export interface CatalogueContributor {
  name: string;
  slug: string;
  role: string;
}
export interface CatalogueEditionSummary {
  id: string;
  editionCode: string;
  label: string;
  isDefault: boolean;
  volumeId: string | null;
  volumeOrdinal: number | null;
  volumeTitle: string | null;
  publishedAt: string;
  revisionNumber: number;
}
export interface CataloguePublication {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  subject: string | null;
  keywords: string[];
  kind: 'STANDALONE' | 'SERIES';
  status: 'PUBLISHED' | 'FORTHCOMING';
  licenceCode: string | null;
  copyrightNotice: string | null;
  releaseAt: string | null;
  publishedAt: string | null;
  contributors: CatalogueContributor[];
  collections: { slug: string; title: string }[];
  accessState: CatalogueAccess;
  accessClass: string;
  editions?: CatalogueEditionSummary[];
}
export interface CatalogueChapter {
  id: string;
  ordinal: number;
  slug: string;
  title: string;
  previewAvailable: boolean;
}
export interface CatalogueEdition extends CatalogueEditionSummary {
  publicationSlug: string;
  publicationTitle: string;
  chapters: CatalogueChapter[];
}
export interface CatalogueResource {
  id: string;
  title: string;
  description: string | null;
  format: string | null;
  licenceCode: string;
  attribution: string | null;
  copyrightNotice: string | null;
  publishedAt: string;
  accessClass: string;
  publicationSlug: string | null;
  accessState: CatalogueAccess;
  hasReadableText: boolean;
}
export interface CataloguePage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
export interface ApiData<T> {
  data: T;
  requestId: string;
}

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
    catalogue: {
      collections: (signal?: AbortSignal) =>
        request<ApiData<CatalogueCollection[]>>('/catalogue/collections', 'GET', undefined, signal),
      facets: (signal?: AbortSignal) =>
        request<ApiData<CatalogueFacets>>('/catalogue/facets', 'GET', undefined, signal),
      publications: (params = new URLSearchParams(), signal?: AbortSignal) =>
        request<ApiData<CataloguePage<CataloguePublication>>>(
          `/catalogue/publications?${params}`,
          'GET',
          undefined,
          signal,
        ),
      publication: (slug: string, signal?: AbortSignal) =>
        request<ApiData<CataloguePublication>>(
          `/catalogue/publications/${encodeURIComponent(slug)}`,
          'GET',
          undefined,
          signal,
        ),
      edition: (id: string, signal?: AbortSignal) =>
        request<ApiData<CatalogueEdition>>(
          `/catalogue/editions/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          signal,
        ),
      chapterPreview: (id: string, signal?: AbortSignal) =>
        request<
          ApiData<{ title: string; text: string; editionId: string; publicationSlug: string }>
        >(`/catalogue/chapters/${encodeURIComponent(id)}/preview`, 'GET', undefined, signal),
      resources: (params = new URLSearchParams(), signal?: AbortSignal) =>
        request<ApiData<CataloguePage<CatalogueResource>>>(
          `/resources?${params}`,
          'GET',
          undefined,
          signal,
        ),
      resource: (id: string, signal?: AbortSignal) =>
        request<ApiData<CatalogueResource>>(
          `/resources/${encodeURIComponent(id)}`,
          'GET',
          undefined,
          signal,
        ),
      openResource: (id: string, signal?: AbortSignal) =>
        request<ApiData<{ id: string; title: string; text: string; licenceCode: string }>>(
          `/resources/${encodeURIComponent(id)}/open`,
          'GET',
          undefined,
          signal,
        ),
      search: (params: URLSearchParams, signal?: AbortSignal) =>
        request<
          ApiData<{
            publications: CataloguePage<CataloguePublication>;
            resources: CataloguePage<CatalogueResource>;
          }>
        >(`/catalogue/search?${params}`, 'GET', undefined, signal),
    },
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
