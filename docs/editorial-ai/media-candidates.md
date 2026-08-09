# Media candidates

`ArticleMediaCandidate` stores provider-neutral external references for `YOUTUBE`, `VIDEO_EMBED`, `IMAGE`, or `EXTERNAL_LINK`. It retains platform, external ID, URL, title, publisher, optional external thumbnail URL, publication time, explicit embed/right status, relevance, and editorial state.

Milestone 23 does not scrape YouTube, download or rehost videos, resolve direct MP4 files, copy source images, or persist thumbnail bytes. Draft generation returns bounded media search terms even when no approved search provider is configured. Editors may record a manually discovered external candidate through the admin API.

Attachment is a separate audited action. The backend requires `embedAllowed=true` and rights `OWNED` or `EMBED_ALLOWED`; `UNKNOWN` and `LINK_ONLY` fail closed. At most one attached candidate is marked primary by the current operation. Media is optional and never affects publication eligibility.
