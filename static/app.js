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
  const delimiterInput = $("#delimiter");
  const encodingInput = $("#encoding");

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
  const resultsErrors = $("#results-errors");
  const resultsWarnings = $("#results-warnings");
  const resultsOpps = $("#results-opps");
  const resultsCard = $("#resultsCard");

  function renderIssues(container, issues, countEl){
    const list = issues || [];
    if(countEl){
      countEl.textContent = String(list.length);
    }
    container.innerHTML = "";
    if(!list.length){
      container.innerHTML = '<div class="empty">None 🎉</div>';
      return;
    }
    for(const it of list){
      const row = document.createElement("article");
      row.className = "issue-row";
      const field = escapeHtml(it.field || "");
      const message = escapeHtml(it.message || "");
      row.innerHTML = `
        <header class="issue-header">
          <span class="issue-pill">Row ${it.row ?? "-"}</span>
          ${field ? `<code class="issue-field">${field}</code>` : ""}
        </header>
        <p class="issue-message">${message}</p>
      `;
      container.appendChild(row);
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
    const f = currentFile();
    if(!f){ alert("Choose a file first."); return; }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("profile", profile());
    const delimiter = delimiterInput?.value?.trim();
    if(delimiter){ fd.append("delimiter", delimiter); }
    const encoding = encodingInput?.value?.trim();
    if(encoding){ fd.append("encoding", encoding); }
    const endpoint = kind === "csv" ? "/api/validate-csv" : "/api/validate-json";
    resultsCard?.classList.add("hidden");
    markStep(2);
    setLoading(true);
    latestBuckets = {errors: [], warnings: [], opportunities: []};
    latestIssues = [];
    try{
      const res = await fetch(endpoint, {method:"POST", body: fd});
      if(!res.ok) throw new Error(await res.text() || "Validation failed");
      const data = await res.json();
      renderIssues(resultsErrors, data.errors);
      renderIssues(resultsWarnings, data.warnings);
      renderIssues(resultsOpps, data.opportunities);
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
