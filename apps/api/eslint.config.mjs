import rootConfig from '../../eslint.config.mjs';

/**
 * NestJS override: this app compiles with emitDecoratorMetadata. Converting a
 * constructor-injected class to `import type` erases it from
 * design:paramtypes and silently breaks dependency injection at runtime, so
 * the auto-fixable consistent-type-imports rule is unsafe here.
 */
export default [
  ...rootConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
