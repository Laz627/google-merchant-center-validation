/* static/app.js */
/* Mirrors original OpenAI validator wiring.
   - No top-level await
   - Profile-aware spec loading
   - Sorts Spec cards in-memory (Required → Conditional → Recommended → Optional → name)
   - Robust tab + drag/drop wiring with conservative fallbacks (NO DOM/CSS changes) */

if (typeof SPEC_FIELDS === "undefined") {
  var SPEC_FIELDS = [];
}

var renderSpecGrid;
var updateChipCounts;
var initSpecFilterKeyboard;
var initCopyButtons;
var updateSelectedFile;
var setDownloadsEnabled;
var showTab;

// Safe bootstrap without top-level await
(function () {
  function safe(fn) {
    try {
      fn && fn();
    } catch (e) {
      console.error(e);
    }
  }

  function bootstrap() {
    safe(renderSpecGrid);
    safe(updateChipCounts);
    safe(initSpecFilterKeyboard);
    safe(initCopyButtons);
    safe(updateSelectedFile);
    safe(typeof setDownloadsEnabled === "function" ? setDownloadsEnabled.bind(null, false) : null);
    if (typeof showTab === "function") {
      showTab("validate");
    }
  }

  if (typeof window !== "undefined") {
    window.__appBootstrap = bootstrap;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

(function () {
  "use strict";

  // -------------------- tiny utils --------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const escAttr = esc;

  // -------------------- state --------------------
  let ACTIVE_PROFILE = "general";
  let CURRENT_FILE = null;
  let CURRENT_FILENAME = "";
  let CURRENT_ENCODING = "utf-8";
  let CURRENT_DELIM = "";

  // -------------------- spec load + sort --------------------
  async function loadSpec(profile) {
    const p = (profile || ACTIVE_PROFILE || "general").trim();
    const res = await fetch(`/api/spec?profile=${encodeURIComponent(p)}`);
    if (!res.ok) throw new Error(`Spec load failed: ${res.status}`);
    SPEC_FIELDS = await res.json();
  }

  function sortSpecByImportance(fields) {
    const order = { required: 0, conditional: 1, recommended: 2, optional: 3 };
    return [...fields].sort((a, b) => {
      const ia = order[(a && a.importance) || "optional"] ?? 99;
      const ib = order[(b && b.importance) || "optional"] ?? 99;
      if (ia !== ib) return ia - ib;
      return (a?.name || "").localeCompare(b?.name || "");
    });
  }

  function getActiveProfile() {
    const sel =
      $("#profile-select") ||
      $("[data-profile-select]") ||
      $("[name='profile']");
    if (sel) return sel.value || "general";
    return ACTIVE_PROFILE || "general";
  }

  // -------------------- tabs (robust, ARIA-first) --------------------
  function showTabId(panelId) {
    if (!panelId) return;

    const tabs = $$("[role='tab']");
    const panels = $$("[role='tabpanel']");

    if (tabs.length && panels.length) {
      const targetPanel = document.getElementById(panelId) || $(`#${panelId}`);
      panels.forEach((p) => p.setAttribute("hidden", "true"));
      if (targetPanel) targetPanel.removeAttribute("hidden");

      const tab = tabs.find((t) => t.getAttribute("aria-controls") === panelId);
      tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
      if (tab) tab.setAttribute("aria-selected", "true");
      return;
    }

    const panel = document.getElementById(panelId) || $(`#${panelId}`);
    const allPanels = $$("[id^='panel-']");
    allPanels.forEach((p) => p.classList.add("hidden"));
    if (panel) panel.classList.remove("hidden");

    const allTabs = $$("[id^='tab-']");
    allTabs.forEach((t) => t.setAttribute("aria-selected", "false"));
    const inferredTab = document.getElementById(panelId.replace("panel-", "tab-"));
    if (inferredTab) inferredTab.setAttribute("aria-selected", "true");
  }

  showTab = function (name) {
    if (!name) return;
    const panelId = name === "spec" ? "panel-spec" : "panel-validate";
    showTabId(panelId);
  };

  function initTabs() {
    on(document, "click", (e) => {
      const t = e.target.closest("[role='tab']");
      if (!t) return;
      const controls = t.getAttribute("aria-controls");
      if (!controls) return;
      e.preventDefault();
      showTabId(controls);
    });

    const tabValidate =
      $("#tab-validate") || $("[data-tab='validate']") || null;
    const tabSpec = $("#tab-spec") || $("[data-tab='spec']") || null;

    on(tabValidate, "click", (e) => {
      e.preventDefault();
      showTab("validate");
    });
    on(tabSpec, "click", (e) => {
      e.preventDefault();
      showTab("spec");
    });

    const selected = $("[role='tab'][aria-selected='true']");
    if (selected && selected.getAttribute("aria-controls")) {
      showTabId(selected.getAttribute("aria-controls"));
    } else if (document.getElementById("panel-validate")) {
      showTab("validate");
    }
  }

  // -------------------- counters --------------------
  function setCountersDisplay(errors, warnings, opportunities) {
    const mapIds = [
      ["counter-errors", errors],
      ["counter-warnings", warnings],
      ["counter-opportunities", opportunities],
      ["count-errors", errors],
      ["count-warnings", warnings],
      ["count-opportunities", opportunities],
    ];
    mapIds.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value ?? 0);
    });
  }

  updateChipCounts = function () {
    // preserve your existing chip behavior if present
  };

  initSpecFilterKeyboard = function () {
    // placeholder to keep existing keyboard shortcuts alive if defined elsewhere
  };

  initCopyButtons = function () {
    // placeholder to keep existing copy interactions alive if defined elsewhere
  };

  // -------------------- drag & drop (robust, zero DOM changes) --------------------
  function pickDropzone() {
    return (
      document.getElementById("dropzone") ||
      $(".dropzone") ||
      $("[data-dropzone]") ||
      $("#uploader") ||
      $("#upload-area")
    );
  }

  function pickFileInput() {
    return (
      document.getElementById("file-input") ||
      $("input[type='file'][data-file-input]") ||
      $("input[type='file']")
    );
  }

  updateSelectedFile = function () {
    const el =
      document.getElementById("selected-file") ||
      $("[data-selected-file]") ||
      $("#file-label");
    if (el) el.textContent = CURRENT_FILENAME ? CURRENT_FILENAME : "No file selected";
  };

  function syncFileInputWithCurrent(file) {
    const input = pickFileInput();
    if (!input || !file) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (err) {
      console.warn("Unable to sync drop file with input", err);
    }
  }

  function initDragAndDrop() {
    const dz = pickDropzone();
    const fi = pickFileInput();
    if (!dz || !fi) return;

    on(dz, "dragover", (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    });
    on(dz, "dragleave", () => dz.classList.remove("dragover"));
    on(dz, "drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        CURRENT_FILE = f;
        CURRENT_FILENAME = f.name;
        syncFileInputWithCurrent(f);
        updateSelectedFile();
      }
    });

    on(fi, "change", (e) => {
      const f = e.target?.files?.[0];
      if (f) {
        CURRENT_FILE = f;
        CURRENT_FILENAME = f.name;
        updateSelectedFile();
      }
    });
  }

  // -------------------- spec grid --------------------
  renderSpecGrid = function () {
    const specGrid = document.getElementById("spec-grid") || $("[data-spec-grid]");
    if (!specGrid) return;
    const fields = Array.isArray(SPEC_FIELDS) ? sortSpecByImportance(SPEC_FIELDS) : [];
    specGrid.innerHTML = fields
      .map((field) => {
        const name = field?.name || "";
        const importance = (field?.importance || "optional").toLowerCase();
        const badgeLabel = importance
          ? importance.charAt(0).toUpperCase() + importance.slice(1)
          : "";
        let dependencyText = field?.dependencies;
        if (Array.isArray(dependencyText)) {
          dependencyText = dependencyText.join(", ");
        }
        if (!dependencyText) {
          dependencyText = "No additional dependencies.";
        }
        const description = field?.description || field?.desc || "";
        return `
      <button type="button" class="spec-card"
        data-field="${escAttr(name)}"
        data-importance="${escAttr(importance)}">
        <div class="spec-card__title">${esc(name)}</div>
        <div class="spec-card__badge badge badge-${escAttr(importance)}">${esc(
          badgeLabel
        )}</div>
        <div class="spec-card__desc">${esc(description)}</div>
        <div class="spec-card__deps">${esc(dependencyText)}</div>
      </button>
    `;
      })
      .join("");
  };

  // -------------------- results table --------------------
  setDownloadsEnabled = function (enabled) {
    const ids = [
      "btn-noissues-json",
      "btn-noissues-csv",
      "download-json",
      "download-csv",
      "download-tsv",
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
  };

  function clearIssuesView() {
    const tbody =
      document.getElementById("issues-body") ||
      document.getElementById("results-body") ||
      $("[data-results-body]");
    if (tbody) tbody.innerHTML = "";
    const empty = document.getElementById("no-issues") || $("#empty-noissues");
    if (empty) empty.classList.remove("hidden");
    const nores = document.getElementById("no-results");
    if (nores) nores.classList.remove("hidden");
    setCountersDisplay(0, 0, 0);
    setDownloadsEnabled(false);
  }

  function renderIssues(issues) {
    const tbody =
      document.getElementById("issues-body") ||
      document.getElementById("results-body") ||
      $("[data-results-body]");
    if (!tbody) return;
    tbody.innerHTML = (issues || [])
      .map((it, i) => {
        const row = it?.row ?? it?.row_index ?? i + 1;
        const itemId = it?.item_id || it?.id || "";
        const field = it?.field || "";
        const rule = it?.rule || it?.code || it?.rule_id || "";
        const severity = it?.severity || "";
        const message = it?.message || "";
        const value = it?.value || it?.sample_value || "";
        return `
        <tr>
          <td class="col-index">${esc(row)}</td>
          <td class="col-item">${esc(itemId)}</td>
          <td>${esc(field)}</td>
          <td>${esc(rule)}</td>
          <td>${esc(severity)}</td>
          <td>${esc(message)}</td>
          <td>${esc(value)}</td>
        </tr>`;
      })
      .join("");
  }

  function applyValidationResponse(data) {
    const issues = data?.issues || [];
    const errorCount =
      data?.error_count ??
      data?.summary?.items_with_errors ??
      issues.filter((i) => i?.severity === "error").length;
    const warningCount =
      data?.warning_count ??
      data?.summary?.items_with_warnings ??
      issues.filter((i) => i?.severity === "warning").length;
    const opportunityCount =
      data?.opportunity_count ??
      data?.summary?.items_with_opportunities ??
      issues.filter((i) => i?.severity === "opportunity").length;

    setCountersDisplay(errorCount, warningCount, opportunityCount);
    renderIssues(issues);

    const empty = document.getElementById("no-issues") || $("#empty-noissues");
    if (empty) empty.classList.toggle("hidden", issues.length !== 0);
    const nores = document.getElementById("no-results");
    if (nores) nores.classList.add("hidden");
    setDownloadsEnabled(issues.length > 0);
  }

  function showValidationFailed(reason) {
    const banner =
      document.getElementById("validation-failed") || $("[data-fail]");
    const msg = document.getElementById("validation-failed-msg") || null;
    if (!banner) return;
    if (msg) msg.textContent = String(reason || "Validation failed");
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 6000);
  }

  // -------------------- validation submit --------------------
  function wireValidateButton(button) {
    if (!button || button.__wired) return;
    button.__wired = true;

    on(button, "click", (ev) => {
      ev.preventDefault();
      doValidate().catch((err) => console.error(err));
    });
  }

  async function doValidate() {
    const fileInput = pickFileInput();
    const delimiterInput = document.getElementById("delimiter");
    const encodingInput = document.getElementById("encoding");

    const selectedFile = fileInput?.files?.[0] || CURRENT_FILE;
    if (!selectedFile) {
      console.warn("No file selected");
      return;
    }

    clearIssuesView();

    const fd = new FormData();
    fd.append("file", selectedFile);
    const encoding = (encodingInput?.value || CURRENT_ENCODING || "utf-8").trim();
    const delimiter = (delimiterInput?.value || CURRENT_DELIM || "").trim();
    fd.append("encoding", encoding || "utf-8");
    fd.append("delimiter", delimiter);

    CURRENT_ENCODING = encoding || "utf-8";
    CURRENT_DELIM = delimiter;

    const profileSel = document.getElementById("profile-select");
    if (profileSel) {
      fd.append("profile", profileSel.value || "general");
    } else {
      fd.append("profile", getActiveProfile());
    }

    try {
      const res = await fetch("/validate/file", { method: "POST", body: fd });
      if (!res.ok) {
        const txt = await res.text();
        console.error("Validate failed:", res.status, txt);
        showValidationFailed(txt || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      applyValidationResponse(data);
    } catch (err) {
      console.error("Validation error:", err);
      showValidationFailed(
        String(err && err.message ? err.message : err || "Validation failed")
      );
    }
  }

  function initValidate() {
    wireValidateButton(document.getElementById("btn-validate-file"));
    wireValidateButton(document.getElementById("btn-validate"));
  }

  // -------------------- profile selector --------------------
  function initProfileSelector() {
    const sel =
      document.getElementById("profile-select") ||
      $("[data-profile-select]") ||
      $("[name='profile']");
    if (!sel) return;

    on(sel, "change", () => {
      ACTIVE_PROFILE = getActiveProfile();
      loadSpec(ACTIVE_PROFILE)
        .then(() => {
          renderSpecGrid();
          updateChipCounts();
        })
        .catch((e) => console.error("Spec reload failed:", e));
    });
  }

  // -------------------- footer year (optional) --------------------
  function initYear() {
    const y = document.getElementById("year") || $("[data-year]");
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function initNoResultState() {
    const nores = document.getElementById("no-results");
    const empty = document.getElementById("no-issues") || $("#empty-noissues");
    if (nores) nores.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
  }

  function boot() {
    initYear();
    initTabs();
    initProfileSelector();
    initDragAndDrop();
    initValidate();
    initNoResultState();
    updateSelectedFile();
    setDownloadsEnabled(false);
    updateChipCounts();

    loadSpec(getActiveProfile())
      .then(() => {
        renderSpecGrid();
        updateChipCounts();
      })
      .catch((e) => console.error("Initial spec load failed:", e));
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    on(document, "DOMContentLoaded", boot);
  }

  if (typeof window !== "undefined" && typeof window.__appBootstrap === "function") {
    window.__appBootstrap();
  }
})();
