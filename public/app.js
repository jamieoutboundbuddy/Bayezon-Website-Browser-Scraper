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
  btn.innerHTML = '<i class="fas fa-robot fa-spin"></i> AI Analyzing...';

  updateProgress(5, 'Initializing AI Agent...');

  try {
    const progressMessages = [
      [10, 'AI Agent: Creating browser session...'],
      [15, 'AI Agent: Navigating to website...'],
      [20, 'AI Agent: Dismissing popups...'],
      [25, 'AI Agent: Capturing homepage...'],
      [30, 'Adversarial Test: Query 1/5 (Easy)...'],
      [40, 'Adversarial Test: Query 2/5 (Medium)...'],
      [50, 'Adversarial Test: Query 3/5 (Harder)...'],
      [60, 'Adversarial Test: Query 4/5 (Hard)...'],
      [70, 'Adversarial Test: Query 5/5 (Hardest)...'],
      [85, 'AI Agent: Evaluating results...'],
      [95, 'AI Agent: Building report...'],
    ];

    // Simulate progress updates since we don't have SSE
    const progressInterval = setInterval(() => {
      const bar = document.getElementById('progress-bar');
      const current = parseInt(bar.style.width) || 0;
      if (current < 90) {
        for (const [threshold, msg] of progressMessages) {
          if (current < threshold) {
            updateProgress(threshold, msg);
            break;
          }
        }
      }
    }, 3000);
    
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
    btn.innerHTML = '<i class="fas fa-search"></i> <span id="search-btn-text">Analyze Search Quality</span>';
  }
}

/**
 * Render Smart Mode results (Adversarial Testing)
 */
