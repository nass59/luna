CREATE TYPE "public"."image_format" AS ENUM('avif', 'webp');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."series_layout" AS ENUM('masonry', 'justified', 'slideshow', 'horizontal', 'story');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'auto');--> statement-breakpoint
CREATE TABLE "photo_variants" (
	"site_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"format" "image_format" NOT NULL,
	"width" integer NOT NULL,
	"key" text NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "photo_variants_photo_id_format_width_pk" PRIMARY KEY("photo_id","format","width")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"title" text,
	"caption" text,
	"alt" text,
	"width" integer,
	"height" integer,
	"blurhash" text,
	"status" "photo_status" DEFAULT 'uploading' NOT NULL,
	"taken_at" timestamp with time zone,
	"exif" jsonb,
	"lat" double precision,
	"lng" double precision,
	"location_name" text,
	"original_key" text NOT NULL,
	"focal_x" real,
	"focal_y" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_photo_id" uuid,
	"layout" "series_layout" DEFAULT 'masonry' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_photos" (
	"site_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "series_photos_series_id_photo_id_pk" PRIMARY KEY("series_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"theme" "theme" DEFAULT 'auto' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sites_customDomain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_cover_photo_id_photos_id_fk" FOREIGN KEY ("cover_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_photos" ADD CONSTRAINT "series_photos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_photos" ADD CONSTRAINT "series_photos_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_photos" ADD CONSTRAINT "series_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_site_id_taken_at_index" ON "photos" USING btree ("site_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "series_site_id_slug_index" ON "series" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "series_photos_series_id_position_index" ON "series_photos" USING btree ("series_id","position");