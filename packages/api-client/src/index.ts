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
export interface StudioTree {
  library: { id: string; title: string; slug: string };
  collections: { id: string; title: string; slug: string }[];
  publications: {
    id: string;
    title: string;
    slug: string;
    kind: 'STANDALONE' | 'SERIES';
    status: string;
    collectionId: string | null;
  }[];
  volumes: { id: string; publicationId: string; title: string; ordinal: number }[];
  editions: {
    id: string;
    publicationId: string;
    volumeId: string | null;
    label: string;
    editionCode: string;
    isDefault: boolean;
    currentRevisionId: string | null;
  }[];
  revisions: {
    id: string;
    editionId: string;
    number: number;
    status: string;
    publishedAt: string | null;
  }[];
  chapters: { id: string; revisionId: string; ordinal: number; title: string }[];
}
export interface StudioPublicationDetail {
  publication: {
    id: string;
    title: string;
    slug: string;
    kind: string;
    status: string;
    languageCode: string | null;
    licenceCode: string | null;
    sourceRef: string | null;
    copyrightNotice: string | null;
    description: string | null;
  };
  collections: { id: string; title: string }[];
  contributors: { id: string; displayName: string; role: string }[];
  volumes: StudioTree['volumes'];
  editions: StudioTree['editions'];
  revisions: StudioTree['revisions'];
}
export interface StudioRevisionDetail {
  revision: {
    id: string;
    editionId: string;
    publicationId: string;
    status: string;
    manifestHash: string | null;
  };
  chapters: { id: string; ordinal: number; title: string; slug: string }[];
  lessons: {
    id: string;
    chapterId: string;
    ordinal: number;
    title: string;
    bodyMarkdown: string | null;
    blocks: unknown;
  }[];
  bibliography: { citationKey: string; citationText: string; ordinal: number }[];
  references: { label: string; sourceLessonId: string }[];
  resources: { id: string; title: string }[];
  reviews: { decision: string; comment: string; decidedAt: string }[];
  errata: { notice: string; createdAt: string }[];
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
    studio: {
      tree: () => request<ApiData<StudioTree>>('/studio/tree'),
      publication: (id: string) =>
        request<ApiData<StudioPublicationDetail>>(`/studio/publications/${encodeURIComponent(id)}`),
      revision: (id: string) =>
        request<ApiData<StudioRevisionDetail>>(`/studio/revisions/${encodeURIComponent(id)}`),
      create: <T>(path: string, body: T) =>
        request<ApiData<{ id: string }>>(`/studio/${path}`, 'POST', body),
      change: <T>(path: string, body: T) =>
        request<ApiData<{ id: string }>>(`/studio/${path}`, 'PATCH', body),
      replace: <T>(path: string, body: T) =>
        request<ApiData<{ id: string }>>(`/studio/${path}`, 'PUT', body),
      action: (path: string, body?: unknown) =>
        request<ApiData<{ id: string; status?: string }>>(`/studio/${path}`, 'POST', body),
      uploadStatus: (id: string) =>
        request<
          ApiData<{
            id: string;
            status: string;
            receivedSize: string;
            assetId: string | null;
            failureCode: string | null;
            processing?: {
              status: string;
              progress: number;
              attempts: number;
              failureCode: string | null;
            };
          }>
        >(`/studio/uploads/${encodeURIComponent(id)}`),
      importStatus: (id: string) =>
        request<
          ApiData<{
            id: string;
            status: string;
            preview: unknown;
            progress: number;
            failureCode: string | null;
            revisionId: string | null;
          }>
        >(`/studio/imports/${encodeURIComponent(id)}`),
    },
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
