/**
 * Search Quality Analyzer - Frontend JS
 */

let currentData = null;
let isSmartMode = false;

/**
 * Toggle Smart Mode on/off
 */
function toggleSmartMode() {
  isSmartMode = !isSmartMode;
  const toggle = document.getElementById('smart-mode-toggle');
  const badge = document.getElementById('smart-mode-badge');
  const queryContainer = document.getElementById('query-input-container');
  const aiToggleContainer = document.getElementById('ai-toggle-container');
  const manualTip = document.getElementById('manual-tip');
  const smartTip = document.getElementById('smart-tip');
  const searchBtnText = document.getElementById('search-btn-text');

  toggle.classList.toggle('active', isSmartMode);
  badge.classList.toggle('hidden', !isSmartMode);
  
  if (isSmartMode) {
    queryContainer.classList.add('hidden');
    aiToggleContainer.classList.add('hidden');
    manualTip.classList.add('hidden');
    smartTip.classList.remove('hidden');
    searchBtnText.textContent = 'Run Smart Analysis';
  } else {
    queryContainer.classList.remove('hidden');
    aiToggleContainer.classList.remove('hidden');
    manualTip.classList.remove('hidden');
    smartTip.classList.add('hidden');
    searchBtnText.textContent = 'Analyze Search Quality';
  }
}

/**
 * Start analysis (handles both modes)
 */
async function startAnalysis() {
  const domain = document.getElementById('domain-input').value.trim();

  if (!domain) {
    showToast('Please enter a website URL');
    return;
  }

  if (isSmartMode) {
    await runSmartAnalysis(domain);
  } else {
    await runManualAnalysis(domain);
  }
}

/**
 * Run Smart Mode analysis (domain only)
 */
async function runSmartAnalysis(domain) {
  // Update UI
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('smart-results-section').classList.add('hidden');
  document.getElementById('loading-state').classList.remove('hidden');
  
  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

  updateProgress(5, 'Connecting to website...');

  try {
    // Simulate progress updates since we don't have SSE
    const progressInterval = setInterval(() => {
      const bar = document.getElementById('progress-bar');
      const current = parseInt(bar.style.width) || 0;
      if (current < 90) {
        const messages = [
          [15, 'Taking homepage screenshot...'],
          [30, 'Analyzing site with AI...'],
          [45, 'Generating test queries...'],
          [60, 'Running natural language search...'],
          [75, 'Running keyword search...'],
          [85, 'Evaluating results...'],
        ];
        for (const [threshold, msg] of messages) {
          if (current < threshold) {
            updateProgress(threshold, msg);
            break;
          }
        }
      }
    }, 2000);

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    });

    clearInterval(progressInterval);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Failed to analyze');
    }

    const data = await response.json();
    currentData = data;
    
    updateProgress(100, 'Complete!');
    await new Promise(r => setTimeout(r, 500));
    
    renderSmartResults(data);
    
  } catch (error) {
    console.error('Smart analysis error:', error);
    showToast('Error: ' + error.message);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-search"></i> <span id="search-btn-text">Run Smart Analysis</span>';
  }
}

/**
 * Render Smart Mode results
 */
