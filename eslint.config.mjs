import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["src/generated/**", ".next/**", "playwright-report/**", "test-results/**"] },
];
export default config;
