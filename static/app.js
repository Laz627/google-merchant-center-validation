/* static/app.js - Final Working Version */

(function() {
  'use strict';
  
  console.log('App.js loading...');
  
  // State
  let specFields = [];
  let allSpecData = {};
  let currentFile = null;
  let currentFilename = '';
  let activeSpecProfile = 'general';
  let activeSpecImportance = 'all';
  let activeSpecSearch = '';
  let validationIssues = [];
  let activeIssueSeverity = 'all';
  let activeIssueSearch = '';
  
  // Helper functions
  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.from(document.querySelectorAll(selector));
  }
  
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  // Load specification from API
  async function loadSpec(profile) {
    try {
      console.log('Loading spec for profile:', profile);
      const response = await fetch(`/api/spec?profile=${profile || 'general'}`);
      if (!response.ok) throw new Error('Failed to load spec');
      const data = await response.json();
      
      // Store in appropriate profile
      allSpecData[profile] = data;
      
      // Set active and render
      specFields = data;
      activeSpecProfile = profile;
      console.log('Loaded', specFields.length, 'fields for', profile);
      
      updateSpecCounts();
      renderSpecCards();
    } catch (err) {
      console.error('Error loading spec:', err);
    }
  }
  
  // Update spec field counts
  function updateSpecCounts() {
    if (!specFields || specFields.length === 0) return;
    
    const counts = {
      all: specFields.length,
      required: specFields.filter(f => f.importance === 'required').length,
      conditional: specFields.filter(f => f.importance === 'conditional').length,
      recommended: specFields.filter(f => f.importance === 'recommended').length,
      optional: specFields.filter(f => f.importance === 'optional').length
    };
    
    console.log('Spec counts:', counts);
    
    Object.entries(counts).forEach(([key, value]) => {
      const el = $(`#spec-count-${key}`);
      if (el) {
        el.textContent = value;
        console.log(`Updated #spec-count-${key} to ${value}`);
      }
    });
  }
  
  // Filter spec fields
  function filterSpecFields() {
    let filtered = specFields;
    
    // Filter by importance
    if (activeSpecImportance !== 'all') {
      filtered = filtered.filter(f => f.importance === activeSpecImportance);
    }
    
    // Filter by search
    if (activeSpecSearch) {
      const search = activeSpecSearch.toLowerCase();
      filtered = filtered.filter(f => 
        (f.name || '').toLowerCase().includes(search) ||
        (f.description || '').toLowerCase().includes(search) ||
        (f.dependencies || '').toLowerCase().includes(search)
      );
    }
    
    return filtered;
  }
  
  // Render specification cards
  function renderSpecCards() {
    const grid = $('#spec-grid');
    const noResults = $('#spec-no-results');
    if (!grid) return;
    
    const filtered = filterSpecFields();
    
    console.log('Rendering spec cards. Filtered count:', filtered.length, 'Total:', specFields.length);
    
    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (noResults) noResults.classList.remove('hidden');
      return;
    }
    
    if (noResults) noResults.classList.add('hidden');
    
    // Sort by importance
    const order = { required: 0, conditional: 1, recommended: 2, optional: 3 };
    const sorted = [...filtered].sort((a, b) => {
      const orderA = order[a.importance] ?? 99;
      const orderB = order[b.importance] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    grid.innerHTML = sorted.map(field => {
      const deps = field.dependencies || 'No additional dependencies';
      return `
      <div class="spec-card">
        <div class="spec-card__title">${escapeHtml(field.name)}</div>
        <div class="spec-card__badge badge badge-${escapeHtml(field.importance)}">${escapeHtml(field.importance)}</div>
        <div class="spec-card__desc">${escapeHtml(field.description || '')}</div>
        <div class="spec-card__deps"><strong>Dependencies:</strong> ${escapeHtml(deps)}</div>
      </div>
    `;
    }).join('');
    
    console.log('Rendered', sorted.length, 'spec cards');
  }
  
  // Initialize spec filters
  function initSpecFilters() {
    // Profile filter buttons
    $$('[data-profile]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const profile = btn.dataset.profile;

        // Update active state
        $$('[data-profile]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Load spec for profile
        activeSpecProfile = profile;
        if (!allSpecData[profile]) {
          await loadSpec(profile);
        } else {
          specFields = allSpecData[profile];
          updateSpecCounts();
          renderSpecCards();
        }
        
        // Update validation profile selector too
        const profileSelect = $('#profile-select');
        if (profileSelect) profileSelect.value = profile;
      });
    });
    
    // Importance filter buttons
    $$('[data-importance]').forEach(btn => {
      btn.addEventListener('click', () => {
        const importance = btn.dataset.importance;

        // Update active state
        $$('[data-importance]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Filter and render
        activeSpecImportance = importance;
        renderSpecCards();
      });
    });
    
    // Search input
    const searchInput = $('#spec-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        activeSpecSearch = e.target.value;
        renderSpecCards();
      });
    }
  }
  
  // Tab switching
  function showTab(tabName) {
    console.log('Switching to tab:', tabName);
    
    // Hide all panels
    $$('.panel').forEach(panel => panel.classList.add('hidden'));
    
    // Show target panel
    const panelId = tabName === 'spec' ? 'panel-spec' : 'panel-validate';
    const panel = $(`#${panelId}`);
    if (panel) panel.classList.remove('hidden');
    
    // Update tab buttons
    $$('.tab').forEach(tab => tab.classList.remove('active'));
    const activeTab = tabName === 'spec' ? $('#tab-spec') : $('#tab-validate');
    if (activeTab) activeTab.classList.add('active');
    
    // Initialize spec filters when spec tab is shown
    if (tabName === 'spec' && !window.specFiltersInitialized) {
      console.log('First time showing spec tab, initializing filters...');
      setTimeout(() => {
        initSpecFilters();
        window.specFiltersInitialized = true;
      }, 50);
    }
  }
  
  // File selection
  function updateFileLabel() {
    const label = $('#selected-file');
    if (label) {
      label.textContent = currentFilename || 'No file selected yet.';
    }
  }
  
  function handleFile(file) {
    if (!file) return;
    currentFile = file;
    currentFilename = file.name;
    updateFileLabel();
    console.log('File selected:', file.name);
  }
  
  // Drag and drop
  function initDragDrop() {
    const dropZone = $('#drop-zone');
    const fileInput = $('#file-input');
    
    if (!dropZone || !fileInput) {
      console.error('Drop zone or file input not found');
      return;
    }
    
    // Click to browse
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        e.preventDefault();
        fileInput.click();
      }
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });
    
    // Drag over
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragging');
    });
    
    // Drag leave
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragging');
    });
    
    // Drop
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      const file = e.dataTransfer?.files[0];
      if (file) handleFile(file);
    });
    
    console.log('Drag & drop initialized');
  }
  
  // Browse button
  function initBrowseButton() {
    const btn = $('#btn-browse');
    const input = $('#file-input');
    if (btn && input) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.click();
      });
    }
  }
  
  // Validation
  function setActiveSeverityButton(severity) {
    $$('[data-severity]').forEach(btn => {
      if (btn.dataset.severity === severity) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function filterIssuesBySeverity(issues) {
    if (activeIssueSeverity === 'all') return issues;
    const severity = activeIssueSeverity.toLowerCase();
    return issues.filter(issue => (issue.severity || '').toLowerCase() === severity);
  }

  function filterIssues() {
    let filtered = filterIssuesBySeverity(validationIssues);

    if (activeIssueSearch) {
      const search = activeIssueSearch.toLowerCase();
      filtered = filtered.filter(issue => {
        const values = [
          issue.item_id,
          issue.field,
          issue.rule_id,
          issue.severity,
          issue.message,
          issue.sample_value
        ].map(value => (value || '').toString().toLowerCase());

        return values.some(value => value.includes(search));
      });
    }

    return filtered;
  }

  function updateIssueTable() {
    const tbody = $('#issues-body');
    if (!tbody) return;

    const noResults = $('#no-results');

    if (!validationIssues || validationIssues.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#8b90a0;">No issues found</td></tr>';
      if (noResults) noResults.classList.add('hidden');
      console.log('Rendered 0 issues (no validation issues available)');
      return;
    }

    const filtered = filterIssues();

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (noResults) noResults.classList.remove('hidden');
      console.log('Rendered 0 issues for filter:', activeIssueSeverity);
      return;
    }

    if (noResults) noResults.classList.add('hidden');

    tbody.innerHTML = filtered.map((issue, idx) => {
      const row = issue.row_index ?? idx + 1;
      const severity = issue.severity || 'info';
      return `
        <tr>
          <td class="col-index">${escapeHtml(row)}</td>
          <td class="col-item">${escapeHtml(issue.item_id || '')}</td>
          <td>${escapeHtml(issue.field || '')}</td>
          <td>${escapeHtml(issue.rule_id || '')}</td>
          <td class="sev-${severity}">${escapeHtml(severity)}</td>
          <td>${escapeHtml(issue.message || '')}</td>
          <td>${escapeHtml(issue.sample_value || '')}</td>
        </tr>
      `;
    }).join('');

    console.log('Rendered', filtered.length, 'issues (filter:', activeIssueSeverity, ')');
  }

  function clearResults() {
    const tbody = $('#issues-body');
    if (tbody) tbody.innerHTML = '';

    const noIssues = $('#no-issues');
    if (noIssues) noIssues.classList.add('hidden');

    const noResults = $('#no-results');
    if (noResults) noResults.classList.add('hidden');

    const results = $('#results');
    if (results) results.classList.add('hidden');

    updateCounters(0, 0, 0);

    validationIssues = [];
    activeIssueSeverity = 'all';
    activeIssueSearch = '';
    setActiveSeverityButton('all');

    const searchInput = $('#filter-search');
    if (searchInput) searchInput.value = '';
  }
  
  function updateCounters(errors, warnings, opportunities) {
    const counters = {
      'count-error': errors,
      'count-warning': warnings,
      'count-opportunity': opportunities,
      'count-all': errors + warnings + opportunities
    };
    
    Object.entries(counters).forEach(([id, value]) => {
      const el = $(`#${id}`);
      if (el) el.textContent = value;
    });
    
    console.log('Updated counters:', counters);
  }
  
  function renderIssues(issues) {
    validationIssues = Array.isArray(issues) ? issues : [];
    updateIssueTable();
  }
  
  async function validateFile() {
    const fileInput = $('#file-input');
    const file = fileInput?.files[0] || currentFile;
    
    if (!file) {
      alert('Please select a file first');
      return;
    }
    
    console.log('Validating file:', file.name);
    clearResults();
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('encoding', $('#encoding')?.value || 'utf-8');
    formData.append('delimiter', $('#delimiter')?.value || '');
    formData.append('profile', $('#profile-select')?.value || 'general');
    
    try {
      const response = await fetch('/validate/file', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Validation complete:', data);
      
      // Store for downloads
      lastValidationData = data;
      
      // Handle both response formats
      const issues = data.issues || [];
      const summary = data.summary || {};
      
      // Support both nested summary and flat response
      const errorCount = summary.items_with_errors ?? data.errors ?? 0;
      const warningCount = summary.items_with_warnings ?? data.warnings ?? 0;
      const oppCount = summary.items_with_opportunities ?? data.opportunities ?? 0;
      
      updateCounters(errorCount, warningCount, oppCount);
      activeIssueSeverity = 'all';
      activeIssueSearch = '';
      setActiveSeverityButton('all');
      renderIssues(issues);

      const searchInput = $('#filter-search');
      if (searchInput) searchInput.value = '';
      
      // Show results section
      const results = $('#results');
      if (results) results.classList.remove('hidden');
      
      const noIssues = $('#no-issues');
      const noResults = $('#no-results');
      
      if (issues.length === 0) {
        if (noIssues) noIssues.classList.remove('hidden');
        if (noResults) noResults.classList.add('hidden');
      } else {
        if (noIssues) noIssues.classList.add('hidden');
        if (noResults) noResults.classList.add('hidden');
      }
      
      // Enable downloads
      enableDownloads(data);
      
      console.log('Validation display updated');
      
    } catch (err) {
      console.error('Validation error:', err);
      alert('Validation failed: ' + err.message);
    }
  }
  
  // Profile selector
  function initProfileSelector() {
    const select = $('#profile-select');
    if (!select) return;
    
    select.addEventListener('change', () => {
      const profile = select.value || 'general';
      loadSpec(profile);
    });
  }
  
  // Download functionality
  let lastValidationData = null;
  
  function enableDownloads(data) {
    lastValidationData = data;
    const buttons = ['#btn-download-json', '#btn-download-csv', '#btn-noissues-json', '#btn-noissues-csv'];
    buttons.forEach(sel => {
      const btn = $(sel);
      if (btn) btn.disabled = false;
    });
  }
  
  function downloadJSON() {
    if (!lastValidationData) return;
    const blob = new Blob([JSON.stringify(lastValidationData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'validation-results.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function downloadCSV() {
    if (!lastValidationData || !lastValidationData.issues) return;
    
    const issues = lastValidationData.issues;
    const headers = ['Row', 'Item ID', 'Field', 'Rule', 'Severity', 'Message', 'Sample Value'];
    const rows = issues.map(issue => [
      issue.row_index ?? '',
      issue.item_id ?? '',
      issue.field ?? '',
      issue.rule_id ?? '',
      issue.severity ?? '',
      issue.message ?? '',
      issue.sample_value ?? ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'validation-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function initDownloadButtons() {
    const jsonBtns = ['#btn-download-json', '#btn-noissues-json'];
    const csvBtns = ['#btn-download-csv', '#btn-noissues-csv'];

    jsonBtns.forEach(sel => {
      const btn = $(sel);
      if (btn) btn.addEventListener('click', downloadJSON);
    });

    csvBtns.forEach(sel => {
      const btn = $(sel);
      if (btn) btn.addEventListener('click', downloadCSV);
    });
  }

  function initIssueFilters() {
    $$('[data-severity]').forEach(btn => {
      btn.addEventListener('click', () => {
        const severity = btn.dataset.severity || 'all';
        activeIssueSeverity = severity;
        setActiveSeverityButton(severity);
        updateIssueTable();
      });
    });

    const searchInput = $('#filter-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        activeIssueSearch = e.target.value || '';
        updateIssueTable();
      });
    }
  }
  
  // Initialize everything
  async function init() {
    console.log('Initializing app...');
    
    // Set year
    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    
    // Setup tabs
    const tabValidate = $('#tab-validate');
    const tabSpec = $('#tab-spec');
    
    if (tabValidate) {
      tabValidate.addEventListener('click', (e) => {
        e.preventDefault();
        showTab('validate');
      });
    }
    
    if (tabSpec) {
      tabSpec.addEventListener('click', (e) => {
        e.preventDefault();
        showTab('spec');
      });
    }
    
    // Show validate tab by default
    showTab('validate');
    
    // Setup profile selector
    initProfileSelector();
    
    // Setup file handling
    initDragDrop();
    initBrowseButton();
    updateFileLabel();
    
    // Setup validation button
    const validateBtn = $('#btn-validate-file');
    if (validateBtn) {
      validateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        validateFile();
      });
    }
    
    // Setup download buttons
    initDownloadButtons();
    initIssueFilters();
    
    // Load initial spec
    await loadSpec('general');
    
    // Initialize spec filters after spec is loaded
    initSpecFilters();
    
    console.log('App initialized successfully!');
  }
  
  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
