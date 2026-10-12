import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["src/generated/**", ".next/**", ".next-e2e/**", "playwright-report/**", "test-results/**"] },
];
export default config;
