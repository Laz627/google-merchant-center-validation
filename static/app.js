
(function(){
  function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  const $ = (q, ctx=document)=>ctx.querySelector(q);
  const $$ = (q, ctx=document)=>Array.from(ctx.querySelectorAll(q));
  const esc = s => (s||"").replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let SPEC = null;

  function showTab(tab){
    $$('.toggle').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    $$('.tabpane').forEach(p => { const on = p.dataset.panel===tab; p.hidden=!on; p.classList.toggle('active', on); });
  }

  function setCounts(e,w,o){
    $('#countErrors').textContent = String(e||0);
    $('#countWarnings').textContent = String(w||0);
    $('#countOpps').textContent = String(o||0);
  }

  function renderTable(data){
    const body = $('#results-body');
    body.innerHTML = "";
    const all = []
      .concat((data.errors||[]))
      .concat((data.warnings||[]))
      .concat((data.opportunities||[]));
    if(!all.length){
      body.innerHTML = '<tr class="empty"><td colspan="4">No issues found 🎉</td></tr>';
      setCounts(0,0,0);
      return;
    }
    let e=0,w=0,o=0;
    for(const it of all){
      if(it.severity==='error') e++;
      else if(it.severity==='warning') w++;
      else o++;
      const tr = document.createElement('tr');
      const sev = it.severity || 'opportunity';
      tr.innerHTML = `
        <td>${esc(String(it.row ?? '-'))}</td>
        <td><code>${esc(it.field||'')}</code></td>
        <td class="${sev==='error'?'sev-error':sev==='warning'?'sev-warning':'sev-opportunity'}">${esc(sev)}</td>
        <td>${esc(it.message||'')}</td>
      `;
      body.appendChild(tr);
    }
    setCounts(e,w,o);
  }

  async function validate(kind){
    const file = $('#fileInput')?.files?.[0];
    if(!file){ alert("Choose a file first."); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('profile', ($('.profile-select')?.value)||'general');
    const url = kind==='csv' ? '/api/validate-csv' : '/api/validate-json';
    const res = await fetch(url, { method:'POST', body: fd });
    if(!res.ok) throw new Error(await res.text()||'Validation failed');
    const data = await res.json();
    renderTable(data);
  }

  async function loadSpec(){
    const res = await fetch('/api/spec');
    SPEC = await res.json();
    renderSpec();
  }

  function renderSpec(){
    if(!SPEC) return;
    const grid = $('#specGrid');
    const q = ($('#specSearch')?.value||'').toLowerCase().trim();
    const profile = ($('.profile-select')?.value)||'general';
    const allowed = new Set($$('.status-filter input:checked').map(i=>i.value));
    const rows = SPEC.attributes.filter(a =>
      (a.profiles||[]).includes(profile) &&
      allowed.has(a.status) &&
      (!q || a.name.toLowerCase().includes(q) || (a.desc||'').toLowerCase().includes(q))
    );
    grid.innerHTML = "";
    for(const a of rows){
      const badge = a.status.toUpperCase();
      const cls = a.status;
      const ex = (a.examples && a.examples.length) ? `<div class="field-meta"><span class="meta-pill">e.g., ${esc(a.examples[0])}</span></div>` : "";
      const syn = a.syntax ? `<div class="field-meta"><span class="meta-pill">syntax: ${esc(a.syntax)}</span></div>` : "";
      const card = document.createElement('article');
      card.className = 'spec-card';
      card.innerHTML = `<div class="badge ${esc(cls)}">${badge}</div>
                        <h5 class="field-name"><code>${esc(a.name)}</code></h5>
                        <p class="field-desc">${esc(a.desc||"")}</p>
                        ${syn}${ex}`;
      grid.appendChild(card);
    }
    $('#specCount').textContent = String(rows.length);
  }

  function initDnD(){
    const dz = $('#dropZone');
    const fi = $('#fileInput');
    function setOver(v){ dz.classList.toggle('dragover', !!v); }
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); setOver(true); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, (e)=>{ e.preventDefault(); e.stopPropagation(); setOver(false); }));
    dz.addEventListener('drop', (e)=>{
      const files = e.dataTransfer.files;
      if(files && files.length){ fi.files = files; $('#fileName').textContent = files[0].name; }
    });
    dz.addEventListener('paste', (e)=>{
      const items = e.clipboardData?.files;
      if(items && items.length){ fi.files = items; $('#fileName').textContent = items[0].name; }
    });
  }

  ready(function(){
    $$('.toggle').forEach(b => b.addEventListener('click', ()=>showTab(b.dataset.tab)));
    showTab('validate');

    $('#browseBtn')?.addEventListener('click', ()=>$('#fileInput').click());
    $('#fileInput')?.addEventListener('change', ()=>{$('#fileName').textContent = $('#fileInput').files[0]?.name || 'No file selected yet.'});
    $('#runCsv')?.addEventListener('click', ()=>validate('csv').catch(e=>alert(e.message||String(e))));
    $('#runJson')?.addEventListener('click', ()=>validate('json').catch(e=>alert(e.message||String(e))));

    $$('.status-filter input').forEach(i=> i.addEventListener('change', renderSpec));
    $('#specSearch')?.addEventListener('input', renderSpec);
    $$('.profile-select').forEach(s=> s.addEventListener('change', renderSpec));

    initDnD();
    loadSpec();
  });
})();
