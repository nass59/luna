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

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };
export type SiteId = Brand<string, 'SiteId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type SeriesId = Brand<string, 'SeriesId'>;

export const themeEnum = pgEnum('theme', ['light', 'dark', 'auto']);
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

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const siteId = () =>
  uuid()
    .$type<SiteId>()
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' });

export const sites = pgTable('sites', {
  id: uuid().$type<SiteId>().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
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
    lat: doublePrecision(),
    lng: doublePrecision(),
    locationName: text(),
    originalKey: text().notNull(),
    // Focal point as 0..1 fractions of width/height
    focalX: real(),
    focalY: real(),
    ...timestamps,
  },
  (t) => [index().on(t.siteId, t.takenAt)],
);

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
    key: text().notNull(),
    bytes: integer().notNull(),
  },
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
    coverPhotoId: uuid()
      .$type<PhotoId>()
      .references(() => photos.id, { onDelete: 'set null' }),
    layout: seriesLayoutEnum().notNull().default('masonry'),
    publishedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.siteId, t.slug)],
);

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
  (t) => [primaryKey({ columns: [t.seriesId, t.photoId] }), index().on(t.seriesId, t.position)],
);
