// User-friendly Image Page JavaScript

const API_BASE = '';
let currentImageId = null;
let allImageIds = [];

// Get image ID from URL
const pathParts = window.location.pathname.split('/');
const imageIdFromUrl = parseInt(pathParts[pathParts.length - 1]);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    currentImageId = imageIdFromUrl;

    // Check for embedded static data first
    // Check for embedded static data first
    const pageData = window.__PAGE_DATA__;

    if (pageData && pageData.image) {
        // Use static data - no API calls needed
        renderImage(pageData.image);

        // Display similar images from static data
        if (pageData.similar && Array.isArray(pageData.similar)) {
            displaySimilarImages(pageData.similar);
        }

        // Try to load navigation data
        loadAllImageIds().then(() => {
            setupNavigation();
            updateNavigation();
        });
    } else {
        // Fall back to API
        loadAllImageIds().then(() => {
            loadImage(currentImageId);
            setupNavigation();
        });
    }
});

const NAV_CACHE_KEY = 'image-nav::ids';
const NAV_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load all image IDs for navigation
async function loadAllImageIds() {
    const cachedIds = getCachedNavIds();
    if (cachedIds && Array.isArray(cachedIds) && cachedIds.length > 0) {
        allImageIds = cachedIds;
        return;
    }

    const limit = 200;
    let offset = 0;
    let hasMore = true;
    const ids = [];

    try {
        while (hasMore) {
            const params = new URLSearchParams({
                limit,
                offset
            });

            const response = await fetch(`${API_BASE}/api/public/images?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load image IDs: ${response.status}`);
            }

            const data = await response.json();
            const images = Array.isArray(data.images) ? data.images : [];

            images.forEach(img => {
                if (typeof img.image_id === 'number') {
                    ids.push(img.image_id);
                }
            });

            const pageHasMore = data.has_more ?? (images.length === limit);
            hasMore = pageHasMore && images.length > 0;
            if (hasMore) {
                offset += limit;
            }
        }

        allImageIds = ids;
        cacheNavIds(ids);
    } catch (error) {
        console.error('Error loading image IDs:', error);
    }
}

// Render image from data (works with both static and API data)
function renderImage(image) {
    const imageEl = document.getElementById('main-image');
    const infoEl = document.getElementById('image-info');

    if (!imageEl || !infoEl) return;

    // Build srcset from predictable variant pattern (no manifest needed)
    if (image.base_url) {
        const base = image.base_url;

        // Update picture sources
        const sourceLargeAvif = document.getElementById('source-large-avif');
        const sourceLargeWebp = document.getElementById('source-large-webp');
        const sourceSmallAvif = document.getElementById('source-small-avif');
        const sourceSmallWebp = document.getElementById('source-small-webp');

        if (sourceLargeAvif) sourceLargeAvif.srcset = `${base}/large.avif`;
        if (sourceLargeWebp) sourceLargeWebp.srcset = `${base}/large.webp`;
        if (sourceSmallAvif) sourceSmallAvif.srcset = `${base}/small.avif`;
        if (sourceSmallWebp) sourceSmallWebp.srcset = `${base}/small.webp`;

        imageEl.src = `${base}/original.jpg`;  // Fallback for browsers without picture support
    } else {
        // Fallback to old behavior
        imageEl.src = image.image_url;
    }
    imageEl.alt = image.image_name || 'Image';

    // Build info HTML
    const rollNumber = image.roll_number;
    const rollDate = image.roll_date || image.capture_date;
    const description = image.description;
    const rollComment = image.roll_comment;
    const batchName = image.batch_name;

    infoEl.innerHTML = `
        <div class="image-page__section">
            <h2 class="image-page__section-title">Image Information</h2>
            ${rollDate ? `
                <div class="image-page__field">
                    <span class="image-page__label">Capture Date</span>
                    <span class="image-page__value">${rollDate}</span>
                </div>
            ` : ''}
            ${rollNumber ? `
                <div class="image-page__field">
                    <span class="image-page__label">Roll Number</span>
                    <span class="image-page__value">
                        <a href="/roll/${rollNumber}">${rollNumber}</a>
                    </span>
                </div>
            ` : ''}
            ${batchName ? `
                <div class="image-page__field">
                    <span class="image-page__label">Batch</span>
                    <span class="image-page__value">${batchName}</span>
                </div>
            ` : ''}
            ${rollComment ? `
                <div class="image-page__field">
                    <span class="image-page__label">Notes</span>
                    <span class="image-page__value">${escapeHtml(rollComment)}</span>
                </div>
            ` : ''}
        </div>

        ${description ? `
        <div class="image-page__section">
            <h2 class="image-page__section-title">Description</h2>
            <div class="image-page__description">${escapeHtml(description)}</div>
        </div>
        ` : ''}

        <div class="image-page__section">
            <a href="/image_detail/${image.image_id}" class="image-page__link">View technical details →</a>
        </div>
    `;

    updateNavigation();

    // Display similar images if available (from static data or API)
    if (image.similar_images && image.similar_images.length > 0) {
        displaySimilarImages(image.similar_images);
    } else if (image.scene_id) {
        // Fall back to API if not in static data
        loadSimilarImages(image.scene_id, image.image_id);
    }
}

