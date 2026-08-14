# @workspace/eslint-config

Shared ESLint flat configs for every package and app in this repository. Each package points its `eslint.config.js` at one of the presets here instead of repeating plugin setup.

## Presets

The package exports three configs:

- `@workspace/eslint-config/base` is the starting point for plain TypeScript packages. It combines the recommended rules from `@eslint/js` and `typescript-eslint`, disables rules that conflict with Prettier, warns on undeclared Turborepo environment variables, and ignores build output (`dist`, `.next`, `.turbo`, `coverage`).
- `@workspace/eslint-config/react-internal` extends the base config for React libraries such as `packages/ui`. It adds `eslint-plugin-react` and `eslint-plugin-react-hooks` with browser globals, and turns off `react/react-in-jsx-scope` for the automatic JSX runtime.
- `@workspace/eslint-config/next-js` extends the base config for Next.js apps. On top of the React rules it applies `@next/eslint-plugin-next` with its recommended and Core Web Vitals rule sets.

All presets load `eslint-plugin-only-warn`, so every violation reports as a warning. CI stays green while the editor still shows the problems.

## Usage

Add the package as a dev dependency and re-export a preset from the local `eslint.config.js`:

```js
import { config } from "@workspace/eslint-config/base"

export default config
```

For a React library, import from `@workspace/eslint-config/react-internal`; for a Next.js app, import `nextJsConfig` from `@workspace/eslint-config/next-js`.