function renderSmartResults(data) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('smart-results-section').classList.remove('hidden');

  const { siteProfile, queriesTested, comparison, confidence, emailHook, screenshotUrls, durationMs } = data;

  // Verdict card
  const verdictCard = document.getElementById('smart-verdict-card');
  const verdictBadge = document.getElementById('smart-verdict-badge');
  const verdictTitle = document.getElementById('smart-verdict-title');
  const verdictReason = document.getElementById('smart-verdict-reason');
  const confidenceBadge = document.getElementById('smart-confidence-badge');
  const durationEl = document.getElementById('smart-duration');

  const verdict = comparison?.verdict || data.verdict || 'INCONCLUSIVE';
  
  // Set verdict styling
  const verdictStyles = {
    'OUTREACH': { 
      class: 'verdict-outreach', 
      badge: '🎯 OUTREACH', 
      title: 'Great Prospect - Their Search Needs Help' 
    },
    'SKIP': { 
      class: 'verdict-skip', 
      badge: '✓ SKIP', 
      title: 'Search Works Fine - Move On' 
    },
    'REVIEW': { 
      class: 'verdict-maybe', 
      badge: '? REVIEW', 
      title: 'Worth Investigating Further' 
    },
    'INCONCLUSIVE': { 
      class: 'verdict-inconclusive', 
      badge: '⚠ INCONCLUSIVE', 
      title: 'Could Not Fully Evaluate' 
    }
  };

  const vstyle = verdictStyles[verdict] || verdictStyles['INCONCLUSIVE'];
  verdictCard.className = `rounded-xl text-white p-8 ${vstyle.class}`;
  verdictBadge.textContent = vstyle.badge;
  verdictTitle.textContent = vstyle.title;
  verdictReason.textContent = comparison?.verdictReason || data.reason || '';

  // Confidence badge
  const confLevel = confidence?.level || 'low';
  confidenceBadge.className = `text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full confidence-${confLevel}`;
  confidenceBadge.textContent = `${confLevel.toUpperCase()} CONFIDENCE`;

  // Duration
  if (durationMs) {
    durationEl.textContent = `${(durationMs / 1000).toFixed(1)}s`;
  }

  // Site Profile
  renderSiteProfile(siteProfile);

  // Comparison view
  if (queriesTested && comparison) {
    renderComparison(queriesTested, comparison, screenshotUrls);
  }

  // Missed products
  renderMissedProducts(comparison?.missedProducts);

  // Email hook
  const hookEl = document.getElementById('smart-email-hook');
  const insightCard = document.getElementById('smart-insight-card');
  if (emailHook) {
    hookEl.textContent = emailHook;
    insightCard.classList.remove('hidden');
  } else {
    insightCard.classList.add('hidden');
  }

  // All screenshots
  renderSmartScreenshots(screenshotUrls);

  // Raw JSON
  document.getElementById('smart-raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Render site profile cards
 */
function renderSiteProfile(profile) {
  if (!profile) return;
  
  const grid = document.getElementById('site-profile-grid');
  
  const items = [
    { 
      icon: 'fa-building', 
      label: 'Company', 
      value: profile.company || 'Unknown',
      color: 'text-cyan-400'
    },
    { 
      icon: 'fa-industry', 
      label: 'Industry', 
      value: profile.industry || 'Unknown',
      color: 'text-violet-400'
    },
    { 
      icon: 'fa-boxes', 
      label: 'Catalog Size', 
      value: (profile.estimatedCatalogSize || 'unknown').charAt(0).toUpperCase() + (profile.estimatedCatalogSize || 'unknown').slice(1),
      color: 'text-pink-400'
    },
    { 
      icon: 'fa-search', 
      label: 'Search Type', 
      value: profile.searchType || 'Unknown',
      color: 'text-amber-400'
    }
  ];

  grid.innerHTML = items.map(item => `
    <div class="bg-slate-800/50 rounded-lg p-4">
      <div class="flex items-center gap-2 mb-1">
        <i class="fas ${item.icon} ${item.color}"></i>
        <span class="text-xs text-slate-500 uppercase">${item.label}</span>
      </div>
      <p class="font-semibold text-slate-200">${item.value}</p>
    </div>
  `).join('');

  // Add visible products/categories if available
  if (profile.visibleProducts?.length > 0) {
    grid.innerHTML += `
      <div class="bg-slate-800/50 rounded-lg p-4 md:col-span-2">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-eye text-cyan-400"></i>
          <span class="text-xs text-slate-500 uppercase">Visible Products</span>
        </div>
        <div class="flex flex-wrap gap-1">
          ${profile.visibleProducts.slice(0, 6).map(p => 
            `<span class="text-xs bg-slate-700 px-2 py-1 rounded text-slate-300">${p}</span>`
          ).join('')}
          ${profile.visibleProducts.length > 6 ? `<span class="text-xs text-slate-500">+${profile.visibleProducts.length - 6} more</span>` : ''}
        </div>
      </div>
    `;
  }

  if (profile.visibleCategories?.length > 0) {
    grid.innerHTML += `
      <div class="bg-slate-800/50 rounded-lg p-4 md:col-span-2">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas fa-folder text-violet-400"></i>
          <span class="text-xs text-slate-500 uppercase">Categories</span>
        </div>
        <div class="flex flex-wrap gap-1">
          ${profile.visibleCategories.slice(0, 8).map(c => 
            `<span class="text-xs bg-slate-700 px-2 py-1 rounded text-slate-300">${c}</span>`
          ).join('')}
          ${profile.visibleCategories.length > 8 ? `<span class="text-xs text-slate-500">+${profile.visibleCategories.length - 8} more</span>` : ''}
        </div>
      </div>
    `;
  }
}

/**
 * Render comparison view
 */
function renderComparison(queries, comparison, screenshots) {
  // NL Query
  document.getElementById('nl-query').textContent = `"${queries.naturalLanguageQuery}"`;
  document.getElementById('nl-result-count').textContent = comparison.nlResultCount ?? '?';
  document.getElementById('nl-screenshot').src = screenshots?.results_nl || '';
  
  // NL Relevance badge
  const nlBadge = document.getElementById('nl-relevance-badge');
  const nlRelevance = comparison.nlRelevance || 'mixed';
  const relevanceStyles = {
    'all_relevant': { bg: 'bg-green-500/20', text: 'text-green-400', label: 'All Relevant' },
    'mostly_relevant': { bg: 'bg-green-500/10', text: 'text-green-300', label: 'Mostly Relevant' },
    'mixed': { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Mixed' },
    'irrelevant': { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Irrelevant' },
    'none': { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'No Results' }
  };
  const nlStyle = relevanceStyles[nlRelevance] || relevanceStyles['mixed'];
  nlBadge.className = `px-3 py-1 rounded-full text-xs font-semibold ${nlStyle.bg} ${nlStyle.text}`;
  nlBadge.textContent = nlStyle.label;

  // NL Products
  const nlProducts = document.getElementById('nl-products');
  if (comparison.nlProductsShown?.length > 0) {
    nlProducts.innerHTML = comparison.nlProductsShown.slice(0, 5).map(p => 
      `<span class="text-xs bg-cyan-500/10 border border-cyan-500/30 px-2 py-1 rounded text-cyan-300">${p}</span>`
    ).join('');
    if (comparison.nlProductsShown.length > 5) {
      nlProducts.innerHTML += `<span class="text-xs text-slate-500">+${comparison.nlProductsShown.length - 5} more</span>`;
    }
  } else {
    nlProducts.innerHTML = '<span class="text-xs text-slate-500">No products visible</span>';
  }

  // KW Query
  document.getElementById('kw-query').textContent = `"${queries.keywordQuery}"`;
  document.getElementById('kw-result-count').textContent = comparison.kwResultCount ?? '?';
  document.getElementById('kw-screenshot').src = screenshots?.results_kw || '';
  
  // KW Relevance badge
  const kwBadge = document.getElementById('kw-relevance-badge');
  const kwRelevance = comparison.kwRelevance || 'mixed';
  const kwStyle = relevanceStyles[kwRelevance] || relevanceStyles['mixed'];
  kwBadge.className = `px-3 py-1 rounded-full text-xs font-semibold ${kwStyle.bg} ${kwStyle.text}`;
  kwBadge.textContent = kwStyle.label;

  // KW Products
  const kwProducts = document.getElementById('kw-products');
  if (comparison.kwProductsShown?.length > 0) {
    kwProducts.innerHTML = comparison.kwProductsShown.slice(0, 5).map(p => 
      `<span class="text-xs bg-violet-500/10 border border-violet-500/30 px-2 py-1 rounded text-violet-300">${p}</span>`
    ).join('');
    if (comparison.kwProductsShown.length > 5) {
      kwProducts.innerHTML += `<span class="text-xs text-slate-500">+${comparison.kwProductsShown.length - 5} more</span>`;
    }
  } else {
    kwProducts.innerHTML = '<span class="text-xs text-slate-500">No products visible</span>';
  }
}

/**
 * Render missed products card
 */
function renderMissedProducts(missedProducts) {
  const card = document.getElementById('missed-products-card');
  const list = document.getElementById('missed-products-list');
  
  if (missedProducts && missedProducts.length > 0) {
    card.classList.remove('hidden');
    list.innerHTML = missedProducts.map(p => 
      `<span class="missed-product-tag px-3 py-1.5 rounded-full text-sm font-medium">${p}</span>`
    ).join('');
  } else {
    card.classList.add('hidden');
  }
}

/**
 * Render smart screenshots grid
 */
function renderSmartScreenshots(urls) {
  if (!urls) return;
  
  const grid = document.getElementById('smart-screenshots-grid');
  const stages = [
    { key: 'homepage', label: 'Homepage', icon: 'fa-home', color: 'text-cyan-400' },
    { key: 'results_nl', label: 'NL Results', icon: 'fa-comment-dots', color: 'text-cyan-400' },
    { key: 'results_kw', label: 'Keyword Results', icon: 'fa-keyboard', color: 'text-violet-400' },
  ];

  grid.innerHTML = stages.map(stage => {
    const url = urls[stage.key];
    if (!url) return '';
    return `
      <div class="group cursor-pointer" onclick="openModal('${url}', '${stage.label}')">
        <div class="screenshot-container rounded-lg overflow-hidden border border-slate-700 group-hover:border-slate-500 transition">
          <img src="${url}" alt="${stage.label}">
        </div>
        <p class="text-sm text-slate-400 mt-2 flex items-center gap-2">
          <i class="fas ${stage.icon} ${stage.color}"></i>
          ${stage.label}
        </p>
      </div>
    `;
  }).join('');
}

/**
 * Copy smart email hook
 */
function copySmartEmailHook() {
  const text = document.getElementById('smart-email-hook').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  });
}

/**
 * Run manual analysis (existing flow)
 */
async function runManualAnalysis(domain) {
  const query = document.getElementById('query-input').value.trim();
  const analyze = document.getElementById('analyze-toggle').checked;

  if (!query) {
    showToast('Please enter a search query');
    return;
  }

  // Update UI
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('smart-results-section').classList.add('hidden');
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
    btn.innerHTML = '<i class="fas fa-search"></i> <span id="search-btn-text">Analyze Search Quality</span>';
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
 * Render manual mode results
 */
function renderResults(data, hasAnalysis) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('smart-results-section').classList.add('hidden');
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
      <div class="screenshot-container rounded-lg overflow-hidden border border-slate-700 group-hover:border-slate-500 transition">
        <img src="${url}" alt="${stage.label}" class="group-hover:scale-105 transition duration-300">
      </div>
      <p class="text-sm text-slate-400 mt-2 flex items-center gap-2">
        <i class="fas ${stage.icon} text-slate-500"></i>
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
    excellent: 'text-green-400 bg-green-500/10 border-green-500/30',
    good: 'text-green-400 bg-green-500/10 border-green-500/30',
    fair: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    poor: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    very_poor: 'text-red-400 bg-red-500/10 border-red-500/30',
  };
  const recallColor = recallColors[recall.recall_verdict] || recallColors.fair;
  
  detailsGrid.innerHTML = `
    <div class="grid md:grid-cols-2 gap-4">
      <div class="bg-slate-800/50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-slate-500 mb-2">Query Used</h4>
        <p class="text-slate-200 font-medium">"${data.input?.query || ''}"</p>
      </div>
      <div class="bg-slate-800/50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-slate-500 mb-2">Results Returned</h4>
        <p class="text-slate-200 font-medium">${searchResults.result_count_text || searchResults.result_count || 'Unknown'}</p>
      </div>
    </div>
    
    <!-- RECALL ANALYSIS (KEY INSIGHT) -->
    ${recall.recall_explanation ? `
    <div class="p-4 rounded-lg border ${recallColor}">
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
        <span class="font-medium text-red-400">Missed:</span> ${recall.missed_categories.join(', ')}
      </div>
      ` : ''}
      <div class="text-xs mt-2 pt-2 border-t border-current border-opacity-20">
        Expected: <strong>${recall.expected_product_count || '?'}</strong> products | 
        Returned: <strong>${recall.actual_result_count || '?'}</strong> products
      </div>
    </div>
    ` : ''}
    
    <div class="bg-slate-800/50 rounded-lg p-4">
      <h4 class="text-sm font-medium text-slate-500 mb-2">What Search Showed</h4>
      <p class="text-slate-200">${emailCtx.what_search_returned || searchResults.products_shown_summary || 'N/A'}</p>
    </div>
    
    ${emailCtx.what_was_missing ? `
    <div class="bg-red-500/10 rounded-lg p-4 border border-red-500/30">
      <h4 class="text-sm font-medium text-red-400 mb-2">What Was Missing</h4>
      <p class="text-slate-200">${emailCtx.what_was_missing}</p>
    </div>
    ` : ''}
    
    <div class="grid md:grid-cols-4 gap-4 text-center">
      <div class="p-3">
        <div class="text-2xl mb-1 ${analysis.handles_natural_language ? 'text-green-400' : 'text-red-400'}">
          <i class="fas fa-${analysis.handles_natural_language ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-500">Natural Language</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${searchResults.results_relevant ? 'text-green-400' : 'text-red-400'}">
          <i class="fas fa-${searchResults.results_relevant ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-500">Precision</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${(recall.recall_score || 50) >= 50 ? 'text-green-400' : 'text-red-400'}">
          <i class="fas fa-${(recall.recall_score || 50) >= 50 ? 'check-circle' : 'times-circle'}"></i>
        </div>
        <p class="text-xs text-slate-500">Recall</p>
      </div>
      <div class="p-3">
        <div class="text-2xl mb-1 ${website.has_autocomplete ? 'text-green-400' : 'text-slate-600'}">
          <i class="fas fa-${website.has_autocomplete ? 'check-circle' : 'minus-circle'}"></i>
        </div>
        <p class="text-xs text-slate-500">Autocomplete</p>
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
