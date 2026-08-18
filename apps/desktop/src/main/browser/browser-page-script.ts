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

const browserElementPickerStyles = `
  :host { all: initial; }
  .box { position:fixed;display:none;box-sizing:border-box;border:2px solid #5b7cfa;
    border-radius:4px;background:rgb(91 124 250 / 10%);box-shadow:0 0 0 1px rgb(255 255 255 / 70%);
    pointer-events:none; }
  .label { position:fixed;display:none;max-width:320px;padding:4px 7px;border-radius:5px;
    background:#171717;color:#fff;box-shadow:0 4px 14px rgb(0 0 0 / 28%);
    font:500 11px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none; }
`

/** Starts a one-shot human element picker inside the isolated automation world. */
export function browserElementPickerScript(controlKey: string): string {
  return String.raw`(() => new Promise((resolve) => {
  const controlKey = ${JSON.stringify(controlKey)};
  window[controlKey]?.cancel?.();
  const clean = (value, maximum) => {
    const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum);
    return text || null;
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
    return null;
  };
  const isSensitive = (element) => {
    if (element instanceof HTMLInputElement &&
      !["button", "submit", "reset", "image"].includes(element.type.toLowerCase())) return true;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ||
      element instanceof HTMLOptionElement) return true;
    const editableRoot = element.closest("[contenteditable]");
    if (element instanceof HTMLElement && (element.isContentEditable ||
      (editableRoot && editableRoot.getAttribute("contenteditable")?.toLowerCase() !== "false"))) return true;
    if (element.matches("[autocomplete*='password' i], [autocomplete*='cc-' i]")) return true;
    return element.querySelector(
      "input:not([type='button']):not([type='submit']):not([type='reset']):not([type='image'])," +
      "textarea,select,option,[contenteditable],[autocomplete*='password' i],[autocomplete*='cc-' i]"
    ) !== null;
  };
  const nameFor = (element) => {
    if (isSensitive(element)) return null;
    const labels = element.labels
      ? Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" ")
      : "";
    return clean(element.getAttribute("aria-label") || labels ||
      element.getAttribute("alt") || element.getAttribute("placeholder") ||
      element.getAttribute("title") || element.innerText || element.textContent, 256);
  };
  const selectorFor = (element) => {
    if (element.getRootNode() !== document) return null;
    const parts = [];
    let current = element;
    while (current && current instanceof Element && parts.length < 10) {
      const tag = current.localName;
      if (!tag) return null;
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((candidate) => candidate.localName === tag);
      const position = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + position + ")" : tag);
      if (tag === "body") break;
      current = parent;
    }
    const selector = parts.join(" > ").slice(0, 1024);
    if (!selector) return null;
    try {
      return document.querySelector(selector) === element ? selector : null;
    } catch {
      return null;
    }
  };
  const targetFor = (event) => event.composedPath().find((candidate) =>
    candidate instanceof Element && candidate.getRootNode() === document &&
    candidate !== host && !host.contains(candidate)
  ) || null;

  const host = document.createElement("div");
  host.setAttribute("data-deskto-element-picker", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(browserElementPickerStyles)};
  const box = document.createElement("div");
  box.className = "box";
  const label = document.createElement("div");
  label.className = "label";
  shadow.append(style, box, label);
  (document.documentElement || document.body).append(host);

  let settled = false;
  let current = null;
  const hide = () => {
    box.style.display = "none";
    label.style.display = "none";
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", refresh, true);
    window.removeEventListener("resize", refresh, true);
    host.remove();
    delete window[controlKey];
    resolve(value);
  };
  const refresh = () => {
    if (!current || !current.isConnected) {
      current = null;
      hide();
      return;
    }
    const rect = current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hide();
      return;
    }
    box.style.display = "block";
    box.style.left = Math.max(0, rect.left) + "px";
    box.style.top = Math.max(0, rect.top) + "px";
    box.style.width = Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)) + "px";
    box.style.height = Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)) + "px";
    label.textContent = current.localName + (nameFor(current) ? " · " + nameFor(current) : "");
    label.style.display = "block";
    label.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 326)) + "px";
    label.style.top = (rect.top > 28 ? rect.top - 25 : Math.min(window.innerHeight - 25, rect.bottom + 5)) + "px";
  };
  function onMove(event) {
    const target = targetFor(event);
    if (!target || !selectorFor(target)) {
      current = null;
      hide();
      return;
    }
    current = target;
    refresh();
  }
  function onClick(event) {
    const target = targetFor(event);
    const selector = target ? selectorFor(target) : null;
    if (!target || !selector) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const sensitive = isSensitive(target);
    finish({
      selector,
      tagName: target.localName.slice(0, 64),
      role: clean(target.getAttribute("role") || implicitRole(target), 64),
      name: sensitive ? null : nameFor(target),
      text: sensitive ? null : clean(target.innerText || target.textContent, 280),
    });
  }
  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(null);
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", refresh, true);
  window.addEventListener("resize", refresh, true);
  Object.defineProperty(window, controlKey, {
    configurable: true,
    value: { cancel: () => finish(null) },
  });
}))()`
}

export function browserCancelElementPickerScript(controlKey: string): string {
  return `window[${JSON.stringify(controlKey)}]?.cancel?.()`
}
