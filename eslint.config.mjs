// eslint.config.mjs — DESIGN_SYSTEM §7.1. Guards start as warnings everywhere (M0); paths listed in
// design/migrated-paths.json get the strict set as errors. M10 flips everything to error.
// eslint-config-next is not extended yet (its error-level rules would fail lint on legacy code, which
// M0 must not do). Only its react-hooks and @next/next plugins are registered, with no rules enabled,
// so the existing `eslint-disable … react-hooks/exhaustive-deps` / `@next/next/no-img-element`
// comments resolve instead of erroring with "Definition for rule … was not found".
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import next from 'eslint-config-next';
import { readFileSync } from 'node:fs';

const nextPlugins = next.find((c) => c.plugins?.['@next/next'])?.plugins ?? {};
const legacyPlugins = Object.fromEntries(
  ['react-hooks', '@next/next'].filter((k) => nextPlugins[k]).map((k) => [k, nextPlugins[k]]),
);

const migrated = JSON.parse(readFileSync(new URL('./design/migrated-paths.json', import.meta.url), 'utf8')).paths ?? [];

const dsSyntax = [
  { selector: "JSXAttribute[name.name='type'][value.value='date']", message: 'Use ds/DateRangeField or ds/DatePicker.' },
  { selector: 'Literal[value=/linear-gradient|radial-gradient/]', message: 'No gradients (DESIGN_SYSTEM P2).' },
  { selector: 'TemplateElement[value.raw=/linear-gradient/]', message: 'No gradients (DESIGN_SYSTEM P2).' },
  { selector: 'Literal[value=/\\buppercase\\b/]', message: 'No uppercase: breaks Turkish (FAİLED). Write sentence case in messages.' },
  { selector: "CallExpression[callee.property.name='toFixed']", message: 'Use <Money>/<Num> or lib/format.ts.' },
  { selector: "JSXAttribute[name.name='variant'][value.value=/^h[1-6]$/]", message: 'Use titleLg/titleMd/titleSm/display.' },
];
const strictSyntax = [
  ...dsSyntax,
  { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'No hex literals outside lib/ds. Use tokens.' },
  { selector: 'Literal[value=/(^|\\s)(sm|md|lg|xl|2xl):[a-z]/]', message: 'No Tailwind responsive prefixes in migrated files (breakpoints differ until M10). Use DS components / theme.breakpoints.' },
];

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'scripts/**', '**/*.test.*'] },
  {
    files: ['pages/**/*.{js,jsx,ts,tsx}', 'components/**/*.{js,jsx,ts,tsx}', 'lib/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, ...legacyPlugins },
    rules: {
      'no-restricted-imports': ['warn', { paths: [{ name: '@mui/icons-material', message: 'Use lucide via lib/ds/icons.ts.' }], patterns: ['@mui/icons-material/*'] }],
      'no-restricted-syntax': ['warn', ...dsSyntax],
      'react/jsx-no-literals': ['warn', { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '/', '×', '%', '(', ')', ':', '…', '⋯'] }],
    },
  },
  // ESLint rejects an empty `files` array, so the strict block only exists once something is migrated.
  ...(migrated.length === 0 ? [] : [{
    // migrated surfaces: everything is an error, raw MUI banned
    files: migrated,
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@mui/icons-material', message: 'Use lucide via lib/ds/icons.ts.' }],
        patterns: [
          { group: ['@mui/icons-material/*'], message: 'Use lucide via lib/ds/icons.ts.' },
          { group: ['@mui/material', '@mui/material/*'], message: 'Migrated files import UI only from components/ds/*.' },
          { group: ['@/components/ui/*', '**/components/ui/*'], message: 'Import from components/ds/* (ui/* are shims).' },
        ],
      }],
      'no-restricted-syntax': ['error', ...strictSyntax],
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '/', '×', '%', '(', ')', ':', '…', '⋯'] }],
    },
  }]),
  {
    // the DS itself may use MUI and tokens
    files: ['components/ds/**/*', 'lib/ds/**/*', 'lib/theme.tsx'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': ['error', ...dsSyntax.filter((r) => !r.selector.includes('#'))] },
  },
);
