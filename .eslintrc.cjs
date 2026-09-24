// Airbnb style (eslint-config-airbnb-base + eslint-config-airbnb-typescript).
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.worker.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Physics and rendering update the bodies, canvases and sockets they are given; that is
    // their job. Airbnb's list of allowed names is extended with this project's ones.
    'no-param-reassign': ['error', {
      props: true,
      ignorePropertyModificationsFor: [
        'acc', 'accumulator', 'e', 'ctx', 'context', 'req', 'request', 'res', 'response',
        'body', 'runner', 'joint', 'writer', 'cpu', 'el', 'dot', 'g', 'ws', 'racer', 'room', 'ghost',
        'shard', 'recording',
      ],
    }],
  },
  overrides: [
    {
      files: ['tools/**', 'tests/**', 'scripts/**'],
      rules: {
        'no-console': 'off',
        'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'public/app.js', 'dist/', '.wrangler/', '.eslintrc.cjs'],
};
