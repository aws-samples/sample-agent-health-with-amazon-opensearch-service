/** Jest configuration for the Agent Health AWS CDK app (ts-jest, Node). */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // The app's tsconfig uses NodeNext; CommonJS is friendlier for ts-jest.
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "Node",
          esModuleInterop: true,
          resolveJsonModule: true,
          target: "ES2022",
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  // NodejsFunction bundling (esbuild) runs during synth in these tests.
  testTimeout: 120000,
};