// Load image data
async function loadImage(imageId) {
    const imageEl = document.getElementById('main-image');
    const infoEl = document.getElementById('image-info');

    imageEl.src = '';
    infoEl.innerHTML = '<p>Loading...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/public/images/${imageId}`);
        if (!response.ok) {
            throw new Error(`Failed to load image: ${response.status}`);
        }

        const image = await response.json();
        renderImage(image);
    } catch (error) {
        console.error('Error loading image:', error);
        infoEl.innerHTML = '<p>Error loading image details</p>';
    }
}

// Display similar images (works with both static and API data)
function displaySimilarImages(similarImages) {
    const similarSection = document.getElementById('similar-section');
    const similarGrid = document.getElementById('similar-grid');

    if (!similarSection || !similarGrid) return;

    if (similarImages && similarImages.length > 0) {
        similarGrid.innerHTML = similarImages.map(result => `
            <div class="image-page__similar-item">
                <a href="/image/${result.image_id || result.scene_id}/">
                    <img src="${result.thumbnail_url}"
                         alt="${result.base_filename}"
                         class="image-page__similar-thumb"
                         loading="lazy">
                    <div class="image-page__similar-info">
                        ${result.base_filename}
                    </div>
                </a>
            </div>
        `).join('');

        similarSection.style.display = 'block';
    }
}

// Load and display similar images from API
async function loadSimilarImages(sceneId, currentImageId) {
    try {
        const response = await fetch(`${API_BASE}/api/public/similar?scene_id=${encodeURIComponent(sceneId)}`);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            displaySimilarImages(data.results);
        }
    } catch (error) {
        console.error('Error loading similar images:', error);
    }
}

// Setup navigation
function setupNavigation() {
    const prevBtn = document.getElementById('prev-button');
    const nextBtn = document.getElementById('next-button');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateImage(-1));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateImage(1));
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            navigateImage(-1);
        } else if (e.key === 'ArrowRight') {
            navigateImage(1);
        }
    });
}

// Update navigation buttons
function updateNavigation() {
    const prevBtn = document.getElementById('prev-button');
    const nextBtn = document.getElementById('next-button');

    if (!prevBtn || !nextBtn) return;

    const currentIndex = allImageIds.indexOf(currentImageId);
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= allImageIds.length - 1;
}

// Navigate to next/previous image
function navigateImage(delta) {
    const currentIndex = allImageIds.indexOf(currentImageId);
    const newIndex = currentIndex + delta;

    if (newIndex >= 0 && newIndex < allImageIds.length) {
        const newImageId = allImageIds[newIndex];
        window.location.href = `/image/${newImageId}`;
    }
}

// Helper functions


function cacheNavIds(ids) {
    try {
        const payload = {
            ids,
            cached_at: Date.now()
        };
        sessionStorage.setItem(NAV_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Unable to cache navigation IDs:', error);
    }
}

function getCachedNavIds() {
    try {
        const raw = sessionStorage.getItem(NAV_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.ids)) return null;
        if (!parsed.cached_at || (Date.now() - parsed.cached_at) > NAV_CACHE_TTL) {
            sessionStorage.removeItem(NAV_CACHE_KEY);
            return null;
        }
        return parsed.ids;
    } catch (error) {
        sessionStorage.removeItem(NAV_CACHE_KEY);
        return null;
    }
}

