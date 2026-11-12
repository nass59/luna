import type { NextConfig } from 'next';

const config: NextConfig = {
  cacheComponents: true,
  // Types are checked by `vp check` (tsgo); no second pass during build.
  typescript: { ignoreBuildErrors: true },
};

export default config;
