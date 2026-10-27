import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  createApiClient,
  type CatalogueCollection,
  type CatalogueEdition,
  type CatalogueFacets,
  type CataloguePublication,
  type CatalogueResource,
} from '@arata/api-client';

const api = createApiClient().catalogue;
const readerApi = createApiClient().reader;
const route = new URLSearchParams(location.search);
const screen = route.get('screen') ?? 'home';
const get = (name: string) => route.get(name) ?? '';
const href = (next: string, values: Record<string, string> = {}) => {
  const params = new URLSearchParams({ screen: next, ...values });
  return `/?${params}`;
};
const badge: Record<string, string> = {
  FREE: 'Public free',
  SIGN_IN: 'Registered free',
  LOCKED: 'Restricted',
  UPCOMING: 'Forthcoming',
};
const linkStyle =
  'rounded-md px-3 py-2 font-semibold hover:bg-slate-100 focus-visible:bg-slate-100';
const buttonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#74233e] px-5 py-3 font-semibold text-white hover:bg-[#5b1730] disabled:opacity-50';
const outlineStyle =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-[#173647] hover:bg-slate-50';

function Metadata({
  title,
  description,
  canonical,
}: {
  title: string;
  description: string;
  canonical?: string;
}) {
  useEffect(() => {
    document.title = `${title} | Arata TechLibrary`;
    const set = (attribute: 'name' | 'property', key: string, value: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, key);
        document.head.append(element);
      }
      element.content = value;
    };
    set('name', 'description', description);
    set('property', 'og:title', `${title} | Arata TechLibrary`);
    set('property', 'og:description', description);
    set('property', 'og:type', 'website');
    set('name', 'twitter:card', 'summary');
    let canonicalLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.append(canonicalLink);
    }
    canonicalLink.href = new URL(
      canonical ?? location.pathname + location.search,
      location.origin,
    ).href;
  }, [title, description, canonical]);
  return null;
}

