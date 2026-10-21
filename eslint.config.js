import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

const restrictedSyntax = [
  {
    message: "Use const arrow functions instead of function declarations.",
    selector: "FunctionDeclaration",
  },
  {
    message: "Use arrow functions for standalone functions.",
    selector: "FunctionExpression:not(MethodDefinition > FunctionExpression)",
  },
  {
    message: "Declare arrow functions with const.",
    selector:
      'VariableDeclaration[kind!="const"] > VariableDeclarator[init.type="ArrowFunctionExpression"]',
  },
  {
    message:
      "Use a single options object for functions with multiple parameters.",
    selector:
      "MethodDefinition[value.params.length > 1], VariableDeclarator > ArrowFunctionExpression[params.length > 1], PropertyDefinition > ArrowFunctionExpression[params.length > 1], VariableDeclarator > ArrowFunctionExpression > RestElement, PropertyDefinition > ArrowFunctionExpression > RestElement",
  },
  {
    message:
      "Use public or private methods instead of arrow properties on classes.",
    selector: 'PropertyDefinition[value.type="ArrowFunctionExpression"]',
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "coverage/**",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/member-ordering": [
        "error",
        {
          default: "never",
          interfaces: { memberTypes: "never", order: "alphabetically" },
          typeLiterals: { memberTypes: "never", order: "alphabetically" },
        },
      ],
      curly: ["error", "all"],
      "lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: true },
      ],
      "no-restricted-syntax": ["error", ...restrictedSyntax],
      "sort-keys": ["error", "asc", { caseSensitive: true }],
    },
  },
  {
    files: [
      "worker/**/*.ts",
      "shared/**/*.ts",
      "src/**/*.{ts,tsx}",
      "*.config.{js,ts}",
    ],
    rules: {
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", next: "*", prev: "import" },
        { blankLine: "any", next: "import", prev: "import" },
        {
          blankLine: "always",
          next: "*",
          prev: [
            "multiline-block-like",
            "multiline-const",
            "multiline-expression",
            "multiline-let",
          ],
        },
        {
          blankLine: "always",
          next: [
            "multiline-block-like",
            "multiline-const",
            "multiline-expression",
            "multiline-let",
          ],
          prev: "*",
        },
      ],
    },
  },
  {
    files: ["worker/services/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true },
      ],
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "explicit", overrides: { properties: "no-public" } },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          message:
            "Service behavior belongs in class methods. Extract helpers to private methods.",
          selector: "ArrowFunctionExpression",
        },
      ],
      "require-await": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // shadcn components intentionally export their variants alongside components.
  {
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
