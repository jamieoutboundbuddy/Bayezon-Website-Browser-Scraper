/**
 * Frontend JavaScript for Website Search Tool
 */

let currentJobId = null;
let pollInterval = null;
let currentAnalysis = null;

/**
 * Start a search
 */
async function startSearch() {
  const domainInput = document.getElementById('domain-input');
  const queryInput = document.getElementById('query-input');
  const analyzeToggle = document.getElementById('analyze-toggle');
  
  const domain = domainInput.value.trim();
  const query = queryInput.value.trim();
  const analyze = analyzeToggle.checked;

  if (!domain) {
    showToast('Please enter a website URL', 'error');
    return;
  }

  if (!query) {
    showToast('Please enter a search query', 'error');
    return;
  }

  // Reset UI
  document.getElementById('screenshots-container').innerHTML = '';
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('screenshots-section').classList.add('hidden');
  document.getElementById('analysis-section').classList.add('hidden');
  document.getElementById('progress-section').classList.remove('hidden');
  currentAnalysis = null;

  // Clear any existing polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Disable search button
  const searchBtn = document.getElementById('search-btn');
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

  try {
    if (analyze) {
      // Use sync endpoint with analysis
      updateProgress(10, 'running');
      document.getElementById('progress-message').textContent = 'Taking screenshots and analyzing with AI...';
      
      const response = await fetch('/api/search/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, query, analyze: true }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      currentAnalysis = data;
      
      // Show screenshots
      if (data.screenshot_urls) {
        document.getElementById('screenshots-section').classList.remove('hidden');
        renderScreenshotsFromUrls(data.screenshot_urls);
      }
      
      // Show analysis
      renderAnalysis(data);
      
      updateProgress(100, 'completed');
      showToast('Search and analysis completed!', 'success');
      
    } else {
      // Use async endpoint without analysis
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, query }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.jobId) {
        throw new Error('No jobId returned from server');
      }
      
      currentJobId = data.jobId;
      showToast(`Search started for ${domain}`, 'success');
      
      // Start polling
      pollSearch();
    }
  } catch (error) {
    console.error('Error starting search:', error);
    showToast(`Failed to start search: ${error.message}`, 'error');
    updateProgress(0, 'failed');
  } finally {
    // Re-enable search button
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<i class="fas fa-search"></i> Run Search';
  }
}

/**
 * Poll search status and render screenshots as they complete
 */
async function pollSearch() {
  if (!currentJobId) return;

  try {
    const response = await fetch(`/api/search/${currentJobId}`);
    const result = await response.json();

    // Update progress
    updateProgress(result.progressPct, result.status);

    // Render screenshots
    if (result.screenshots && result.screenshots.length > 0) {
      document.getElementById('screenshots-section').classList.remove('hidden');
      renderScreenshots(result.screenshots);
    }

    // Continue polling if not done
    if (result.status !== 'completed' && result.status !== 'failed') {
      pollInterval = setTimeout(() => pollSearch(), 2000);
    } else {
      // Done!
      showToast(
        result.status === 'completed' ? 'Search completed!' : 'Search failed',
        result.status === 'completed' ? 'success' : 'error'
      );
      if (result.error) {
        showToast(result.error, 'error');
      }
    }
  } catch (error) {
    console.error('Error polling search:', error);
    showToast('Error checking search status', 'error');
  }
}

/**
 * Render screenshots from URL object (from analysis response)
 */
function renderScreenshotsFromUrls(urls) {
  const container = document.getElementById('screenshots-container');
  container.innerHTML = '';
  
  const stages = [
    { key: 'homepage', label: 'Homepage', icon: 'fa-home' },
    { key: 'search_modal', label: 'Search Modal', icon: 'fa-search' },
    { key: 'search_results', label: 'Search Results', icon: 'fa-list' },
  ];
  
  stages.forEach(stage => {
    if (!urls[stage.key]) return;
    
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden';
    card.innerHTML = `
      <div class="p-4 border-b border-slate-200">
        <h3 class="font-semibold text-slate-900 flex items-center gap-2">
          <i class="fas ${stage.icon} text-blue-600"></i>
          ${stage.label}
        </h3>
      </div>
      <div class="screenshot-preview-container">
        <img 
          src="${urls[stage.key]}"
          alt="${stage.label}"
          class="screenshot-preview cursor-pointer"
          onclick="openModal('${urls[stage.key]}', '${stage.label}')"
        >
      </div>
    `;
    container.appendChild(card);
  });
}

/**
 * Render screenshots in grid
 */
