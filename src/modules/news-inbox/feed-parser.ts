import { SaxesParser } from 'saxes';

import { AppError } from '../../common/errors/app-error.js';
import { normalizeNewsUrl } from './news-url.js';

const MAX_XML_DEPTH = 32;
const MAX_FIELD_CHARACTERS = 10_000;
const MAX_DESCRIPTION_CHARACTERS = 2_000;

export interface NormalizedFeedEntry {
  readonly externalId: string | null;
  readonly canonicalUrl: string;
  readonly canonicalUrlHash: string;
  readonly headline: string;
  readonly description: string | null;
  readonly author: string | null;
  readonly publishedAt: Date | null;
}

export interface ParsedFeed {
  readonly kind: 'RSS' | 'ATOM';
  readonly entries: readonly NormalizedFeedEntry[];
}

interface EntryState {
  readonly values: Map<string, string>;
  atomLink: string | null;
}

interface CaptureState {
  readonly key: string;
  readonly rootDepth: number;
  text: string;
}

export function parseNewsFeed(xml: string, maximumEntries = 100): ParsedFeed {
  validateXmlText(xml);
  const document: { kind: ParsedFeed['kind'] | null } = { kind: null };
  let depth = 0;
  let entry: EntryState | null = null;
  let entryDepth = 0;
  let capture: CaptureState | null = null;
  const entries: NormalizedFeedEntry[] = [];
  const stack: string[] = [];
  const parser = new SaxesParser({ xmlns: false, position: true });

  parser.on('doctype', () => {
    throw feedError(
      'NEWS_FEED_XML_ENTITY_FORBIDDEN',
      'XML document types and entities are forbidden.',
    );
  });
  parser.on('error', (error) => {
    throw feedError('NEWS_FEED_XML_MALFORMED', sanitizeParserMessage(error.message));
  });
  parser.on('opentag', (tag) => {
    depth += 1;
    if (depth > MAX_XML_DEPTH) {
      throw feedError('NEWS_FEED_XML_DEPTH_EXCEEDED', 'The feed exceeds the XML nesting limit.');
    }
    const name = localName(tag.name);
    stack.push(name);
    if (depth === 1) {
      if (name === 'rss') document.kind = 'RSS';
      else if (name === 'feed') document.kind = 'ATOM';
      else throw feedError('NEWS_FEED_FORMAT_UNSUPPORTED', 'The XML is not an RSS or Atom feed.');
    }
    if (
      entry === null &&
      ((document.kind === 'RSS' && name === 'item') ||
        (document.kind === 'ATOM' && name === 'entry'))
    ) {
      if (entries.length >= maximumEntries) {
        throw feedError(
          'NEWS_FEED_ENTRY_LIMIT_EXCEEDED',
          'The feed exceeds the configured entry limit.',
        );
      }
      entry = { values: new Map(), atomLink: null };
      entryDepth = depth;
      return;
    }
    if (entry === null) return;
    if (
      capture?.key === 'description' &&
      (['script', 'iframe', 'style'].includes(name) || hasUnsafeMarkupAttribute(tag))
    ) {
      throw feedError(
        'NEWS_SOURCE_DESCRIPTION_UNSAFE',
        'The source description contains unsafe markup.',
      );
    }
    if (document.kind === 'ATOM' && name === 'link' && entry.atomLink === null) {
      const attributes = tag.attributes as Record<string, string>;
      const relationship = attributes.rel?.toLowerCase();
      if (relationship === undefined || relationship === 'alternate') {
        entry.atomLink = attributes.href ?? null;
      }
      return;
    }
    if (capture !== null) return;
    const key = capturedKey(document.kind, name, stack.at(-2));
    if (key === null) return;
    capture = { key, rootDepth: depth, text: '' };
  });
  const appendText = (text: string): void => {
    if (capture === null) return;
    capture.text += text;
    if (capture.text.length > MAX_FIELD_CHARACTERS) {
      throw feedError('NEWS_FEED_FIELD_TOO_LARGE', 'A feed entry field exceeds its safe limit.');
    }
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (entry !== null && capture !== null && capture.rootDepth === depth) {
      if (entry.values.has(capture.key)) {
        throw feedError(
          'NEWS_FEED_DUPLICATE_FIELD',
          `A feed entry repeats the ${capture.key} field.`,
        );
      }
      entry.values.set(capture.key, capture.text);
      capture = null;
    }
    if (entry !== null && entryDepth === depth && ['item', 'entry'].includes(name)) {
      entries.push(finalizeEntry(entry, document.kind));
      entry = null;
      capture = null;
    }
    stack.pop();
    depth -= 1;
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw feedError(
      'NEWS_FEED_XML_MALFORMED',
      sanitizeParserMessage(error instanceof Error ? error.message : 'Malformed XML feed.'),
    );
  }
  if (document.kind === null)
    throw feedError('NEWS_FEED_FORMAT_UNSUPPORTED', 'The XML is not an RSS or Atom feed.');
  return { kind: document.kind, entries };
}

