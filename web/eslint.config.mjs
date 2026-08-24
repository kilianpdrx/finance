import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/**
 * Configuration ESLint — resserrée, comme celle de ruff côté backend.
 *
 * `next/core-web-vitals` apporte ce qui compte vraiment ici :
 * `react-hooks/exhaustive-deps`, qui attrape les dépendances manquantes dans les
 * effets et les closures périmées — la classe de bugs que TypeScript ne voit pas.
 * Le reste (règles de style) est laissé de côté : le typage strict couvre déjà
 * l'essentiel et une réécriture cosmétique n'a pas sa place dans du code qui
 * manipule de l'argent.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "e2e/.tmp-data/**",
      "playwright-report/**",
      "test-results/**",
      // Généré par openapi-typescript à partir du backend.
      "lib/api/schema.d.ts",
      // Généré par Next à chaque build ; le modifier ne sert à rien.
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Un `any` explicite est parfois la réponse honnête face à une réponse
      // d'API non typée ; `tsc --noEmit` reste le garde-fou principal.
      "@typescript-eslint/no-explicit-any": "off",
      // Convention habituelle : un identifiant préfixé de `_` est délibérément
      // inutilisé (élément ignoré d'une déstructuration, paramètre de signature).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // La suite Playwright n'est pas du React. `test.extend({ api: async ({request}, use) => … })`
    // fait appeler `use()` dans une fonction nommée `api`, que la règle prend pour
    // un hook mal placé — c'est un faux positif, pas un composant.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default config;
