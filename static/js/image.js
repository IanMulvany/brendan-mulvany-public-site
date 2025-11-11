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
    loadAllImageIds().then(() => {
        loadImage(currentImageId);
        setupNavigation();
    });
});

// Load all image IDs for navigation
async function loadAllImageIds() {
    try {
        const response = await fetch(`${API_BASE}/api/public/images?limit=1000`);
        const data = await response.json();
        allImageIds = data.images.map(img => img.image_id);
    } catch (error) {
        console.error('Error loading image IDs:', error);
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
        const image = await response.json();
        
        // Set image
        imageEl.src = image.image_url;
        imageEl.alt = image.image_name || 'Image';
        
        // Build info HTML
        const scene = image.scene || {};
        const rollNumber = scene.roll_number;
        const rollDate = scene.roll_date || scene.capture_date;
        const description = scene.description;
        const rollComment = scene.roll_comment;
        
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
                ${scene.batch_name ? `
                    <div class="image-page__field">
                        <span class="image-page__label">Batch</span>
                        <span class="image-page__value">${scene.batch_name}</span>
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
                <a href="/image_detail/${imageId}" class="image-page__link">View technical details →</a>
            </div>
        `;
        
        updateNavigation();
        
        // Load similar images if we have a scene
        if (scene.scene_id) {
            loadSimilarImages(scene.scene_id, imageId);
        }
    } catch (error) {
        console.error('Error loading image:', error);
        infoEl.innerHTML = '<p>Error loading image details</p>';
    }
}

// Load and display similar images
async function loadSimilarImages(sceneId, currentImageId) {
    try {
        const response = await fetch(`${API_BASE}/api/public/similar?scene_id=${encodeURIComponent(sceneId)}`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            const similarSection = document.getElementById('similar-section');
            const similarGrid = document.getElementById('similar-grid');
            
            similarGrid.innerHTML = data.results.map(result => `
                <div class="image-page__similar-item">
                    <a href="/image/${result.image_id || result.scene_id}">
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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

