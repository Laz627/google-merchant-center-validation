
// =======================
// static/app.js (GMC)
// =======================
(function(){
  const $ = (q, ctx=document) => ctx.querySelector(q);
  const $$ = (q, ctx=document) => Array.from(ctx.querySelectorAll(q));

  const profileSelects = $$(".profile-select");
  const csvForm = $("#csvForm");
  const jsonForm = $("#jsonForm");
  const csvInput = $("#csvFile");
  const jsonInput = $("#jsonFile");

  const resultsErrors = $("#results-errors");
  const resultsWarnings = $("#results-warnings");
  const resultsOpps = $("#results-opps");

  function currentProfile(){
    // both forms share the same profile select value
    return profileSelects[0]?.value || "general";
  }

  function renderIssues(container, issues){
    container.innerHTML = "";
    if(!issues || !issues.length){
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "None 🎉";
      container.appendChild(el);
      return;
    }
    for(const it of issues){
      const row = document.createElement("div");
      row.className = "issue-row";
      row.innerHTML = `
        <div class="col col-row">Row ${it.row ?? "-"}</div>
        <div class="col col-field"><code>${(it.field||"")}</code></div>
        <div class="col col-msg">${escapeHtml(it.message||"")}</div>
      `;
      container.appendChild(row);
    }
  }

  function escapeHtml(str){
    return (str||"").replace(/[&<>"']/g, s=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[s]));
  }

  async function handleSubmit(form, endpoint, fileInput){
    const file = fileInput.files[0];
    if(!file){ alert("Please choose a file first."); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("profile", currentProfile());

    setLoading(true);
    try{
      const res = await fetch(endpoint, { method: "POST", body: fd });
      if(!res.ok){
        const msg = await res.text();
        throw new Error(msg || "Validation failed");
      }
      const data = await res.json();
      renderIssues(resultsErrors, data.errors);
      renderIssues(resultsWarnings, data.warnings);
      renderIssues(resultsOpps, data.opportunities);
    }catch(e){
      alert(e.message || String(e));
    }finally{
      setLoading(false);
    }
  }

  function setLoading(is){
    const btns = $$("button[type=submit]");
    btns.forEach(b => b.disabled = is);
    document.body.classList.toggle("loading", is);
  }

  csvForm?.addEventListener("submit", (e)=>{
    e.preventDefault();
    handleSubmit(csvForm, "/api/validate-csv", csvInput);
  });
  jsonForm?.addEventListener("submit", (e)=>{
    e.preventDefault();
    handleSubmit(jsonForm, "/api/validate-json", jsonInput);
  });

  // Spec accordion
  $$(".spec-toggle").forEach(t => {
    t.addEventListener("click", ()=>{
      const target = t.getAttribute("data-target");
      const el = $(target);
      if(el) el.classList.toggle("open");
    });
  });
})();
