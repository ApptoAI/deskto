import {
  defaultInterfaceFontSize,
  type InterfaceFontSize,
} from "@deskto/settings"

export const interfaceFontSizeStorageKey =
  "deskto.appearance.interface-font-size"

export function rememberInterfaceFontSize(size: InterfaceFontSize): void {
  try {
    window.localStorage.setItem(interfaceFontSizeStorageKey, String(size))
  } catch {
    // Runtime settings remain authoritative when storage is unavailable.
  }
}

export function interfaceFontScale(size: InterfaceFontSize): number {
  return size / defaultInterfaceFontSize
}

export function applyInterfaceFontSize(size: InterfaceFontSize): void {
  document.documentElement.style.setProperty(
    "--app-font-scale",
    String(interfaceFontScale(size))
  )
}
