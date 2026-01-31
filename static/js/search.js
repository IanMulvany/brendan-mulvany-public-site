// Search Page JavaScript - FTS5 API Search

const API_BASE = '';
let searchTimeout = null;
let currentFilters = {};

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const initialQuery = urlParams.get('q') || 'dublin';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const searchQueryEl = document.getElementById('search-query');
    searchQueryEl.value = initialQuery;
    currentFilters.q = initialQuery;

    performSearch();
    setupEventListeners();
});

function setupEventListeners() {
    const searchQuery = document.getElementById('search-query');
    const rollDate = document.getElementById('filter-roll-date');
    const clearFilters = document.getElementById('clear-filters');

    // Search on input (debounced)
    searchQuery.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentFilters.q = e.target.value.trim() || null;
            performSearch();
        }, 500);
    });

    // Filter changes
    rollDate.addEventListener('input', (e) => {
        currentFilters.roll_date = e.target.value.trim() || null;
        performSearch();
    });

    clearFilters.addEventListener('click', () => {
        searchQuery.value = 'dublin';
        rollDate.value = '';
        currentFilters = { q: 'dublin' };
        performSearch();
    });
}

async function performSearch() {
    const resultsGrid = document.getElementById('results-grid');
    const resultsCount = document.getElementById('results-count');

    resultsGrid.innerHTML = '<p>Searching...</p>';

    try {
        const params = new URLSearchParams();
        if (currentFilters.q) {
            params.append('q', currentFilters.q);
        }
        if (currentFilters.roll_date) {
            params.append('roll_date', currentFilters.roll_date);
        }

        const response = await fetch(`${API_BASE}/api/public/search?${params.toString()}`);
        if (!response.ok) {
            const body = await response.text();
            throw new Error(body || `Search request failed (${response.status})`);
        }
        const data = await response.json();

        resultsCount.textContent = `${data.total} result${data.total !== 1 ? 's' : ''} found`;

        if (data.results && data.results.length > 0) {
            resultsGrid.innerHTML = data.results.map(img => `
                <div class="search-page__result-item">
                    <a href="/image/${img.image_id}/">
                        <img src="${img.thumbnail_url}"
                             alt="${img.image_name || img.base_filename}"
                             class="search-page__result-thumb"
                             loading="lazy">
                        <div class="search-page__result-info">
                            <div class="search-page__result-filename">${escapeHtml(img.image_name || img.base_filename)}</div>
                            <div class="search-page__result-meta">
                                ${img.roll_number ? `Roll: ${img.roll_number} • ` : ''}
                                ${img.capture_date || img.roll_date || ''}
                            </div>
                        </div>
                    </a>
                </div>
            `).join('');
        } else {
            resultsGrid.innerHTML = `
                <div class="search-page__no-results">
                    <p>No results found</p>
                    <p style="font-size: 14px; margin-top: 10px;">Try adjusting your search criteria</p>
                </div>
            `;
        }

        displayFacets(data.facets);

    } catch (error) {
        console.error('Error performing search:', error);
        resultsGrid.innerHTML = '<p>Error performing search. Please try again.</p>';
    }
}

function displayFacets(facets) {
    if (!facets) return;

    // Roll date facets
    const rollDatesFacet = document.getElementById('facet-roll-dates');
    if (facets.roll_dates && facets.roll_dates.length > 0) {
        rollDatesFacet.innerHTML = facets.roll_dates.map(f => `
            <div class="search-page__facet-item ${currentFilters.roll_date === f.value ? 'active' : ''}" 
                 onclick="selectFacet('roll_date', '${f.value}')">
                <span>${escapeHtml(f.value)}</span>
                <span class="search-page__facet-count">${f.count}</span>
            </div>
        `).join('');
    } else {
        rollDatesFacet.innerHTML = '';
    }
}

function selectFacet(facetType, value) {
    // Toggle facet - if already selected, clear it
    if (currentFilters[facetType] === value) {
        currentFilters[facetType] = null;
        // Clear the input
        if (facetType === 'roll_date') {
            document.getElementById('filter-roll-date').value = '';
        }
    } else {
        currentFilters[facetType] = value;
        // Set the input
        if (facetType === 'roll_date') {
            document.getElementById('filter-roll-date').value = value;
        }
    }

    performSearch();
}


