# App icons

Build resources for electron-builder (`directories.buildResources` points here —
not the conventional `build/`, which the repo's `.gitignore` drops).

| File             | Used by                                           |
| ---------------- | ------------------------------------------------- |
| `icon.svg`       | Source artwork for everything below               |
| `icon-light.svg` | Light-background alternative, not currently built |
| `icon.icns`      | macOS (dock, Finder, dmg)                         |
| `icon.ico`       | Windows (nsis)                                    |
| `icon.png`       | Linux (AppImage), 1024×1024                       |

## Artwork

The sygnet on a 824×824 rounded rect centred in a 1024 canvas, corner radius
185.4 — the macOS Big Sur icon grid, which Windows and Linux crop to taste. The
mark spans 58% of the body width and carries no wordmark, because at dock size
the lettering would not resolve.

Background is `#0a0a0a` to match the window's `backgroundColor`. Swapping to
`icon-light.svg` inverts it to a black mark on white.

## Artwork source

The sygnet — three stacked planes seen edge-on — comes from the brand artwork
and is duplicated in `src/renderer/components/deskto-logo.tsx`, which also
carries the wordmark as outlines. Both take `currentColor` there, so one set of
paths serves the dark window and the light one; the icons below are the only
place the fills are baked in.

## Regenerating

Re-export `icon.svg`, then rasterize it with alpha. Any renderer will do as
long as the area outside the rounded rect stays transparent — `sips` flattens
it to white, so it is not one of them. Chromium via the app's own Electron is:

```js
// page.setContent(svg with width/height swapped for the target size)
await page.screenshot({ omitBackground: true })
```

Sizes: 16, 24, 32, 48, 64, 128, 256, 512, 1024.

```sh
# icns — one png per slot in an .iconset directory
mkdir icon.iconset   # icon_16x16.png, icon_16x16@2x.png, … icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

`icon.png` is the 1024 render. `icon.ico` is a PNG-embedded ICO holding
16/24/32/48/64/128/256px: an `ICONDIR` header, one 16-byte entry per size with
256 written as `0`, then the PNG payloads in the same order.
