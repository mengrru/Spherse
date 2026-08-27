import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

const tsFiles = [
  "packages/*/src/**/*.{ts,tsx}",
  "packages/*/electron/**/*.ts",
  "packages/*/shared/**/*.ts",
  "packages/*/*.{ts,tsx}",
  "packages/*/scripts/**/*.mjs",
  "scripts/**/*.mjs",
  "*.config.{js,mjs,ts}",
];

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "docs/**",
      ".superpowers/**",
      "packages/presets/templates/**",
      "packages/*/dist/**",
    ],
  },
  js.configs.recommended,
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "packages/app/src/**/*.{ts,tsx}",
      "packages/landing/src/**/*.{ts,tsx}",
      "packages/desktop/src/**/*.{ts,tsx}",
      "packages/web/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["packages/desktop/src/**/*.{ts,tsx}", "packages/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "壳包不得经 @/ alias 深度导入 @spherse/app 内部模块；只允许 @spherse/app package.json exports 白名单入口（@spherse/app/*）",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/core/src/**/*.ts",
      "packages/server/src/**/*.ts",
      "packages/presets/src/**/*.ts",
      "packages/*/electron/**/*.ts",
      "packages/*/shared/**/*.ts",
      "packages/*/*.{ts,tsx}",
      "packages/*/scripts/**/*.mjs",
      "scripts/**/*.mjs",
      "*.config.{js,mjs,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["packages/core/src/tools/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration[source]",
          message:
            "tools/index.ts must not re-export from individual tool files. Use createToolsForProject as the sole entry point.",
        },
      ],
    },
  },
];
