// Public derivative widths (SPEC: image pipeline). 3200 is private, client galleries only.
export const PUBLIC_WIDTHS = [480, 960, 1600, 2400] as const;
export const PRIVATE_WIDTH = 3200;
export const FORMATS = ['avif', 'webp'] as const;

export type ImageFormat = (typeof FORMATS)[number];
