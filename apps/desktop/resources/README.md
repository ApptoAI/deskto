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

The geometric D monogram is duplicated in
`src/renderer/components/deskto-logo.tsx`. The renderer adds the Deskto
wordmark with the system sans-serif font so it follows the rest of the UI.

## Regenerating

Re-export `icon.svg` at 1024×1024, then:

```sh
# icns — one png per slot in an .iconset directory
mkdir icon.iconset   # icon_16x16.png, icon_16x16@2x.png, … icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

`icon.ico` is a PNG-embedded ICO holding 16/24/32/48/64/128/256px.
