(function(){
  const $ = (q, ctx=document) => ctx.querySelector(q);
  const $$ = (q, ctx=document) => Array.from(ctx.querySelectorAll(q));

  // Tabs
  const toggles = $$(".toggle");
  const panels = $$(".panel");
  function showTab(tab){
    toggles.forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
    panels.forEach(p => {
      const on = p.getAttribute("data-panel") === tab;
      p.hidden = !on;
      p.classList.toggle("active", on);
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
  const browseBtn = $("#browseBtn");
  const fileName = $("#fileName");

  browseBtn?.addEventListener("click", ()=> fileInput.click());
  fileInput?.addEventListener("change", ()=> {
    fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : "No file selected yet.";
  });

  ["dragenter","dragover"].forEach(evt => dz?.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add("hover");
  }));
  ["dragleave","drop"].forEach(evt => dz?.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove("hover");
  }));
  dz?.addEventListener("drop", e => {
    const f = e.dataTransfer.files?.[0];
    if(f){ fileInput.files = e.dataTransfer.files; fileName.textContent = f.name; }
  });

  // Results
  const resultsErrors = $("#results-errors");
  const resultsWarnings = $("#results-warnings");
  const resultsOpps = $("#results-opps");

  function renderIssues(container, issues){
    container.innerHTML = "";
    if(!issues || !issues.length){
      container.innerHTML = '<div class="empty">None 🎉</div>';
      return;
    }
    for(const it of issues){
      const row = document.createElement("div");
      row.className = "issue-row";
      row.innerHTML = `
        <div class="badge">Row ${it.row ?? "-"}</div>
        <div class="field"><code>${escapeHtml(it.field||"")}</code></div>
        <div class="msg">${escapeHtml(it.message||"")}</div>
      `;
      container.appendChild(row);
    }
  }

  function escapeHtml(str){
    return (str||"").replace(/[&<>"']/g, s=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[s]));
  }

  async function validate(kind){
    const f = fileInput.files?.[0];
    if(!f){ alert("Choose a file first."); return; }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("profile", profile());
    const endpoint = kind === "csv" ? "/api/validate-csv" : "/api/validate-json";
    setLoading(true);
    try{
      const res = await fetch(endpoint, {method:"POST", body: fd});
      if(!res.ok) throw new Error(await res.text() || "Validation failed");
      const data = await res.json();
      renderIssues(resultsErrors, data.errors);
      renderIssues(resultsWarnings, data.warnings);
      renderIssues(resultsOpps, data.opportunities);
      markStep(2);
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
  const stepEls = $$(".steps .step");
  function markStep(n){ // 1..3
    stepEls.forEach((s, i) => s.classList.toggle("active", i < n));
  }

  $("#runCsv")?.addEventListener("click", ()=> validate("csv"));
  $("#runJson")?.addEventListener("click", ()=> validate("json"));
})();
