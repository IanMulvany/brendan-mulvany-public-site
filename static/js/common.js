/**
 * Common utility functions for the static site
 */

/**
 * Format a date string into a readable format (e.g., "Nov 2023")
 * @param {string} dateString - The date string to format
 * @returns {string} The formatted date string
 */
function formatDate(dateString) {
    if (!dateString) return 'Unknown Date';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    } catch (e) {
        return dateString;
    }
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - The text to escape
 * @returns {string} The escaped HTML string
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for module usage if needed, but primarily for global scope in simple static site
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatDate, escapeHtml };
}
