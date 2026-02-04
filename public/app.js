/**
 * Search Quality Analyzer - Frontend JS
 * v2.0 - Simplified: Always uses AI-powered Smart Analysis
 */

let currentData = null;

/**
 * Start analysis - always uses Smart Mode with Stagehand AI
 */
async function startAnalysis() {
  const domain = document.getElementById('domain-input').value.trim();

  if (!domain) {
    showToast('Please enter a website URL');
    return;
  }

  await runSmartAnalysis(domain);
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
    btn.innerHTML = '<i class="fas fa-robot"></i> Run Analysis';
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
 * Update progress bar and message
 */
function updateProgress(pct, message) {
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('loading-message').textContent = message;
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
