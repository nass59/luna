import { z } from 'zod';

// ponytail: no 'server-only' here, drizzle-kit loads this outside Next and server-only throws there.
// The runtime DB client (step 2) adds it.
export const env = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  })
  .parse(process.env);
