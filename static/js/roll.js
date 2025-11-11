// Roll Page JavaScript

const API_BASE = '';

// Get roll number from URL
const pathParts = window.location.pathname.split('/');
const rollNumber = pathParts[pathParts.length - 1];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadRollData(rollNumber);
});

// Load roll data
async function loadRollData(rollNumber) {
    const titleEl = document.getElementById('roll-number');
    const metadataEl = document.getElementById('roll-metadata');
    const galleryEl = document.getElementById('roll-gallery');
    
    titleEl.textContent = rollNumber;
    metadataEl.innerHTML = '<p>Loading...</p>';
    galleryEl.innerHTML = '<p>Loading images...</p>';
    
    try {
        const response = await fetch(`${API_BASE}/api/public/roll/${encodeURIComponent(rollNumber)}`);
        const data = await response.json();
        
        // Display metadata
        const meta = data.roll_metadata;
        metadataEl.innerHTML = `
            ${meta.roll_date ? `
                <div class="roll-page__metadata-item">
                    <span class="roll-page__metadata-label">Date:</span>
                    <span class="roll-page__metadata-value">${meta.roll_date}</span>
                </div>
            ` : ''}
            ${meta.date_source ? `
                <div class="roll-page__metadata-item">
                    <span class="roll-page__metadata-label">Date Source:</span>
                    <span class="roll-page__metadata-value">${meta.date_source}</span>
                </div>
            ` : ''}
            ${meta.roll_comment ? `
                <div class="roll-page__metadata-item">
                    <span class="roll-page__metadata-label">Notes:</span>
                    <span class="roll-page__metadata-value">${escapeHtml(meta.roll_comment)}</span>
                </div>
            ` : ''}
            ${meta.index_book_number ? `
                <div class="roll-page__metadata-item">
                    <span class="roll-page__metadata-label">Index Book:</span>
                    <span class="roll-page__metadata-value">${meta.index_book_number}${meta.index_book_date ? ' (' + meta.index_book_date + ')' : ''}</span>
                </div>
            ` : ''}
            ${meta.index_book_comment ? `
                <div class="roll-page__metadata-item">
                    <span class="roll-page__metadata-label">Index Book Notes:</span>
                    <span class="roll-page__metadata-value">${escapeHtml(meta.index_book_comment)}</span>
                </div>
            ` : ''}
        `;
        
        // Display images
        if (data.images && data.images.length > 0) {
            galleryEl.innerHTML = data.images.map(img => `
                <div class="roll-page__item">
                    <a href="/image/${img.image_id}">
                        <img src="${img.thumbnail_url}" 
                             alt="${img.base_filename}" 
                             class="roll-page__thumb"
                             loading="lazy">
                        <div class="roll-page__info">
                            <div class="roll-page__filename">${img.base_filename}</div>
                            ${img.capture_date ? `<div class="roll-page__date">${img.capture_date}</div>` : ''}
                        </div>
                    </a>
                </div>
            `).join('');
        } else {
            galleryEl.innerHTML = '<p>No images found for this roll.</p>';
        }
    } catch (error) {
        console.error('Error loading roll data:', error);
        metadataEl.innerHTML = '<p>Error loading roll information</p>';
        galleryEl.innerHTML = '<p>Error loading images</p>';
    }
}

// Helper functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

