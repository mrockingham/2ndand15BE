# Source rights

`SourceRightsProfile` is optional and one-to-one with a configured `NewsSource`. Missing profiles resolve to conservative defaults: text/image/video `UNKNOWN`, quotation policy `UNKNOWN`, and `reviewRequired=true`.

Text usage is `SUMMARY_ALLOWED`, `LINK_ONLY`, or `UNKNOWN`. A stored candidate description is supplied to AI only when both the reviewed profile is `SUMMARY_ALLOWED` and the existing source setting permits description use. Otherwise generation receives headline, publisher, URL, author/time metadata, and team suggestions only; it is marked thin and rights-unclear.

Image/video usage is `OWNED`, `EMBED_ALLOWED`, `LINK_ONLY`, or `UNKNOWN`. These values are administrative judgments, not inferred from a URL or publisher identity. Private notes and reviewer identity never appear publicly. Editors cannot attach suggested media unless the individual record is embeddable and its rights status is `OWNED` or `EMBED_ALLOWED`.

The application does not fetch article pages, download images, proxy thumbnails, copy article bodies, or infer permission from official-team/publisher status. Attribution and external links remain attached to the article.
