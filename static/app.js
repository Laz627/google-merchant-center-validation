
(function(){
  function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  const $ = (q, ctx=document)=>ctx.querySelector(q);
  const $$ = (q, ctx=document)=>Array.from(ctx.querySelectorAll(q));
  const esc = s => (s||"").replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Attribute catalog (US/English GMC)
  const GMC_SPEC = [
    // General
    {name:"id", status:"required", profile:"general", desc:"Unique product ID; stable across updates; ≤ 50 chars."},
    {name:"title", status:"required", profile:"general", desc:"≤ 150 chars; match PDP title; no promo/ALL CAPS."},
    {name:"description", status:"required", profile:"general", desc:"Plain text ≤ 5000; match PDP; no links/competitors."},
    {name:"link", status:"required", profile:"general", desc:"Canonical product URL on verified domain."},
    {name:"image_link", status:"required", profile:"general", desc:"Primary image URL; no borders/watermarks."},
    {name:"availability", status:"required", profile:"general", desc:"in_stock | out_of_stock | preorder | backorder."},
    {name:"price", status:"required", profile:"general", desc:"Format '<amount> <ISO4217>' (e.g., 15.00 USD)."},
    {name:"availability_date", status:"conditional", profile:"general", desc:"Required when availability=preorder (ISO-8601)."},
    {name:"brand", status:"conditional", profile:"general", desc:"Required for many new products (not media/books/music)."},
    {name:"gtin", status:"conditional", profile:"general", desc:"GS1 GTIN (UPC/EAN/JAN/ISBN/ITF-14). Strongly recommended."},
    {name:"mpn", status:"conditional", profile:"general", desc:"If no GTIN, provide brand+mpn."},
    {name:"additional_image_link", status:"recommended", profile:"general", desc:"Up to 10 extra images; lifestyle allowed."},
    {name:"mobile_link", status:"recommended", profile:"general", desc:"Mobile-optimized product URL (if used)."},
    {name:"sale_price", status:"recommended", profile:"general", desc:"Sale price formatted like price."},
    {name:"sale_price_effective_date", status:"recommended", profile:"general", desc:"ISO-8601 'start/end' window."},
    {name:"google_product_category", status:"recommended", profile:"general", desc:"Google taxonomy ID/path; most specific."},
    {name:"product_type", status:"recommended", profile:"general", desc:"Your taxonomy breadcrumb."},
    {name:"identifier_exists", status:"recommended", profile:"general", desc:"Set 'no' only if brand/gtin/mpn truly don't exist."},
    {name:"unit_pricing_measure", status:"recommended", profile:"general", desc:"e.g., 150ml; with base measure for unit price."},
    {name:"unit_pricing_base_measure", status:"recommended", profile:"general", desc:"e.g., 100ml; base for unit price."},
    {name:"shipping_weight", status:"recommended", profile:"general", desc:"Needed for carrier-calculated shipping."},
    {name:"shipping_length", status:"recommended", profile:"general", desc:"Dims for carrier calc. in/cm."},
    {name:"shipping_width", status:"recommended", profile:"general", desc:"Dims for carrier calc. in/cm."},
    {name:"shipping_height", status:"recommended", profile:"general", desc:"Dims for carrier calc. in/cm."},

    // Apparel
    {name:"color", status:"required", profile:"apparel", desc:"Required for Apparel in many markets."},
    {name:"gender", status:"required", profile:"apparel", desc:"male | female | unisex."},
    {name:"age_group", status:"required", profile:"apparel", desc:"newborn | infant | toddler | kids | adult."},
    {name:"size", status:"required", profile:"apparel", desc:"Required for Clothing & Shoes."},
    {name:"item_group_id", status:"conditional", profile:"apparel", desc:"Required when variants exist."},
    {name:"size_type", status:"recommended", profile:"apparel", desc:"regular | petite | maternity | big | tall | plus."},
    {name:"size_system", status:"recommended", profile:"apparel", desc:"US | UK | EU | DE | FR | JP | CN | IT | BR | MEX | AU."},
    {name:"material", status:"recommended", profile:"apparel", desc:"e.g., cotton/polyester/elastane."},
    {name:"pattern", status:"recommended", profile:"apparel", desc:"e.g., striped / polka dot / paisley."},

    // Local Inventory
    {name:"store_code", status:"required", profile:"local_inventory", desc:"Must match store feed store_code."},
    {name:"quantity", status:"recommended", profile:"local_inventory", desc:"On-hand inventory count."},
    {name:"pickup_method", status:"recommended", profile:"local_inventory", desc:"buy | reserve (per LI setup)."},
    {name:"pickup_sla", status:"recommended", profile:"local_inventory", desc:"same_day (etc., per LI setup)."},
    {name:"link", status:"recommended", profile:"local_inventory", desc:"Product URL (recommended for LI feeds)."},
    {name:"price", status:"required", profile:"local_inventory", desc:"Required for LI offers; '<amount> <ISO4217>'."},
    {name:"availability", status:"required", profile:"local_inventory", desc:"in_stock | out_of_stock | preorder | backorder."},
    {name:"sale_price", status:"conditional", profile:"local_inventory", desc:"If on sale, provide sale_price."}
  ];

  function showTab(tab){
    $$('.toggle').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    $$('.tabpane').forEach(p => { const on = p.dataset.panel===tab; p.hidden=!on; p.classList.toggle('active', on); });
  }

  function renderIssues(container, issues, countEl){
    const list = Array.isArray(issues)?issues:[];
    if(countEl) countEl.textContent = String(list.length);
    container.innerHTML = list.length? "" : '<div class="empty">None 🎉</div>';
    for(const it of list){
      const row = document.createElement("article");
      row.className = "issue-row";
      row.innerHTML = `
        <header class="issue-header">
          <span class="issue-pill">Row ${it.row ?? "-"}</span>
          ${it.field ? `<code class="issue-field">${esc(it.field)}</code>`: ""}
        </header>
        <p class="issue-message">${esc(it.message||"")}</p>`;
      container.appendChild(row);
    }
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
    renderIssues($('#results-errors'), data.errors, $('#countErrors'));
    renderIssues($('#results-warnings'), data.warnings, $('#countWarnings'));
    renderIssues($('#results-opps'), data.opportunities, $('#countOpps'));
  }

  function renderSpec(){
    const grid = $('#specGrid'); if(!grid) return;
    const q = ($('#specSearch')?.value||'').toLowerCase().trim();
    const profile = ($('.profile-select')?.value)||'general';
    const allowed = new Set($$('.status-filter input:checked').map(i=>i.value));
    const rows = GMC_SPEC.filter(a => (a.profile===profile || (profile==='general' && a.profile==='general'))
      && allowed.has(a.status)
      && (!q || a.name.includes(q) || (a.desc||'').toLowerCase().includes(q)));

    grid.innerHTML = "";
    for(const a of rows){
      const badge = a.status.toUpperCase();
      const cls = a.status==='required' ? 'required' : a.status==='conditional' ? 'conditional' : 'recommended';
      const card = document.createElement('article');
      card.className = 'spec-card';
      card.innerHTML = `<div class="badge ${cls}">${badge}</div>
                        <h5 class="field-name"><code>${esc(a.name)}</code></h5>
                        <p class="field-desc">${esc(a.desc||"")}</p>
                        <div class="field-meta"><span class="meta-pill">${esc(a.profile.replace('_',' '))}</span></div>`;
      grid.appendChild(card);
    }
    const specCount = $('#specCount'); if(specCount) specCount.textContent = String(rows.length);
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

    renderSpec();
  });
})();
