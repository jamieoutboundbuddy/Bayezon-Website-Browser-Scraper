/**
 * Search Quality Analyzer - Frontend JS
 * v3.0 - Clean Bayezon UI
 */

let currentData = null;
let currentBatchId = null;
let batchPollInterval = null;

/**
 * Start analysis
 */
async function startAnalysis() {
  const domain = document.getElementById('domain-input').value.trim();

  if (!domain) {
    showToast('Please enter a website URL');
    return;
  }

  // Clear previous cached results
  localStorage.removeItem('lastSearchResults');
  localStorage.removeItem('lastSearchTimestamp');

  // Update UI
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('smart-results-section').classList.add('hidden');
  document.getElementById('loading-state').classList.remove('hidden');

  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

  updateProgress(5, 'Starting AI Agent...');

  try {
    const progressMessages = [
      [10, 'Creating browser session...'],
      [20, 'Navigating to website...'],
      [30, 'Testing Query 1/5...'],
      [45, 'Testing Query 2/5...'],
      [60, 'Testing Query 3/5...'],
      [75, 'Testing Query 4/5...'],
      [85, 'Testing Query 5/5...'],
      [95, 'Building report...'],
    ];

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
    }, 4000);

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

    // Save to localStorage for persistence
    try {
      localStorage.setItem('lastSearchResults', JSON.stringify(data));
      localStorage.setItem('lastSearchTimestamp', Date.now().toString());
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }

    updateProgress(100, 'Complete!');
    await new Promise(r => setTimeout(r, 500));

    renderResults(data);

  } catch (error) {
    console.error('Analysis error:', error);
    showToast('Error: ' + error.message);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-play"></i> Run Analysis';
  }
}

/**
 * Render results
 */
