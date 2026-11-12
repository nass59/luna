# CLAUDE.md — Photography Portfolio

Context for Claude Code. The full spec lives in `docs/SPEC.md` — read it before any non-trivial change. When a decision changes, update the spec's decision log too.

## What this is

A Squarespace-like photography portfolio (landscape + street). Phase A = my own site with a custom admin, single editor, English only. Phase B (optional, later) = multi-tenant builder. Design north star: jamespopsys.com (image-first, full-screen single-image viewer, minimal UI).

## Stack

- Bun workspaces monorepo; Node is the production runtime
- Next.js (App Router, RSC, `'use cache'` + `cacheTag`/`revalidateTag`) on Vercel (cdg1)
- PostgreSQL on Neon (EU) + Drizzle
- Better Auth (passkey + TOTP, sign-up closed)
- Cloudflare R2: private bucket for originals, public bucket + CDN for derivatives
- Trigger.dev + Sharp for image processing
- Vite+: `vp check` (Oxlint, Oxfmt, tsgo), `vp test` (Vitest), `vp run`. `next dev`/`next build` stay as-is
- Umami (cookieless), Resend, MapLibre + OpenFreeMap, Sentry

## Layout

```
apps/web            Next.js app — (site) and (admin) route groups
packages/db         Drizzle schema, migrations, repositories
packages/images     Trigger.dev tasks + Sharp pipeline
packages/ui         shared components
docs/SPEC.md        technical spec (source of truth)
docs/learning/      one note per algorithm studied
```

## Commands

- `bun install` · `bun run dev` · `vp check` · `vp test` · `vp run <task>`
- `bunx drizzle-kit generate` / `migrate` · `bunx trigger.dev dev`

## Non-negotiable rules

- Every table has `site_id`; all data access goes through repositories that take `siteId`. Components never import Drizzle.
- `import 'server-only'` on anything touching the DB, secrets or R2 keys.
- Zod at every boundary (forms, server actions, webhooks, env). TS strict + `noUncheckedIndexedAccess`. No `any`.
- Originals are never public. Public images: AVIF + WebP at 480/960/1600/2400 px, GPS stripped, no watermark. 3200 px is private (client galleries only).
- Image derivatives use content-hashed keys + immutable cache headers.
- Background jobs must be idempotent (keyed by photoId + pipeline version).
- Every admin action starts with `requireAdmin()`.
- Migrations are expand-then-contract (backward compatible for one release).
- Conventional Commits, small PRs, CI must pass (`vp check`, `vp test`).

## Performance budgets

LCP < 2.0 s (mid-range phone, 4G) · CLS 0 · INP < 150 ms · first-screen images < 400 KB · public JS < 90 KB gz.

## Learning mode (important)

This project is also how I practise algorithms, data structures and Big O. For features listed in the spec's "Algorithms and data structures learning track" (justified rows, masonry, fractional indexing, LRU, KD-tree clustering, etc.):

- Don't write the optimised solution straight away. Help me write the naive version first, then guide me to the better one with hints.
- Always state time and space complexity, and add a `vitest bench` at n = 100 / 1k / 10k.
- Put pure algorithms in framework-free modules so they can be tested, benchmarked and ported to Rust.

## Current phase

A1 — see "First steps checklist" in `docs/SPEC.md`.
