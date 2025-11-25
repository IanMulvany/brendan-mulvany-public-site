document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('minimal-container');
    const data = window.__STATIC_DATA__;

    if (!data || !data.minimal) {
        container.innerHTML = '<p class="error-text">No data available.</p>';
        return;
    }

    container.innerHTML = '';

    // Create a masonry-style layout
    const masonryGrid = document.createElement('div');
    masonryGrid.className = 'minimal-grid';

    data.minimal.forEach(img => {
        const item = document.createElement('div');
        item.className = 'minimal-item';

        item.innerHTML = `
            <a href="/image/${img.image_id}/index.html">
                <img src="${img.thumbnail_url || img.image_url}" alt="" loading="lazy">
            </a>
        `;
        masonryGrid.appendChild(item);
    });

    container.appendChild(masonryGrid);
});
