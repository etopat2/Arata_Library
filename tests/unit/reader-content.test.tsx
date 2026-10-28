import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderBlocks, ReaderContent } from '../../apps/web-pwa/src/ReaderContent.js';

describe('reader content rendering', () => {
  it('renders headings, tables, formulas and syntax-highlighted code as semantic markup', () => {
    const markdown = `## Systems\n\n| Name | Value |\n| --- | --- |\n| CPU | 2 |\n\n$E = mc^2$\n\n\`\`\`js\nconst answer = 42\n\`\`\``;
    const html = renderToStaticMarkup(<ReaderContent markdown={markdown} quotes={[]} />);
    expect(html).toContain('<h2');
    expect(html).toContain('<table>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    expect(html).toContain('hljs-keyword');
  });

  it('drops executable HTML and dangerous or tracking URLs while preserving safe links', () => {
    const markdown = `<script>alert('unsafe')</script>\n\n[bad](javascript:alert(1)) [safe](https://example.invalid/page) ![Diagram](https://tracker.invalid/pixel)`;
    const html = renderToStaticMarkup(<ReaderContent markdown={markdown} quotes={[]} />);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('tracker.invalid');
    expect(html).toContain('https://example.invalid/page');
    expect(html).toContain('noopener noreferrer');
    expect(html).toContain('Diagram (asset unavailable)');
  });

  it('keeps highlights and validated structured blocks visible without exposing asset URLs', () => {
    const html = renderToStaticMarkup(
      <>
        <ReaderContent markdown="A **safe quote** is here." quotes={['safe quote']} />
        <ReaderBlocks
          blocks={[
            { type: 'heading', level: 3, text: 'Practice' },
            { type: 'paragraph', text: 'Read this section.' },
            { type: 'code', language: 'js', source: 'const value = 2' },
            { type: 'diagram', assetId: 'private-id', alt: 'Flow diagram' },
            { type: 'invalid', html: '<script>bad</script>' },
          ]}
          quotes={[]}
        />
      </>,
    );
    expect(html).toContain('<mark');
    expect(html).toContain('<h3');
    expect(html).toContain('const');
    expect(html).toContain('Flow diagram');
    expect(html).not.toContain('private-id');
    expect(html).not.toContain('<script');
  });
});
