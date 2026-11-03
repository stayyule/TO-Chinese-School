import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/test/*.int-spec.ts'],
  transform: { '^.+[.]ts$': 'ts-jest' },
};

export default config;
