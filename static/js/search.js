// Advanced Search Page JavaScript

const API_BASE = '';
let searchTimeout = null;
let currentFilters = {};

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const initialQuery = urlParams.get('q') || '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Set initial query if present
    if (initialQuery) {
        document.getElementById('search-query').value = initialQuery;
        currentFilters.q = initialQuery;
    }
    
    // Load initial results
    performSearch();
    
    // Setup event listeners
    setupEventListeners();
});

function setupEventListeners() {
    const searchQuery = document.getElementById('search-query');
    const rollNumber = document.getElementById('filter-roll-number');
    const rollDate = document.getElementById('filter-roll-date');
    const batchName = document.getElementById('filter-batch-name');
    const dateSource = document.getElementById('filter-date-source');
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
    rollNumber.addEventListener('input', (e) => {
        currentFilters.roll_number = e.target.value.trim() || null;
        performSearch();
    });
    
    rollDate.addEventListener('input', (e) => {
        currentFilters.roll_date = e.target.value.trim() || null;
        performSearch();
    });
    
    batchName.addEventListener('change', (e) => {
        currentFilters.batch_name = e.target.value || null;
        performSearch();
    });
    
    dateSource.addEventListener('change', (e) => {
        currentFilters.date_source = e.target.value || null;
        performSearch();
    });
    
    clearFilters.addEventListener('click', () => {
        searchQuery.value = '';
        rollNumber.value = '';
        rollDate.value = '';
        batchName.value = '';
        dateSource.value = '';
        currentFilters = {};
        performSearch();
    });
}

async function performSearch() {
    const resultsGrid = document.getElementById('results-grid');
    const resultsCount = document.getElementById('results-count');
    
    resultsGrid.innerHTML = '<p>Searching...</p>';
    
    try {
        // Build query params
        const params = new URLSearchParams();
        if (currentFilters.q) params.append('q', currentFilters.q);
        if (currentFilters.roll_number) params.append('roll_number', currentFilters.roll_number);
        if (currentFilters.roll_date) params.append('roll_date', currentFilters.roll_date);
        if (currentFilters.batch_name) params.append('batch_name', currentFilters.batch_name);
        if (currentFilters.date_source) params.append('date_source', currentFilters.date_source);
        
        const response = await fetch(`${API_BASE}/api/public/search?${params.toString()}`);
        if (!response.ok) {
            const body = await response.text();
            throw new Error(body || `Search request failed (${response.status})`);
        }
        const data = await response.json();
        
        // Update results count
        resultsCount.textContent = `${data.total} result${data.total !== 1 ? 's' : ''} found`;
        
        // Display results
        if (data.results && data.results.length > 0) {
            resultsGrid.innerHTML = data.results.map(img => `
                <div class="search-page__result-item">
                    <a href="/image/${img.image_id}">
                        <img src="${img.thumbnail_url}" 
                             alt="${img.image_name}" 
                             class="search-page__result-thumb"
                             loading="lazy">
                        <div class="search-page__result-info">
                            <div class="search-page__result-filename">${escapeHtml(img.base_filename)}</div>
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
        
        // Display facets
        displayFacets(data.facets);
        
    } catch (error) {
        console.error('Error performing search:', error);
        resultsGrid.innerHTML = '<p>Error performing search. Please try again.</p>';
    }
}

function displayFacets(facets) {
    if (!facets) return;
    
    // Roll number facets
    const rollNumbersFacet = document.getElementById('facet-roll-numbers');
    if (facets.roll_numbers && facets.roll_numbers.length > 0) {
        rollNumbersFacet.innerHTML = facets.roll_numbers.map(f => `
            <div class="search-page__facet-item ${currentFilters.roll_number === f.value ? 'active' : ''}" 
                 onclick="selectFacet('roll_number', '${f.value}')">
                <span>${escapeHtml(f.value)}</span>
                <span class="search-page__facet-count">${f.count}</span>
            </div>
        `).join('');
    } else {
        rollNumbersFacet.innerHTML = '';
    }
    
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
    
    // Batch name facets
    const batchNamesFacet = document.getElementById('facet-batch-names');
    const batchNameSelect = document.getElementById('filter-batch-name');
    if (facets.batch_names && facets.batch_names.length > 0) {
        // Update select options
        const currentValue = batchNameSelect.value;
        batchNameSelect.innerHTML = '<option value="">All batches</option>' + 
            facets.batch_names.map(f => 
                `<option value="${escapeHtml(f.value)}" ${currentValue === f.value ? 'selected' : ''}>${escapeHtml(f.value)} (${f.count})</option>`
            ).join('');
        
        // Also show as clickable list
        batchNamesFacet.innerHTML = facets.batch_names.map(f => `
            <div class="search-page__facet-item ${currentFilters.batch_name === f.value ? 'active' : ''}" 
                 onclick="selectFacet('batch_name', '${f.value}')">
                <span>${escapeHtml(f.value)}</span>
                <span class="search-page__facet-count">${f.count}</span>
            </div>
        `).join('');
    } else {
        batchNamesFacet.innerHTML = '';
    }
    
    // Date source facets
    const dateSourcesFacet = document.getElementById('facet-date-sources');
    if (facets.date_sources && facets.date_sources.length > 0) {
        dateSourcesFacet.innerHTML = facets.date_sources.map(f => `
            <div class="search-page__facet-item ${currentFilters.date_source === f.value ? 'active' : ''}" 
                 onclick="selectFacet('date_source', '${f.value}')">
                <span>${escapeHtml(f.value)}</span>
                <span class="search-page__facet-count">${f.count}</span>
            </div>
        `).join('');
    } else {
        dateSourcesFacet.innerHTML = '';
    }
}

function selectFacet(facetType, value) {
    // Toggle facet - if already selected, clear it
    if (currentFilters[facetType] === value) {
        currentFilters[facetType] = null;
        // Clear the input/select
        if (facetType === 'roll_number') {
            document.getElementById('filter-roll-number').value = '';
        } else if (facetType === 'roll_date') {
            document.getElementById('filter-roll-date').value = '';
        } else if (facetType === 'batch_name') {
            document.getElementById('filter-batch-name').value = '';
        } else if (facetType === 'date_source') {
            document.getElementById('filter-date-source').value = '';
        }
    } else {
        currentFilters[facetType] = value;
        // Set the input/select
        if (facetType === 'roll_number') {
            document.getElementById('filter-roll-number').value = value;
        } else if (facetType === 'roll_date') {
            document.getElementById('filter-roll-date').value = value;
        } else if (facetType === 'batch_name') {
            document.getElementById('filter-batch-name').value = value;
        } else if (facetType === 'date_source') {
            document.getElementById('filter-date-source').value = value;
        }
    }
    
    performSearch();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