function renderScreenshots(screenshots) {
  const container = document.getElementById('screenshots-container');
  
  const stageLabels = {
    homepage: 'Homepage',
    search_modal: 'Search Modal',
    search_results: 'Search Results',
  };

  const stageIcons = {
    homepage: 'fa-home',
    search_modal: 'fa-search',
    search_results: 'fa-list',
  };

  // Create a map to track which screenshots we've already rendered
  const renderedStages = new Set();
  const existingCards = container.querySelectorAll('[data-stage]');
  existingCards.forEach(card => {
    const stage = card.getAttribute('data-stage');
    if (screenshots.some(s => s.stage === stage)) {
      renderedStages.add(stage);
    } else {
      card.remove();
    }
  });

  // Add new screenshots
  screenshots.forEach(screenshot => {
    if (renderedStages.has(screenshot.stage)) {
      return; // Already rendered
    }

    const stageLabel = stageLabels[screenshot.stage] || screenshot.stage;
    const stageIcon = stageIcons[screenshot.stage] || 'fa-image';

    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden';
    card.setAttribute('data-stage', screenshot.stage);

    card.innerHTML = `
      <div class="p-4 border-b border-slate-200">
        <h3 class="font-semibold text-slate-900 flex items-center gap-2">
          <i class="fas ${stageIcon} text-blue-600"></i>
          ${stageLabel}
        </h3>
        <p class="text-xs text-slate-500 mt-1 truncate">${screenshot.url}</p>
      </div>
      <div class="screenshot-preview-container">
        <img 
          src="${screenshot.screenshotUrl}"
          alt="${stageLabel}"
          class="screenshot-preview cursor-pointer"
          onclick="openModal('${screenshot.screenshotUrl}', '${stageLabel}')"
        >
      </div>
    `;

    container.appendChild(card);
    renderedStages.add(screenshot.stage);
  });
}

/**
 * Render analysis results
 */
