(() => {
  "use strict";

  const STORAGE_KEY = "x-old-media:dim-enabled";
  const PREVIOUS_THEME_KEY = "x-old-media:previous-night-mode";
  const ROOT_ATTRIBUTE = "data-x-old-media-dim";
  const CHOICE_ID = "x-old-media-dim-choice";
  const SCANNED_MAIN_CLASS = "x-old-media-dimmed-main";
  const SCANNED_CARD_CLASS = "x-old-media-dimmed-card";
  const DIM_THEME_COLOR = "#15202B";
  const MISSING_COOKIE = "__missing__";
  const DISPLAY_ROUTES = new Set(["/settings/display", "/i/display"]);
  const NATIVE_THEME_LABEL = /^(default|lights?\s*out|dark|light|デフォルト|ライトアウト|ダーク|ライト|消灯)$/i;
  const SHADOW_STYLE_ATTR = "data-x-old-media-shadow-style";
  const SHADOW_CSS = `
    [data-xchat-root="route"] {
      background-color: #15202b !important;
      --bg-background: 210 26% 13% !important;
      color: #f7f9f9 !important;
    }
  `;




  const diagnostics = globalThis.__xOldMedia;
  if (diagnostics && typeof diagnostics === "object") {
    diagnostics.dimEnabled = false;
    diagnostics.dimPanelMounted = false;
  }

  function readPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writePreference(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
      return true;
    } catch {
      return false;
    }
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
      const value = part.trim();
      if (value.startsWith(prefix)) return value.slice(prefix.length);
    }
    return null;
  }

  function writeNightMode(value) {
    document.cookie = `night_mode=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }

  function removeNightMode() {
    document.cookie = "night_mode=; Max-Age=0; Path=/; SameSite=Lax";
  }

  function rememberCurrentTheme() {
    try {
      if (localStorage.getItem(PREVIOUS_THEME_KEY) !== null) return;
      localStorage.setItem(PREVIOUS_THEME_KEY, readCookie("night_mode") ?? MISSING_COOKIE);
    } catch {
      // DIM still works without remembering the previous native theme.
    }
  }

  function restorePreviousTheme() {
    try {
      const previous = localStorage.getItem(PREVIOUS_THEME_KEY);
      if (previous === MISSING_COOKIE || previous === null) removeNightMode();
      else if (/^[012]$/.test(previous)) writeNightMode(previous);
      localStorage.removeItem(PREVIOUS_THEME_KEY);
    } catch {
      removeNightMode();
    }
  }

  let originalThemeColor;
  function syncThemeColor(enabled) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (enabled) {
      if (originalThemeColor === undefined) originalThemeColor = meta.getAttribute("content");
      meta.setAttribute("content", DIM_THEME_COLOR);
    } else if (originalThemeColor !== undefined) {
      if (originalThemeColor === null) meta.removeAttribute("content");
      else meta.setAttribute("content", originalThemeColor);
      originalThemeColor = undefined;
    }
  }

  function injectShadowStyle(host) {
    const root = host.shadowRoot;
    if (!root) return;

    const existing = root.querySelector(`style[${SHADOW_STYLE_ATTR}]`);

    if (!readPreference()) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const style = document.createElement("style");
    style.setAttribute(SHADOW_STYLE_ATTR, "");
    style.textContent = SHADOW_CSS;
    root.appendChild(style);
  }

  let scanFrame = 0;
  const pendingScanRoots = new Set();

  function dimElement(element) {
    if (!(element instanceof HTMLElement)) return;
    if (element.classList.contains(SCANNED_MAIN_CLASS) || element.classList.contains(SCANNED_CARD_CLASS)) return;
    let background = element.style.backgroundColor;
    if (!background && element.classList.contains("jf-element")) {
      try { background = getComputedStyle(element).backgroundColor; } catch { return; }
    }
    if (background === "rgb(0, 0, 0)" || background === "rgba(0, 0, 0, 1)") {
      element.classList.add(SCANNED_MAIN_CLASS);
    } else if (background === "rgb(22, 24, 28)" || background === "rgb(24, 24, 27)") {
      element.classList.add(SCANNED_CARD_CLASS);
    }
  }

    function scanShadowHosts(root = document) {
        root.querySelectorAll('[data-testid="xchatEmbedRoute"]').forEach(injectShadowStyle);
    }

  function scanSubtree(root) {
    if (!(root instanceof Element)) return;
    dimElement(root);
    for (const element of root.querySelectorAll("div,main,aside,header,nav,section,article,footer,button")) dimElement(element);
  }

  function flushDimScan() {
    scanFrame = 0;
    if (!readPreference()) { pendingScanRoots.clear(); return; }
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    for (const root of roots) scanSubtree(root);
  }

  function queueDimScan(nodes) {
    if (!readPreference()) return;
    for (const node of nodes) if (node instanceof Element) pendingScanRoots.add(node);
    if (pendingScanRoots.size && !scanFrame) scanFrame = requestAnimationFrame(flushDimScan);
  }

  function clearDimScanClasses() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    pendingScanRoots.clear();
    for (const element of document.querySelectorAll(`.${SCANNED_MAIN_CLASS}, .${SCANNED_CARD_CLASS}`)) {
      element.classList.remove(SCANNED_MAIN_CLASS, SCANNED_CARD_CLASS);
    }
  }

  function applyRootState(enabled) {
    const root = document.documentElement;
    if (!root) return;
    if (enabled) root.setAttribute(ROOT_ATTRIBUTE, "true");
    else root.removeAttribute(ROOT_ATTRIBUTE);
    syncThemeColor(enabled);
    if (enabled && document.body) queueDimScan([document.body]);
    else if (!enabled) clearDimScanClasses();
    if (diagnostics && typeof diagnostics === "object") diagnostics.dimEnabled = enabled;
  }

  function isDisplayRoute() {
    const path = location.pathname.replace(/\/$/, "") || "/";
    return DISPLAY_ROUTES.has(path);
  }

  function findBackgroundGroup() {
    const groups = [...document.querySelectorAll('[role="radiogroup"]')];
    if (!groups.length) return null;

    let best = null;
    let bestScore = -1;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const radioCount = group.querySelectorAll('[role="radio"]').length;
      if (!radioCount) continue;

      let context = group;
      let contextText = group.textContent || "";
      for (let depth = 0; depth < 2 && context.parentElement; depth += 1) {
        context = context.parentElement;
        contextText += ` ${context.textContent || ""}`;
      }

      let score = radioCount >= 2 ? 2 : 0;
      if (/background|背景/i.test(contextText)) score += 8;
      if (/lights?\s*out|ライトアウト|消灯/i.test(contextText)) score += 5;
      if (/default|デフォルト/i.test(group.textContent || "")) score += 1;
      score += index / Math.max(groups.length, 1);

      if (score > bestScore) {
        best = group;
        bestScore = score;
      }
    }
    return best;
  }

  function directChoiceFor(radio, group) {
    let choice = radio;
    while (choice.parentElement && choice.parentElement !== group) choice = choice.parentElement;
    return choice;
  }

  function removeDuplicateControlAttributes(choice) {
    const elements = [choice, ...choice.querySelectorAll("*")];
    for (const element of elements) {
      element.removeAttribute("id");
      element.removeAttribute("name");
      element.removeAttribute("for");
      element.removeAttribute("checked");
    }
  }

  function replaceChoiceLabel(choice) {
    const elements = [choice, ...choice.querySelectorAll("*")];
    const leaves = elements.filter((element) => element.children.length === 0 && element.textContent?.trim());
    const nativeLabel = leaves.find((element) => NATIVE_THEME_LABEL.test(element.textContent.trim()));
    const fallback = leaves.at(-1);
    const label = nativeLabel || fallback;
    if (label) {
      label.textContent = "DIM";
      label.classList.add("x-old-media-dim-label");
      return;
    }
    const addedLabel = document.createElement("span");
    addedLabel.className = "x-old-media-dim-label";
    addedLabel.textContent = "DIM";
    choice.appendChild(addedLabel);
  }

  function recolorNativePreview(choice) {
    const palette = ["#15202B", "#192734", "#22303C", "#1D9BF0"];
    const previews = [...choice.querySelectorAll('[style*="background"]')].slice(0, palette.length);
    if (previews.length) {
      previews.forEach((preview, index) => {
        preview.style.backgroundColor = palette[index];
      });
      return;
    }

    const preview = document.createElement("span");
    preview.className = "x-old-media-dim-inline-preview";
    preview.setAttribute("aria-hidden", "true");
    for (const color of palette) {
      const swatch = document.createElement("span");
      swatch.style.backgroundColor = color;
      preview.appendChild(swatch);
    }
    choice.insertBefore(preview, choice.firstChild);
  }

  function syncDimChoiceVisualState(choice, enabled) {
    if (!choice) return;
    const radio = choice.matches('[role="radio"]') ? choice : choice.querySelector('[role="radio"]');
    const input = choice.querySelector('input[type="radio"]');
    const indicator = radio?.firstElementChild;

    radio?.setAttribute("aria-checked", String(enabled));
    if (input) input.checked = enabled;
    choice.style.borderColor = enabled ? "rgb(29, 155, 240)" : "rgb(207, 217, 222)";
    choice.style.borderWidth = enabled ? "2px" : "1px";

    if (!indicator) return;
    if (enabled) {
      indicator.style.backgroundColor = "rgb(29, 155, 240)";
      indicator.style.borderColor = "rgb(29, 155, 240)";
      indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="display:block;width:100%;height:100%;color:#fff;fill:currentColor"><path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z"></path></svg>';
    } else {
      indicator.style.backgroundColor = "rgba(0, 0, 0, 0)";
      indicator.style.borderColor = "rgb(62, 65, 68)";
      indicator.replaceChildren();
    }
  }

  function updateGroupState(group) {
    const enabled = readPreference();
    const dimChoice = document.getElementById(CHOICE_ID);
    const dimRadio = dimChoice?.matches('[role="radio"]')
      ? dimChoice
      : dimChoice?.querySelector('[role="radio"]');
    syncDimChoiceVisualState(dimChoice, enabled);
    if (enabled) {
      for (const radio of group.querySelectorAll('[role="radio"]')) {
        if (radio !== dimRadio) radio.setAttribute("aria-checked", "false");
      }
    }
  }

  function enableDim(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (readPreference()) return;
    rememberCurrentTheme();
    if (!writePreference(true)) return;
    writeNightMode("2");
    applyRootState(true);
    location.reload();
  }

  function disableDimFromNativeChoice(event) {
    if (event.target.closest?.(`#${CHOICE_ID}`)) return;
    const group = event.currentTarget;
    const choice = [...group.children].find((element) => element.contains(event.target));
    if (!choice) return;
    const isDefaultChoice = /default|デフォルト/i.test(choice.textContent || "");

    if (readPreference()) {
      if (!writePreference(false)) return;
      restorePreviousTheme();
    }
    applyRootState(false);
    setTimeout(() => {
      writeNightMode(isDefaultChoice ? "0" : "2");
      updateGroupState(group);
    }, 0);
  }

  function createInlineChoice(group) {
    const nativeRadio = group.querySelector('[role="radio"]');
    if (!nativeRadio) return null;
    const template = directChoiceFor(nativeRadio, group);
    const choice = template.cloneNode(true);
    removeDuplicateControlAttributes(choice);
    choice.id = CHOICE_ID;
    choice.classList.add("x-old-media-dim-inline-choice");

    const radio = choice.matches('[role="radio"]') ? choice : choice.querySelector('[role="radio"]');
    if (radio) {
      radio.setAttribute("aria-label", "DIM");
      radio.setAttribute("aria-checked", String(readPreference()));
      radio.setAttribute("tabindex", "0");
    } else {
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-label", "DIM");
      choice.setAttribute("aria-checked", String(readPreference()));
      choice.setAttribute("tabindex", "0");
    }

    replaceChoiceLabel(choice);
    recolorNativePreview(choice);
    choice.addEventListener("click", enableDim, true);

    if (template.parentElement === group) template.insertAdjacentElement("afterend", choice);
    else group.appendChild(choice);
    return choice;
  }

  function bindNativeChoices(group) {
    if (group.dataset.xOldMediaDimBound === "true") return;
    group.dataset.xOldMediaDimBound = "true";
    group.addEventListener("click", disableDimFromNativeChoice, true);
  }

  function ensureInlineChoice() {
    const existing = document.getElementById(CHOICE_ID);
    if (!isDisplayRoute()) {
      existing?.remove();
      if (diagnostics && typeof diagnostics === "object") diagnostics.dimPanelMounted = false;
      return;
    }

    const group = findBackgroundGroup();
    if (!group) return;
    bindNativeChoices(group);

    let choice = existing;
    if (choice && !group.contains(choice)) {
      choice.remove();
      choice = null;
    }
    if (!choice) choice = createInlineChoice(group);
    if (!choice) return;

    updateGroupState(group);
    if (diagnostics && typeof diagnostics === "object") diagnostics.dimPanelMounted = true;
  }

  let scheduled = false;
  function scheduleChoiceCheck() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureInlineChoice();
    });
  }

  applyRootState(readPreference());

  const observer = new MutationObserver((mutations) => {
    scheduleChoiceCheck();
    scanShadowHosts();
      if (!readPreference()) return;
    for (const mutation of mutations) if (mutation.addedNodes.length) queueDimScan(mutation.addedNodes);
    syncThemeColor(true);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", scheduleChoiceCheck);
  addEventListener("hashchange", scheduleChoiceCheck);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleChoiceCheck, { once: true });
  } else {
    scheduleChoiceCheck();
  }

  for (const delay of [0, 500, 1500, 3000]) {
    setTimeout(() => {
        scanShadowHosts();
      if (readPreference() && document.body) queueDimScan([document.body]);
    }, delay);
  }
})();
