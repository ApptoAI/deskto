# @deskto/settings

The registry of every user-configurable setting in the product. Each setting is defined once — a stable key, a zod schema, a default value, and the kind of editor a settings screen renders for it — and every other layer works from that definition. The package is pure TypeScript with zod as its only dependency, so the Runtime, the Client, and any Surface can all import it.

## Why it exists

A configurable value touches four places: something reads it, the Runtime stores the user's override, a settings screen edits it, and the protocol carries it between them. Without one registry, each of those places grows its own copy of the key, the default, and the validation. This package keeps all of that in a single definition, so adding a setting is one entry rather than four edits that must agree.

Defaults never leave the registry. The Runtime stores only overrides, which means shipping a new default reaches every user who has not changed that setting.

## What is in it

- `SettingDefinition<T>` and `defineSetting` — one setting: `key`, `label`, `description`, `input` (which editor a settings screen shows), `schema`, and `defaultValue`.
- `appSettings` — the registry itself. `settingDefinitions` lists every definition, `settingDefinition(key)` looks one up, and editor-specific lists such as `keybindingSettings` and `harnessModelSettings` are derived from each definition's `input.kind`.
- `resolveSettings(stored)` — applies stored overrides to the defaults and returns a `SettingsSnapshot` with `values` (every key, effective value) and `overrides` (only what the user changed). Unknown and invalid overrides are dropped, so a bad write can never break startup.
- `settingValue(snapshot, definition)` and `isOverridden(snapshot, definition)` — typed reads. `settingValue(null, definition)` returns the default, so readers work before the snapshot loads.
- Model selection — `appSettings.threadTitleModel` defaults to the current task's Harness and model, and can hold a dedicated Harness/model pair selected in Settings.
- Keybinding helpers — bindings are strings such as `"mod+shift+n"`, where `mod` is ⌘ on mac and Ctrl elsewhere. `parseKeybinding` and `keybindingSchema` validate them, `matchesKeybinding(value, event, platform)` tests a keydown, `keybindingFromEvent(event, platform)` builds a binding inside a shortcut recorder, and `formatKeybinding(value, platform)` renders `⇧⌘N` or `Ctrl+Shift+N`.

## How the layers use it

The Runtime validates and persists overrides by `key` and serves `resolveSettings` output through the protocol's `settings.get` and `settings.update` methods. The desktop renderer holds the snapshot in a `SettingsProvider`, reads values with `useSettingValue`, and binds shortcuts with `useKeybinding`. The protocol itself stays generic: it moves `SettingsSnapshot` as plain JSON and never learns individual keys.

## Adding a setting

Add one `defineSetting` entry to `appSettings`. Storage, validation, the protocol, and the settings screen pick it up from there; the only remaining work is reading the value where it should take effect, with `useSettingValue` or `settingValue`.