function renderAnalysis(data) {
  document.getElementById('analysis-section').classList.remove('hidden');
  
  // Prospect Score
  const scoreEl = document.getElementById('prospect-score');
  const score = data.outreach_qualification?.prospect_score || 0;
  const isGoodProspect = data.outreach_qualification?.is_good_prospect;
  const recommendation = data.outreach_qualification?.recommended_action || 'review';
  
  scoreEl.textContent = score;
  scoreEl.className = `text-5xl font-bold ${getScoreColor(score)}`;
  
  document.getElementById('prospect-label').textContent = isGoodProspect ? 'Good Prospect' : 'Review Needed';
  document.getElementById('prospect-label').className = `text-sm font-medium mt-1 ${isGoodProspect ? 'text-green-600' : 'text-amber-600'}`;
  
  const recBadge = {
    outreach: { text: 'Recommended: Outreach', class: 'bg-green-100 text-green-800' },
    skip: { text: 'Recommended: Skip', class: 'bg-red-100 text-red-800' },
    review: { text: 'Recommended: Review', class: 'bg-amber-100 text-amber-800' },
  };
  const rec = recBadge[recommendation] || recBadge.review;
  document.getElementById('prospect-recommendation').innerHTML = `<span class="px-2 py-1 rounded-full text-xs font-medium ${rec.class}">${rec.text}</span>`;
  
  // Reasons
  const reasonsEl = document.getElementById('prospect-reasons');
  const reasons = data.outreach_qualification?.reasons || [];
  const disqualifiers = data.outreach_qualification?.disqualifiers || [];
  
  reasonsEl.innerHTML = `
    ${reasons.length > 0 ? `
      <div class="mb-3">
        <p class="text-sm font-medium text-green-700 mb-2"><i class="fas fa-check-circle mr-1"></i> Why this is a good prospect:</p>
        <ul class="text-sm text-slate-600 space-y-1">
          ${reasons.map(r => `<li class="flex items-start gap-2"><i class="fas fa-check text-green-500 mt-0.5"></i>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}
    ${disqualifiers.length > 0 ? `
      <div>
        <p class="text-sm font-medium text-red-700 mb-2"><i class="fas fa-times-circle mr-1"></i> Potential concerns:</p>
        <ul class="text-sm text-slate-600 space-y-1">
          ${disqualifiers.map(d => `<li class="flex items-start gap-2"><i class="fas fa-times text-red-500 mt-0.5"></i>${escapeHtml(d)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}
  `;
  
  // Search Quality
  const qualityEl = document.getElementById('search-quality-content');
  const analysis = data.analysis || {};
  const quality = analysis.search_quality || 'unknown';
  const qualityColors = {
    excellent: 'text-green-600',
    good: 'text-green-500',
    average: 'text-amber-500',
    poor: 'text-orange-500',
    very_poor: 'text-red-600',
  };
  
  qualityEl.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Quality Rating</span>
        <span class="font-semibold ${qualityColors[quality] || 'text-slate-600'} capitalize">${quality.replace('_', ' ')}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Handles Natural Language</span>
        <span class="${analysis.handles_natural_language ? 'text-green-600' : 'text-red-600'}">
          <i class="fas fa-${analysis.handles_natural_language ? 'check' : 'times'}"></i>
          ${analysis.handles_natural_language ? 'Yes' : 'No'}
        </span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Matches Query Intent</span>
        <span class="${analysis.matches_query_intent ? 'text-green-600' : 'text-red-600'}">
          <i class="fas fa-${analysis.matches_query_intent ? 'check' : 'times'}"></i>
          ${analysis.matches_query_intent ? 'Yes' : 'No'}
        </span>
      </div>
      ${analysis.missed_opportunity ? `
        <div class="pt-3 border-t border-slate-200">
          <p class="text-sm font-medium text-slate-700 mb-1">Missed Opportunity:</p>
          <p class="text-sm text-slate-600">${escapeHtml(analysis.missed_opportunity)}</p>
        </div>
      ` : ''}
    </div>
  `;
  
  // Search Results
  const resultsEl = document.getElementById('search-results-content');
  const searchResults = data.search_results || {};
  
  resultsEl.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Returned Results</span>
        <span class="${searchResults.returned_results ? 'text-green-600' : 'text-red-600'}">
          ${searchResults.returned_results ? 'Yes' : 'No'}
        </span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Result Count</span>
        <span class="font-medium text-slate-900">${searchResults.result_count_text || searchResults.result_count || 'N/A'}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-600">Results Relevant</span>
        <span class="${searchResults.results_relevant ? 'text-green-600' : 'text-red-600'}">
          <i class="fas fa-${searchResults.results_relevant ? 'check' : 'times'}"></i>
          ${searchResults.results_relevant ? 'Yes' : 'No'}
        </span>
      </div>
      ${searchResults.products_shown_summary ? `
        <div class="pt-3 border-t border-slate-200">
          <p class="text-sm font-medium text-slate-700 mb-1">Products Shown:</p>
          <p class="text-sm text-slate-600">${escapeHtml(searchResults.products_shown_summary)}</p>
        </div>
      ` : ''}
    </div>
  `;
  
  // Issues Found
  const issuesCard = document.getElementById('issues-card');
  const issuesEl = document.getElementById('issues-content');
  const issues = analysis.issues_found || [];
  
  if (issues.length > 0) {
    issuesCard.classList.remove('hidden');
    issuesEl.innerHTML = issues.map(issue => {
      const severityColors = {
        high: 'bg-red-100 text-red-800 border-red-200',
        medium: 'bg-amber-100 text-amber-800 border-amber-200',
        low: 'bg-blue-100 text-blue-800 border-blue-200',
      };
      const color = severityColors[issue.severity] || severityColors.medium;
      
      return `
        <div class="p-3 rounded-lg border ${color} mb-3">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium text-sm">${escapeHtml(issue.issue.replace(/_/g, ' '))}</span>
            <span class="text-xs uppercase font-semibold">${issue.severity}</span>
          </div>
          <p class="text-sm opacity-90">${escapeHtml(issue.detail)}</p>
        </div>
      `;
    }).join('');
  } else {
    issuesCard.classList.add('hidden');
  }
  
  // Email Context
  const emailContextEl = document.getElementById('email-context-content');
  const emailContext = data.email_context || {};
  
  const contextFields = [
    { key: 'search_query_used', label: 'Search Query Used', icon: 'fa-search' },
    { key: 'what_search_returned', label: 'What Search Returned', icon: 'fa-list' },
    { key: 'what_was_missing', label: 'What Was Missing', icon: 'fa-exclamation-triangle' },
    { key: 'relevant_products_on_site', label: 'Relevant Products on Site', icon: 'fa-box' },
    { key: 'pain_point_summary', label: 'Pain Point Summary', icon: 'fa-bullseye' },
  ];
  
  emailContextEl.innerHTML = contextFields.map(field => {
    const value = emailContext[field.key];
    if (!value) return '';
    return `
      <div class="bg-slate-50 rounded-lg p-4">
        <p class="text-sm font-medium text-slate-700 mb-2">
          <i class="fas ${field.icon} text-slate-400 mr-2"></i>
          ${field.label}
        </p>
        <p class="text-slate-900">${escapeHtml(value)}</p>
      </div>
    `;
  }).join('');
  
  // Talking Points
  const talkingPoints = emailContext.suggested_talking_points || [];
  if (talkingPoints.length > 0) {
    emailContextEl.innerHTML += `
      <div class="bg-slate-50 rounded-lg p-4">
        <p class="text-sm font-medium text-slate-700 mb-2">
          <i class="fas fa-comments text-slate-400 mr-2"></i>
          Suggested Talking Points
        </p>
        <ul class="space-y-2">
          ${talkingPoints.map(point => `
            <li class="flex items-start gap-2 text-slate-900">
              <i class="fas fa-chevron-right text-indigo-500 mt-1 text-xs"></i>
              ${escapeHtml(point)}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }
  
  // Email Snippets
  const snippetsEl = document.getElementById('email-snippets-content');
  const snippets = emailContext.email_snippet_data || {};
  
  const snippetLabels = {
    opener: { label: 'Opener', icon: 'fa-door-open', desc: 'Start your email with...' },
    result: { label: 'Result', icon: 'fa-search', desc: 'What we found...' },
    observation: { label: 'Observation', icon: 'fa-eye', desc: 'Key insight...' },
    pain: { label: 'Pain Point', icon: 'fa-heart-broken', desc: 'The problem...' },
    pitch_hook: { label: 'Pitch Hook', icon: 'fa-lightbulb', desc: 'Your solution angle...' },
  };
  
  snippetsEl.innerHTML = Object.entries(snippets).map(([key, value]) => {
    const config = snippetLabels[key] || { label: key, icon: 'fa-quote-left', desc: '' };
    if (!value) return '';
    return `
      <div class="bg-white rounded-lg p-4 border border-indigo-200">
        <div class="flex items-center gap-2 mb-2">
          <i class="fas ${config.icon} text-indigo-600"></i>
          <span class="font-medium text-slate-900">${config.label}</span>
          <span class="text-xs text-slate-500">${config.desc}</span>
        </div>
        <p class="text-slate-700 italic">"${escapeHtml(value)}"</p>
        <button 
          onclick="copyToClipboard('${escapeHtml(value).replace(/'/g, "\\'")}')"
          class="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
        >
          <i class="fas fa-copy mr-1"></i>Copy
        </button>
      </div>
    `;
  }).join('');
  
  // Raw JSON
  document.getElementById('raw-json').textContent = JSON.stringify(data, null, 2);
}

/**
 * Get color class for score
 */
function getScoreColor(score) {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-green-500';
  if (score >= 40) return 'text-amber-500';
  if (score >= 20) return 'text-orange-500';
  return 'text-red-600';
}

/**
 * Toggle raw JSON visibility
 */
function toggleRawJson() {
  const container = document.getElementById('raw-json-container');
  const icon = document.getElementById('json-toggle-icon');
  const text = document.getElementById('json-toggle-text');
  
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    icon.classList.remove('fa-chevron-down');
    icon.classList.add('fa-chevron-up');
    text.textContent = 'Hide Raw JSON Response';
  } else {
    container.classList.add('hidden');
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    text.textContent = 'Show Raw JSON Response';
  }
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

/**
 * Update progress bar and message
 */
function updateProgress(progressPct, status) {
  document.getElementById('progress-bar').style.width = `${progressPct}%`;
  document.getElementById('progress-text').textContent = `${Math.round(progressPct)}%`;

  const messageMap = {
    queued: 'Waiting to start...',
    running: 'Search in progress... please wait',
    completed: 'Search completed!',
    failed: 'Search failed',
  };

  document.getElementById('progress-message').textContent =
    messageMap[status] || 'Processing...';
}

/**
 * Open image modal
 */
function openModal(imageSrc, title) {
  document.getElementById('modal-image').src = imageSrc;
  document.getElementById('modal-title').textContent = title || 'Screenshot';
  document.getElementById('image-modal').classList.remove('hidden');
}

/**
 * Close image modal
 */
function closeModal() {
  document.getElementById('image-modal').classList.add('hidden');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: 'check-circle',
    error: 'exclamation-circle',
    info: 'info-circle',
  };

  toast.innerHTML = `
    <div class="toast-content">
      <i class="fas fa-${icons[type] || 'info-circle'}"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  document.getElementById('toast-container').appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Close modal when clicking outside image
 */
document.getElementById('image-modal')?.addEventListener('click', e => {
  if (e.target.id === 'image-modal') {
    closeModal();
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('empty-state').classList.remove('hidden');
});
