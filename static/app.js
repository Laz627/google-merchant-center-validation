(function(){
  const $ = (q, ctx=document) => ctx.querySelector(q);
  const $$ = (q, ctx=document) => Array.from(ctx.querySelectorAll(q));

  // Tabs
  const toggles = $$(".tab");
  const panels = $$(".panel");
  function showTab(tab){
    toggles.forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
    panels.forEach(p => {
      const on = p.getAttribute("data-panel") === tab;
      p.hidden = !on;
      p.classList.toggle("visible", on);
    });
  }
  toggles.forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
  showTab("validate");

  // Profile
  const profileSelect = $(".profile-select");
  function profile(){ return profileSelect?.value || "general"; }

  // Drag & drop
  const dz = $("#dropZone");
  const fileInput = $("#fileInput");
  const fileName = $("#fileName");

  function updateSelectedFile(){
    const name = fileInput?.files?.[0]?.name;
    fileName.textContent = name || "No file selected yet.";
    markStep(name ? 2 : 1);
  }

  dz?.addEventListener("click", ()=> fileInput?.click());
  dz?.addEventListener("keydown", e => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      fileInput?.click();
    }
  });
  fileInput?.addEventListener("change", updateSelectedFile);

  ["dragenter","dragover"].forEach(evt => dz?.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add("dragging");
  }));
  ["dragleave","drop"].forEach(evt => dz?.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove("dragging");
  }));
  dz?.addEventListener("drop", e => {
    const f = e.dataTransfer.files?.[0];
    if(f){
      fileInput.files = e.dataTransfer.files;
      updateSelectedFile();
    }
  });

  // Results
  const resultsSummary = $("#resultsSummary");
  const resultsHeading = $("#resultsHeading");
  const resultsCard = $("#resultsCard");
  const resultsTableBody = $("#resultsTableBody");
  const resultsEmptyState = $("#resultsEmptyState");
  const visibleCount = $("#visibleCount");
  const filterButtons = $$(".results-toolbar .chip");
  const filterCounts = {
    all: $("#filterAllCount"),
    errors: $("#filterErrorsCount"),
    warnings: $("#filterWarningsCount"),
    opportunities: $("#filterOppsCount")
  };
  const downloadJsonBtn = $("#downloadJson");
  const downloadCsvBtn = $("#downloadCsv");

  const severityLookup = {
    errors: "Error",
    warnings: "Warning",
    opportunities: "Opportunity"
  };

  let latestBuckets = {errors: [], warnings: [], opportunities: []};
  let latestIssues = [];
  let activeFilter = "all";

  function updateFilters(){
    const counts = {
      errors: latestBuckets.errors.length,
      warnings: latestBuckets.warnings.length,
      opportunities: latestBuckets.opportunities.length
    };
    const total = counts.errors + counts.warnings + counts.opportunities;
    if(filterCounts.all) filterCounts.all.textContent = total;
    if(filterCounts.errors) filterCounts.errors.textContent = counts.errors;
    if(filterCounts.warnings) filterCounts.warnings.textContent = counts.warnings;
    if(filterCounts.opportunities) filterCounts.opportunities.textContent = counts.opportunities;
    if(downloadJsonBtn) downloadJsonBtn.disabled = total === 0;
    if(downloadCsvBtn) downloadCsvBtn.disabled = total === 0;
    if(visibleCount){
      visibleCount.textContent = `${getFilteredIssues(activeFilter).length} items shown`;
    }
  }

  function getFilteredIssues(filter){
    if(filter === "all") return latestIssues;
    const severity = severityLookup[filter];
    return latestIssues.filter(issue => issue.severity === severity);
  }

  function renderTable(filter="all"){
    activeFilter = filter;
    const filtered = getFilteredIssues(filter);
    if(resultsTableBody){
      resultsTableBody.innerHTML = "";
      for(const issue of filtered){
        const tr = document.createElement("tr");
        const severityClass = (issue.severity || "").toLowerCase();
        tr.innerHTML = `
          <td>${escapeHtml(issue.row ?? "-")}</td>
          <td>${escapeHtml(issue.item_id || "")}</td>
          <td>${escapeHtml(issue.item_title || "")}</td>
          <td>${escapeHtml(issue.field || "")}</td>
          <td><span class="severity-badge ${escapeHtml(severityClass)}">${escapeHtml(issue.severity || "")}</span></td>
          <td class="message">${escapeHtml(issue.message || "")}</td>
          <td class="value">${escapeHtml(issue.value === undefined || issue.value === null ? "" : String(issue.value))}</td>
        `;
        resultsTableBody.appendChild(tr);
      }
    }
    if(resultsEmptyState){
      resultsEmptyState.classList.toggle("hidden", filtered.length > 0);
    }
    if(visibleCount){
      visibleCount.textContent = `${filtered.length} items shown`;
    }
    filterButtons.forEach(btn => {
      const isActive = btn.dataset.filter === filter;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      renderTable(btn.dataset.filter || "all");
    });
  });

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  downloadJsonBtn?.addEventListener("click", () => {
    if(!latestIssues.length) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      profile: profile(),
      issues: latestIssues
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
    downloadBlob(blob, "gmc-validation-issues.json");
  });

  downloadCsvBtn?.addEventListener("click", () => {
    if(!latestIssues.length) return;
    const header = ["row","item_id","item_title","field","severity","message","value"];
    const rows = latestIssues.map(issue => header.map(key => {
      const val = issue[key] === undefined || issue[key] === null ? "" : String(issue[key]);
      return `"${val.replace(/"/g,'""')}"`;
    }).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], {type: "text/csv"});
    downloadBlob(blob, "gmc-validation-issues.csv");
  });

  function escapeHtml(str){
    const text = str == null ? "" : String(str);
    return text.replace(/[&<>"']/g, s=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[s]));
  }

  async function validate(kind){
    const f = fileInput.files?.[0];
    if(!f){ alert("Choose a file first."); return; }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("profile", profile());
    const endpoint = kind === "csv" ? "/api/validate-csv" : "/api/validate-json";
    resultsCard?.classList.add("hidden");
    markStep(2);
    setLoading(true);
    try{
      const res = await fetch(endpoint, {method:"POST", body: fd});
      if(!res.ok) throw new Error(await res.text() || "Validation failed");
      const data = await res.json();
      latestBuckets = {
        errors: data.errors || [],
        warnings: data.warnings || [],
        opportunities: data.opportunities || []
      };
      latestIssues = [
        ...latestBuckets.errors,
        ...latestBuckets.warnings,
        ...latestBuckets.opportunities
      ];
      updateFilters();
      renderTable(activeFilter);
      if(resultsSummary){
        const err = latestBuckets.errors.length;
        const warn = latestBuckets.warnings.length;
        const opp = latestBuckets.opportunities.length;
        const parts = [
          err ? `${err} ${err===1?"error":"errors"}` : null,
          warn ? `${warn} ${warn===1?"warning":"warnings"}` : null,
          opp ? `${opp} ${opp===1?"opportunity":"opportunities"}` : null
        ].filter(Boolean);
        resultsSummary.textContent = parts.length
          ? `Found ${parts.join(", ")}. Prioritize errors, then warnings.`
          : "No blocking issues found. Review opportunities to improve feed quality.";
      }
      if(resultsHeading){
        resultsHeading.textContent = latestIssues.length ? "Validation complete." : "No issues detected.";
      }
      markStep(3);
      resultsCard?.classList.remove("hidden");
    }catch(e){
      alert(e.message || String(e));
    }finally{
      setLoading(false);
    }
  }

  function setLoading(is){
    document.body.classList.toggle("loading", is);
  }

  // Stepper visuals
  const stepEls = $$(".flow-steps .step");
  function markStep(n){ // 1..3
    stepEls.forEach((s, i) => {
      s.classList.toggle("current", i === n - 1);
      s.classList.toggle("complete", i < n - 1);
    });
  }
  markStep(1);

  $("#runCsv")?.addEventListener("click", ()=> validate("csv"));
  $("#runJson")?.addEventListener("click", ()=> validate("json"));
})();
