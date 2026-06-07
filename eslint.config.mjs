import eslintConfig from '@book000/eslint-config'

export default [
  ...eslintConfig,
  {
    ignores: ['dist/', 'coverage/', 'node_modules/'],
  },
]
