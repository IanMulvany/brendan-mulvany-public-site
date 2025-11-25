document.addEventListener('DOMContentLoaded', () => {
    const rollsGrid = document.getElementById('rolls-grid');
    const data = window.__STATIC_DATA__;

    if (!data || !data.rolls) {
        rollsGrid.innerHTML = '<p class="error-text">No data available.</p>';
        return;
    }

    rollsGrid.innerHTML = '';

    data.rolls.forEach(roll => {
        const rollCard = document.createElement('div');
        rollCard.className = 'roll-card';

        // Get the first image as cover
        const coverImage = roll.images[0];
        const coverUrl = coverImage.thumbnail_url || coverImage.image_url;

        rollCard.innerHTML = `
            <a href="/roll/${roll.roll_number}/index.html" class="roll-card__link">
                <div class="roll-card__image-wrapper">
                    <img src="${coverUrl}" alt="Roll ${roll.roll_number}" class="roll-card__image" loading="lazy">
                    <div class="roll-card__count">${roll.count} photos</div>
                </div>
                <div class="roll-card__info">
                    <h3 class="roll-card__title">Roll ${roll.roll_number}</h3>
                    <p class="roll-card__date">${formatDate(roll.images[0].capture_date)}</p>
                </div>
            </a>
        `;
        rollsGrid.appendChild(rollCard);
    });
});


