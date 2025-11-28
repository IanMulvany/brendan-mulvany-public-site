// Year Page JavaScript

const API_BASE = '';

// Get year from URL
const pathParts = window.location.pathname.split('/');
const year = pathParts[pathParts.length - 2]; // /year/1980/index.html -> 1980

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check for embedded static data first
    const pageData = window.__PAGE_DATA__;
    if (pageData) {
        // Use static data - no API call needed
        const data = {
            year: pageData.year,
            count: pageData.count,
            images: pageData.images || []
        };
        displayYearData(data);
    } else {
        // Fall back to API
        loadYearData(year);
    }
});

// Display year data (works with both static and API data)
function displayYearData(data) {
    const titleEl = document.getElementById('year-number');
    const metadataEl = document.getElementById('year-metadata');
    const galleryEl = document.getElementById('year-gallery');

    const images = data.images || [];
    const yearValue = data.year || year;

    if (titleEl) titleEl.textContent = yearValue;

    if (metadataEl) {
        metadataEl.innerHTML = `
            <div class="year-page__metadata-item">
                <span class="year-page__metadata-label">Year:</span>
                <span class="year-page__metadata-value">${yearValue}</span>
            </div>
            <div class="year-page__metadata-item">
                <span class="year-page__metadata-label">Total Photos:</span>
                <span class="year-page__metadata-value">${images.length}</span>
            </div>
        `;
    }

    if (galleryEl) {
        if (images.length > 0) {
            galleryEl.innerHTML = images.map(img => `
                <div class="year-page__item">
                    <a href="/image/${img.image_id}">
                        <img src="${img.thumbnail_url || img.image_url}"
                             alt="${img.image_name || img.base_filename}"
                             class="year-page__thumb"
                             loading="lazy">
                        <div class="year-page__info">
                            <div class="year-page__filename">${img.image_name || img.base_filename}</div>
                            ${img.capture_date ? `<div class="year-page__date">${img.capture_date}</div>` : ''}
                        </div>
                    </a>
                </div>
            `).join('');
        } else {
            galleryEl.innerHTML = '<p>No images found for this year.</p>';
        }
    }
}

// Load year data from API (fallback if not static)
async function loadYearData(year) {
    const titleEl = document.getElementById('year-number');
    const metadataEl = document.getElementById('year-metadata');
    const galleryEl = document.getElementById('year-gallery');

    if (titleEl) titleEl.textContent = year;
    if (metadataEl) metadataEl.innerHTML = '<p>Loading...</p>';
    if (galleryEl) galleryEl.innerHTML = '<p>Loading images...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/public/year/${encodeURIComponent(year)}`);
        const data = await response.json();
        displayYearData(data);
    } catch (error) {
        console.error('Error loading year data:', error);
        if (metadataEl) metadataEl.innerHTML = '<p>Error loading year information</p>';
        if (galleryEl) galleryEl.innerHTML = '<p>Error loading images</p>';
    }
}
