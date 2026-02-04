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
 * Render Smart Mode results (Adversarial Testing) - CLEAN VERSION
 */
function renderSmartResults(data) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('smart-results-section').classList.remove('hidden');

  const { siteProfile, comparison, confidence, screenshotUrls, durationMs, adversarial, summary } = data;

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
      title: 'Search Passed All Tests' 
    },
    'REVIEW': { 
      class: 'verdict-maybe', 
      badge: '? REVIEW', 
      title: 'Worth Investigating' 
    },
    'INCONCLUSIVE': { 
      class: 'verdict-inconclusive', 
      badge: '⚠ INCONCLUSIVE', 
      title: 'Could Not Evaluate' 
    }
  };

  const vstyle = verdictStyles[verdict] || verdictStyles['INCONCLUSIVE'];
  verdictCard.className = `rounded-xl text-white p-8 ${vstyle.class}`;
  verdictBadge.textContent = vstyle.badge;
  verdictTitle.textContent = vstyle.title;
  verdictReason.textContent = '';  // We'll show this in the summary instead

  // Confidence badge - hide for cleaner look
  confidenceBadge.className = 'hidden';

  // Duration
  if (durationMs) {
    durationEl.textContent = `${(durationMs / 1000).toFixed(1)}s`;
  }

  // Hide site profile for cleaner look
  const profileGrid = document.getElementById('site-profile-grid');
  if (profileGrid) profileGrid.innerHTML = '';

  // Render clean screenshots + summary
  renderCleanResults(adversarial, screenshotUrls, summary, siteProfile);

  // Hide unnecessary sections
  const insightCard = document.getElementById('smart-insight-card');
  if (insightCard) insightCard.classList.add('hidden');
  const missedCard = document.getElementById('missed-products-card');
  if (missedCard) missedCard.classList.add('hidden');

  // Raw JSON
  document.getElementById('smart-raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Render CLEAN results - screenshots grid + narrative summary
 */
function renderCleanResults(adversarial, screenshots, summary, siteProfile) {
  const container = document.getElementById('comparison-container');
  if (!container) return;
  
  const queriesTested = adversarial?.queriesTested || [];
  const proofQuery = adversarial?.proofQuery;
  const narrative = summary?.narrative || '';
  const queriesThatWork = summary?.queriesThatWork || [];
  
  // Build screenshot grid HTML
  const screenshotItems = [];
  
  // Homepage
  if (screenshots?.homepage) {
    screenshotItems.push({
      url: screenshots.homepage,
      label: 'Homepage',
      sublabel: siteProfile?.companyName || ''
    });
  }
  
  // Each query result
  queriesTested.forEach((q, i) => {
    const url = screenshots[`results_${i + 1}`] || screenshots.results;
    if (url) {
      screenshotItems.push({
        url: url,
        label: q.passed ? `✅ Query ${i + 1}` : `❌ Query ${i + 1} (FAILED)`,
        sublabel: `"${q.query}"`,
        failed: !q.passed
      });
    }
  });
  
  container.innerHTML = `
    <!-- SCREENSHOTS GRID -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-slate-200 mb-4">
        <i class="fas fa-images text-cyan-400 mr-2"></i>
        Screenshots
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-${Math.min(screenshotItems.length, 4)} gap-4">
        ${screenshotItems.map(item => `
          <div class="cursor-pointer group" onclick="openModal('${item.url}', '${item.label}')">
            <div class="aspect-video rounded-lg overflow-hidden border-2 ${
              item.failed ? 'border-red-500/50' : 'border-slate-700'
            } group-hover:border-cyan-500 transition">
              <img src="${item.url}" alt="${item.label}" class="w-full h-full object-cover object-top">
            </div>
            <p class="text-sm font-medium mt-2 ${item.failed ? 'text-red-400' : 'text-slate-300'}">${item.label}</p>
            <p class="text-xs text-slate-500 truncate">${item.sublabel}</p>
          </div>
        `).join('')}
      </div>
    </div>
    
    <!-- NARRATIVE SUMMARY -->
    <div class="mb-8 p-6 rounded-xl bg-slate-800/70 border border-slate-700">
      <h3 class="text-lg font-semibold text-slate-200 mb-4">
        <i class="fas fa-file-alt text-cyan-400 mr-2"></i>
        Analysis Summary
      </h3>
      <div class="text-slate-300 whitespace-pre-line font-mono text-sm leading-relaxed">
        ${narrative || 'No summary available.'}
      </div>
    </div>
    
    ${proofQuery ? `
    <!-- PROOF OF FAILURE -->
    <div class="mb-8 p-6 rounded-xl bg-red-500/10 border border-red-500/30">
      <h3 class="text-lg font-semibold text-red-400 mb-2">
        <i class="fas fa-exclamation-triangle mr-2"></i>
        Proof Query (Use This in Outreach)
      </h3>
      <p class="text-2xl font-mono text-red-300">"${proofQuery}"</p>
      <p class="text-sm text-slate-400 mt-2">This query returned no relevant results, proving their search needs improvement.</p>
    </div>
    ` : ''}
    
    <!-- QUERIES THAT WOULD WORK -->
    ${queriesThatWork.length > 0 ? `
    <div class="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
      <h3 class="text-lg font-semibold text-slate-200 mb-4">
        <i class="fas fa-lightbulb text-amber-400 mr-2"></i>
        Queries That Would Work (Simple Keywords)
      </h3>
      <div class="flex flex-wrap gap-2">
        ${queriesThatWork.map(q => `
          <span class="px-3 py-1.5 rounded-full bg-slate-700 text-slate-300 text-sm font-mono">${q}</span>
        `).join('')}
      </div>
      <p class="text-xs text-slate-500 mt-3">These simple keyword searches would likely return results, but shoppers often use natural language instead.</p>
    </div>
    ` : ''}
  `;
}

/**
 * Render adversarial query progression (LEGACY - kept for compatibility)
 */
function renderAdversarialProgression(adversarial, screenshots) {
  // Now handled by renderCleanResults
  renderCleanResults(adversarial, screenshots, null, null);
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
 * Render smart screenshots grid - NOW EMPTY (handled by renderCleanResults)
 */
function renderSmartScreenshots(urls, adversarial) {
  // Screenshots are now rendered inside renderCleanResults
  // Hide the separate screenshots section
  const grid = document.getElementById('smart-screenshots-grid');
  if (grid) grid.innerHTML = '';
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
