import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<ComponentProps<typeof Markdown>['rehypePlugins']> = [
  [rehypeSanitize, schema],
  [rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 10 }],
  [rehypeHighlight, { detect: false }],
];

function safeUrl(url: string, key: string): string {
  if (key !== 'href') return '';
  if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('?'))
    return url;
  if (/^https:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return '';
}

function highlighted(value: string, quotes: string[]): ReactNode {
  const matches = quotes.filter(Boolean);
  if (!matches.length) return value;
  const escaped = matches.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = value.split(new RegExp(`(${escaped.join('|')})`, 'g'));
  return parts.map((part, index) =>
    matches.includes(part) ? (
      <mark key={index} className="bg-yellow-200 text-slate-900">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function markText(children: ReactNode, quotes: string[]): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') return highlighted(child, quotes);
    if (!isValidElement<{ children?: ReactNode }>(child) || !child.props.children) return child;
    return cloneElement(child, { children: markText(child.props.children, quotes) });
  });
}

export function ReaderContent({ markdown, quotes }: { markdown: string; quotes: string[] }) {
  return (
    <Markdown
      skipHtml
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={safeUrl}
      components={{
        h1: ({ children }) => <h2 className="mt-8 text-2xl font-bold">{children}</h2>,
        h2: ({ children }) => <h2 className="mt-8 text-2xl font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-6 text-xl font-semibold">{children}</h3>,
        p: ({ children }) => (
          <p className="my-5 whitespace-pre-wrap leading-relaxed">{markText(children, quotes)}</p>
        ),
        pre: ({ children }) => (
          <pre className="my-5 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-50">
            {children}
          </pre>
        ),
        a: ({ href, children }) => (
          <a
            href={href || undefined}
            target={href?.startsWith('https://') ? '_blank' : undefined}
            rel={href?.startsWith('https://') ? 'noopener noreferrer' : undefined}
          >
            {children}
          </a>
        ),
        img: ({ alt }) => (
          <span role="img" aria-label={alt || 'Illustration'}>
            {alt || 'Illustration'} (asset unavailable)
          </span>
        ),
      }}
    >
      {markdown}
    </Markdown>
  );
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; source: string }
  | { type: 'image' | 'diagram'; assetId: string; alt: string };

function isBlock(value: unknown): value is Block {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.type === 'paragraph') return typeof item.text === 'string';
  if (item.type === 'heading')
    return (
      typeof item.text === 'string' &&
      typeof item.level === 'number' &&
      item.level >= 2 &&
      item.level <= 6
    );
  if (item.type === 'code')
    return typeof item.source === 'string' && typeof item.language === 'string';
  if (item.type === 'image' || item.type === 'diagram')
    return typeof item.assetId === 'string' && typeof item.alt === 'string';
  return false;
}

function codeMarkdown(source: string, language: string) {
  const longest = Math.max(0, ...[...source.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const safeLanguage = /^[a-z0-9+#.-]{1,40}$/i.test(language) ? language : '';
  return `${fence}${safeLanguage}\n${source}\n${fence}`;
}

export function ReaderBlocks({ blocks, quotes }: { blocks: unknown; quotes: string[] }) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return (
    <section aria-label="Structured learning blocks">
      {blocks.slice(0, 2000).map((value: unknown, index: number) => {
        if (!isBlock(value)) return null;
        if (value.type === 'paragraph')
          return (
            <p key={index} className="my-5 whitespace-pre-wrap leading-relaxed">
              {highlighted(value.text, quotes)}
            </p>
          );
        if (value.type === 'heading')
          return createElement(
            `h${value.level}`,
            { key: index, className: 'mt-6 font-semibold' },
            value.text,
          );
        if (value.type === 'code')
          return (
            <ReaderContent
              key={index}
              markdown={codeMarkdown(value.source, value.language)}
              quotes={[]}
            />
          );
        return (
          <figure key={index} className="my-5 rounded border border-current/20 p-3">
            <figcaption>
              {value.alt} — {value.type === 'diagram' ? 'Diagram' : 'Illustration'} asset
              unavailable in this reader.
            </figcaption>
          </figure>
        );
      })}
    </section>
  );
}
