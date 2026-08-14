# @workspace/typescript-config

Shared `tsconfig` presets for the repository. Each package extends one of these files so compiler settings stay identical across the workspace and changes happen in one place.

## Presets

- `base.json` is the default for TypeScript packages. It targets ES2022 with `NodeNext` module resolution, enables `strict` and `noUncheckedIndexedAccess`, emits declarations with declaration maps, and keeps `isolatedModules` on so files compile independently.
- `react-library.json` extends the base config and sets `jsx` to `react-jsx` for React component libraries.
- `nextjs.json` extends the base config for Next.js apps. It switches to `Bundler` module resolution, preserves JSX for the Next.js compiler, allows JavaScript files, and sets `noEmit` because Next.js handles the build.

## Usage

Add the package as a dev dependency and extend the preset that matches the package type:

```json
{
  "extends": "@workspace/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist"
  }
}
```
