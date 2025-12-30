// Image Detail Page JavaScript

const API_BASE = '';
let currentImageId = null;
let allImageIds = [];

// Get image ID from URL (for image_detail route)
const pathParts = window.location.pathname.split('/');
const imageIdFromUrl = parseInt(pathParts[pathParts.length - 1]);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    currentImageId = imageIdFromUrl;
    loadAllImageIds().then(() => {
        loadImageDetail(currentImageId);
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

// Load image detail
async function loadImageDetail(imageId) {
    const imageEl = document.getElementById('detail-image');
    const infoEl = document.getElementById('detail-info');
    
    imageEl.src = '';
    infoEl.innerHTML = '<p>Loading...</p>';
    
    try {
        const response = await fetch(`${API_BASE}/api/public/images/${imageId}`);
        const image = await response.json();
        
        // Set image
        imageEl.src = image.image_url;
        imageEl.alt = image.image_name || 'Image';
        
        // Display all DB data
        infoEl.innerHTML = `
            <div class="image-detail__section">
                <h2 class="image-detail__section-title">Basic Info</h2>
                <div class="image-detail__field">
                    <span class="image-detail__label">Image ID:</span>
                    <span class="image-detail__value">${image.image_id}</span>
                </div>
                <div class="image-detail__field">
                    <span class="image-detail__label">Name:</span>
                    <span class="image-detail__value">${image.image_name || 'N/A'}</span>
                </div>
                <div class="image-detail__field">
                    <span class="image-detail__label">Batch:</span>
                    <span class="image-detail__value">${image.bm_batch_note || 'N/A'}</span>
                </div>
                <div class="image-detail__field">
                    <span class="image-detail__label">Capture Date:</span>
                    <span class="image-detail__value">${image.capture_date || 'N/A'}</span>
                </div>
            </div>

            <div class="image-detail__section">
                <h2 class="image-detail__section-title">Scene Data</h2>
                ${image.scene ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Scene ID:</span>
                        <span class="image-detail__value">${image.scene.scene_id}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Batch Name:</span>
                        <span class="image-detail__value">${image.scene.batch_name}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Base Filename:</span>
                        <span class="image-detail__value">${image.scene.base_filename}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Created At:</span>
                        <span class="image-detail__value">${image.scene.created_at || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Updated At:</span>
                        <span class="image-detail__value">${image.scene.updated_at || 'N/A'}</span>
                    </div>
                    ${image.scene.description ? `
                        <div class="image-detail__field">
                            <span class="image-detail__label">Description:</span>
                            <span class="image-detail__value" style="white-space: pre-wrap;">${image.scene.description}</span>
                        </div>
                        <div class="image-detail__field">
                            <span class="image-detail__label">Description Model:</span>
                            <span class="image-detail__value">${image.scene.description_model || 'N/A'}</span>
                        </div>
                        <div class="image-detail__field">
                            <span class="image-detail__label">Description Timestamp:</span>
                            <span class="image-detail__value">${image.scene.description_timestamp || 'N/A'}</span>
                        </div>
                    ` : ''}
                ` : '<p>No scene data</p>'}
            </div>

            ${image.scene && (image.scene.roll_number || image.scene.roll_date || image.scene.roll_comment || image.scene.index_book_number) ? `
            <div class="image-detail__section">
                <h2 class="image-detail__section-title">Batch Metadata</h2>
                ${image.scene.roll_number ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Roll Number:</span>
                        <span class="image-detail__value">${image.scene.roll_number}</span>
                    </div>
                ` : ''}
                ${image.scene.roll_date ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Capture Date (Roll Date):</span>
                        <span class="image-detail__value">${image.scene.roll_date}</span>
                    </div>
                ` : ''}
                ${image.scene.date_source ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Date Source:</span>
                        <span class="image-detail__value">${image.scene.date_source}</span>
                    </div>
                ` : ''}
                ${image.scene.date_notes ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Date Notes:</span>
                        <span class="image-detail__value" style="white-space: pre-wrap;">${image.scene.date_notes}</span>
                    </div>
                ` : ''}
                ${image.scene.roll_comment ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Roll Comment:</span>
                        <span class="image-detail__value" style="white-space: pre-wrap;">${image.scene.roll_comment}</span>
                    </div>
                ` : ''}
                ${image.scene.index_book_number ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Index Book Number:</span>
                        <span class="image-detail__value">${image.scene.index_book_number}</span>
                    </div>
                ` : ''}
                ${image.scene.index_book_date ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Index Book Date:</span>
                        <span class="image-detail__value">${image.scene.index_book_date}</span>
                    </div>
                ` : ''}
                ${image.scene.index_book_comment ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Index Book Comment:</span>
                        <span class="image-detail__value" style="white-space: pre-wrap;">${image.scene.index_book_comment}</span>
                    </div>
                ` : ''}
                ${image.scene.short_description ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Short Description:</span>
                        <span class="image-detail__value">${image.scene.short_description}</span>
                    </div>
                ` : ''}
            </div>
            ` : ''}

            <div class="image-detail__section">
                <h2 class="image-detail__section-title">Current Version</h2>
                ${image.current_version ? `
                    <div class="image-detail__field">
                        <span class="image-detail__label">Version ID:</span>
                        <span class="image-detail__value">${image.current_version.version_id || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Version Type:</span>
                        <span class="image-detail__value">${image.current_version.version_type || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">R2 Key:</span>
                        <span class="image-detail__value">${image.current_version.r2_key || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Local Path:</span>
                        <span class="image-detail__value">${image.current_version.local_path || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Perceptual Hash:</span>
                        <span class="image-detail__value">${image.current_version.perceptual_hash || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">MD5 Hash:</span>
                        <span class="image-detail__value">${image.current_version.md5_hash || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">File Size:</span>
                        <span class="image-detail__value">${image.current_version.file_size ? formatBytes(image.current_version.file_size) : 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Dimensions:</span>
                        <span class="image-detail__value">${image.current_version.width && image.current_version.height ? `${image.current_version.width} × ${image.current_version.height}` : 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Is Current:</span>
                        <span class="image-detail__value">${image.current_version.is_current ? 'Yes' : 'No'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Created At:</span>
                        <span class="image-detail__value">${image.current_version.created_at || 'N/A'}</span>
                    </div>
                    <div class="image-detail__field">
                        <span class="image-detail__label">Synced At:</span>
                        <span class="image-detail__value">${image.current_version.synced_at || 'N/A'}</span>
                    </div>
                ` : '<p>No current version data</p>'}
            </div>

            <div class="image-detail__section">
                <h2 class="image-detail__section-title">All Versions (${image.all_versions ? image.all_versions.length : 0})</h2>
                <div class="image-detail__versions">
                    ${image.all_versions && image.all_versions.length > 0 ? image.all_versions.map(v => `
                        <div class="image-detail__version ${v.is_current ? 'image-detail__version--current' : ''}">
                            <div class="image-detail__field">
                                <span class="image-detail__label">Version ID:</span>
                                <span class="image-detail__value">${v.version_id || 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Type:</span>
                                <span class="image-detail__value">${v.version_type || 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">R2 Key:</span>
                                <span class="image-detail__value">${v.r2_key || 'Not synced'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Perceptual Hash:</span>
                                <span class="image-detail__value">${v.perceptual_hash || 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">MD5 Hash:</span>
                                <span class="image-detail__value">${v.md5_hash || 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">File Size:</span>
                                <span class="image-detail__value">${v.file_size ? formatBytes(v.file_size) : 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Dimensions:</span>
                                <span class="image-detail__value">${v.width && v.height ? `${v.width} × ${v.height}` : 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Is Current:</span>
                                <span class="image-detail__value">${v.is_current ? 'Yes' : 'No'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Created:</span>
                                <span class="image-detail__value">${v.created_at || 'N/A'}</span>
                            </div>
                            <div class="image-detail__field">
                                <span class="image-detail__label">Synced:</span>
                                <span class="image-detail__value">${v.synced_at || 'Not synced'}</span>
                            </div>
                        </div>
                    `).join('') : '<p>No version data</p>'}
                </div>
            </div>

            ${image.annotations && image.annotations.length > 0 ? `
            <div class="image-detail__section">
                <h2 class="image-detail__section-title">Annotations (${image.annotations.length})</h2>
                ${image.annotations.map(ann => `
                    <div class="image-detail__field">
                        <span class="image-detail__label">${ann.username}:</span>
                        <span class="image-detail__value">${escapeHtml(ann.content)}</span>
                    </div>
                `).join('')}
            </div>
            ` : ''}
        `;
        
        updateNavigation();
        
        // Load similar images if we have a scene
        if (image.scene && image.scene.scene_id) {
            loadSimilarImages(image.scene.scene_id, image.image_id);
        }
    } catch (error) {
        console.error('Error loading image detail:', error);
        infoEl.innerHTML = '<p>Error loading image details</p>';
    }
}

// Load and display similar images
async function loadSimilarImages(sceneId, currentImageId) {
    try {
        const response = await fetch(`${API_BASE}/api/public/similar?scene_id=${encodeURIComponent(sceneId)}`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            // Convert scene_ids to image_ids for navigation
            const similarImagesHtml = `
                <div class="image-detail__section">
                    <h2 class="image-detail__section-title">Similar Images (${data.results.length})</h2>
                    <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
                        Threshold: ${data.threshold} | Query hash: ${data.query_hash.substring(0, 16)}...
                    </p>
                    <div class="image-detail__similar-grid">
                        ${data.results.map(result => `
                            <div class="image-detail__similar-item">
                                <a href="/image/${result.image_id || result.scene_id}">
                                    <img src="${result.thumbnail_url}" 
                                         alt="${result.base_filename}" 
                                         class="image-detail__similar-thumb"
                                         loading="lazy">
                                    <div class="image-detail__similar-info">
                                        <div class="image-detail__similar-filename">${result.base_filename}</div>
                                        <div class="image-detail__similar-distance">Distance: ${result.distance}</div>
                                        ${result.batch_name ? `<div class="image-detail__similar-batch">${result.batch_name}</div>` : ''}
                                    </div>
                                </a>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            // Append to info section
            const infoEl = document.getElementById('detail-info');
            infoEl.insertAdjacentHTML('beforeend', similarImagesHtml);
        }
    } catch (error) {
        console.error('Error loading similar images:', error);
        // Don't show error to user, just log it
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
function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

