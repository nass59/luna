# Photography Portfolio — Technical Spec

Exported from the living spec doc on 2026-11-12. The doc stays the source for planning; keep this file in sync when decisions change.

## Vision and scope

Phase A is a single-owner portfolio for landscape and street photography, with a custom admin, built so it can become a multi-tenant builder (Phase B) later.

- **Phase A:** my own site. I am the only editor. English only. No selling yet.
- **Phase B (optional):** other photographers create sites, possibly commercial. No deadline.
- **Design north star:** [James Popsys](https://www.jamespopsys.com/). Image-first, a large single-image viewer with prev/next and a thumbnail toggle, minimal menu.
- **Signature feature:** an AI photo coach. For each photo it suggests concrete edits and gives advice for the next shoot (angle, subject, timing, light). It is what would set the Phase B builder apart from Squarespace-style tools.
- **Day-one rule for B:** every record carries a `siteId`, even while there is only one site.
- **Launch volume:** about 100 photos, then about 800 added per year.

## Key decisions and stack

Next.js on Vercel, Postgres, Better Auth, Cloudflare R2 and a self-owned Sharp pipeline: free or near-free in Phase A, and each piece scales to multi-tenant.

| Layer                | Choice                                                                  | Why                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework            | Next.js (App Router, RSC, ISR)                                          | Existing expertise; strongest path to multi-tenant and custom domains. Astro wins for a pure portfolio but is weaker for the admin and for SaaS.                                                                                      |
| Hosting              | Vercel, Paris region (cdg1)                                             | Native Next.js. Hobby while personal, Pro once commercial.                                                                                                                                                                            |
| Database             | PostgreSQL on Neon (EU) + Drizzle                                       | Relational data for B (tenants, clients, orders); `jsonb` for page blocks.                                                                                                                                                            |
| Auth                 | **Better Auth**                                                         | Auth.js is in maintenance mode (its team joined Better Auth). Self-hosted, users live in our Postgres, free, and the organization plugin maps to tenants in B. Clerk is faster to set up but adds lock-in and per-user cost at scale. |
| Images               | Cloudflare R2 (EU bucket) + Sharp jobs + Cloudflare CDN                 | Zero egress fees; full control over quality and EXIF.                                                                                                                                                                                 |
| Background jobs      | Trigger.dev (or Inngest)                                                | Large files exceed serverless memory and time limits.                                                                                                                                                                                 |
| Admin UI             | Custom: dnd-kit, Tiptap, block-based page schema                        | Learning goal. Look at Puck for the free-form editor in B.                                                                                                                                                                            |
| Map                  | MapLibre GL + OpenFreeMap tiles                                         | Free, no API key.                                                                                                                                                                                                                     |
| Email and newsletter | Resend                                                                  | Contact form and broadcasts; free tier to start.                                                                                                                                                                                      |
| Analytics            | **Umami**                                                               | Cookieless, so no consent banner. Free cloud tier or self-host (MIT), and its API can feed per-tenant stats in B. Plausible is the more polished paid alternative (from ~€9/month).                                                   |
| Monitoring           | Sentry free tier                                                        | Error tracking.                                                                                                                                                                                                                       |
| AI coach             | Claude API (Claude Opus 5.5, `claude-opus-5-5`) with structured outputs | Strong vision and photographic judgement; structured outputs give typed JSON that Zod validates. Runs in a Trigger.dev job like the image pipeline, so the model can be swapped behind one function.                                  |

**Upload format:** high-quality JPEG (quality 95+, long edge 4000–6000 px). TIFF adds no visible quality on the web, because every derivative is re-encoded to AVIF or WebP, and 16-bit depth only matters while editing. TIFF upload can be added later for archiving.

**Tooling:** Bun as package manager and script runner, with Node kept as the production runtime for Next.js and Trigger.dev. [Vite+](https://viteplus.dev/) (MIT, 1.0) handles `vp check` (Oxlint, Oxfmt, tsgo), `vp test` (Vitest) and `vp run` (cached monorepo tasks). Next.js is not built on Vite, so `next dev` and `next build` stay. If Vite+ conflicts with Next.js, fall back to Turborepo with standalone Oxlint and Vitest.

## Architecture

```
Visitor ──pages──▶ Public site (Next.js RSC + ISR, Vercel Paris) ──reads──▶ Neon Postgres (content, EXIF, GPS; site_id on every row)
Visitor ──images─▶ Cloudflare CDN (R2 public bucket, AVIF + WebP sizes)
Me (admin) ──▶ Admin + API (Next.js + Better Auth, writes content to DB)
Admin + API ──presigned upload──▶ R2 private (originals only, never public)
Admin + API ──trigger──▶ Trigger.dev job (Sharp: resize, encode, EXIF, blurhash)
Trigger.dev job ──read──▶ R2 private
Trigger.dev job ──derivatives──▶ Cloudflare CDN / R2 public
Trigger.dev job ──status──▶ Neon Postgres
Admin + API ──trigger──▶ Trigger.dev job (AI coach: 1600 px derivative + EXIF) ──▶ Claude API ──critique──▶ Neon Postgres
```

The browser uploads originals straight to the private bucket with a presigned URL. A background job then builds the public sizes, and the public site reads only from Postgres and the CDN. Umami (analytics) and Resend (email) sit alongside as external services, and the Claude API is called only from background jobs.

## Image pipeline and display quality

Originals stay private. Visitors only ever get size-capped AVIF or WebP derivatives from the CDN.

1. The admin requests a presigned URL. The browser uploads the original straight to the private R2 bucket.
2. A `photo.uploaded` job starts in Trigger.dev.
3. The job reads EXIF: camera, lens, settings, date and GPS. GPS is kept in the database for the map, then stripped from every public file.
4. It converts to sRGB with the ICC profile handled (optionally Display P3 for wide-gamut screens).
5. It resizes with Lanczos3 to 480, 960, 1600 and 2400 px wide (plus a private 3200 px size for client galleries), with light output sharpening per size.
6. It encodes AVIF (quality ~60–70) and WebP (~80), plus a tiny blurhash placeholder.
7. It caps the public maximum at 2400 px.
8. It writes derivatives to the public bucket under content-hashed keys with immutable cache headers, and marks the photo `ready`.

**What makes it feel high quality and fast at the same time:**

- Accurate `srcset` and `sizes`, so each screen downloads only the width it needs.
- `fetchpriority="high"` and preload on the hero (LCP) image; lazy loading everywhere else.
- A blurhash placeholder with a short fade-in, and fixed aspect ratios, so there is no layout shift.
- The slideshow preloads the next and previous images.
- Every image is cached at the Cloudflare edge close to the visitor.

**Protection:** no watermark; public files capped at 2400 px, right-click and drag disabled on images. This discourages copying but cannot prevent screenshots.

## AI photo coach

For each photo, the coach returns concrete edit suggestions and advice for next time. In Phase A it is private: only I see it, in the admin. In Phase B it becomes a per-tenant feature with a usage limit per plan.

**Flow**

1. From `/admin/photos/[id]` (or in bulk from `/admin/photos`), I request a critique. It needs the photo to be `ready`.
2. A `photo.critique` Trigger.dev job sends the 1600 px WebP derivative, the EXIF summary (camera, lens, focal length, aperture, shutter, ISO) and my caption to the Claude API. The original is never sent, and the derivative already has GPS stripped.
3. The response uses structured outputs (`output_config.format`) and is parsed with Zod before it is saved. A refusal or invalid output marks the critique `failed` with the reason, and the job retries like the image pipeline.
4. The critique is stored in `photo_critiques` and shown in a panel next to the photo.

**Output (Zod schema, versioned)**

- `summary`: two or three sentences on what works and what holds the photo back.
- `edits[]`: `{ area: exposure | contrast | white_balance | color | crop | straighten | local | noise | sharpening, suggestion, priority: 1–3 }`.
- `nextTime[]`: `{ topic: angle | subject | timing | light | composition | settings, advice }`.
- `strengths[]`: what to keep doing.

Text only in A2. Lightroom-style presets generated from `edits[]` stay in the backlog.

**Rules**

- **Idempotent:** keyed by `photoId` + `promptVersion`. Re-running the same version returns the stored critique; a new prompt or model creates a new row, so the history stays.
- **Model behind one function:** `critiquePhoto(input) → Critique` in `packages/images`, so the model or provider can change without touching the admin.
- **Bulk:** critiquing the launch backlog (~100 photos) goes through the Message Batches API, which costs 50% less and has no latency requirement.
- **Cost guard:** a monthly cap on critiques (an env value) and the token usage logged per critique.

**Cost (estimate, to measure with `count_tokens` before launch):** Claude Opus 5.5 costs $4 per million input tokens and $20 per million output tokens. A critique is roughly 2–4k input tokens (image, EXIF, prompt) and 1–3k output tokens including thinking, so about $0.03–0.08 each, or half that through batches. At ~800 photos a year, that is about €2–5 a month.

**Open questions**

- [ ] Show any of the critique publicly, for example as "notes" on a photo page, or keep it private?
- [ ] Phase B: how many critiques each plan includes, and whether tenants can bring their own API key.

## Data model

The primary unit is the **Series**. Photos also carry tags and a location, and a global "All photos" stream lists everything. Every table has a `site_id`.

| Table                   | Key fields                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sites`                 | id, slug, custom_domain, theme (light/dark/auto), settings `jsonb`                                                                                        |
| `users` / `members`     | Better Auth tables; member = user × site × role                                                                                                           |
| `photos`                | id, site_id, title, caption, alt, width, height, blurhash, status, taken_at, exif `jsonb`, lat, lng, location_name, original_key, focal_x, focal_y        |
| `photo_variants`        | photo_id, format (avif/webp), width, key, bytes                                                                                                           |
| `series`                | id, site_id, slug, title, description, cover_photo_id, layout, published_at                                                                               |
| `series_photos`         | series_id, photo_id, position                                                                                                                             |
| `tags` / `photo_tags`   | tag name and slug; join table                                                                                                                             |
| `pages`                 | id, site_id, slug, title, blocks `jsonb`, published_at                                                                                                    |
| `posts`                 | journal and blog entries: id, site_id, slug, title, body `jsonb`, cover_photo_id, published_at                                                            |
| `client_galleries`      | id, site_id, client_name, password_hash, expires_at, allow_download                                                                                       |
| `client_gallery_photos` | gallery_id, photo_id, favorited_at                                                                                                                        |
| `subscribers`           | id, site_id, email, confirmed_at                                                                                                                          |
| `contact_messages`      | id, site_id, name, email, body, created_at                                                                                                                |
| `photo_critiques`       | id, site_id, photo_id, prompt_version, model, status, critique `jsonb`, input_tokens, output_tokens, error, created_at; unique (photo_id, prompt_version) |

The `layout` field on `series` takes one of: `masonry`, `justified`, `slideshow`, `horizontal`, `story`.

## Features

| Area             | Phase A scope                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Galleries        | Masonry, justified rows, full-screen slideshow (James Popsys style), horizontal scroll, single-image story. Layout chosen per series.    |
| Photo page       | Large image, caption, EXIF panel (camera, lens, settings), tags, mini-map, prev/next.                                                    |
| Map              | Dedicated `/map` page with clustered pins and click-to-open, plus a mini-map on each photo page.                                         |
| Themes           | Light and dark, following the system setting, with a toggle.                                                                             |
| Journal / blog   | Rich text plus embedded photos; RSS feed.                                                                                                |
| Newsletter       | Double opt-in signup; broadcasts via Resend.                                                                                             |
| Contact          | Form with rate limiting and Turnstile spam protection.                                                                                   |
| Client galleries | Password-protected link, expiry date, favorites, optional download of a full-size version.                                               |
| Protection       | No watermark; public resolution capped at 2400 px, right-click and drag disabled.                                                        |
| Admin            | Bulk upload with progress, drag-to-reorder, edit captions and alt text in bulk, set cover and focal point, page and journal editor.      |
| SEO              | Sitemap, Open Graph images per photo and series, structured data, clean URLs.                                                            |
| Analytics        | Umami, cookieless.                                                                                                                       |
| AI coach         | Per-photo critique in the admin: edit suggestions and advice for next time, single or in bulk. Private in Phase A. See "AI photo coach". |
| Not in scope     | Selling prints or downloads, multiple languages.                                                                                         |

## Costs

Phase A runs at about €4–7/month as a personal site (€2 without the AI coach) and €25–45/month once commercial. Build time is the real cost. Prices are approximate and should be checked before committing.

| Item                 | Choice                                                      | Personal (€/month) | Commercial (€/month)                 |
| -------------------- | ----------------------------------------------------------- | ------------------ | ------------------------------------ |
| Domain               | .com or .photo                                              | ~1                 | ~1                                   |
| Hosting              | Vercel Hobby, then Pro                                      | 0                  | ~20                                  |
| Database             | Neon free tier, then Launch plan                            | 0                  | 0–20                                 |
| Image storage        | R2: $0.015/GB, 10 GB free, $0 egress; 25–110 GB in year one | ~0.25–1.50         | ~0.25–1.50                           |
| Image jobs           | Trigger.dev free tier                                       | 0                  | 0–10                                 |
| Auth                 | Better Auth (self-hosted)                                   | 0                  | 0                                    |
| Email and newsletter | Resend free tier (~3,000 emails/month)                      | 0                  | 0–20                                 |
| Map                  | MapLibre + OpenFreeMap                                      | 0                  | 0                                    |
| Analytics            | Umami Cloud hobby or self-hosted                            | 0                  | 0–20                                 |
| Monitoring           | Sentry free tier                                            | 0                  | 0                                    |
| AI coach             | Claude API, Claude Opus 5.5 (~$0.03–0.08 per critique)      | ~2–5               | per critique; covered by plan limits |

**Phase B:** each tenant adds only about $0.15–0.75/month of storage. Custom domains are included on Vercel Pro, or free for the first 100 on Cloudflare for SaaS, then about $0.10 each. Stripe takes roughly 1.5% + €0.25 per EU card payment. Expect around €100–300/month of fixed costs for the first few hundred customers. For pricing reference, Squarespace charges about $16–99/month and niche photo builders about $10–30/month.

**Build effort:** about 205–295 hours for Phase A and 400–800+ hours for Phase B (see Roadmap). For reference, a French freelance team would charge roughly €20–40k for Phase A, at €500–700 per day.

Sources: [R2 pricing (Filebase)](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/), [Vercel vs Cloudflare (Makerkit)](https://makerkit.dev/pricing-calculator/vercel-vs-cloudflare), [Squarespace pricing (Style Factory)](https://www.stylefactoryproductions.com/squarespace-pricing).

## Roadmap

| Phase                   | Effort     | Scope                                                                                                                          |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A1 · Core MVP           | 80–120 h   | Image pipeline; series + 3 layouts (masonry, justified rows, full-screen slideshow); admin upload and order; light/dark themes |
| A2 · Content            | 75–105 h   | AI photo coach; horizontal + story layouts; map + EXIF panel; journal, newsletter; contact form                                |
| A3 · Clients            | 50–70 h    | Client galleries; signed downloads; SEO, Umami; public launch                                                                  |
| B · Platform (optional) | 400–800+ h | Multi-tenant signup; Stripe billing; custom domains; templates + editor                                                        |

Phase A totals about 205–295 hours, and Phase B is decided only after A is live.

## First steps checklist

The image pipeline comes first because it is the riskiest part. Once a photo goes from upload to a fast, sharp display, the rest is features.

**Step 0 · Decisions and accounts (about an evening)**

- [ ] Pick a working name and buy the domain (a placeholder is fine)
- [ ] Create accounts: GitHub, Vercel, Neon (EU), Cloudflare R2 (`originals-dev`, `public-dev`), Trigger.dev, Sentry, Backblaze B2
- [ ] Choose 20–30 fixture photos: a vertical shot, one with GPS, one wide-gamut file, one very large file

**Step 1 · Project skeleton (about one weekend)**

- [x] Bun monorepo: `apps/web` (Next.js), `packages/db`, `packages/images`, `packages/ui`
- [x] Vite+ (`vp check`, `vp test`), strict TypeScript, Zod-validated env
- [x] `CLAUDE.md` and `docs/SPEC.md` committed at the repo root
- [x] GitHub Actions: install, check, test on every PR; Vercel previews connected
- [x] Drizzle schema for `sites`, `photos`, `photo_variants`, `series`, `series_photos` with `site_id`; first migration

**Step 2 · Image pipeline (1–2 weekends)**

- [ ] Presigned upload to the private bucket from a bare, local-only admin page
- [ ] Trigger.dev + Sharp task: EXIF/GPS, 480–2400 px AVIF and WebP, blurhash, status updates
- [ ] Pipeline tests against the fixture photos
- [ ] Throwaway `/photo/[id]` page with `srcset`, `sizes` and blurhash fade; LCP measured on a phone

**Step 3 · Make it real (2–3 weekends)**

- [ ] Better Auth with passkey; `/admin` locked
- [ ] Series CRUD with drag-to-reorder (algorithm: fractional indexing)
- [ ] Justified rows (DP), masonry (min-heap), full-screen slideshow
- [ ] Production deploy on a hidden URL; nightly backup to B2

## Routes and page inventory

Public pages are static or ISR; admin and client galleries render dynamically.

| Route                                     | Purpose                                                                            | Rendering                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| `/`                                       | Hero photo plus latest series                                                      | ISR                               |
| `/photos`                                 | "All photos" stream, paginated slideshow with thumbnail toggle                     | ISR                               |
| `/series`                                 | Grid of all series                                                                 | ISR                               |
| `/series/[slug]`                          | One series in its chosen layout                                                    | ISR                               |
| `/photo/[id]`                             | Single photo, EXIF, tags, mini-map, prev/next                                      | ISR                               |
| `/tags/[tag]`                             | Photos with a tag                                                                  | ISR                               |
| `/map`                                    | Clustered map of all geotagged photos                                              | ISR shell, map loaded client-side |
| `/journal`, `/journal/[slug]`             | Blog and journal                                                                   | ISR                               |
| `/about`, `/contact`                      | Block pages; contact form uses a server action                                     | ISR + action                      |
| `/c/[token]`                              | Client gallery behind a password                                                   | Dynamic, no-store, noindex        |
| `/legal`, `/privacy`                      | Mentions légales and privacy policy                                                | Static                            |
| `/rss.xml`, `/sitemap.xml`, `/robots.txt` | Feeds and SEO                                                                      | Generated at build or ISR         |
| `/admin`                                  | Dashboard: recent uploads, processing queue, stats link                            | Dynamic, auth                     |
| `/admin/photos`                           | Library: bulk upload, filter, bulk edit metadata                                   | Dynamic, auth                     |
| `/admin/photos/[id]`                      | Edit one photo: caption, alt, tags, focal point, location; AI coach critique panel | Dynamic, auth                     |
| `/admin/series`, `/admin/series/[id]`     | Create series, pick layout, drag to reorder                                        | Dynamic, auth                     |
| `/admin/pages/[id]`                       | Block editor for About and other pages                                             | Dynamic, auth                     |
| `/admin/journal/[id]`                     | Tiptap editor for posts                                                            | Dynamic, auth                     |
| `/admin/clients`, `/admin/clients/[id]`   | Client galleries: password, expiry, download mode, favorites                       | Dynamic, auth                     |
| `/admin/subscribers`                      | Newsletter list and broadcast                                                      | Dynamic, auth                     |
| `/admin/settings`                         | Site name, theme, social links, domain                                             | Dynamic, auth                     |

## Caching and revalidation

Public pages are cached at the edge indefinitely and refreshed only when I publish something, using cache tags. There is no time-based revalidation.

| Admin action                  | Tags revalidated                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Publish or edit a photo       | `photo:{id}`, `photos`, every `series:{slug}` it belongs to, `tags:{tag}`, `map` |
| Reorder or edit a series      | `series:{slug}`, `series`                                                        |
| Publish a post                | `journal`, `post:{slug}`, `rss`                                                  |
| Edit a page                   | `page:{slug}`                                                                    |
| Change site settings or theme | `site` (every page depends on it)                                                |

- Data reads use the `'use cache'` directive with `cacheTag()`; admin server actions call `revalidateTag()` after a successful write.
- Image derivatives are immutable: content-hashed keys with `Cache-Control: public, max-age=31536000, immutable`. A replaced photo gets a new key, so the CDN never needs purging.
- Client galleries and admin pages are never cached (`no-store`).
- For Phase B, every tag is prefixed with the site ID (e.g. `site:{id}:series:{slug}`).

## Upload and admin flows

```
Select files ─▶ Create records (status: uploading, presigned URLs) ─▶ Upload to R2 (parallel, progress) ─▶ Process job (status: processing)
                                                                                                             │
                                                                     ┌──── retry (up to 3) ◀─── no ──── Succeeded?
                                                                     │                                       │ yes
                                                       after 3 tries ▼                                       ▼
                                                  Failed (error + manual retry)            Ready (still a draft) ─▶ Publish (revalidate tags, live < 10 s)
```

The admin polls status (or uses Trigger.dev realtime) so each thumbnail shows uploading, processing, ready or failed. **Delete** is a soft delete: the photo disappears from all series at once, tags are revalidated, and the original and derivatives are purged after 30 days. **Reorder** saves the new positions in one server action and revalidates only that series. **Replace image** uploads a new original to the same photo record, re-runs processing, and keeps caption, tags and series positions.

## Backups and recovery

Originals are the only irreplaceable data, so they exist in three places. Everything else can be rebuilt from originals plus the database.

| Data            | Primary                | Backup                                                                            | Recovery                                 |
| --------------- | ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| Originals       | R2 private bucket (EU) | Nightly sync to Backblaze B2 (another provider), plus my local photo archive      | Re-sync from B2                          |
| Database        | Neon Postgres          | Neon point-in-time restore (window depends on plan) plus a weekly `pg_dump` to B2 | Restore a branch, then promote it        |
| Derivatives     | R2 public bucket       | None needed                                                                       | Re-run the processing job from originals |
| Code and config | GitHub                 | Local clones                                                                      | Redeploy                                 |

- Delete is soft for 30 days (`deleted_at`), then a scheduled job purges the original and derivatives.
- A restore drill runs once per quarter: restore the database to a Neon branch and re-process 10 random photos.
- B2 keeps previous file versions, so an accidental overwrite of an original can be undone.

## Security

Only one person can sign in to the admin in Phase A. Every write goes through an authenticated server action, and nothing private is ever reachable by a guessable URL.

- **Admin auth:** Better Auth with email + passkey, plus TOTP as a second factor. Sign-up is disabled after the first user. Sessions use httpOnly, Secure, SameSite=Lax cookies.
- **Authorization:** one `requireAdmin()` guard at the start of every admin server action and route handler. In Phase B it becomes `requireMember(siteId, role)`.
- **Client galleries:** each link has a random 128-bit token plus a password hashed with Argon2id. Five failed attempts lock it for 15 minutes. Access is a short-lived signed cookie scoped to that gallery.
- **Signed URLs:** uploads expire after 15 minutes and are limited to image MIME types and 200 MB. Download URLs expire after 10 minutes.
- **Rate limiting:** Upstash Redis (or a Postgres counter) on sign-in, the contact form, newsletter signup and client gallery passwords. Cloudflare Turnstile on public forms.
- **Headers:** strict CSP (self, CDN host, Umami, map tiles), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`.
- **Input:** Zod validation on every action. Server-side MIME and magic-byte checks on uploads. Tiptap output sanitized before render.
- **Secrets:** stored only in Vercel and Trigger.dev environment variables, never in the repo. R2 keys are scoped per bucket, and the public site has no write key at all. The Anthropic API key lives only in Trigger.dev, the one place that calls the Claude API.
- **Dependencies:** Renovate for updates; `bun audit` in CI.

## Performance budgets

The budgets target a mid-range phone on 4G. CI fails a PR that breaks one, using Lighthouse CI on preview deployments.

| Metric                     | Budget                               | Measured on                          |
| -------------------------- | ------------------------------------ | ------------------------------------ |
| LCP                        | < 2.0 s                              | `/`, `/series/[slug]`, `/photo/[id]` |
| CLS                        | 0 (every image has fixed dimensions) | All public pages                     |
| INP                        | < 150 ms                             | Slideshow next/prev, lightbox open   |
| First-screen image weight  | < 400 KB                             | `/`, `/photo/[id]`                   |
| JavaScript on public pages | < 90 KB gzipped (map page excluded)  | All public pages                     |
| TTFB from the edge         | < 200 ms                             | Cached ISR pages                     |
| Lighthouse performance     | ≥ 95                                 | Home, one series, one photo          |

Real-user Core Web Vitals come from Vercel Speed Insights, reviewed monthly.

## Testing strategy

Most of the risk sits in the image pipeline and the gallery layouts, so that is where tests concentrate.

| Layer             | Tool                                   | What it covers                                                                                                                                                                                    |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit              | Vitest (`vp test`)                     | Justified-row and masonry layout maths, EXIF parsing, slug and tag helpers, auth guards                                                                                                           |
| Pipeline          | Vitest with fixture images             | A JPEG with GPS, a portrait shot, a Display P3 file and a 150 MB file go in; the test checks sizes, formats, colour profile, stripped GPS and blurhash                                            |
| Integration       | Vitest + a Neon test branch per CI run | Server actions: create series, reorder, publish, client gallery access                                                                                                                            |
| End-to-end        | Playwright                             | Sign in, bulk upload 5 photos, wait for processing, publish a series, view it as a visitor, unlock a client gallery                                                                               |
| Visual regression | Playwright screenshots                 | Each gallery layout at 375, 768 and 1440 px, in light and dark themes                                                                                                                             |
| Accessibility     | axe-core inside Playwright             | Every public route                                                                                                                                                                                |
| Performance       | Lighthouse CI                          | The budgets above                                                                                                                                                                                 |
| AI coach          | Vitest with recorded responses         | Zod parsing of critique output, refusal and invalid-output handling, idempotency per prompt version. No live API calls in CI; a manual eval on 10 fixture photos when the prompt or model changes |

## Environments and CI/CD

There are three environments, each with its own database branch, buckets and Trigger.dev project. Every PR gets a preview deployment, and merging to `main` ships to production.

| Environment | Web                          | Database                                                   | Storage               | Jobs                |
| ----------- | ---------------------------- | ---------------------------------------------------------- | --------------------- | ------------------- |
| Local       | `next dev` via `bun run dev` | Neon dev branch (or local Postgres in Docker)              | R2 `-dev` buckets     | `trigger dev`       |
| Preview     | Vercel preview per PR        | Neon branch per PR, created by the Neon–Vercel integration | R2 `-dev` buckets     | Trigger.dev staging |
| Production  | Vercel, `main` branch        | Neon `main`                                                | R2 production buckets | Trigger.dev prod    |

**Pipeline (GitHub Actions on each PR):**

1. `bun install --frozen-lockfile`
2. `vp check`: lint, format, types
3. `vp test`: unit, pipeline and integration tests
4. `drizzle-kit check` (migration files consistent), then `drizzle-kit generate` must produce no new files (migrations match the schema)
5. Wait for the Vercel preview, then run Playwright, axe and Lighthouse CI against it
6. On merge: `drizzle-kit migrate` runs before Vercel promotes the build, then Trigger.dev tasks deploy

Migrations must stay backward-compatible for one release (expand, then contract) so a rollback never breaks the schema.

## Accessibility

The target is WCAG 2.2 AA on all public pages, checked by axe in CI and by a manual keyboard pass before each phase ships.

- **Alt text is required to publish.** The admin blocks publishing a photo without alt text and offers the caption as a starting point.
- **Slideshow and lightbox:** arrow keys for prev/next, Esc to close, focus trapped inside and returned to the thumbnail on close. Swipe on touch screens. Visible prev/next buttons.
- **Motion:** fades and parallax respect `prefers-reduced-motion`, and the slideshow never auto-advances.
- **Contrast:** captions and UI text stay at 4.5:1 or more in both themes. Text over photos sits on a scrim.
- **Map:** every photo shown on the map is also reachable from a plain list, because map pins are hard to use by keyboard.
- **Structure:** one `h1` per page, landmarks, a skip link, and `lang="en"`.

## Legal (France)

The site needs a mentions légales page and a privacy policy from launch. Street photography also raises image rights (droit à l'image). This section is a checklist, not legal advice; check it with a professional before going commercial.

- [ ] **Mentions légales (LCEN):** publisher identity and contact, publication director, and the host's name, address and phone (Vercel Inc.). Once commercial: business status and SIRET.
- [ ] **Privacy policy (GDPR):** what is collected (contact messages, newsletter emails, client gallery access logs), why, how long it is kept, processors (Vercel, Neon, Cloudflare, Resend, Umami, Trigger.dev, Anthropic), and how to request access or deletion. Anthropic receives only photo derivatives (GPS stripped) for the AI coach; street photos may still show recognisable people, so list it even in Phase A.
- [ ] **Retention:** contact messages deleted after 12 months; access logs after 6 months; unsubscribed emails removed within 30 days.
- [ ] **Newsletter consent:** double opt-in, storing the timestamp, IP and form version as proof; one-click unsubscribe in every email.
- [ ] **Analytics:** Umami is cookieless, so no consent banner, but it is still listed in the privacy policy.
- [ ] **Data location:** Neon and R2 in EU regions; Vercel and Resend under their standard data processing agreements.
- [ ] **Image rights:** street photos where a person is recognisable and the main subject carry legal risk in France. Add a `model_release` flag per photo and a takedown contact on `/legal`.
- [ ] **Copyright notice:** © in the footer and an "all rights reserved, no reuse without permission" line on `/legal`.

## Phase B migration notes

Because every row already carries `site_id`, Phase B adds routing, isolation and limits rather than a rewrite.

- **Tenant routing:** middleware reads the `Host` header, looks up `sites` by `custom_domain` or `{slug}.travelly.app` (placeholder domain; cached at the edge), and rewrites to `/_sites/[siteId]/...`. The admin moves to `app.travelly.app`.
- **Custom domains:** added through the Vercel Domains API (or Cloudflare for SaaS). The site owner adds a CNAME, and SSL is issued automatically.
- **Isolation:** Postgres row-level security keyed on `current_setting('app.site_id')`, set per request inside a transaction, as a second line of defence behind the app-level `requireMember` checks.
- **Storage layout:** R2 keys prefixed `sites/{siteId}/...` in shared buckets. Per-tenant storage usage is recorded on upload.
- **Limits per plan:** photo count, storage GB, client galleries, custom domain yes/no. Enforced in server actions, with usage shown in the admin.
- **Billing:** Stripe Checkout and Billing for subscriptions; a webhook updates `sites.plan`. EU VAT is handled by Stripe Tax.
- **Templates:** a theme is a set of tokens plus layout presets stored on `sites.theme`, so a template switch never touches content.
- **Editor:** evaluate Puck for free-form page building; series layouts stay preset-based.
- **Abuse and moderation:** sign-up email verification, upload quotas, and a report link on every public site.
- **Analytics:** self-hosted Umami with one website per tenant, its stats shown in each tenant's admin through the Umami API.

## Acceptance criteria per phase

A phase is done when every box below is ticked on production, not on a preview.

**A1 · Core MVP**

- [ ] I can sign in with a passkey; sign-up is closed
- [ ] I can bulk-upload 50 JPEGs; all reach `ready` in under 5 minutes, with progress shown
- [ ] A failed job retries 3 times, then shows an error with a manual retry button
- [ ] I can create a series, add photos, drag to reorder and pick masonry, justified or slideshow
- [ ] The `/photos` slideshow works with arrow keys, swipe, thumbnails toggle and preloading of the next image
- [ ] Light and dark themes follow the system setting, with a toggle
- [ ] Publishing updates the public page within 10 seconds
- [ ] Performance budgets pass on `/`, a series and a photo page
- [ ] Originals are not reachable publicly; public images max out at 2400 px with GPS stripped
- [ ] The nightly backup to B2 has run successfully for 7 days

**A2 · Content**

- [ ] Horizontal-scroll and story layouts are available per series
- [ ] `/map` shows clustered pins; each photo page has a mini-map when GPS exists
- [ ] The EXIF panel shows camera, lens, focal length, aperture, shutter and ISO
- [ ] I can write and publish a journal post with embedded photos; RSS validates
- [ ] Newsletter signup with double opt-in works, and I can send a broadcast
- [ ] The contact form delivers to my inbox and is rate-limited and Turnstile-protected
- [ ] I can request an AI critique for one photo or in bulk; it shows edit suggestions and advice for next time within a minute
- [ ] Re-requesting a critique with the same prompt version reuses the stored one; a refusal or invalid output shows an error with a retry
- [ ] The cost per critique is measured on 10 fixture photos and matches the estimate in "AI photo coach"

**A3 · Clients and launch**

- [ ] I can create a client gallery with password, expiry and download mode
- [ ] A client can unlock it, favorite photos, and download single photos or a ZIP
- [ ] Favorites are visible to me in the admin
- [ ] Sitemap, Open Graph images and structured data are live; Umami is tracking
- [ ] `/legal` and `/privacy` are published
- [ ] axe reports 0 serious issues; a manual keyboard pass is done
- [ ] Domain is live with HSTS

## Decision log and risks

**Decisions (ADRs)**

| #   | Decision                                                                            | Rejected alternatives                                              | Reason                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Next.js                                                                             | Astro, SvelteKit, React Router v7                                  | Expertise; custom admin; multi-tenant path                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Postgres + Drizzle                                                                  | MongoDB                                                            | Relational data in Phase B; `jsonb` covers page blocks                                                                                                                                                                                                                                                                                                                                                            |
| 3   | R2 + own Sharp pipeline                                                             | Cloudinary, imgix, S3                                              | Zero egress; control over quality; no lock-in                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Better Auth                                                                         | Auth.js, Clerk                                                     | Auth.js in maintenance; Clerk lock-in and per-user cost                                                                                                                                                                                                                                                                                                                                                           |
| 5   | Umami                                                                               | Plausible, GA4                                                     | Cookieless, free tier, per-tenant API                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | JPEG uploads                                                                        | TIFF, RAW                                                          | No visible web gain; much smaller files                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | No watermark; 2400 px public cap                                                    | Watermarks                                                         | Cleaner presentation; the cap limits reuse                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | Bun + Vite+ tooling                                                                 | pnpm + Turborepo                                                   | Speed; single toolchain; fallback documented                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Single Next.js app in a monorepo                                                    | Separate site and admin apps                                       | One deploy, shared types; split later if needed                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | Website stays TypeScript; optional Rust image worker as a learning track            | Full-stack Rust (Leptos, Dioxus, Axum)                             | Rust UI frameworks lack RSC/ISR and the React editor ecosystem. The worker sits behind the queue with a clear contract (original in, derivatives + metadata out), so a Rust version (`image`/`fast_image_resize` + `ravif`, or libvips bindings) can replace the Sharp one without touching the site. Sharp stays the default; Rust is adopted only if it matches output quality and speed in the pipeline tests. |
| 11  | AI photo coach on the Claude API (Claude Opus 5.5), private in Phase A, built in A2 | Generic vision APIs; a self-hosted vision model; building it in A1 | The coach is the product's signature feature, so critique quality matters more than cost (about €2–5/month at my volume). Structured outputs plus Zod keep the result typed. A1 stays focused on the riskiest part, the image pipeline, and the coach reuses its derivatives and job setup.                                                                                                                       |

**Risks**

| Risk                                              | Impact                            | Mitigation                                                                                                                             |
| ------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Vite+ 1.0 conflicts with Next.js tooling          | Lost time on setup                | Use it only for check/test/run; Turborepo fallback                                                                                     |
| Very large files exceed job memory or time limits | Uploads stuck in processing       | Size cap at 200 MB, streaming Sharp, retries, an alert on stuck jobs                                                                   |
| Losing originals                                  | Permanent                         | Three copies (R2, B2, local) and quarterly restore drill                                                                               |
| Scope creep toward Phase B before A ships         | A never launches                  | Phase B starts only after the A3 criteria pass                                                                                         |
| Street photos of recognisable people              | Legal claim                       | `model_release` flag, takedown contact, careful selection                                                                              |
| Gallery layout quality across screen sizes        | Site looks amateur                | Visual regression tests at 3 widths; real-device checks                                                                                |
| Free-tier limits change                           | Unexpected costs                  | Monthly cost check; every service has a paid tier under €25                                                                            |
| AI critiques are generic or wrong                 | The signature feature disappoints | Fixture-photo eval before each prompt or model change; EXIF and caption as context; versioned prompts so old critiques stay comparable |
| AI costs grow (bulk runs, Phase B tenants)        | Unexpected costs                  | Monthly critique cap, tokens logged per critique, batches for bulk, per-plan limits in Phase B                                         |

## Engineering best practices

These rules keep a solo project shippable today and ready for collaborators in Phase B. Security, testing, performance and accessibility have their own sections above.

**Code organisation**

- Feature folders (`features/photos`, `features/series`, `features/clients`), each owning its components, server actions, queries and tests.
- Pure domain logic (layout maths, EXIF parsing, ordering) lives in framework-free packages, so it can be unit-tested, benchmarked and ported to Rust.
- `import 'server-only'` on every module that touches the database, secrets or R2 keys.
- Data access only through a repository layer that requires `siteId`. Components never import Drizzle directly.

**TypeScript**

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Zod at every boundary (forms, server actions, webhooks, env vars), with types inferred from the schemas.
- No `any`; `unknown` plus parsing instead.
- Branded ID types (`PhotoId`, `SiteId`) so IDs can't be swapped by mistake.

**Errors and logging**

- Expected failures (validation, not found, locked gallery) return typed results; only unexpected ones throw.
- Structured JSON logs with a request ID and `siteId`; Sentry for exceptions.
- Every background job is idempotent, keyed by `photoId` plus pipeline version, so retries never duplicate work.

**Git and reviews**

- Trunk-based development: short-lived branches, small PRs, squash merge.
- Conventional Commits, so a changelog can be generated.
- Even solo, every change goes through a PR so CI and a preview deployment run. Self-review the diff before merging.
- Feature flags (an env var or a `flags` table) for anything half-built, instead of long-running branches.

**Documentation**

- This spec stays the source of truth; each new significant choice adds a row to the decision log.
- A README covering setup in under 10 minutes, plus `.env.example`.
- A `docs/learning/` folder with one note per algorithm studied (see the next section).

## Algorithms and data structures learning track

Every feature below hides a classic algorithm. For each one, build the naive version first, measure it, then implement the better one. At 900 photos almost anything is fast enough; Phase B, with millions of photos across tenants, is where the Big O shows.

| Feature                            | Data structure / algorithm                                                                        | Naive → better                                                             | Phase           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------- |
| Justified rows                     | Line breaking with dynamic programming (as in Knuth–Plass), minimising row-height deviation       | Greedy O(n), uneven rows → DP O(n²) → O(n·k) with at most k photos per row | A1              |
| Masonry                            | Place each photo in the shortest column, tracked with a min-heap                                  | Scan columns O(n·c) → heap O(n log c)                                      | A1              |
| Drag-to-reorder                    | Fractional indexing (string keys between neighbours)                                              | Renumber all positions O(n) writes → O(1) write per move                   | A1              |
| Bulk reorder diff                  | Longest increasing subsequence, to find the fewest items to move                                  | O(n²) DP → O(n log n) patience sorting                                     | A1              |
| Slideshow prev/next and preloading | Circular buffer of neighbours plus an LRU cache (hash map + doubly linked list) of decoded images | Array search O(n) → O(1) get, put and evict                                | A1              |
| Upload queue                       | Bounded worker pool over a FIFO queue; exponential backoff with jitter on retry                   | All at once (browser stalls) → c concurrent, O(1) enqueue and dequeue      | A1              |
| Image resizing                     | Separable Lanczos convolution (rows, then columns)                                                | 2D kernel O(w·h·k²) → O(w·h·k)                                             | A1 (Rust track) |
| Blurhash placeholder               | Discrete cosine transform on a downsampled image                                                  | Full image → 32×32 input, O(cx·cy) per pixel                               | A1              |
| EXIF parsing                       | Tree walk of TIFF directories (IFDs), with a visited set to stop malicious cycles                 | Unbounded recursion → O(entries), cycle-safe                               | A2              |
| Map clustering                     | KD-tree with hierarchical greedy clustering per zoom level (the Supercluster approach)            | Pairwise distances O(n²) → build O(n log n), viewport query O(√n + k)      | A2              |
| "Taken nearby"                     | Geohash prefixes on a B-tree index, then Haversine distance                                       | Full scan O(n) → O(log n + k)                                              | A2              |
| Tag autocomplete                   | Trie (or a Postgres trigram index)                                                                | Scan all tags O(n·m) → O(m) per prefix                                     | A2              |
| Related photos                     | Inverted index from tag to photos, ranked by Jaccard similarity                                   | Compare against all O(n·t) → only candidates sharing a tag                 | A2              |
| Duplicate upload warning           | Perceptual hash (64-bit dHash) and Hamming distance in a BK-tree                                  | Compare with all O(n) → about O(log n) average                             | A3              |
| Pagination                         | Keyset (cursor) pagination on a B-tree index                                                      | OFFSET O(offset + limit) → O(log n + limit)                                | A3              |
| Rate limiting                      | Token bucket per key                                                                              | Log of timestamps O(n) memory → O(1) time and memory                       | A3              |
| Accent colour per photo            | Median cut, or k-means on downsampled pixels                                                      | All pixels → O(p log p) on 64×64 samples                                   | A3              |
| Client ZIP download                | Streaming ZIP straight from R2                                                                    | Buffer the archive O(total size) memory → O(1) memory                      | A3              |
| Admin undo/redo                    | Two stacks with the command pattern                                                               | Snapshot whole state O(n) → O(1) per action                                | A3              |
| Monorepo tasks                     | Topological sort (Kahn's algorithm) with cycle detection, which is what `vp run` does internally  | Write a mini runner: O(V + E)                                              | Any time        |

**How to work through each one**

1. Write the naive version and its tests.
2. Benchmark it with `vitest bench` at n = 100, 1,000 and 10,000, and plot how it grows.
3. State the Big O for time and memory, then check it against the measurements.
4. Implement the better version behind the same interface; the tests must still pass.
5. Write a one-page note in `docs/learning/` covering the problem, both approaches, the numbers, and when the naive version is good enough.
6. Optionally port the hot path to Rust and compare.

**Concepts each item covers:** dynamic programming (justified rows, LIS), heaps (masonry), hashing and linked lists (LRU), trees (KD-tree, trie, BK-tree, B-tree), graphs (topological sort, EXIF cycles), signal processing (convolution, DCT), clustering (k-means), amortised analysis (fractional indexing, token bucket) and streaming (ZIP).

## Decisions and open questions

| Topic            | Decision                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watermark        | None. Protection comes from the 2400 px public cap and disabled right-click.                                                                                                                                                                                                          |
| Client downloads | Per-gallery setting, default **high-res capped** (3200 px JPEG, no watermark). Switch on **originals** only for paid or commissioned work. Downloads use short-lived signed URLs from the private bucket, single photo or ZIP.                                                        |
| Repository       | One **Bun workspaces monorepo**. A single Next.js app with `(site)` and `(admin)` route groups, plus shared packages: `db` (Drizzle schema), `images` (Trigger.dev + Sharp tasks), `ui`. One deploy and shared types; the admin can split into its own app later if Phase B needs it. |
| Umami            | Start on the free cloud tier; self-host later if Phase B needs per-tenant stats.                                                                                                                                                                                                      |

- [ ] Site name and domain (working name: Travelly)
- [ ] Visual identity: logo and typefaces
