/* static/app.js - FIXED VERSION */

(function () {
  "use strict";

  // -------------------- Utilities --------------------
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

  // -------------------- State --------------------
  let SPEC_FIELDS = [];
  let ACTIVE_PROFILE = "general";
  let CURRENT_FILE = null;
  let CURRENT_FILENAME = "";
  let CURRENT_ENCODING = "utf-8";
  let CURRENT_DELIM = "";

  // -------------------- Spec Loading --------------------
  async function loadSpec(profile) {
    const p = (profile || ACTIVE_PROFILE || "general").trim();
    try {
      const res = await fetch(`/api/spec?profile=${encodeURIComponent(p)}`);
      if (!res.ok) throw new Error(`Spec load failed: ${res.status}`);
      SPEC_FIELDS = await res.json();
      console.log(`Loaded ${SPEC_FIELDS.length} fields for profile: ${p}`);
    } catch (err) {
      console.error("Failed to load spec:", err);
      SPEC_FIELDS = [];
    }
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

  function renderSpecGrid() {
    const specGrid = $("#spec-grid");
    if (!specGrid) return;
    
    const fields = Array.isArray(SPEC_FIELDS) ? sortSpecByImportance(SPEC_FIELDS) : [];
    
    if (fields.length === 0) {
      specGrid.innerHTML = '<p class="muted" style="padding: 20px;">Loading specification...</p>';
      return;
    }

    specGrid.innerHTML = fields
      .map((field) => {
        const name = field?.name || "";
        const importance = (field?.importance || "optional").toLowerCase();
        const badgeLabel = importance.charAt(0).toUpperCase() + importance.slice(1);
        const description = field?.description || field?.desc || "";
        let dependencyText = field?.dependencies || "No additional dependencies.";
        
        return `
          <button type="button" class="spec-card" data-field="${esc(name)}" data-importance="${esc(importance)}">
            <div class="spec-card__title">${esc(name)}</div>
            <div class="spec-card__badge badge badge-${esc(importance)}">${esc(badgeLabel)}</div>
            <div class="spec-card__desc">${esc(description)}</div>
            <div class="spec-card__deps">${esc(dependencyText)}</div>
          </button>
        `;
      })
      .join("");
  }

  // -------------------- Tabs --------------------
  function showTab(name) {
    const panelId = name === "spec" ? "panel-spec" : "panel-validate";
    
    // Hide all panels
    $$("[role='tabpanel']").forEach((p) => p.classList.add("hidden"));
    
    // Show target panel
    const targetPanel = $(`#${panelId}`);
    if (targetPanel) targetPanel.classList.remove("hidden");
    
    // Update tab states
    $$("[role='tab']").forEach((t) => t.setAttribute("aria-selected", "false"));
    const activeTab = name === "spec" ? $("#tab-spec") : $("#tab-validate");
    if (activeTab) activeTab.setAttribute("aria-selected", "true");
  }

  function initTabs() {
    on($("#tab-validate"), "click", (e) => {
      e.preventDefault();
      showTab("validate");
    });
    
    on($("#tab-spec"), "click", (e) => {
      e.preventDefault();
      showTab("spec");
    });
    
    // Show validate tab by default
    showTab("validate");
  }

  // -------------------- File Selection --------------------
  function updateSelectedFile() {
    const el = $("#selected-file");
    if (el) {
      el.textContent = CURRENT_FILENAME ? CURRENT_FILENAME : "No file selected yet.";
    }
  }

  function handleFileSelection(file) {
    if (!file) return;
    CURRENT_FILE = file;
    CURRENT_FILENAME = file.name;
    updateSelectedFile();
    console.log("File selected:", file.name);
  }

  // -------------------- Drag & Drop --------------------
  function initDragAndDrop() {
    const dropZone = $("#drop-zone");
    const fileInput = $("#file-input");
    
    if (!dropZone || !fileInput) {
      console.error("Drop zone or file input not found");
      return;
    }

    // File input change
    on(fileInput, "change", (e) => {
      const file = e.target?.files?.[0];
      if (file) handleFileSelection(file);
    });

    // Click to browse
    on(dropZone, "click", (e) => {
      if (e.target !== fileInput) {
        e.preventDefault();
        fileInput.click();
      }
    });

    // Drag events
    on(dropZone, "dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragging");
    });

    on(dropZone, "dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragging");
    });

    on(dropZone, "drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragging");
      
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        handleFileSelection(file);
        // Sync with file input
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
        } catch (err) {
          console.warn("Could not sync file input:", err);
        }
      }
    });

    console.log("Drag & drop initialized");
  }

  // -------------------- Browse Button --------------------
  function initBrowseButton() {
    const browseBtn = $("#btn-browse");
    const fileInput = $("#file-input");
    
    if (browseBtn && fileInput) {
      on(browseBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });
    }
  }

  // -------------------- Validation --------------------
  function clearResults() {
    const tbody = $("#issues-body");
    if (tbody) tbody.innerHTML = "";
    
    const noIssues = $("#no-issues");
    if (noIssues) noIssues.classList.add("hidden");
    
    const noResults = $("#no-results");
    if (noResults) noResults.classList.remove("hidden");
    
    setCountersDisplay(0, 0, 0);
    setDownloadsEnabled(false);
  }

  function setCountersDisplay(errors, warnings, opportunities) {
    const counters = [
      ["counter-errors", errors],
      ["counter-warnings", warnings],
      ["counter-opportunities", opportunities],
      ["count-errors", errors],
      ["count-warnings", warnings],
      ["count-opportunities", opportunities],
      ["count-all", errors + warnings + opportunities],
      ["count-error", errors],
      ["count-warning", warnings],
      ["count-opportunity", opportunities]
    ];
    
    counters.forEach(([id, value]) => {
      const el = $(`#${id}`);
      if (el) el.textContent = String(value ?? 0);
    });
  }

  function setDownloadsEnabled(enabled) {
    const btnIds = ["btn-noissues-json", "btn-noissues-csv", "btn-download-json", "btn-download-csv"];
    btnIds.forEach((id) => {
      const btn = $(`#${id}`);
      if (btn) btn.disabled = !enabled;
    });
  }

  function renderIssues(issues) {
    const tbody = $("#issues-body");
    if (!tbody) return;
    
    tbody.innerHTML = (issues || [])
      .map((issue, idx) => {
        const row = issue?.row_index ?? idx + 1;
        const itemId = issue?.item_id || "";
        const field = issue?.field || "";
        const ruleId = issue?.rule_id || "";
        const severity = issue?.severity || "";
        const message = issue?.message || "";
        const sample = issue?.sample_value || "";
        
        return `
          <tr>
            <td class="col-index">${esc(row)}</td>
            <td class="col-item">${esc(itemId)}</td>
            <td>${esc(field)}</td>
            <td>${esc(ruleId)}</td>
            <td class="sev-${esc(severity)}">${esc(severity)}</td>
            <td>${esc(message)}</td>
            <td>${esc(sample)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function showValidationError(message) {
    alert(`Validation failed: ${message}`);
  }

  async function doValidate() {
    const fileInput = $("#file-input");
    const delimiterInput = $("#delimiter");
    const encodingInput = $("#encoding");
    const profileSelect = $("#profile-select");

    const file = fileInput?.files?.[0] || CURRENT_FILE;
    if (!file) {
      alert("Please select a file first");
      return;
    }

    clearResults();

    const formData = new FormData();
    formData.append("file", file);
    formData.append("encoding", encodingInput?.value || "utf-8");
    formData.append("delimiter", delimiterInput?.value || "");
    formData.append("profile", profileSelect?.value || "general");

    try {
      const response = await fetch("/validate/file", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Process results
      const issues = data?.issues || [];
      const summary = data?.summary || {};
      
      const errorCount = summary.items_with_errors || 0;
      const warningCount = summary.items_with_warnings || 0;
      const oppCount = summary.items_with_opportunities || 0;

      setCountersDisplay(errorCount, warningCount, oppCount);
      renderIssues(issues);

      const noIssues = $("#no-issues");
      const noResults = $("#no-results");
      
      if (issues.length === 0) {
        if (noIssues) noIssues.classList.remove("hidden");
        if (noResults) noResults.classList.add("hidden");
      } else {
        if (noIssues) noIssues.classList.add("hidden");
        if (noResults) noResults.classList.add("hidden");
      }

      setDownloadsEnabled(true);
      
      console.log("Validation complete:", {
        total: summary.items_total,
        errors: errorCount,
        warnings: warningCount,
        opportunities: oppCount
      });

    } catch (err) {
      console.error("Validation error:", err);
      showValidationError(err.message);
    }
  }

  function initValidate() {
    const validateBtn = $("#btn-validate-file");
    if (validateBtn) {
      on(validateBtn, "click", (e) => {
        e.preventDefault();
        doValidate();
      });
    }
  }

  // -------------------- Profile Selector --------------------
  function initProfileSelector() {
    const profileSelect = $("#profile-select");
    if (!profileSelect) return;

    on(profileSelect, "change", async () => {
      ACTIVE_PROFILE = profileSelect.value || "general";
      await loadSpec(ACTIVE_PROFILE);
      renderSpecGrid();
    });
  }

  // -------------------- Footer Year --------------------
  function initYear() {
    const yearEl = $("#year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  }

  // -------------------- Main Initialization --------------------
  async function init() {
    console.log("Initializing app...");
    
    initYear();
    initTabs();
    initProfileSelector();
    initDragAndDrop();
    initBrowseButton();
    initValidate();
    updateSelectedFile();
    setDownloadsEnabled(false);

    // Load initial spec
    await loadSpec("general");
    renderSpecGrid();
    
    console.log("App initialized successfully");
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
