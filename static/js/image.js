// User-friendly Image Page JavaScript

const API_BASE = '';
let currentImageId = null;
let navigationData = null;  // Static navigation within batch

// Get image ID from URL
const pathParts = window.location.pathname.split('/');
const imageIdFromUrl = parseInt(pathParts[pathParts.length - 1]);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    currentImageId = imageIdFromUrl;

    // Check for embedded static data first
    const pageData = window.__PAGE_DATA__;

    if (pageData && pageData.image) {
        // Use static data - no API calls needed
        renderImage(pageData.image);

        // Display similar images from static data
        if (pageData.similar && Array.isArray(pageData.similar)) {
            displaySimilarImages(pageData.similar);
        }

        // Use embedded navigation data for prev/next within batch
        navigationData = pageData.navigation || null;
        setupNavigation();
        updateNavigation();
        setupFullscreen();
    } else {
        // Fall back to API
        loadImage(currentImageId);
        setupNavigation();
        setupFullscreen();
    }
});

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
                         alt="${result.image_name || result.base_filename}"
                         class="image-page__similar-thumb"
                         loading="lazy">
                    <div class="image-page__similar-info">
                        ${result.image_name || result.base_filename}
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
        if (e.key === 'Escape' && isFullscreen) {
            closeFullscreen();
        } else if (e.key === 'ArrowLeft') {
            if (isFullscreen) {
                navigateFullscreen(-1);
            } else {
                navigateImage(-1);
            }
        } else if (e.key === 'ArrowRight') {
            if (isFullscreen) {
                navigateFullscreen(1);
            } else {
                navigateImage(1);
            }
        }
    });
}

// Update navigation buttons based on static navigation data
function updateNavigation() {
    const prevBtn = document.getElementById('prev-button');
    const nextBtn = document.getElementById('next-button');

    if (!prevBtn || !nextBtn) return;

    if (navigationData) {
        // Use static batch navigation
        prevBtn.disabled = !navigationData.prev_image_id;
        nextBtn.disabled = !navigationData.next_image_id;
    } else {
        // No navigation data available
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }
}

// Navigate to next/previous image within batch
function navigateImage(delta) {
    if (!navigationData) return;

    const targetId = delta < 0 ? navigationData.prev_image_id : navigationData.next_image_id;
    if (targetId) {
        window.location.href = `/image/${targetId}/`;
    }
}

// Fullscreen functionality
let isFullscreen = false;
const FULLSCREEN_KEY = 'image-fullscreen-mode';

function setupFullscreen() {
    const mainImage = document.getElementById('main-image');
    const overlay = document.getElementById('fullscreen-overlay');
    const fullscreenImage = document.getElementById('fullscreen-image');
    const closeBtn = document.getElementById('fullscreen-close');
    const prevBtn = document.getElementById('fullscreen-prev');
    const nextBtn = document.getElementById('fullscreen-next');
    const infoEl = document.getElementById('fullscreen-info');

    if (!mainImage || !overlay) return;

    // Open fullscreen on image click
    mainImage.addEventListener('click', () => openFullscreen());

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', closeFullscreen);
    }

    // Click outside image to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeFullscreen();
        }
    });

    // Navigation buttons in fullscreen
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateFullscreen(-1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateFullscreen(1);
        });
    }

    // Check if we should auto-open fullscreen (navigated from fullscreen view)
    if (sessionStorage.getItem(FULLSCREEN_KEY) === 'true') {
        sessionStorage.removeItem(FULLSCREEN_KEY);
        // Small delay to let image load
        setTimeout(() => openFullscreen(), 100);
    }
}

function openFullscreen() {
    const overlay = document.getElementById('fullscreen-overlay');
    const mainImage = document.getElementById('main-image');
    const fullscreenImage = document.getElementById('fullscreen-image');
    const infoEl = document.getElementById('fullscreen-info');
    const prevBtn = document.getElementById('fullscreen-prev');
    const nextBtn = document.getElementById('fullscreen-next');

    if (!overlay || !mainImage || !fullscreenImage) return;

    // Use the large image URL for fullscreen
    const pageData = window.__PAGE_DATA__;
    if (pageData && pageData.image) {
        const img = pageData.image;
        // Prefer large webp/avif, fall back to original
        fullscreenImage.src = img.large_webp || img.large_avif || img.image_url || mainImage.src;
    } else {
        fullscreenImage.src = mainImage.src;
    }
    fullscreenImage.alt = mainImage.alt;

    // Update info
    if (infoEl && navigationData) {
        infoEl.textContent = `${navigationData.batch_position} of ${navigationData.batch_total}`;
    }

    // Update nav button states
    if (prevBtn) {
        prevBtn.disabled = !navigationData || !navigationData.prev_image_id;
    }
    if (nextBtn) {
        nextBtn.disabled = !navigationData || !navigationData.next_image_id;
    }

    overlay.classList.add('active');
    isFullscreen = true;
    document.body.style.overflow = 'hidden';
}

function closeFullscreen() {
    const overlay = document.getElementById('fullscreen-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    isFullscreen = false;
    document.body.style.overflow = '';
    sessionStorage.removeItem(FULLSCREEN_KEY);
}

function navigateFullscreen(delta) {
    if (!navigationData) return;

    const targetId = delta < 0 ? navigationData.prev_image_id : navigationData.next_image_id;
    if (targetId) {
        // Remember fullscreen state for next page
        sessionStorage.setItem(FULLSCREEN_KEY, 'true');
        window.location.href = `/image/${targetId}/`;
    }
}

