import { z } from 'zod';

/**
 * M35A: a deliberately small, closed JSON rich-text document model for Hero
 * content blocks -- never raw/arbitrary HTML. No existing structured
 * rich-text format exists elsewhere in this codebase (Article `body` is
 * sanitized Markdown text, not JSON), so this is new, but intentionally
 * minimal: paragraphs and headings, inline text runs with bold/italic marks,
 * links, and block-level alignment. There is no `script`/`iframe`/custom-HTML
 * node type in this model at all -- not "sanitized out" at write time, but
 * structurally impossible to express, which is a stronger guarantee than a
 * sanitizer that might miss an edge case.
 */

const MAX_BLOCKS_PER_DOCUMENT = 20;
const MAX_INLINE_NODES_PER_BLOCK = 40;
const MAX_TEXT_LENGTH = 500;

const alignmentSchema = z.enum(['left', 'center', 'right']);
const markSchema = z.enum(['bold', 'italic']);

/**
 * Matches the CTA `url` convention (see `homepage.schemas.ts`): either an
 * internal relative path (starting with `/`) or an `https:` URL. Never
 * `http:`/`javascript:`/`data:`/`file:`.
 */
const richTextHref = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => {
      if (value.startsWith('/')) return !value.startsWith('//');
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Links must be an internal path starting with "/" or an https:// URL.' },
  );

const textNodeSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    marks: z.array(markSchema).max(2).optional(),
  })
  .strict();

const linkNodeSchema = z
  .object({
    type: z.literal('link'),
    href: richTextHref,
    children: z.array(textNodeSchema).min(1).max(MAX_INLINE_NODES_PER_BLOCK),
  })
  .strict();

const inlineNodeSchema = z.union([textNodeSchema, linkNodeSchema]);

const paragraphBlockSchema = z
  .object({
    type: z.literal('paragraph'),
    align: alignmentSchema.optional(),
    children: z.array(inlineNodeSchema).min(1).max(MAX_INLINE_NODES_PER_BLOCK),
  })
  .strict();

const headingBlockSchema = z
  .object({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align: alignmentSchema.optional(),
    children: z.array(inlineNodeSchema).min(1).max(MAX_INLINE_NODES_PER_BLOCK),
  })
  .strict();

const blockNodeSchema = z.union([paragraphBlockSchema, headingBlockSchema]);

export const heroRichTextDocumentSchema = z
  .object({
    type: z.literal('doc'),
    children: z.array(blockNodeSchema).min(1).max(MAX_BLOCKS_PER_DOCUMENT),
  })
  .strict();

export type HeroRichTextMark = z.infer<typeof markSchema>;
export type HeroRichTextTextNode = z.infer<typeof textNodeSchema>;
export type HeroRichTextLinkNode = z.infer<typeof linkNodeSchema>;
export type HeroRichTextInlineNode = z.infer<typeof inlineNodeSchema>;
export type HeroRichTextParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type HeroRichTextHeadingBlock = z.infer<typeof headingBlockSchema>;
export type HeroRichTextBlockNode = z.infer<typeof blockNodeSchema>;
export type HeroRichTextDocument = z.infer<typeof heroRichTextDocumentSchema>;