function capturedKey(
  kind: ParsedFeed['kind'] | null,
  name: string,
  parent: string | undefined,
): string | null {
  if (kind === 'RSS') {
    const keys: Readonly<Record<string, string>> = {
      guid: 'externalId',
      title: 'title',
      link: 'link',
      description: 'description',
      author: 'author',
      'dc:creator': 'creator',
      pubdate: 'published',
    };
    return keys[name] ?? null;
  }
  if (parent === 'author' && name === 'name') return 'author';
  const keys: Readonly<Record<string, string>> = {
    id: 'externalId',
    title: 'title',
    summary: 'description',
    published: 'published',
    updated: 'updated',
  };
  return keys[name] ?? null;
}

function finalizeEntry(entry: EntryState, kind: ParsedFeed['kind'] | null): NormalizedFeedEntry {
  const headline = normalizePlainText(entry.values.get('title') ?? '');
  const rawUrl = kind === 'ATOM' ? entry.atomLink : entry.values.get('link');
  if (headline.length === 0 || headline.length > 300) {
    throw feedError('NEWS_FEED_ENTRY_TITLE_INVALID', 'Every feed entry requires a bounded title.');
  }
  if (rawUrl === undefined || rawUrl === null || rawUrl.trim().length === 0) {
    throw feedError('NEWS_FEED_ENTRY_URL_INVALID', 'Every feed entry requires a canonical URL.');
  }
  const normalized = normalizeNewsUrl(rawUrl.trim());
  const descriptionValue = entry.values.get('description');
  return {
    externalId: boundedNullable(entry.values.get('externalId'), 512),
    canonicalUrl: normalized.url,
    canonicalUrlHash: normalized.hash,
    headline,
    description:
      descriptionValue === undefined ? null : sanitizeSourceDescription(descriptionValue),
    author: boundedNullable(entry.values.get('author') ?? entry.values.get('creator'), 160),
    publishedAt: parseOptionalDate(entry.values.get('published') ?? entry.values.get('updated')),
  };
}

export function sanitizeSourceDescription(value: string): string | null {
  validateUnicodeAndControls(value);
  if (
    /<(?:script|iframe|style)\b/i.test(value) ||
    /\bon[a-z]+\s*=/i.test(value) ||
    /(?:javascript|data)\s*:/i.test(value)
  ) {
    throw feedError(
      'NEWS_SOURCE_DESCRIPTION_UNSAFE',
      'The source description contains unsafe markup.',
    );
  }
  const stripped = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  const normalized = normalizePlainText(stripped);
  if (normalized.length === 0) return null;
  return normalized.slice(0, MAX_DESCRIPTION_CHARACTERS);
}

function normalizePlainText(value: string): string {
  validateUnicodeAndControls(value);
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function boundedNullable(value: string | undefined, maximum: number): string | null {
  if (value === undefined) return null;
  const normalized = normalizePlainText(value);
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (value === undefined || value.trim().length === 0) return null;
  const timestamp = Date.parse(value.trim());
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function validateXmlText(value: string): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value)) {
    throw feedError(
      'NEWS_FEED_XML_ENTITY_FORBIDDEN',
      'XML document types and entities are forbidden.',
    );
  }
  validateUnicodeAndControls(value);
}

function validateUnicodeAndControls(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code))) {
      throw feedError(
        'NEWS_FEED_TEXT_INVALID',
        'The feed contains unsupported control characters.',
      );
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw feedError('NEWS_FEED_TEXT_INVALID', 'The feed contains malformed Unicode.');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw feedError('NEWS_FEED_TEXT_INVALID', 'The feed contains malformed Unicode.');
    }
  }
}

function localName(name: string): string {
  return name.toLowerCase();
}

function hasUnsafeMarkupAttribute(tag: { readonly attributes: Record<string, string> }): boolean {
  return Object.entries(tag.attributes).some(
    ([name, value]) =>
      name.toLowerCase().startsWith('on') || /^(?:javascript|data)\s*:/i.test(value.trim()),
  );
}

function sanitizeParserMessage(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300) || 'Malformed XML feed.';
}

function feedError(code: string, message: string): AppError {
  return new AppError({ code, message, statusCode: 422 });
}
