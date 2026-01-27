/**
 * Frontend JavaScript for Website Search Tool
 */

let currentJobId = null;
let pollInterval = null;

/**
 * Start a search
 */
async function startSearch() {
  const domainInput = document.getElementById('domain-input');
  const queryInput = document.getElementById('query-input');
  const domain = domainInput.value.trim();
  const query = queryInput.value.trim();

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
  document.getElementById('progress-section').classList.remove('hidden');

  // Clear any existing polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  try {
    // Create search job
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
  } catch (error) {
    console.error('Error starting search:', error);
    showToast(`Failed to start search: ${error.message}`, 'error');
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


