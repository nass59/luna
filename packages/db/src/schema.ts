// Drizzle schema: the single source of truth for the database shape.
// `drizzle-kit generate` diffs this file against the last snapshot in ../drizzle
// and writes the SQL migration. Column names are camelCase here and snake_case
// in Postgres (`casing: 'snake_case'` in drizzle.config.ts), e.g. takenAt -> taken_at.
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Branded IDs: all IDs are plain uuid strings at runtime, but TypeScript treats
// them as distinct types, so passing a PhotoId where a SiteId is expected is a
// compile error. The brand only exists in the type system (zero runtime cost).
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };
export type SiteId = Brand<string, 'SiteId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type SeriesId = Brand<string, 'SeriesId'>;

// Postgres enums: the DB rejects any value outside the list, and Drizzle infers
// the matching TS union ('light' | 'dark' | 'auto'). Adding a value later is a
// cheap migration; removing one is not, so they only grow.
export const themeEnum = pgEnum('theme', ['light', 'dark', 'auto']);
// Upload lifecycle (SPEC: upload and admin flows).
export const photoStatusEnum = pgEnum('photo_status', [
  'uploading',
  'processing',
  'ready',
  'failed',
]);
export const imageFormatEnum = pgEnum('image_format', ['avif', 'webp']);
export const seriesLayoutEnum = pgEnum('series_layout', [
  'masonry',
  'justified',
  'slideshow',
  'horizontal',
  'story',
]);

// Shared columns, spread into tables with `...timestamps`.
// `$onUpdate` runs in Drizzle (app side) on every update query, not as a DB trigger,
// so a raw SQL UPDATE won't touch updated_at.
const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// The tenant column every table carries (CLAUDE.md rule). A function, not a
// constant, because each table needs its own column builder instance.
// Deleting a site cascades to all of its rows.
const siteId = () =>
  uuid()
    .$type<SiteId>()
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' });

// One row per site. Phase A has exactly one; Phase B adds one per tenant.
export const sites = pgTable('sites', {
  // defaultRandom() = Postgres gen_random_uuid(), so the DB generates IDs.
  id: uuid().$type<SiteId>().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  // Nullable + unique: many sites may have no domain (Postgres allows multiple NULLs).
  customDomain: text().unique(),
  theme: themeEnum().notNull().default('auto'),
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const photos = pgTable(
  'photos',
  {
    id: uuid().$type<PhotoId>().primaryKey().defaultRandom(),
    siteId: siteId(),
    // Metadata is nullable: the row is created at upload time, before the
    // pipeline reads dimensions/EXIF and before I write a caption or alt text.
    title: text(),
    caption: text(),
    alt: text(),
    width: integer(),
    height: integer(),
    blurhash: text(),
    status: photoStatusEnum().notNull().default('uploading'),
    takenAt: timestamp({ withTimezone: true }),
    // ponytail: shape typed once the EXIF parser exists (step 2)
    exif: jsonb().$type<Record<string, unknown>>(),
    // GPS lives only here (for the map); it is stripped from every public file.
    lat: doublePrecision(),
    lng: doublePrecision(),
    locationName: text(),
    // R2 key of the original in the private bucket. Never exposed publicly.
    originalKey: text().notNull(),
    // Focal point as 0..1 fractions of width/height
    focalX: real(),
    focalY: real(),
    ...timestamps,
  },
  // Serves "this site's photos, newest first" (the /photos stream).
  (t) => [index().on(t.siteId, t.takenAt)],
);

// One row per generated file: 2 formats x 4 public widths (+ the private 3200).
export const photoVariants = pgTable(
  'photo_variants',
  {
    siteId: siteId(),
    photoId: uuid()
      .$type<PhotoId>()
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    format: imageFormatEnum().notNull(),
    width: integer().notNull(),
    // Content-hashed R2 key in the public bucket (immutable, cached for a year).
    key: text().notNull(),
    bytes: integer().notNull(),
  },
  // Composite primary key: at most one file per photo/format/width. A re-run of
  // the pipeline upserts on this key instead of piling up duplicates.
  (t) => [primaryKey({ columns: [t.photoId, t.format, t.width] })],
);

export const series = pgTable(
  'series',
  {
    id: uuid().$type<SeriesId>().primaryKey().defaultRandom(),
    siteId: siteId(),
    slug: text().notNull(),
    title: text().notNull(),
    description: text(),
    // Deleting the cover photo keeps the series and just clears its cover.
    coverPhotoId: uuid()
      .$type<PhotoId>()
      .references(() => photos.id, { onDelete: 'set null' }),
    layout: seriesLayoutEnum().notNull().default('masonry'),
    // NULL = draft; a timestamp = published.
    publishedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  // Slugs are unique per site, not globally (two tenants can both have /series/iceland).
  // This index also serves the /series/[slug] lookup.
  (t) => [uniqueIndex().on(t.siteId, t.slug)],
);

// Join table: which photos are in which series, and in what order.
// A photo can belong to many series; deleting either side removes the link.
export const seriesPhotos = pgTable(
  'series_photos',
  {
    siteId: siteId(),
    seriesId: uuid()
      .$type<SeriesId>()
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    photoId: uuid()
      .$type<PhotoId>()
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    // ponytail: integer = the naive "renumber on move" version; fractional indexing (text keys) replaces it in step 3
    position: integer().notNull(),
  },
  (t) => [
    // A photo appears at most once per series.
    primaryKey({ columns: [t.seriesId, t.photoId] }),
    // Serves "photos of this series in order" (ORDER BY position).
    index().on(t.seriesId, t.position),
  ],
);
