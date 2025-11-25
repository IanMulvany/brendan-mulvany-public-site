document.addEventListener('DOMContentLoaded', () => {
    const themesContainer = document.getElementById('themes-container');
    const data = window.__STATIC_DATA__;

    if (!data || !data.themes) {
        themesContainer.innerHTML = '<p class="error-text">No data available.</p>';
        return;
    }

    themesContainer.innerHTML = '';

    Object.entries(data.themes).forEach(([theme, images]) => {
        if (images.length < 3) return; // Skip small themes

        const themeSection = document.createElement('section');
        themeSection.className = 'theme-section';

        const themeHeader = document.createElement('div');
        themeHeader.className = 'theme-header';
        themeHeader.innerHTML = `
            <h3 class="theme-title">${theme}</h3>
            <span class="theme-count">${images.length} photos</span>
        `;
        themeSection.appendChild(themeHeader);

        const themeGrid = document.createElement('div');
        themeGrid.className = 'theme-grid';

        // Show top 5 images
        images.slice(0, 5).forEach(img => {
            const imgLink = document.createElement('a');
            imgLink.href = `/image/${img.image_id}/index.html`;
            imgLink.className = 'theme-image';

            imgLink.innerHTML = `
                <img src="${img.thumbnail_url || img.image_url}" alt="${img.image_name}" loading="lazy">
            `;
            themeGrid.appendChild(imgLink);
        });

        themeSection.appendChild(themeGrid);
        themesContainer.appendChild(themeSection);
    });
});
