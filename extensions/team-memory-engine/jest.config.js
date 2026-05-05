/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: {
    "^(\\.\\.?/.*)\\.js$": "$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "bundler",
          target: "ES2022",
        },
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
};
