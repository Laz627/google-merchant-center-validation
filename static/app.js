/* static/app.js */
/* Mirrors original OpenAI validator wiring.
   - No top-level await
   - Profile-aware spec loading
   - Sorts Spec cards in-memory (Required → Conditional → Recommended → Optional → name)
   - Robust tab + drag/drop wiring with conservative fallbacks (NO DOM/CSS changes) */

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
  let SPEC_FIELDS = [];
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
      const ia = order[a.importance] ?? 99;
      const ib = order[b.importance] ?? 99;
      if (ia !== ib) return ia - ib;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  function getActiveProfile() {
    // prefer explicit selector if your DOM has it
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

    // ARIA pattern
    const tabs = $$("[role='tab']");
    const panels = $$("[role='tabpanel']");

    if (tabs.length && panels.length) {
      const targetPanel = document.getElementById(panelId) || $(`#${panelId}`);
      panels.forEach((p) => p.setAttribute("hidden", "true"));
      if (targetPanel) targetPanel.removeAttribute("hidden");

      // find tab that controls this panel
      const tab = tabs.find((t) => t.getAttribute("aria-controls") === panelId);
      tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
      if (tab) tab.setAttribute("aria-selected", "true");
      return;
    }

    // fallback to #panel-*
    const panel = document.getElementById(panelId) || $(`#${panelId}`);
    const allPanels = $$("[id^='panel-']");
    allPanels.forEach((p) => p.classList.add("hidden"));
    if (panel) panel.classList.remove("hidden");

    // fallback tabs by id convention
    const allTabs = $$("[id^='tab-']");
    allTabs.forEach((t) => t.setAttribute("aria-selected", "false"));
    const inferredTab = document.getElementById(panelId.replace("panel-", "tab-"));
    if (inferredTab) inferredTab.setAttribute("aria-selected", "true");
  }

  function initTabs() {
    // Delegate clicks for role="tab"
    on(document, "click", (e) => {
      const t = e.target.closest("[role='tab']");
      if (!t) return;
      const controls = t.getAttribute("aria-controls");
      if (!controls) return;
      e.preventDefault();
      showTabId(controls);
    });

    // Fallback: support id convention tab-validate/tab-spec
    const tabValidate =
      $("#tab-validate") || $("[data-tab='validate']") || null;
    const tabSpec = $("#tab-spec") || $("[data-tab='spec']") || null;

    on(tabValidate, "click", (e) => {
      e.preventDefault();
      showTabId("panel-validate");
    });
    on(tabSpec, "click", (e) => {
      e.preventDefault();
      showTabId("panel-spec");
    });

    // Default view
    // If an ARIA tab is already selected, respect it; else show validate.
    const selected = $("[role='tab'][aria-selected='true']");
    if (selected && selected.getAttribute("aria-controls")) {
      showTabId(selected.getAttribute("aria-controls"));
    } else {
      // fallback default
      if (document.getElementById("panel-validate")) showTabId("panel-validate");
    }
  }

  // -------------------- counters --------------------
  function setCounters({ errors = 0, warnings = 0, opportunities = 0 }) {
    const ce = $("#count-errors");
    const cw = $("#count-warnings");
    const co = $("#count-opportunities");
    if (ce) ce.textContent = String(errors);
    if (cw) cw.textContent = String(warnings);
    if (co) co.textContent = String(opportunities);
  }

  function updateChipCounts() {
    // preserve your existing chip behavior if present
  }

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
      $("input[type='file']") // last resort; assumes only one file input
    );
  }

  function updateSelectedFile() {
    const el =
      document.getElementById("selected-file") ||
      $("[data-selected-file]") ||
      $("#file-label");
    if (!el) return;
    el.textContent = CURRENT_FILENAME ? CURRENT_FILENAME : "No file selected";
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
  function renderSpecGrid() {
    const specGrid =
      document.getElementById("spec-grid") || $("[data-spec-grid]");
    if (!specGrid) return;

    const fields = sortSpecByImportance(SPEC_FIELDS);

    specGrid.innerHTML = fields
      .map((field) => {
        const badge = (field.importance || "").toLowerCase();
        const badgeLabel = badge
          ? badge.charAt(0).toUpperCase() + badge.slice(1)
          : "";
        return `
<button type="button" class="spec-card" data-field="${escAttr(
          field.name
        )}" data-importance="${escAttr(field.importance)}">
  <div class="spec-card__head">
    <span class="badge badge--${escAttr(badge)}">${esc(badgeLabel)}</span>
  </div>
  <div class="spec-card__body">
    <h4>${esc(field.name)}</h4>
    <p>${esc(field.description || "")}</p>
    <div class="muted">—</div>
  </div>
</button>`;
      })
      .join("");
  }

  // -------------------- results table --------------------
  function clearResults() {
    const tb =
      document.getElementById("results-body") || $("[data-results-body]");
    const empty =
      document.getElementById("empty-noissues") || $("[data-empty]");
    if (tb) tb.innerHTML = "";
    if (empty) empty.classList.add("hidden");
    setCounters({ errors: 0, warnings: 0, opportunities: 0 });
    setDownloadsEnabled(false);
  }

  function setDownloadsEnabled(enabled) {
    const a = document.getElementById("btn-noissues-json");
    const b = document.getElementById("btn-noissues-csv");
    if (a) a.disabled = !enabled;
    if (b) b.disabled = !enabled;
  }

  function renderResults(payload) {
    const issues = payload?.issues || [];
    const summary = payload?.summary || null;

    let errors = 0,
      warnings = 0,
      opportunities = 0;

    if (summary) {
      errors = Number(summary.items_with_errors || 0);
      warnings = Number(summary.items_with_warnings || 0);
      opportunities = Number(summary.items_with_opportunities || 0);
    } else {
      for (const it of issues) {
        if (it.severity === "error") errors++;
        else if (it.severity === "warning") warnings++;
        else if (it.severity === "opportunity") opportunities++;
      }
    }

    setCounters({ errors, warnings, opportunities });

    const tb =
      document.getElementById("results-body") || $("[data-results-body]");
    const empty =
      document.getElementById("empty-noissues") || $("[data-empty]");

    if (!tb) return;

    if (!issues.length) {
      if (empty) empty.classList.remove("hidden");
      setDownloadsEnabled(false);
      return;
    }

    const rows = issues
      .map((it) => {
        const r = it.row_index == null ? "" : String(it.row_index);
        const id = it.item_id || "";
        const field = it.field || "";
        const sev = it.severity || "";
        const msg = it.message || "";
        const sample = it.sample_value || "";
        return `
<tr class="issue-row issue-${escAttr(sev)}">
  <td class="col-row">${esc(r)}</td>
  <td class="col-id">${esc(id)}</td>
  <td class="col-field">${esc(field)}</td>
  <td class="col-sev">${esc(sev)}</td>
  <td class="col-msg">${esc(msg)}</td>
  <td class="col-sample">${esc(sample)}</td>
</tr>`;
      })
      .join("");

    tb.innerHTML = rows;
    setDownloadsEnabled(true);
  }

  // -------------------- validation submit --------------------
  function initValidate() {
    const btn =
      document.getElementById("btn-validate") || $("[data-validate]");
    if (!btn) return;

    on(btn, "click", async (e) => {
      e.preventDefault();
      if (!CURRENT_FILE) {
        clearResults();
        return;
      }
      clearResults();

      const encoding =
        document.getElementById("encoding") ||
        $("[data-encoding]") || { value: "utf-8" };
      const delimiter =
        document.getElementById("delimiter") ||
        $("[data-delimiter]") || { value: "" };

      const fd = new FormData();
      fd.append("file", CURRENT_FILE);
      fd.append("encoding", String(encoding.value || "utf-8").trim());
      fd.append("delimiter", String(delimiter.value || "").trim());
      fd.append("profile", getActiveProfile());

      try {
        const res = await fetch("/validate/file", { method: "POST", body: fd });
        if (!res.ok) {
          const txt = await res.text();
          console.error("Validation failed:", res.status, txt);
          showValidationFailed(txt || `HTTP ${res.status}`);
          return;
        }
        const payload = await res.json();
        renderResults(payload);
      } catch (err) {
        console.error("Validation error:", err);
        showValidationFailed(
          String(err && err.message ? err.message : err || "Validation failed")
        );
      }
    });
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

  // -------------------- boot --------------------
  function boot() {
    initYear();
    initTabs();
    initDragAndDrop();
    initProfileSelector();
    updateSelectedFile();
    setDownloadsEnabled(false);
    updateChipCounts();

    loadSpec(getActiveProfile())
      .then(() => {
        renderSpecGrid();
        updateChipCounts();
      })
      .catch((e) => console.error("Initial spec load failed:", e));

    initValidate();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    on(document, "DOMContentLoaded", boot);
  }
})();
