/**
 * Search Quality Analyzer - Frontend JS
 */

let currentData = null;

/**
 * Start analysis
 */
async function startAnalysis() {
  const domain = document.getElementById('domain-input').value.trim();
  const query = document.getElementById('query-input').value.trim();
  const analyze = document.getElementById('analyze-toggle').checked;

  if (!domain) {
    showToast('Please enter a website URL');
    return;
  }
  if (!query) {
    showToast('Please enter a search query');
    return;
  }

  // Update UI
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('loading-state').classList.remove('hidden');
  
  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

  updateProgress(10, 'Connecting to website...');

  try {
    const response = await fetch('/api/search/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, query, analyze }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Failed to analyze');
    }

    const data = await response.json();
    currentData = data;
    
    updateProgress(100, 'Complete!');
    await new Promise(r => setTimeout(r, 500));
    
    renderResults(data, analyze);
    
  } catch (error) {
    console.error('Analysis error:', error);
    showToast('Error: ' + error.message);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-search"></i> Analyze Search Quality';
  }
}

/**
 * Update progress bar and message
 */
function updateProgress(pct, message) {
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('loading-message').textContent = message;
}

/**
 * Render results
 */
function renderResults(data, hasAnalysis) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('results-section').classList.remove('hidden');

  // Determine verdict
  const qual = data.outreach_qualification || {};
  const score = qual.prospect_score || 50;
  const action = qual.recommended_action || 'review';
  const isGood = qual.is_good_prospect;
  const reasons = qual.reasons || [];
  const analysis = data.analysis || {};
  const emailCtx = data.email_context || {};
  const recallData = data.recall_analysis || {};
  const recallScore = recallData.recall_score || 50;

  // Verdict card
  const verdictCard = document.getElementById('verdict-card');
  const verdictBadge = document.getElementById('verdict-badge');
  const verdictTitle = document.getElementById('verdict-title');
  const verdictInsight = document.getElementById('verdict-insight');
  const verdictScore = document.getElementById('verdict-score');

  // POOR RECALL = ALWAYS OUTREACH (this is the key insight)
  const hasRecallProblem = recallScore < 40 || recallData.recall_verdict === 'poor' || recallData.recall_verdict === 'very_poor';
  
  if (action === 'outreach' || hasRecallProblem || (score >= 70 && !analysis.handles_natural_language)) {
    verdictCard.className = 'rounded-xl shadow-lg text-white p-8 verdict-outreach';
    verdictBadge.textContent = '🎯 OUTREACH';
    if (hasRecallProblem) {
      verdictTitle.textContent = 'Great Prospect - Poor Recall Detected';
      verdictInsight.textContent = recallData.recall_explanation || 'Search returned few results but likely missed many relevant products';
    } else {
      verdictTitle.textContent = 'Good Prospect - Their Search Needs Help';
      verdictInsight.textContent = analysis.missed_opportunity || emailCtx.pain_point_summary || 'Search is not handling natural language queries well';
    }
  } else if (action === 'skip' || (score < 40 && recallScore >= 60)) {
    verdictCard.className = 'rounded-xl shadow-lg text-white p-8 verdict-skip';
    verdictBadge.textContent = '✓ SKIP';
    verdictTitle.textContent = 'Search Works Fine - Move On';
    verdictInsight.textContent = 'Their search handles this query well with good recall. Look for other prospects.';
  } else {
    verdictCard.className = 'rounded-xl shadow-lg text-white p-8 verdict-maybe';
    verdictBadge.textContent = '? REVIEW';
    verdictTitle.textContent = 'Maybe - Worth Investigating';
    verdictInsight.textContent = reasons[0] || recallData.recall_explanation || 'Some issues detected, but may not be a strong fit';
  }
  verdictScore.textContent = score;

  // Email hook
  const hookEl = document.getElementById('email-hook');
  const snippets = emailCtx.email_snippet_data || {};
  const opener = snippets.opener || '';
  const result = snippets.result || '';
  const pain = snippets.pain || '';
  
  if (opener || result) {
    hookEl.textContent = `${opener} ${result}`.trim() || 
      `I searched for "${data.input?.query || ''}" on your site and noticed ${emailCtx.what_was_missing || 'the results could be more relevant'}`;
    document.getElementById('insight-card').classList.remove('hidden');
  } else if (emailCtx.pain_point_summary) {
    hookEl.textContent = emailCtx.pain_point_summary;
    document.getElementById('insight-card').classList.remove('hidden');
  } else {
    document.getElementById('insight-card').classList.add('hidden');
  }

  // Screenshots
  const screenshotsGrid = document.getElementById('screenshots-grid');
  screenshotsGrid.innerHTML = '';
  
  const urls = data.screenshot_urls || {};
  const stages = [
    { key: 'homepage', label: 'Homepage', icon: 'fa-home' },
    { key: 'navigation', label: 'Navigation (Catalog)', icon: 'fa-bars' },
    { key: 'search_modal', label: 'Search Overlay', icon: 'fa-search' },
    { key: 'search_results', label: 'Results Page', icon: 'fa-list' },
  ];
  
  stages.forEach(stage => {
    const url = urls[stage.key];
    if (!url) return;
    
    const div = document.createElement('div');
    div.className = 'group cursor-pointer';
    div.onclick = () => openModal(url, stage.label);
    div.innerHTML = `
      <div class="screenshot-container rounded-lg overflow-hidden border border-slate-200 group-hover:border-slate-400 transition">
        <img src="${url}" alt="${stage.label}" class="group-hover:scale-105 transition duration-300">
      </div>
      <p class="text-sm text-slate-600 mt-2 flex items-center gap-2">
        <i class="fas ${stage.icon} text-slate-400"></i>
        ${stage.label}
      </p>
    `;
    screenshotsGrid.appendChild(div);
  });

  // What Happened details
  const detailsGrid = document.getElementById('details-grid');
  const searchResults = data.search_results || {};
  const website = data.website || {};
  const recall = data.recall_analysis || {};
  
  // Recall verdict colors
  const recallColors = {
    excellent: 'text-green-600 bg-green-50 border-green-200',
    good: 'text-green-500 bg-green-50 border-green-200',
    fair: 'text-amber-600 bg-amber-50 border-amber-200',
    poor: 'text-orange-600 bg-orange-50 border-orange-200',
    very_poor: 'text-red-600 bg-red-50 border-red-200',
  };
  const recallColor = recallColors[recall.recall_verdict] || recallColors.fair;
  
  detailsGrid.innerHTML = `
    <div class="grid md:grid-cols-2 gap-4">
      <div class="bg-slate-50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-slate-500 mb-2">Query Used</h4>
        <p class="text-slate-900 font-medium">"${data.input?.query || ''}"</p>
      </div>
      <div class="bg-slate-50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-slate-500 mb-2">Results Returned</h4>
        <p class="text-slate-900 font-medium">${searchResults.result_count_text || searchResults.result_count || 'Unknown'}</p>
      </div>
    </div>
    
    <!-- RECALL ANALYSIS (KEY INSIGHT) -->
    ${recall.recall_explanation ? `
    <div class="p-4 rounded-lg border-2 ${recallColor}">
      <div class="flex items-center justify-between mb-2">
        <h4 class="font-semibold flex items-center gap-2">
          <i class="fas fa-chart-pie"></i>
          Recall Analysis
        </h4>
        <span class="text-2xl font-bold">${recall.recall_score || '?'}/100</span>
      </div>
      <p class="text-sm mb-3">${recall.recall_explanation}</p>
      ${recall.visible_categories?.length > 0 ? `
      <div class="text-xs">
        <span class="font-medium">Categories in nav:</span> ${recall.visible_categories.join(', ')}
      </div>
      ` : ''}
      ${recall.missed_categories?.length > 0 ? `
      <div class="text-xs mt-1">
        <span class="font-medium text-red-600">Missed:</span> ${recall.missed_categories.join(', ')}
      </div>
      ` : ''}
      <div class="text-xs mt-2 pt-2 border-t border-current border-opacity-20">
        Expected: <strong>${recall.expected_product_count || '?'}</strong> products | 
        Returned: <strong>${recall.actual_result_count || '?'}</strong> products
      </div>
    </div>
    ` : ''}
    
    <div class="bg-slate-50 rounded-lg p-4">
      <h4 class="text-sm font-medium text-slate-500 mb-2">What Search Showed</h4>
      <p class="text-slate-900">${emailCtx.what_search_returned || searchResults.products_shown_summary || 'N/A'}</p>
    </div>
    
    ${emailCtx.what_was_missing ? `
    <div class="bg-red-50 rounded-lg p-4 border border-red-100">
      <h4 class="text-sm font-medium text-red-600 mb-2">What Was Missing</h4>
      <p class="text-slate-900">${emailCtx.what_was_missing}</p>
    </div>
    ` : ''}
    
    <div class="grid md:grid-cols-4 gap-4 text-center">
      <div class="p-3">
        <div class="text-2xl mb-1 ${analysis.handles_natural_language ? 'text-green-500' : 'text-red-500'}">
          <i class="fas fa-${analysis.handles_natural_language ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-600">Natural Language</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${searchResults.results_relevant ? 'text-green-500' : 'text-red-500'}">
          <i class="fas fa-${searchResults.results_relevant ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-600">Precision</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${(recall.recall_score || 50) >= 50 ? 'text-green-500' : 'text-red-500'}">
          <i class="fas fa-${(recall.recall_score || 50) >= 50 ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-600">Recall</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${website.has_autocomplete ? 'text-green-500' : 'text-slate-300'}">
          <i class="fas fa-${website.has_autocomplete ? 'check-circle' : 'minus-circle'}"></i>
        </div>
        <p class="text-xs text-slate-600">Autocomplete</p>
      </div>
    </div>
  `;

  // Raw JSON
  document.getElementById('raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Toggle collapsible section
 */
function toggleSection(id) {
  const content = document.getElementById(`${id}-content`);
  const chevron = document.getElementById(`${id}-chevron`);
  
  content.classList.toggle('open');
  chevron.classList.toggle('fa-chevron-down');
  chevron.classList.toggle('fa-chevron-up');
}

/**
 * Copy email hook
 */
function copyEmailHook() {
  const text = document.getElementById('email-hook').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  });
}

/**
 * Open image modal
 */
function openModal(src, title) {
  document.getElementById('modal-image').src = src;
  document.getElementById('image-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Close modal
 */
function closeModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest('button')) return;
  document.getElementById('image-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/**
 * Show toast
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-message').textContent = message;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3000);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') startAnalysis();
});