function AccessBadge({ state, accessClass }: { state: string; accessClass?: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold ${state === 'FREE' ? 'bg-teal-100 text-teal-900' : state === 'UPCOMING' ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-900'}`}
    >
      {state === 'LOCKED' && accessClass === 'PREMIUM'
        ? 'Premium'
        : (badge[state] ?? 'Access restricted')}
    </span>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-slate-600">{children}</p>
    </div>
  );
}
function BookCard({ book }: { book: CataloguePublication }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex h-32 items-end bg-[#153849] p-4 text-white">
        <span className="text-xs font-bold uppercase tracking-[.15em] text-[#eacb78]">
          {book.subject ?? 'Technology publication'}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-[#087d78]">
            {book.kind === 'SERIES' ? 'Multi-volume series' : 'Standalone book'}
          </span>
          <AccessBadge state={book.accessState} accessClass={book.accessClass} />
        </div>
        <h3 className="mt-3 text-xl font-bold leading-snug">
          <a className="hover:underline" href={href('series-detail', { slug: book.slug })}>
            {book.title}
          </a>
        </h3>
        {book.subtitle && <p className="mt-1 text-sm text-slate-600">{book.subtitle}</p>}
        <p className="mt-3 line-clamp-3 text-sm text-slate-600">
          {book.description ?? 'Publication details are being prepared.'}
        </p>
        <p className="mt-auto pt-5 text-sm text-slate-600">
          {book.contributors.map((person) => person.name).join(', ') ||
            'Contributors to be announced'}
        </p>
        <a
          className="mt-3 font-bold text-[#087d78] hover:underline"
          href={href('series-detail', { slug: book.slug })}
        >
          View publication →
        </a>
      </div>
    </article>
  );
}
function ResourceCard({ resource }: { resource: CatalogueResource }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-[#087d78]">
          {resource.format ?? 'Learning resource'}
        </span>
        <AccessBadge state={resource.accessState} accessClass={resource.accessClass} />
      </div>
      <h3 className="mt-3 text-lg font-bold">
        <a className="hover:underline" href={href('resource-detail', { id: resource.id })}>
          {resource.title}
        </a>
      </h3>
      <p className="mt-2 text-sm text-slate-600">
        {resource.description ?? 'View licence and access details.'}
      </p>
      <a
        className="mt-4 inline-block font-bold text-[#087d78] hover:underline"
        href={href('resource-detail', { id: resource.id })}
      >
        View resource →
      </a>
    </article>
  );
}

export function PublicPortal({
  online,
  checked,
  updateReady,
  onUpdate,
}: {
  online: boolean;
  checked: boolean;
  updateReady: boolean;
  onUpdate: () => void;
}) {
  const [books, setBooks] = useState<CataloguePublication[]>([]);
  const [resources, setResources] = useState<CatalogueResource[]>([]);
  const [collections, setCollections] = useState<CatalogueCollection[]>([]);
  const [facets, setFacets] = useState<CatalogueFacets>({
    subjects: [],
    authors: [],
    volumes: [],
    editions: [],
    formats: [],
  });
  const [publication, setPublication] = useState<CataloguePublication | null>(null);
  const [edition, setEdition] = useState<CatalogueEdition | null>(null);
  const [resource, setResource] = useState<CatalogueResource | null>(null);
  const [reading, setReading] = useState<{
    title: string;
    text: string;
    licenceCode?: string;
    assets?: { id: string; name: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState('');
  const [total, setTotal] = useState(0);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [query, setQuery] = useState(get('q'));
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setBusy(true);
      setError('');
      try {
        if (screen === 'home') {
          const [featured, categories, free] = await Promise.all([
            api.publications(new URLSearchParams({ featured: 'true', limit: '4' }), abort.signal),
            api.collections(abort.signal),
            api.resources(new URLSearchParams({ access: 'PUBLIC_FREE', limit: '3' }), abort.signal),
          ]);
          setBooks(featured.data.items);
          setCollections(categories.data);
          setResources(free.data.items);
        } else if (screen === 'collections') {
          setCollections((await api.collections(abort.signal)).data);
          setFacets((await api.facets(abort.signal)).data);
        } else if (screen === 'catalogue' || screen === 'search') {
          const params = new URLSearchParams(location.search);
          params.delete('screen');
          if (screen === 'search' && get('q')) {
            const result = (await api.search(params, abort.signal)).data;
            setBooks(result.publications.items);
            setTotal(result.publications.total);
            setResources(result.resources.items);
            setResourceTotal(result.resources.total);
          } else {
            const result = (await api.publications(params, abort.signal)).data;
            setBooks(result.items);
            setTotal(result.total);
          }
          setCollections((await api.collections(abort.signal)).data);
        } else if (screen === 'series-detail') {
          setPublication((await api.publication(get('slug'), abort.signal)).data);
        } else if (screen === 'volume-detail') {
          setEdition((await api.edition(get('id'), abort.signal)).data);
        } else if (screen === 'chapter-preview') {
          setReading((await api.chapterPreview(get('id'), abort.signal)).data);
        } else if (screen === 'free-library') {
          const params = new URLSearchParams(location.search);
          params.delete('screen');
          if (!params.has('access')) params.set('access', 'PUBLIC_FREE');
          const result = (await api.resources(params, abort.signal)).data;
          setResources(result.items);
          setResourceTotal(result.total);
          setFacets((await api.facets(abort.signal)).data);
        } else if (screen === 'resource-detail') {
          setResource((await api.resource(get('id'), abort.signal)).data);
        }
      } catch (reason) {
        if (abort.signal.aborted) return;
        setError(
          reason instanceof ApiError && reason.status === 404
            ? 'This item is unavailable or has been withdrawn.'
            : 'The catalogue could not be loaded. Check your connection and try again.',
        );
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => abort.abort();
  }, []);

  async function openResource() {
    if (!resource) return;
    setOpening(true);
    setOpenError('');
    try {
      setReading((await api.openResource(resource.id)).data);
    } catch (reason) {
      setOpenError(
        reason instanceof ApiError && reason.status === 401
          ? 'Sign in to open this registered-free resource.'
          : 'This resource is not available to read with your current access.',
      );
    } finally {
      setOpening(false);
    }
  }
  async function downloadResource(assetId: string) {
    if (!resource) return;
    try {
      const grant = (await readerApi.resourceAssetGrant(resource.id, assetId)).data;
      location.href = `/api/v1/reader/assets/${encodeURIComponent(assetId)}?grant=${encodeURIComponent(grant.token)}`;
    } catch {
      setOpenError('The licensed file is unavailable for download.');
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    location.assign(href('search', { q: query.trim() }));
  }
  async function share() {
    if (!publication) return;
    const url = `${location.origin}/api/v1/share/publications/${publication.slug}`;
    if (navigator.share) await navigator.share({ title: publication.title, url });
    else {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
    }
  }

  const title =
    publication?.title ??
    edition?.publicationTitle ??
    resource?.title ??
    {
      home: 'Technology books and learning',
      collections: 'Collections and categories',
      catalogue: 'Books and series',
      search: 'Search the library',
      'free-library': 'Free resource library',
      'resource-detail': 'Resource details',
      'chapter-preview': 'Sample chapter',
    }[screen] ??
    'Library catalogue';
  const description =
    publication?.description ??
    resource?.description ??
    'Explore technology publications and learning resources from Arata TechLibrary.';
  const pageNumber = Math.max(1, Number(get('page')) || 1);
  const pageLink = (next: number) => {
    const params = new URLSearchParams(location.search);
    params.set('page', String(next));
    return `/?${params}`;
  };

  return (
    <div className="portal min-h-screen bg-[#f7f9fa] text-[#183443]">
      <Metadata title={title} description={description} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-3 text-lg font-black tracking-tight">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-lg bg-[#74233e] text-white"
            >
              ◇
            </span>
            <span>
              ARATA <span className="text-[#087d78]">TECHLIBRARY</span>
              <sup className="text-[9px]">™</sup>
            </span>
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            <a className={linkStyle} href="/">
              Home
            </a>
            <a className={linkStyle} href={href('catalogue')}>
              Books
            </a>
            <a className={linkStyle} href={href('collections')}>
              Collections
            </a>
            <a className={linkStyle} href={href('free-library', { access: 'PUBLIC_FREE' })}>
              Free Library
            </a>
            <a className={linkStyle} href={href('search')}>
              Search
            </a>
            <a className={linkStyle} href={href('pricing')}>
              Plans
            </a>
          </nav>
          <a className={outlineStyle} href={href('login')}>
            Sign in
          </a>
          <details className="w-full md:hidden">
            <summary className="cursor-pointer rounded-md border border-slate-300 p-3 font-semibold">
              Browse library
            </summary>
            <nav aria-label="Mobile" className="grid gap-1 py-2">
              <a className={linkStyle} href="/">
                Home
              </a>
              <a className={linkStyle} href={href('catalogue')}>
                Books and series
              </a>
              <a className={linkStyle} href={href('collections')}>
                Collections
              </a>
              <a className={linkStyle} href={href('free-library', { access: 'PUBLIC_FREE' })}>
                Free Library
              </a>
              <a className={linkStyle} href={href('search')}>
                Search
              </a>
              <a className={linkStyle} href={href('pricing')}>
                Plans
              </a>
            </nav>
          </details>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {updateReady && (
          <div role="status" className="mb-6 rounded-lg border border-teal-300 bg-teal-50 p-4">
            An update is ready.{' '}
            <button className="font-bold underline" onClick={onUpdate}>
              Apply update
            </button>
          </div>
        )}
        {screen === 'home' && (
          <>
            <section className="grid overflow-hidden rounded-2xl bg-[#153849] text-white md:grid-cols-[3fr_2fr]">
              <div className="px-6 py-12 sm:px-10 sm:py-16">
                <p className="text-sm font-bold uppercase tracking-[.18em] text-[#eacb78]">
                  Read · Learn · Build
                </p>
                <h1 className="mt-5 max-w-xl text-4xl font-black leading-tight sm:text-5xl">
                  Knowledge that moves with you.
                </h1>
                <p className="mt-5 max-w-xl text-lg text-slate-200">
                  Technology books, practical exercises and free learning resources, accessible
                  wherever you study.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a className={buttonStyle} href={href('catalogue')}>
                    Explore our books →
                  </a>
                  <a
                    className={outlineStyle}
                    href={href('free-library', { access: 'PUBLIC_FREE' })}
                  >
                    Browse free library
                  </a>
                </div>
              </div>
              <div className="grid min-h-56 place-items-center bg-[#205467] p-8">
                <div className="w-48 rotate-[-8deg] rounded-sm border-l-8 border-[#eacb78] bg-[#74233e] p-6 shadow-2xl">
                  <span className="text-xs uppercase tracking-[.2em]">Arata TechLibrary</span>
                  <p className="mt-12 text-2xl font-bold">
                    Read.
                    <br />
                    Learn.
                    <br />
                    Build.
                  </p>
                  <span className="mt-8 block text-xs">Technology publishing</span>
                </div>
              </div>
            </section>
            <section className="mt-10">
              <h2 className="text-2xl font-bold">Choose how you learn</h2>
              <p className="text-slate-600">One library. Multiple paths into technology.</p>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <a className="portal-card" href={href('catalogue', { access: 'PREMIUM' })}>
                  <strong>Premium books</strong>
                  <p>Browse published books, volumes and editions.</p>
                  <span>Explore →</span>
                </a>
                <a className="portal-card" href={href('free-library', { access: 'PUBLIC_FREE' })}>
                  <strong>Always-free resources</strong>
                  <p>Open public learning materials without a subscription.</p>
                  <span>Explore →</span>
                </a>
                <a className="portal-card" href={href('catalogue', { kind: 'SERIES' })}>
                  <strong>Multi-volume learning</strong>
                  <p>Follow a series from volume to edition to chapter.</p>
                  <span>Explore →</span>
                </a>
              </div>
            </section>
            <section className="mt-12">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold">Featured publications</h2>
                  <p className="text-slate-600">Selected published titles.</p>
                </div>
                <a className="font-bold text-[#087d78]" href={href('catalogue')}>
                  View all →
                </a>
              </div>
              {!busy && !error && books.length === 0 ? (
                <div className="mt-5">
                  <Empty title="No featured publications yet">
                    Editorial selections will appear after publication approval.
                  </Empty>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {books.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              )}
            </section>
            <section className="mt-12">
              <div className="flex items-end justify-between">
                <h2 className="text-2xl font-bold">Technology collections</h2>
                <a className="font-bold text-[#087d78]" href={href('collections')}>
                  All collections →
                </a>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {collections.slice(0, 3).map((item) => (
                  <a
                    className="portal-card"
                    href={href('catalogue', { collection: item.slug })}
                    key={item.slug}
                  >
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <span>{item.publicationCount} publications →</span>
                  </a>
                ))}
              </div>
            </section>
            <section className="mt-12">
              <div className="flex items-end justify-between">
                <h2 className="text-2xl font-bold">Free learning resources</h2>
                <a
                  className="font-bold text-[#087d78]"
                  href={href('free-library', { access: 'PUBLIC_FREE' })}
                >
                  Free Library →
                </a>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {resources.map((item) => (
                  <ResourceCard key={item.id} resource={item} />
                ))}
              </div>
            </section>
          </>
        )}
        {screen === 'collections' && (
          <>
            <p className="page-kicker">Public & discovery</p>
            <h1 className="page-title">Collections and categories</h1>
            <p className="page-lead">Explore technology topics with published publications.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((item) => (
                <a
                  className="portal-card"
                  href={href('catalogue', { collection: item.slug })}
                  key={item.slug}
                >
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <span>{item.publicationCount} publications →</span>
                </a>
              ))}
            </div>
            {!busy && collections.length === 0 && !error && (
              <Empty title="No collections yet">
                Collections appear when publications are approved.
              </Empty>
            )}
          </>
        )}
        {(screen === 'catalogue' || screen === 'search') && (
          <>
            <p className="page-kicker">Public & discovery</p>
            <h1 className="page-title">
              {screen === 'search' ? 'Search the library' : 'Books and series catalogue'}
            </h1>
            <p className="page-lead">
              Browse published metadata and available sample content. Access labels come from
              approved content policies.
            </p>
            <form className="mt-7 flex flex-wrap gap-2" role="search" onSubmit={search}>
              <label className="sr-only" htmlFor="catalogue-search">
                Search books and resources
              </label>
              <input
                id="catalogue-search"
                type="search"
                className="min-w-56 flex-1 rounded-lg border border-slate-300 bg-white p-3"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, subjects and free text"
                minLength={2}
              />
              <button className={buttonStyle}>Search</button>
            </form>
            {screen === 'catalogue' && (
              <form
                className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
                action="/"
                method="get"
              >
                <input type="hidden" name="screen" value="catalogue" />
                {get('q') && <input type="hidden" name="q" value={get('q')} />}
                <label className="filter-label">
                  Publication type
                  <select name="kind" defaultValue={get('kind')}>
                    <option value="">All types</option>
                    <option value="STANDALONE">Standalone books</option>
                    <option value="SERIES">Multi-volume series</option>
                  </select>
                </label>
                <label className="filter-label">
                  Access
                  <select name="access" defaultValue={get('access')}>
                    <option value="">All access classes</option>
                    <option value="PUBLIC_FREE">Public free</option>
                    <option value="REGISTERED_FREE">Registered free</option>
                    <option value="PREMIUM">Premium</option>
                  </select>
                </label>
                <label className="filter-label">
                  Status
                  <select name="status" defaultValue={get('status')}>
                    <option value="">All public statuses</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="FORTHCOMING">Forthcoming</option>
                  </select>
                </label>
                <label className="filter-label">
                  Collection
                  <select name="collection" defaultValue={get('collection')}>
                    <option value="">All collections</option>
                    {collections.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-label">
                  Subject
                  <select name="subject" defaultValue={get('subject')}>
                    <option value="">All subjects</option>
                    {facets.subjects.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-label">
                  Author
                  <select name="author" defaultValue={get('author')}>
                    <option value="">All authors</option>
                    {facets.authors.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-label">
                  Volume
                  <select name="volume" defaultValue={get('volume')}>
                    <option value="">All volumes</option>
                    {facets.volumes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-label">
                  Edition
                  <select name="edition" defaultValue={get('edition')}>
                    <option value="">All editions</option>
                    {facets.editions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-label">
                  Sort
                  <select name="sort" defaultValue={get('sort') || 'newest'}>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="title">Title A–Z</option>
                    <option value="title-desc">Title Z–A</option>
                  </select>
                </label>
                <button className={buttonStyle}>Apply filters</button>
              </form>
            )}
            {!busy && !error && (
              <p className="mt-6 text-sm text-slate-600" role="status">
                {total} publications found
                {screen === 'search' ? `; ${resourceTotal} resources found` : ''}.
              </p>
            )}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
            {!busy && !error && books.length === 0 && (
              <div className="mt-5">
                <Empty title="No publications match">
                  Try a broader search or remove a filter. Unpublished work is not listed.
                </Empty>
              </div>
            )}
            {screen === 'search' && resources.length > 0 && (
              <section className="mt-10">
                <h2 className="text-2xl font-bold">Learning resources</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {resources.map((item) => (
                    <ResourceCard key={item.id} resource={item} />
                  ))}
                </div>
              </section>
            )}
            {total > 12 && (
              <nav aria-label="Catalogue pages" className="mt-7 flex gap-3">
                {pageNumber > 1 && (
                  <a className={outlineStyle} href={pageLink(pageNumber - 1)}>
                    Previous
                  </a>
                )}
                {pageNumber * 12 < total && (
                  <a className={outlineStyle} href={pageLink(pageNumber + 1)}>
                    Next
                  </a>
                )}
              </nav>
            )}
          </>
        )}
        {screen === 'series-detail' && publication && (
          <>
            <a className="font-semibold text-[#087d78]" href={href('catalogue')}>
              ← Books and series
            </a>
            <div className="mt-5 grid gap-8 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-[1fr_2fr] md:p-8">
              <div className="grid min-h-72 place-items-center rounded-lg bg-[#153849] p-8 text-white">
                <div className="w-48 rotate-[-5deg] border-l-8 border-[#eacb78] bg-[#74233e] p-6 shadow-xl">
                  <span className="text-xs uppercase">Arata TechLibrary</span>
                  <strong className="mt-10 block text-2xl">{publication.title}</strong>
                </div>
              </div>
              <div>
                <p className="page-kicker">
                  {publication.kind === 'SERIES' ? 'Multi-volume series' : 'Standalone book'}
                </p>
                <h1 className="mt-3 text-3xl font-black sm:text-4xl">{publication.title}</h1>
                {publication.subtitle && (
                  <p className="mt-2 text-xl text-slate-600">{publication.subtitle}</p>
                )}
                <div className="mt-5">
                  <AccessBadge
                    state={publication.accessState}
                    accessClass={publication.accessClass}
                  />
                </div>
                <p className="mt-5 whitespace-pre-wrap text-slate-700">{publication.description}</p>
                <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-bold">Contributors</dt>
                    <dd>
                      {publication.contributors
                        .map((item) => `${item.name} (${item.role.toLowerCase()})`)
                        .join(', ') || 'To be announced'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Subject</dt>
                    <dd>{publication.subject ?? 'Not specified'}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">Publication date</dt>
                    <dd>
                      {publication.publishedAt
                        ? new Date(publication.publishedAt).toLocaleDateString()
                        : publication.releaseAt
                          ? `Forthcoming: ${new Date(publication.releaseAt).toLocaleDateString()}`
                          : 'Not announced'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Licence</dt>
                    <dd>{publication.licenceCode ?? 'All rights reserved'}</dd>
                  </div>
                </dl>
                <p className="mt-5 text-sm text-slate-600">
                  {publication.copyrightNotice ?? 'Copyright terms are provided by the publisher.'}
                </p>
                <button className={`${outlineStyle} mt-5`} onClick={() => void share()}>
                  Share publication
                </button>
                {shareCopied && (
                  <span role="status" className="ml-3 text-sm">
                    Link copied.
                  </span>
                )}
              </div>
            </div>
            <section className="mt-9">
              <h2 className="text-2xl font-bold">
                {publication.kind === 'SERIES' ? 'Volumes and editions' : 'Available editions'}
              </h2>
              {publication.editions?.length ? (
                <div className="mt-4 grid gap-3">
                  {publication.editions.map((item) => (
                    <a
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 hover:border-[#087d78]"
                      href={href('volume-detail', { id: item.id })}
                    >
                      <div>
                        <strong>{item.volumeTitle ?? publication.title}</strong>
                        <p className="text-sm text-slate-600">
                          {item.label} · Revision {item.revisionNumber}
                          {item.isDefault ? ' · Default edition' : ''}
                        </p>
                      </div>
                      <span className="font-bold text-[#087d78]">Browse chapters →</span>
                    </a>
                  ))}
                </div>
              ) : (
                <Empty title="Edition not yet available">
                  This publication is forthcoming; no chapter content is public yet.
                </Empty>
              )}
            </section>
          </>
        )}
        {screen === 'volume-detail' && edition && (
          <>
            <a
              className="font-semibold text-[#087d78]"
              href={href('series-detail', { slug: edition.publicationSlug })}
            >
              ← {edition.publicationTitle}
            </a>
            <p className="page-kicker mt-6">Edition and chapter navigation</p>
            <h1 className="page-title">{edition.volumeTitle ?? edition.publicationTitle}</h1>
            <p className="page-lead">
              {edition.label} · Revision {edition.revisionNumber} · Published{' '}
              {new Date(edition.publishedAt).toLocaleDateString()}
            </p>
            <a
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[#74233e] px-5 font-semibold text-white"
              href={href('reader', { edition: edition.id })}
            >
              Open digital reader
            </a>
            <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-xl font-bold">Table of contents</h2>
              <p className="mt-1 text-sm text-slate-600">
                Chapter titles are public. Only approved samples can be opened here.
              </p>
              <ol className="mt-5 divide-y divide-slate-200">
                {edition.chapters.map((chapter) => (
                  <li
                    key={chapter.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <span>
                      <span className="mr-3 font-bold text-[#087d78]">{chapter.ordinal}.</span>
                      {chapter.title}
                    </span>
                    {chapter.previewAvailable ? (
                      <a
                        className="font-bold text-[#087d78]"
                        href={href('chapter-preview', { id: chapter.id })}
                      >
                        Read free sample →
                      </a>
                    ) : (
                      <span className="text-sm text-slate-600">Preview unavailable</span>
                    )}
                  </li>
                ))}
              </ol>
              {edition.chapters.length === 0 && (
                <p className="mt-4">No public chapter outline has been added.</p>
              )}
            </section>
          </>
        )}
        {screen === 'chapter-preview' && reading && (
          <>
            <a
              className="font-semibold text-[#087d78]"
              href={href('volume-detail', {
                id: get('edition') || ('editionId' in reading ? String(reading.editionId) : ''),
              })}
            >
              ← Table of contents
            </a>
            <p className="page-kicker mt-6">Public sample chapter</p>
            <h1 className="page-title">{reading.title}</h1>
            <article className="mt-7 max-w-3xl whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-6 leading-8">
              {reading.text}
            </article>
          </>
        )}
        {screen === 'free-library' && (
          <>
            <p className="page-kicker">Public & discovery</p>
            <h1 className="page-title">Free resource library</h1>
            <p className="page-lead">
              Public-free materials open without a subscription. Registered-free items require sign
              in; premium resources remain locked.
            </p>
            <form className="mt-6 flex flex-wrap gap-3" action="/" method="get">
              <input type="hidden" name="screen" value="free-library" />
              <label className="filter-label">
                Access
                <select
                  name="access"
                  defaultValue={route.has('access') ? get('access') : 'PUBLIC_FREE'}
                >
                  <option value="PUBLIC_FREE">Public free</option>
                  <option value="REGISTERED_FREE">Registered free</option>
                  <option value="PREMIUM">Premium</option>
                  <option value="">All public listings</option>
                </select>
              </label>
              <label className="filter-label">
                Format
                <select name="format" defaultValue={get('format')}>
                  <option value="">All formats</option>
                  {facets.formats.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-label">
                Sort
                <select name="sort" defaultValue={get('sort') || 'newest'}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="title">Title A–Z</option>
                  <option value="title-desc">Title Z–A</option>
                </select>
              </label>
              <button className={buttonStyle}>Apply filters</button>
            </form>
            <p className="mt-6 text-sm text-slate-600" role="status">
              {resourceTotal} resources found.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {resources.map((item) => (
                <ResourceCard key={item.id} resource={item} />
              ))}
            </div>
            {!busy && !error && resources.length === 0 && (
              <Empty title="No resources here yet">Try another access class or format.</Empty>
            )}
            {resourceTotal > 12 && (
              <nav aria-label="Resource pages" className="mt-7 flex gap-3">
                {pageNumber > 1 && (
                  <a className={outlineStyle} href={pageLink(pageNumber - 1)}>
                    Previous
                  </a>
                )}
                {pageNumber * 12 < resourceTotal && (
                  <a className={outlineStyle} href={pageLink(pageNumber + 1)}>
                    Next
                  </a>
                )}
              </nav>
            )}
          </>
        )}
        {screen === 'resource-detail' && resource && (
          <>
            <a
              className="font-semibold text-[#087d78]"
              href={href('free-library', { access: 'PUBLIC_FREE' })}
            >
              ← Free Library
            </a>
            <div className="mt-6 max-w-3xl rounded-xl border border-slate-200 bg-white p-6">
              <p className="page-kicker">{resource.format ?? 'Learning resource'}</p>
              <h1 className="mt-3 text-3xl font-black">{resource.title}</h1>
              <div className="mt-4">
                <AccessBadge state={resource.accessState} accessClass={resource.accessClass} />
              </div>
              <p className="mt-5 whitespace-pre-wrap text-slate-700">{resource.description}</p>
              <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-bold">Licence</dt>
                  <dd>{resource.licenceCode}</dd>
                </div>
                <div>
                  <dt className="font-bold">Published</dt>
                  <dd>{new Date(resource.publishedAt).toLocaleDateString()}</dd>
                </div>
                {resource.attribution && (
                  <div>
                    <dt className="font-bold">Attribution</dt>
                    <dd>{resource.attribution}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-5 text-sm text-slate-600">
                {resource.copyrightNotice ?? 'Observe the stated licence and copyright terms.'}
              </p>
              {resource.accessState !== 'UPCOMING' ? (
                <button
                  className={`${buttonStyle} mt-5`}
                  disabled={opening}
                  onClick={() => void openResource()}
                >
                  {opening ? 'Opening…' : 'Open resource'}
                </button>
              ) : (
                <p className="mt-5 font-semibold">Reading is not available for this item.</p>
              )}
              {openError && (
                <p role="alert" className="mt-4 text-[#9b2144]">
                  {openError}{' '}
                  {resource.accessState === 'SIGN_IN' && (
                    <a className="underline" href={href('login')}>
                      Sign in
                    </a>
                  )}
                </p>
              )}
              {reading && (
                <article className="mt-7 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-5 leading-8">
                  <h2 className="mb-4 text-xl font-bold">{reading.title}</h2>
                  {reading.text}
                  {reading.assets?.length ? (
                    <div className="mt-5">
                      <h3 className="font-semibold">Licensed files</h3>
                      <ul className="mt-2 space-y-2">
                        {reading.assets.map((asset) => (
                          <li key={asset.id}>
                            <button
                              className="font-semibold underline"
                              onClick={() => void downloadResource(asset.id)}
                            >
                              Download {asset.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              )}
            </div>
          </>
        )}
        {busy && (
          <p role="status" className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            Loading catalogue…
          </p>
        )}
        {error && (
          <div role="alert" className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-6">
            <p>{error}</p>
            <a className="mt-3 inline-block font-bold underline" href={href('catalogue')}>
              Browse catalogue
            </a>
          </div>
        )}
      </main>
      <footer className="mt-16 bg-[#153849] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-6 py-8">
          <div>
            <strong>Arata TechLibrary™</strong>
            <p className="text-sm text-slate-300">Technology publishing and learning</p>
          </div>
          <div className="text-sm text-slate-300">
            <a className="underline" href={href('catalogue')}>
              Catalogue
            </a>{' '}
            ·{' '}
            <a className="underline" href={href('free-library', { access: 'PUBLIC_FREE' })}>
              Free Library
            </a>{' '}
            ·{' '}
            <span>
              {checked ? (online ? 'API available' : 'API unavailable') : 'Checking API…'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
