import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/lint.spec.ts'],
  transform: { '^.+[.]ts$': 'ts-jest' },
  passWithNoTests: true,
};

export default config;
