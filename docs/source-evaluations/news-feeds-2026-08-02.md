# NFL news-feed evaluation — August 2, 2026

This was a read-only, metadata-only evaluation. No source, candidate, article, image, page body, or feed body was persisted. Only two candidate URLs were checked, and neither was added automatically to the registry.

## ESPN NFL News

- Feed URL: `https://www.espn.com/espn/rss/nfl/news`
- Publisher: ESPN
- Format/status/type: RSS 2.0; HTTP 200; `text/xml;charset=UTF-8`
- Response/entries: 13,016 bytes; 22 entries during the check
- IDs: all 22 entries supplied distinct GUIDs; the observed form was an ESPN content key such as `US-EN-49368181`
- Links: all 22 were HTTPS ESPN story URLs with stable-looking path IDs
- Descriptions: all entries supplied plain-text descriptions; observed maximum was 255 characters and none contained HTML-like tags
- Dates: all 22 supplied `pubDate`; the observed format included an explicit `EST` abbreviation
- Duplicate/team behavior: GUID plus canonical ESPN URL provides two deterministic identities; six sampled titles contained an exact recognized team name
- Usage notes: metadata is compatible with the parser and remains subject to ESPN terms, attribution, editorial review, and normal rights review
- Recommendation: technically suitable for a manually configured `PAUSED` source, but not inserted or enabled by this migration because source approval/usage terms remain a product-owner decision

The browser-oriented check initially encountered anti-bot presentation, while the bounded non-browser XML request with the inbox user agent returned the feed successfully. The implementation uses no browser rendering and must treat a future HTML/challenge response as a failed run.

## NFL.com `?format=rss`

- Candidate URL: `https://www.nfl.com/?format=rss`
- Publisher: National Football League
- Format/status/type: HTTP 200; `text/html; charset=utf-8`, not RSS or Atom
- Response: approximately 3.45 MB, above the inbox's 512 KiB limit
- Entries/GUIDs/dates: not applicable because the response was ordinary HTML
- Link/description/duplicate/team behavior: not evaluated; the client rejects the content before parsing
- Recommendation: do not configure or enable this URL

No team-feed URL was inferred. The repository ships with no default active live source. A future approval should create a source explicitly, test it while paused, document publisher terms and observed validators, and only then activate manual ingestion.
