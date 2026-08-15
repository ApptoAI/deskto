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

## Provenance

The sygnet geometry comes from `appto-sygnet.svg` in the appto-ai repo and is
duplicated in `src/renderer/components/appto-logo.tsx`. The wordmark in that
component is a vector trace of `appto_black.png`, which the brand ships only as
a raster; the trace is within 0.3% of the original by pixel coverage.

Note that the mark in `appto_black.png` is scaled about 4% narrower than
`appto-sygnet.svg`. The lockup here uses the sygnet's own aspect, on the
assumption that the squeeze in the png was accidental.

## Regenerating

Re-export `icon.svg` at 1024×1024, then:

```sh
# icns — one png per slot in an .iconset directory
mkdir icon.iconset   # icon_16x16.png, icon_16x16@2x.png, … icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

`icon.ico` is a PNG-embedded ICO holding 16/24/32/48/64/128/256px.
