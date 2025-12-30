document.addEventListener('DOMContentLoaded', () => {
    const timelineContainer = document.getElementById('timeline-container');
    const data = window.__STATIC_DATA__;

    if (!data || !data.years) {
        timelineContainer.innerHTML = '<p class="error-text">No data available.</p>';
        return;
    }

    timelineContainer.innerHTML = '';

    // Sort years descending
    const sortedYears = Object.keys(data.years).sort((a, b) => b - a);

    sortedYears.forEach(year => {
        const yearSection = document.createElement('section');
        yearSection.className = 'timeline-year';

        const yearHeader = document.createElement('h2');
        yearHeader.className = 'timeline-year__title';
        yearHeader.textContent = year;
        yearSection.appendChild(yearHeader);

        const yearGrid = document.createElement('div');
        yearGrid.className = 'timeline-year__grid';

        // Show top 12 images for each year
        const images = data.years[year].slice(0, 12);

        images.forEach(img => {
            const imgLink = document.createElement('a');
            imgLink.href = `/image/${img.image_id}/index.html`;
            imgLink.className = 'timeline-image';

            imgLink.innerHTML = `
                <img src="${img.thumbnail_url || img.image_url}" alt="${img.image_name}" loading="lazy">
            `;
            yearGrid.appendChild(imgLink);
        });

        if (data.years[year].length > 12) {
            const moreLink = document.createElement('div');
            moreLink.className = 'timeline-more';
            moreLink.textContent = `+${data.years[year].length - 12} more`;
            yearGrid.appendChild(moreLink);
        }

        yearSection.appendChild(yearGrid);
        timelineContainer.appendChild(yearSection);
    });
});