function renderSmartResults(data) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('smart-results-section').classList.remove('hidden');

  const { siteProfile, queriesTested, comparison, confidence, emailHook, screenshotUrls, durationMs, adversarial } = data;

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
      title: 'Search Failure Found - Great Prospect!' 
    },
    'SKIP': { 
      class: 'verdict-skip', 
      badge: '✓ SKIP', 
      title: 'Search Passed All Tests - Move On' 
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

  // Adversarial Query Progression (replaces comparison view)
  if (adversarial?.queriesTested) {
    renderAdversarialProgression(adversarial, screenshotUrls);
  } else if (queriesTested && comparison) {
    // Fallback to single query display
    renderSingleQueryResult(queriesTested, comparison, screenshotUrls);
  }

  // Email hook
  const hookEl = document.getElementById('smart-email-hook');
  const insightCard = document.getElementById('smart-insight-card');
  if (emailHook) {
    hookEl.textContent = emailHook;
    insightCard.classList.remove('hidden');
  } else {
    insightCard.classList.add('hidden');
  }

  // Hide missed products (not relevant for adversarial)
  const missedCard = document.getElementById('missed-products-card');
  if (missedCard) missedCard.classList.add('hidden');

  // All screenshots
  renderSmartScreenshots(screenshotUrls, adversarial);

  // Raw JSON
  document.getElementById('smart-raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Render adversarial query progression
 */
function renderAdversarialProgression(adversarial, screenshots) {
  const container = document.getElementById('comparison-container');
  if (!container) return;
  
  const { queriesTested, failedOnAttempt, proofQuery } = adversarial;
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-slate-200">
          <i class="fas fa-flask text-cyan-400 mr-2"></i>
          Adversarial Search Test
        </h3>
        <span class="text-sm text-slate-400">
          ${queriesTested.length} queries tested
        </span>
      </div>
      
      <div class="space-y-3">
        ${queriesTested.map((q, i) => `
          <div class="flex items-center gap-4 p-4 rounded-lg ${
            q.passed 
              ? 'bg-green-500/10 border border-green-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          }">
            <div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              q.passed ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }">
              <i class="fas ${q.passed ? 'fa-check' : 'fa-times'}"></i>
            </div>
            <div class="flex-grow">
              <div class="flex items-center gap-2">
                <span class="text-xs text-slate-500">Query ${q.attempt}</span>
                ${!q.passed ? '<span class="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded">PROOF</span>' : ''}
              </div>
              <p class="font-mono text-sm ${q.passed ? 'text-green-300' : 'text-red-300'}">
                "${q.query}"
              </p>
              <p class="text-xs text-slate-400 mt-1">
                ${q.resultCount !== null ? `${q.resultCount} results` : 'Unknown results'} 
                ${q.reasoning ? `— ${q.reasoning.substring(0, 80)}${q.reasoning.length > 80 ? '...' : ''}` : ''}
              </p>
            </div>
            ${q.screenshotPath ? `
              <button 
                onclick="openModal('${screenshots['results_' + q.attempt] || screenshots.results}', 'Query ${q.attempt} Results')"
                class="flex-shrink-0 text-slate-400 hover:text-cyan-400 transition"
              >
                <i class="fas fa-image"></i>
              </button>
            ` : ''}
          </div>
        `).join('')}
      </div>
      
      ${proofQuery ? `
        <div class="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <h4 class="font-semibold text-red-400 mb-2">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            Proof of Search Weakness
          </h4>
          <p class="text-slate-300">
            Search failed on query <span class="font-mono bg-red-500/20 px-2 py-0.5 rounded">"${proofQuery}"</span>
            after ${failedOnAttempt - 1} successful tests.
          </p>
        </div>
      ` : `
        <div class="mt-6 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <h4 class="font-semibold text-green-400 mb-2">
            <i class="fas fa-shield-alt mr-2"></i>
            Search is Robust
          </h4>
          <p class="text-slate-300">
            All ${queriesTested.length} test queries passed. This site handles natural language search well.
          </p>
        </div>
      `}
    </div>
  `;
}

/**
 * Render single query result (fallback for non-adversarial)
 */
function renderSingleQueryResult(queries, comparison, screenshots) {
  const container = document.getElementById('comparison-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="p-6 rounded-lg bg-slate-800/50 border border-slate-700">
      <h3 class="text-lg font-semibold text-slate-200 mb-4">
        <i class="fas fa-search text-cyan-400 mr-2"></i>
        Search Test Result
      </h3>
      <div class="space-y-4">
        <div>
          <span class="text-xs text-slate-500 uppercase">Query Tested</span>
          <p class="font-mono text-cyan-300">"${queries.naturalLanguageQuery}"</p>
        </div>
        <div class="flex gap-4">
          <div>
            <span class="text-xs text-slate-500 uppercase">Results</span>
            <p class="text-2xl font-bold text-slate-200">${comparison.nlResultCount ?? '?'}</p>
          </div>
          <div>
            <span class="text-xs text-slate-500 uppercase">Relevance</span>
            <p class="text-sm ${comparison.nlRelevance === 'high' ? 'text-green-400' : comparison.nlRelevance === 'none' ? 'text-red-400' : 'text-amber-400'}">
              ${comparison.nlRelevance?.toUpperCase() || 'Unknown'}
            </p>
          </div>
        </div>
        ${screenshots?.results ? `
          <div class="mt-4 cursor-pointer" onclick="openModal('${screenshots.results}', 'Search Results')">
            <img src="${screenshots.results}" alt="Search Results" class="rounded-lg border border-slate-600 max-h-64 object-cover object-top">
          </div>
        ` : ''}
      </div>
    </div>
  `;
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

// renderComparison removed - replaced by renderAdversarialProgression

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
 * Render smart screenshots grid (Adversarial version)
 */
function renderSmartScreenshots(urls, adversarial) {
  if (!urls) return;
  
  const grid = document.getElementById('smart-screenshots-grid');
  
  // Build stages dynamically based on adversarial results
  const stages = [
    { key: 'homepage', label: 'Homepage', icon: 'fa-home', color: 'text-cyan-400' },
  ];
  
  // Add screenshots for each tested query
  if (adversarial?.queriesTested) {
    adversarial.queriesTested.forEach((q, i) => {
      stages.push({
        key: `results_${i + 1}`,
        label: `Query ${i + 1}: ${q.passed ? 'Passed' : 'FAILED'}`,
        icon: q.passed ? 'fa-check-circle' : 'fa-times-circle',
        color: q.passed ? 'text-green-400' : 'text-red-400',
        query: q.query
      });
    });
  } else {
    // Fallback to single results screenshot
    stages.push({ key: 'results', label: 'Search Results', icon: 'fa-search', color: 'text-cyan-400' });
  }

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
        ${stage.query ? `<p class="text-xs text-slate-500 font-mono truncate">"${stage.query}"</p>` : ''}
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
