document.addEventListener('DOMContentLoaded', () => {
    const featuredContainer = document.getElementById('featured-container');
    const data = window.__STATIC_DATA__;

    if (!data || !data.featured) {
        featuredContainer.innerHTML = '<p class="error-text">No data available.</p>';
        return;
    }

    featuredContainer.innerHTML = '';

    data.featured.forEach((img, index) => {
        const featuredItem = document.createElement('article');
        featuredItem.className = `featured-item ${index % 2 === 0 ? 'featured-item--left' : 'featured-item--right'}`;

        featuredItem.innerHTML = `
            <a href="/image/${img.image_id}/index.html" class="featured-image-link">
                <img src="${img.image_url}" alt="${img.image_name}" class="featured-image" loading="lazy">
            </a>
            <div class="featured-info">
                <h2 class="featured-title">${img.description || 'Untitled'}</h2>
                <div class="featured-meta">
                    <span class="featured-date">${formatDate(img.capture_date)}</span>
                    <span class="featured-roll">Roll ${img.roll_number || 'N/A'}</span>
                </div>
                <p class="featured-description">${img.short_description || ''}</p>
                <a href="/image/${img.image_id}/index.html" class="featured-link">View Photo →</a>
            </div>
        `;
        featuredContainer.appendChild(featuredItem);
    });
});
