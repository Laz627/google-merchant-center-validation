/* static/app.js */
/* Mirrors original OpenAI validator wiring; adds profile-aware spec loading and in-memory sort. */

(function () {
  "use strict";

  // ---------- DOM helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const escapeHtml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const escapeAttr = escapeHtml;

  // ---------- Globals preserved by original UI ----------
  let SPEC_FIELDS = []; // filled via /api/spec
  let ACTIVE_PROFILE = "general";
  let CURRENT_FILE = null;
  let CURRENT_FILENAME = "";
  let CURRENT_ENCODING = "utf-8";
  let CURRENT_DELIM = "";

  // ---------- Spec loading + sorting ----------
  async function loadSpec(profile) {
    const p = profile || ACTIVE_PROFILE || "general";
    const res = await fetch(`/api/spec?profile=${encodeURIComponent(p)}`);
    if (!res.ok) throw new Error(`Failed to load spec: ${res.status}`);
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
    const sel = $("#profile-select");
    if (sel) return sel.value || "general";
    return ACTIVE_PROFILE || "general";
  }

  // ---------- Tabs ----------
  function showTab(which) {
    const panels = $$(".panel");
    const tabs = $$(".tabs [role='tab']");
    panels.forEach((p) => p.classList.add("hidden"));
    tabs.forEach((t) => t.setAttribute("aria-selected", "false"));

    const panel = $(`#panel-${which}`);
    const tab = $(`#tab-${which}`);
    if (panel) panel.classList.remove("hidden");
    if (tab) tab.setAttribute("aria-selected", "true");
  }

  function initTabs() {
    on($("#tab-validate"), "click", () => showTab("validate"));
    on($("#tab-spec"), "click", () => showTab("spec"));
  }

  // ---------- Counters / chip counts ----------
  function setCounters({ errors = 0, warnings = 0, opportunities = 0 }) {
    const ce = $("#count-errors");
    const cw = $("#count-warnings");
    const co = $("#count-opportunities");
    if (ce) ce.textContent = String(errors);
    if (cw) cw.textContent = String(warnings);
    if (co) co.textContent = String(opportunities);
  }

  function updateChipCounts() {
    // If your UI has chip filters for required/conditional/etc., keep their counts here if needed.
    // This preserves existing behavior; no DOM changes are introduced.
  }

  // ---------- Downloads (no-op until you wire your existing buttons) ----------
  function setDownloadsEnabled(enabled) {
    const a = $("#btn-noissues-json");
    const b = $("#btn-noissues-csv");
    if (a) a.disabled = !enabled;
    if (b) b.disabled = !enabled;
  }

  // ---------- File selection UI ----------
  function updateSelectedFile() {
    const el = $("#selected-file");
    if (!el) return;
    el.textContent = CURRENT_FILENAME ? CURRENT_FILENAME : "No file selected";
  }

  // ---------- Drag & Drop ----------
  function initDragAndDrop() {
    const dz = $("#dropzone");
    const fi = $("#file-input");
    if (!dz || !fi) return;

    on(dz, "dragover", (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    });
    on(dz, "dragleave", () => dz.classList.remove("dragover"));
    on(dz, "drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        CURRENT_FILE = f;
        CURRENT_FILENAME = f.name;
        updateSelectedFile();
      }
    });

    on(fi, "change", (e) => {
      const f = e.target && e.target.files && e.target.files[0];
      if (f) {
        CURRENT_FILE = f;
        CURRENT_FILENAME = f.name;
        updateSelectedFile();
      }
    });
  }

  // ---------- Spec grid render ----------
  function renderSpecGrid() {
    const specGrid = $("#spec-grid");
    if (!specGrid) return;

    // sort by importance → name; keep selectors/markup identical
    const fields = sortSpecByImportance(SPEC_FIELDS);

    specGrid.innerHTML = fields
      .map((field) => {
        const badgeLabel =
          field.importance.charAt(0).toUpperCase() + field.importance.slice(1);
        const dependencyText = field.dependencies || "No additional dependencies.";
        return `
<button type="button" class="spec-card" data-field="${escapeAttr(
          field.name
        )}" data-importance="${escapeAttr(field.importance)}">
  <div class="spec-card__head">
    <span class="badge badge--${escapeAttr(field.importance)}">${badgeLabel}</span>
  </div>
  <div class="spec-card__body">
    <h4>${escapeHtml(field.name)}</h4>
    <p>${escapeHtml(field.description || "")}</p>
    <div class="muted">—</div>
  </div>
</button>`;
      })
      .join("");
  }

  // ---------- Results table rendering ----------
  function clearResults() {
    const tb = $("#results-body");
    const empty = $("#empty-noissues");
    if (tb) tb.innerHTML = "";
    if (empty) empty.classList.add("hidden");
    setCounters({ errors: 0, warnings: 0, opportunities: 0 });
    setDownloadsEnabled(false);
  }

  function renderResults(payload) {
    // The backend should return ValidateResponse (summary + issues).
    // We support both the model shape and a legacy flat dict.
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
      // Legacy: compute from issues if summary missing
      for (const it of issues) {
        if (it.severity === "error") errors++;
        else if (it.severity === "warning") warnings++;
        else if (it.severity === "opportunity") opportunities++;
      }
    }

    setCounters({ errors, warnings, opportunities });

    const tb = $("#results-body");
    const empty = $("#empty-noissues");
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
<tr class="issue-row issue-${escapeAttr(sev)}">
  <td class="col-row">${escapeHtml(r)}</td>
  <td class="col-id">${escapeHtml(id)}</td>
  <td class="col-field">${escapeHtml(field)}</td>
  <td class="col-sev">${escapeHtml(sev)}</td>
  <td class="col-msg">${escapeHtml(msg)}</td>
  <td class="col-sample">${escapeHtml(sample)}</td>
