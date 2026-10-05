import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/.next-dev/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      ".data/**",
      ".local/**",
      "playwright-report/**",
      "test-results*/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
