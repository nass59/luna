import { z } from 'zod';

const pg = z.url({ protocol: /^postgres(ql)?$/ });

// ponytail: no 'server-only' here, drizzle-kit loads this outside Next and server-only throws there.
// The runtime DB client (step 2) adds it.
export const env = z
  .object({
    // Pooled (PgBouncer): the app at runtime.
    DATABASE_URL: pg,
    // Direct: migrations, which need session features the pooler drops.
    DATABASE_URL_UNPOOLED: pg,
  })
  .parse(process.env);
