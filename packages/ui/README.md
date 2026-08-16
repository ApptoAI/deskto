# @workspace/ui

Reusable DOM components for Deskto surfaces. The package holds the design-system primitives and the chat-specific components the desktop renderer composes into screens. It never imports Electron or calls the Runtime; everything here renders props and fires callbacks.

## What is in it

General primitives in `src/components`, built on Base UI with shadcn styling: `Button`, `Card`, `Dialog`, `DropdownMenu`, `Input`, `Label`, `Switch`, and `Textarea`. Base UI provides the unstyled behavior and accessibility; class-variance-authority and Tailwind provide the look.

Chat components in `src/components/chat`:

- `Markdown` renders assistant output with react-markdown and remark-gfm. Raw HTML is dropped on purpose, and links only become anchors when the caller passes an `onLinkActivate` callback, so an Electron host decides how navigation happens.
- `Message`, `MessageBody`, and `MessageActivity` render one turn's content and its tool activity summary.
- `MessageList` lays out a thread.
- `PromptInput`, with `PromptInputTextarea` and `PromptInputToolbar`, is the compose area.

`src/lib/utils.ts` exports `cn()`, the clsx plus tailwind-merge helper.

## Styling setup

Tailwind 4, configured in CSS rather than a config file. `src/styles/globals.css` imports Tailwind, tw-animate-css, and the shadcn preset, defines the design tokens as oklch CSS variables for `:root` and `.dark`, and declares `@source` globs so classes used in consuming apps get picked up. Consumers import the stylesheet once and reuse the PostCSS config:

```css
@import "@workspace/ui/globals.css";
```

## Imports

There is no barrel file. Components resolve through subpath exports:

```ts
import { Button } from "@workspace/ui/components/button"
import { PromptInput } from "@workspace/ui/components/chat/prompt-input"
import { cn } from "@workspace/ui/lib/utils"
```

New shadcn components are added with the shadcn CLI; `components.json` already points the aliases at this package.
