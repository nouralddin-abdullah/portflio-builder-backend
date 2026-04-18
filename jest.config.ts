import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }],
  },
  transformIgnorePatterns: [
    // cuid2 (via @noble/hashes) ships ESM — let ts-jest transpile it.
    // pnpm realpaths live under .pnpm/@scope+name@version/node_modules/...
    'node_modules/(?!(\\.pnpm/)?@paralleldrive|(\\.pnpm/)?@noble).+\\.js$',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.e2e-spec.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
};

export default config;
