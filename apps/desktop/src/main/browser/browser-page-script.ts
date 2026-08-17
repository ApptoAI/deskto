/** Runs in an untrusted guest page and returns bounded semantic data only. */
export function browserSnapshotScript(
  registryKey: string,
  previousRegistryKey?: string
): string {
  return String.raw`(() => {
  const registryKey = ${JSON.stringify(registryKey)};
  const previousRegistryKey = ${JSON.stringify(previousRegistryKey)};
  const clean = (value, maximum = 240) => String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  };
  const implicitRole = (element) => {
    const tag = element.localName;
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = String(element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type !== "hidden") return "textbox";
    }
    return "";
  };
  const nameFor = (element) => {
    const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText).join(" ") : "";
    const value = element instanceof HTMLInputElement && element.type === "password"
      ? "" : element.getAttribute("value");
    return clean(element.getAttribute("aria-label") || labels || element.getAttribute("alt") ||
      element.getAttribute("placeholder") || element.getAttribute("title") || element.innerText ||
      value);
  };
  const candidates = Array.from(document.querySelectorAll(
    'a[href],button,input:not([type="hidden"]),textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]'
  ));
  const elements = [];
  const registry = Object.create(null);
  for (const element of candidates) {
    if (elements.length >= 160 || !visible(element)) continue;
    const ref = "e" + (elements.length + 1);
    const item = {
      ref,
      tag: element.localName,
      role: clean(element.getAttribute("role") || implicitRole(element), 40) || undefined,
      name: nameFor(element),
    };
    const password = element instanceof HTMLInputElement && element.type === "password";
    if ("value" in element && !password) item.value = clean(element.value, 200);
    elements.push(item);
    registry[ref] = element;
  }
  Object.defineProperty(window, registryKey, { value: registry, configurable: true });
  if (previousRegistryKey && previousRegistryKey !== registryKey) delete window[previousRegistryKey];
  const text = clean(document.body?.innerText || "", 20000);
  return { text, elements };
})()`
}

export function browserElementBoundsScript(
  registryKey: string,
  ref: string
): string {
  return `(() => {
    const element = window[${JSON.stringify(registryKey)}]?.[${JSON.stringify(ref)}];
    if (!(element instanceof Element) || !element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const next = element.getBoundingClientRect();
    const x = next.x + next.width / 2;
    const y = next.y + next.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return null;
    return { x, y };
  })()`
}

export function browserDeleteRegistryScript(registryKey: string): string {
  return `delete window[${JSON.stringify(registryKey)}]`
}

export function browserSetValueScript(
  registryKey: string,
  ref: string,
  value: string
): string {
  return `(() => {
    const element = window[${JSON.stringify(registryKey)}]?.[${JSON.stringify(ref)}];
    if (!(element instanceof Element) || !element.isConnected) return false;
    element.focus();
    const value = ${JSON.stringify(value)};
    if (element instanceof HTMLSelectElement) {
      element.value = value;
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value); else element.value = value;
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      return false;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`
}
