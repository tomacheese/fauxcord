import eslintConfig from '@book000/eslint-config'

export default [
  ...eslintConfig,
  {
    ignores: ['dist/', 'coverage/', 'node_modules/'],
  },
  {
    // scripts/ contains standalone CLI entry points invoked via `tsx`, not
    // library code, so calling process.exit() with a specific exit code is
    // the intended way to communicate success/failure to the shell.
    files: ['scripts/**/*.ts'],
    rules: {
      'unicorn/no-process-exit': 'off',
    },
  },
]
