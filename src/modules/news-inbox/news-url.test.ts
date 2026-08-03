import { describe, expect, it } from 'vitest';

import { isPublicIpAddress, normalizeNewsUrl, parseFeedUrl } from './news-url.js';

describe('news URL policy', () => {
  it('normalizes only documented tracking features and preserves material queries', () => {
    const normalized = normalizeNewsUrl(
      'HTTPS://Example.COM:443/story?id=42&utm_source=inbox&fbclid=x#section',
    );
    expect(normalized.url).toBe('https://example.com/story?id=42');
    expect(normalized.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeNewsUrl('https://example.com/story?id=43').url).not.toBe(normalized.url);
  });

  it.each([
    'file:///etc/passwd',
    'http://localhost/feed.xml',
    'http://127.0.0.1/feed.xml',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/feed.xml',
    'https://user:password@example.com/feed.xml',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => parseFeedUrl(url)).toThrow();
  });

  it('classifies public and non-public IP addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('192.168.1.1')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicIpAddress('fc00::1')).toBe(false);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });
});
