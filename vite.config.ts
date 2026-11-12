import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'typescript/no-explicit-any': 'error',
    },
    overrides: [
      {
        files: ['apps/web/**', 'packages/ui/**'],
        plugins: ['react', 'nextjs', 'jsx-a11y'],
      },
    ],
  },
  fmt: {
    singleQuote: true,
    ignorePatterns: ['**/drizzle/meta/**'],
  },
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    passWithNoTests: true,
  },
  run: {
    cache: true,
  },
});