function renderResults(data) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('smart-results-section').classList.remove('hidden');

  const { siteProfile, comparison, screenshotUrls, durationMs, adversarial, summary } = data;
  const verdict = comparison?.verdict || data.verdict || 'INCONCLUSIVE';

  // Verdict card
  const verdictCard = document.getElementById('smart-verdict-card');
  const verdictBadge = document.getElementById('smart-verdict-badge');
  const verdictTitle = document.getElementById('smart-verdict-title');
  const verdictReason = document.getElementById('smart-verdict-reason');
  const durationEl = document.getElementById('smart-duration');
  const verdictIconContainer = document.getElementById('verdict-icon-container');
  const verdictIcon = document.getElementById('verdict-icon');

  // Set verdict styling
  if (verdict === 'OUTREACH') {
    verdictCard.className = 'card p-6 verdict-outreach';
    verdictBadge.className = 'text-xs font-bold uppercase tracking-wider px-2 py-1 rounded badge-opportunity';
    verdictBadge.textContent = '🎯 OPPORTUNITY';
    verdictTitle.textContent = 'Search Opportunity Found';
    verdictIconContainer.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-amber-100';
    verdictIcon.className = 'fas fa-lightbulb text-2xl text-amber-500';
  } else if (verdict === 'SKIP') {
    verdictCard.className = 'card p-6 verdict-skip';
    verdictBadge.className = 'text-xs font-bold uppercase tracking-wider px-2 py-1 rounded badge-success';
    verdictBadge.textContent = '✓ SKIP';
    verdictTitle.textContent = 'Search Passed All Tests';
    verdictIconContainer.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-green-100';
    verdictIcon.className = 'fas fa-check text-2xl text-green-500';
  } else {
    verdictCard.className = 'card p-6 verdict-review';
    verdictBadge.className = 'text-xs font-bold uppercase tracking-wider px-2 py-1 rounded badge-warning';
    verdictBadge.textContent = '⚠ REVIEW';
    verdictTitle.textContent = 'Could Not Fully Evaluate';
    verdictIconContainer.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-yellow-100';
    verdictIcon.className = 'fas fa-question text-2xl text-yellow-600';
  }

  verdictReason.textContent = comparison?.reason || '';
  durationEl.textContent = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '';

  // Screenshots grid
  renderScreenshots(adversarial, screenshotUrls, siteProfile);

  // Narrative summary
  renderNarrative(summary?.narrative || adversarial?.narrative);

  // Queries tested (with insight explanation)
  renderQueriesTested(adversarial?.queriesTested || [], summary?.queryInsight);

  // Queries that would work
  renderWorkingQueries(summary?.queriesThatWork || []);

  // Site profile
  renderSiteProfile(siteProfile);

  // Raw JSON
  document.getElementById('smart-raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Render screenshots grid
 */
function renderScreenshots(adversarial, screenshots, siteProfile) {
  const grid = document.getElementById('smart-screenshots-grid');
  if (!grid || !screenshots) return;

  const items = [];

  // Homepage
  if (screenshots.homepage) {
    items.push({
      url: screenshots.homepage,
      label: 'Homepage',
      sublabel: siteProfile?.companyName || siteProfile?.company || ''
    });
  }

  // Query results
  const queriesTested = adversarial?.queriesTested || [];
  queriesTested.forEach((q, i) => {
    const url = screenshots[`results_${i + 1}`] || screenshots.results;
    if (url) {
      items.push({
        url,
        label: q.passed ? `✅ Query ${i + 1}` : `❌ Query ${i + 1}`,
        sublabel: q.query?.substring(0, 40) + (q.query?.length > 40 ? '...' : ''),
        failed: !q.passed
      });
    }
  });

  grid.innerHTML = items.map(item => `
    <div class="cursor-pointer group" onclick="openModal('${item.url}')">
      <div class="screenshot-container ${item.failed ? 'border-red-300' : ''} group-hover:shadow-lg transition">
        <img src="${item.url}" alt="${item.label}">
      </div>
      <p class="text-sm font-medium mt-2 ${item.failed ? 'text-red-600' : 'text-gray-900'}">${item.label}</p>
      <p class="text-xs text-gray-500 truncate">${item.sublabel || ''}</p>
    </div>
  `).join('');
}

/**
 * Render narrative summary
 */
function renderNarrative(narrative) {
  const container = document.getElementById('narrative-summary');
  if (!container) return;

  if (narrative) {
    container.innerHTML = `
      <div class="bg-gray-50 rounded-lg p-4 text-gray-700 leading-relaxed whitespace-pre-line">
        ${narrative}
      </div>
    `;
  } else {
    container.innerHTML = `<p class="text-gray-400 italic">No summary available.</p>`;
  }
}

/**
 * Render queries tested
 */
function renderQueriesTested(queries, insight) {
  const container = document.getElementById('queries-tested');
  if (!container) return;

  if (queries.length === 0) {
    container.innerHTML = `<p class="text-gray-400 italic">No queries tested.</p>`;
    return;
  }

  // Show insight box first if available
  const insightHtml = insight ? `
    <div class="mb-6 p-4 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-lg">
      <div class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fas fa-brain text-amber-600"></i>
        </div>
        <div>
          <h4 class="font-semibold text-amber-900 mb-1">What This Means</h4>
          <p class="text-sm text-amber-800 leading-relaxed">${insight}</p>
        </div>
      </div>
    </div>
  ` : '';

  const queriesHtml = queries.map((q, i) => `
    <div class="p-4 rounded-lg ${q.passed ? 'query-passed' : 'query-failed'}">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-semibold ${q.passed ? 'text-green-700' : 'text-amber-700'}">
              Query ${i + 1}
            </span>
            <span class="text-xs px-2 py-0.5 rounded-full ${q.passed ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}">
              ${q.passed ? 'HANDLED' : 'OPPORTUNITY'}
            </span>
          </div>
          <p class="font-medium text-gray-900">"${q.query}"</p>
          ${q.resultCount !== null && q.resultCount !== undefined ?
      `<p class="text-sm text-gray-500 mt-1">${q.resultCount} results found</p>` : ''
    }
          ${q.reasoning ?
      `<p class="text-sm text-gray-600 mt-2 italic">${q.reasoning}</p>` : ''
    }
        </div>
        <div class="text-2xl ${q.passed ? 'text-green-500' : 'text-amber-500'}">
          <i class="fas ${q.passed ? 'fa-check-circle' : 'fa-lightbulb'}"></i>
        </div>
      </div>
    </div>
  `).join('');

  container.innerHTML = insightHtml + queriesHtml;
}

/**
 * Render queries that would work
 */
function renderWorkingQueries(queries) {
  const section = document.getElementById('working-queries-section');
  const container = document.getElementById('working-queries');

  if (!section || !container) return;

  if (queries.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = queries.map(q => `
    <span class="px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-sm border border-gray-200">${q}</span>
  `).join('');
}

/**
 * Render site profile
 */
function renderSiteProfile(profile) {
  if (!profile) return;

  const grid = document.getElementById('site-profile-grid');
  if (!grid) return;

  const items = [
    { label: 'Company', value: profile.company || profile.companyName || 'Unknown' },
    { label: 'Industry', value: profile.industry || 'Unknown' },
    { label: 'Catalog Size', value: profile.estimatedCatalogSize || 'Unknown' },
    { label: 'Search Type', value: profile.searchType || 'Unknown' }
  ];

  grid.innerHTML = items.map(item => `
    <div class="bg-gray-50 rounded-lg p-3">
      <span class="text-xs text-gray-500 uppercase">${item.label}</span>
      <p class="font-medium text-gray-900">${item.value}</p>
    </div>
  `).join('');
}

/**
 * Update progress
 */
function updateProgress(pct, message) {
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('loading-message').textContent = message;
}

/**
 * Toggle section
 */
function toggleSection(id) {
  const content = document.getElementById(`${id}-content`);
  const chevron = document.getElementById(`${id}-chevron`);

  if (content) content.classList.toggle('open');
  if (chevron) {
    chevron.classList.toggle('fa-chevron-down');
    chevron.classList.toggle('fa-chevron-up');
  }
}

/**
 * Open modal
 */
function openModal(src) {
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

/**
 * Switch between tabs
 */
function switchTab(tab) {
  console.log('Switching to tab:', tab);

  // Hide all tabs
  const singleTab = document.getElementById('single-tab');
  const batchTab = document.getElementById('batch-tab');
  const tabSingleBtn = document.getElementById('tab-single');
  const tabBatchBtn = document.getElementById('tab-batch');

  if (!singleTab || !batchTab || !tabSingleBtn || !tabBatchBtn) {
    console.error('Tab elements not found');
    return;
  }

  if (tab === 'single') {
    singleTab.classList.remove('hidden');
    batchTab.classList.add('hidden');
    tabSingleBtn.style.borderBottomColor = '#1a1a1a';
    tabSingleBtn.style.color = '#1a1a1a';
    tabBatchBtn.style.borderBottomColor = 'transparent';
    tabBatchBtn.style.color = '#4b5563';
  } else {
    singleTab.classList.add('hidden');
    batchTab.classList.remove('hidden');
    tabBatchBtn.style.borderBottomColor = '#1a1a1a';
    tabBatchBtn.style.color = '#1a1a1a';
    tabSingleBtn.style.borderBottomColor = 'transparent';
    tabSingleBtn.style.color = '#4b5563';
  }
}

/**
 * Handle CSV file selection
 */
function handleCsvSelected() {
  const fileInput = document.getElementById('csv-file');
  const file = fileInput.files[0];

  if (!file) return;

  document.getElementById('csv-filename').classList.remove('hidden');
  document.getElementById('filename-text').textContent = file.name + ` (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
}

/**
 * Upload CSV and start batch processing
 */
async function uploadCsv() {
  const password = document.getElementById('csv-password').value.trim();
  const fileInput = document.getElementById('csv-file');
  const file = fileInput.files[0];

  if (!password) {
    showToast('Please enter the CSV upload password');
    return;
  }

  if (!file) {
    showToast('Please select a CSV file');
    return;
  }

  const btn = document.getElementById('upload-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/batch/upload', {
      method: 'POST',
      headers: {
        'x-csv-password': password
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }

    const data = await response.json();
    currentBatchId = data.batchId;

    showToast(`✓ Batch uploaded! ${data.totalDomains} domains queued for processing.`);

    // Show batch status
    document.getElementById('batch-empty-state').classList.add('hidden');
    document.getElementById('batch-status-section').classList.remove('hidden');

    // Clear form
    fileInput.value = '';
    document.getElementById('csv-filename').classList.add('hidden');
    document.getElementById('csv-password').value = '';

    // Start polling
    pollBatchStatus();
    if (batchPollInterval) clearInterval(batchPollInterval);
    batchPollInterval = setInterval(() => pollBatchStatus(), 5000);

  } catch (error) {
    console.error('Upload error:', error);
    showToast('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-upload"></i> Upload & Start Processing';
  }
}

/**
 * Poll batch status
 */
async function pollBatchStatus() {
  if (!currentBatchId) return;

  try {
    const response = await fetch(`/api/batch/${currentBatchId}`);

    if (!response.ok) {
      if (response.status === 404) {
        clearInterval(batchPollInterval);
        showToast('Batch not found');
      }
      return;
    }

    const data = await response.json();

    // Update progress
    const total = data.totalDomains;
    const completed = data.progress.completed;
    const progress = total > 0 ? (completed / total) * 100 : 0;

    document.getElementById('batch-progress-bar').style.width = `${progress}%`;
    document.getElementById('batch-progress-text').textContent = `${completed}/${total}`;
    document.getElementById('batch-total').textContent = total;
    document.getElementById('batch-completed').textContent = completed;
    document.getElementById('batch-running').textContent = data.progress.statusBreakdown.running;
    document.getElementById('batch-failed').textContent = data.progress.statusBreakdown.failed;
    document.getElementById('batch-id-display').textContent = data.batchId;

    // Stop polling when complete
    if (data.status === 'completed' || data.status === 'failed') {
      clearInterval(batchPollInterval);
      showToast(`Batch ${data.status === 'completed' ? 'completed' : 'failed'}!`);
    }

  } catch (error) {
    console.error('Poll error:', error);
  }
}

/**
 * Copy batch ID to clipboard
 */
function copyBatchId() {
  const batchId = document.getElementById('batch-id-display').textContent;
  navigator.clipboard.writeText(batchId);
  showToast('Batch ID copied!');
}

/**
 * Restore previous results from localStorage
 */
function restoreFromCache() {
  try {
    const savedResults = localStorage.getItem('lastSearchResults');
    const savedTimestamp = localStorage.getItem('lastSearchTimestamp');

    if (!savedResults || !savedTimestamp) return false;

    // Check if results are less than 24 hours old
    const age = Date.now() - parseInt(savedTimestamp);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (age > maxAge) {
      // Expired, clear it
      localStorage.removeItem('lastSearchResults');
      localStorage.removeItem('lastSearchTimestamp');
      return false;
    }

    // Restore results
    const data = JSON.parse(savedResults);
    currentData = data;
    renderResults(data);

    // Show restoration toast
    showToast(`✓ Restored previous results (${Math.round(age / 1000 / 60)} min ago)`);
    return true;
  } catch (e) {
    console.error('Failed to restore from cache:', e);
    return false;
  }
}

/**
 * Initialize page on load
 */
document.addEventListener('DOMContentLoaded', () => {
  // Set initial tab state (single tab active)
  switchTab('single');

  // Restore previous search results if available
  restoreFromCache();
});

/**
 * Keyboard shortcuts
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') startAnalysis();
});