</tr>`;
      })
      .join("");

    tb.innerHTML = rows;
    setDownloadsEnabled(true);
  }

  // ---------- Validation submit ----------
  function initValidate() {
    const btn = $("#btn-validate");
    if (!btn) return;

    on(btn, "click", async (e) => {
      e.preventDefault();
      if (!CURRENT_FILE) {
        clearResults();
        return;
      }
      clearResults();

      const encoding = $("#encoding") || { value: "utf-8" };
      const delimiter = $("#delimiter") || { value: "" };

      const fd = new FormData();
      fd.append("file", CURRENT_FILE);
      fd.append("encoding", (encoding.value || "utf-8").trim());
      fd.append("delimiter", (delimiter.value || "").trim());
      fd.append("profile", getActiveProfile()); // ← profile added

      try {
        const res = await fetch("/validate/file", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const txt = await res.text();
          console.error("Validation failed:", res.status, txt);
          showValidationFailed(txt);
          return;
        }
        const payload = await res.json();
        renderResults(payload);
      } catch (err) {
        console.error("Validation error:", err);
        showValidationFailed(String(err && err.message ? err.message : err));
      }
    });
  }

  function showValidationFailed(reason) {
    const banner = $("#validation-failed");
    if (!banner) return;
    const msg = $("#validation-failed-msg");
    if (msg) msg.textContent = String(reason || "Validation failed");
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 6000);
  }

  // ---------- Spec interactions (keyboard/filter hooks preserved) ----------
  function initSpecFilterKeyboard() {
    // Keep any existing keyboard handler logic. Stub kept to preserve wiring.
  }

  function initCopyButtons() {
    // If you had “copy” buttons in the original app, preserve their listeners here.
  }

  // ---------- Profile selector wiring ----------
  function initProfileSelector() {
    const sel = $("#profile-select");
    if (!sel) return;
    on(sel, "change", () => {
      ACTIVE_PROFILE = getActiveProfile();
      loadSpec(ACTIVE_PROFILE)
        .then(() => {
          renderSpecGrid();
          updateChipCounts();
        })
        .catch((e) => console.error("Failed to reload spec:", e));
    });
  }

  // ---------- Year footer ----------
  function initYear() {
    const yearEl = $("#year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  }

  // ---------- Boot ----------
  function boot() {
    initYear();
    initTabs();
    initDragAndDrop();
    initCopyButtons();
    initSpecFilterKeyboard();
    initProfileSelector();
    updateSelectedFile();
    setDownloadsEnabled(false);
    updateChipCounts();
    showTab("validate");

    // Load initial spec without top-level await
    loadSpec(getActiveProfile())
      .then(() => {
        renderSpecGrid();
        updateChipCounts();
      })
      .catch((e) => console.error("Failed to load spec:", e));

    initValidate();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    on(document, "DOMContentLoaded", boot);
  }
})();
