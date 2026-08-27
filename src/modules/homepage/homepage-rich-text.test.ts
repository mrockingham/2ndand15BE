import { describe, expect, it } from 'vitest';

import { heroRichTextDocumentSchema } from './homepage-rich-text.js';

function paragraph(text: string) {
  return { type: 'paragraph' as const, children: [{ type: 'text' as const, text }] };
}

describe('heroRichTextDocumentSchema', () => {
  it('accepts a minimal valid document', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [paragraph('Eagles vs. Patriots')],
    });
    expect(result.success).toBe(true);
  });

  it('accepts headings, alignment, marks, and links', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        {
          type: 'heading',
          level: 2,
          align: 'center',
          children: [{ type: 'text', text: 'Big Game', marks: ['bold', 'italic'] }],
        },
        {
          type: 'paragraph',
          align: 'left',
          children: [
            { type: 'text', text: 'Read more: ' },
            {
              type: 'link',
              href: '/articles/big-game-recap',
              children: [{ type: 'text', text: 'here' }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an external https link', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href: 'https://www.nfl.com',
              children: [{ type: 'text', text: 'NFL' }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an http (non-https) link', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'link', href: 'http://example.com', children: [{ type: 'text', text: 'x' }] },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a javascript: link', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              href: 'javascript:alert(1)',
              children: [{ type: 'text', text: 'x' }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a protocol-relative link', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'link', href: '//evil.example.com', children: [{ type: 'text', text: 'x' }] },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown node type', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [{ type: 'iframe', src: 'https://evil.example.com' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown mark', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'x', marks: ['underline'] }] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra/unknown fields (strict)', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [paragraph('x')],
      onClick: 'javascript:alert(1)',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty document', () => {
    const result = heroRichTextDocumentSchema.safeParse({ type: 'doc', children: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 blocks', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: Array.from({ length: 21 }, (_, i) => paragraph(`Paragraph ${String(i)}`)),
    });
    expect(result.success).toBe(false);
  });

  it('rejects text exceeding the max length', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [paragraph('x'.repeat(501))],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid heading level', () => {
    const result = heroRichTextDocumentSchema.safeParse({
      type: 'doc',
      children: [{ type: 'heading', level: 4, children: [{ type: 'text', text: 'x' }] }],
    });
    expect(result.success).toBe(false);
  });
});
