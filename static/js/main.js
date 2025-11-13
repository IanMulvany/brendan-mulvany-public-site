// Public Site JavaScript
// Handles API calls, UI interactions, and state management

const API_BASE = ''; // Same origin
let currentPage = 0;
let currentLimit = 48; // Default to 48 thumbnails per page
let currentFilters = {};
let allImageIds = []; // Store all image IDs for navigation
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let isLoading = false;
let hasMore = true;

const GALLERY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const GALLERY_CACHE_PREFIX = 'gallery-cache::';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
    setupEventListeners();
    loadImages({ reset: true });
});

// Auth Functions
function initializeAuth() {
    if (authToken) {
        fetchCurrentUser();
    } else {
        updateAuthUI();
    }
}

async function fetchCurrentUser() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            updateAuthUI();
        } else {
            localStorage.removeItem('authToken');
            authToken = null;
            updateAuthUI();
        }
    } catch (error) {
        console.error('Error fetching user:', error);
        localStorage.removeItem('authToken');
        authToken = null;
        updateAuthUI();
    }
}

function updateAuthUI() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const annotationForm = document.getElementById('annotation-form');
    
    if (authToken && currentUser) {
        loginBtn.classList.add('header__nav-button--hidden');
        logoutBtn.classList.remove('header__nav-button--hidden');
        if (annotationForm) {
            annotationForm.classList.remove('modal__annotation-form--hidden');
        }
    } else {
        loginBtn.classList.remove('header__nav-button--hidden');
        logoutBtn.classList.add('header__nav-button--hidden');
        if (annotationForm) {
            annotationForm.classList.add('modal__annotation-form--hidden');
        }
    }
}

// Event Listeners
function setupEventListeners() {
    
    // Auth
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (loginBtn) loginBtn.addEventListener('click', showLoginModal);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // Pagination
    const loadMoreButton = document.getElementById('load-more-button');
    if (loadMoreButton) {
        loadMoreButton.addEventListener('click', () => loadImages());
    }
    
    // Login/Register modals
    setupAuthModals();
    
    // Image modal
    // Modal setup removed - using page navigation instead
    
    // Annotation form
    const annotationForm = document.getElementById('annotation-form');
    if (annotationForm) {
        annotationForm.addEventListener('submit', handleAnnotationSubmit);
    }
}

// Search functionality
let searchTimeout = null;
const searchInput = document.getElementById('search-input');
const searchForm = document.getElementById('search-form');
const searchSuggestions = document.getElementById('search-suggestions');

if (searchInput) {
    // Autocomplete suggestions
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        clearTimeout(searchTimeout);
        
        if (query.length < 2) {
            searchSuggestions.classList.remove('show');
            return;
        }
        
        searchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`${API_BASE}/api/public/search/suggestions?q=${encodeURIComponent(query)}`);
                const data = await response.json();
                
                if (data.suggestions && data.suggestions.length > 0) {
                    searchSuggestions.innerHTML = data.suggestions.map(suggestion => 
                        `<div class="search-suggestion-item" onclick="selectSuggestion('${suggestion.replace(/'/g, "\\'")}')">${escapeHtml(suggestion)}</div>`
                    ).join('');
                    searchSuggestions.classList.add('show');
                } else {
                    searchSuggestions.classList.remove('show');
                }
            } catch (error) {
                console.error('Error fetching suggestions:', error);
            }
        }, 300);
    });
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
            searchSuggestions.classList.remove('show');
        }
    });
    
    // Handle form submission
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `/search?q=${encodeURIComponent(query)}`;
            }
        });
    }
}

function selectSuggestion(suggestion) {
    searchInput.value = suggestion;
    searchSuggestions.classList.remove('show');
    if (searchForm) {
        searchForm.submit();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load Images
async function loadImages({ reset = false } = {}) {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    
    const loadMoreContainer = document.getElementById('gallery-load-more');
    
    if (reset) {
        currentPage = 0;
        hasMore = true;
        allImageIds = [];
        if (loadMoreContainer) {
            loadMoreContainer.classList.add('gallery__load-more--hidden');
        }
        container.innerHTML = '<p class="gallery__loading">Loading images...</p>';
    }
    
    if (isLoading || (!hasMore && currentPage !== 0)) {
        return;
    }
    
    const page = currentPage;
    const cacheKey = getGalleryCacheKey(page);
    const cachedPage = getCachedGalleryPage(cacheKey);
    
    if (cachedPage) {
        if (page === 0) {
            container.innerHTML = '';
        }
        renderGalleryPage(cachedPage.images, page > 0);
        hasMore = typeof cachedPage.has_more === 'boolean'
            ? cachedPage.has_more
            : (cachedPage.images.length === currentLimit);
        allImageIds = allImageIds.concat(cachedPage.images.map(img => img.image_id));
        currentPage += 1;
        updateLoadMoreState();
        return;
    }
    
    isLoading = true;
    updateLoadMoreState();
    
    const params = new URLSearchParams({
        limit: currentLimit,
        offset: page * currentLimit,
        ...currentFilters
    });
    
    try {
        const response = await fetch(`${API_BASE}/api/public/images?${params}`);
        if (!response.ok) {
            throw new Error(`Failed to load images: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (page === 0) {
            container.innerHTML = '';
        }
        
        if (data.images && data.images.length > 0) {
            renderGalleryPage(data.images, page > 0);
            hasMore = data.has_more ?? (data.images.length === currentLimit);
            allImageIds = allImageIds.concat(data.images.map(img => img.image_id));
            cacheGalleryPage(cacheKey, data);
            currentPage += 1;
        } else if (page === 0) {
            container.innerHTML = '<p class="gallery__loading">No images found</p>';
            hasMore = false;
        } else {
            hasMore = false;
        }
    } catch (error) {
        console.error('Error loading images:', error);
        if (page === 0) {
            container.innerHTML = '<p class="gallery__loading">Error loading images</p>';
        }
        hasMore = false;
    } finally {
        isLoading = false;
        updateLoadMoreState();
    }
}

function renderGalleryPage(images, append = false) {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    
    if (!append) {
        container.innerHTML = '';
    }
    
    images.forEach(image => {
        const item = document.createElement('div');
        item.className = 'gallery__item';
        item.addEventListener('click', () => {
            window.location.href = `/image/${image.image_id}`;
        });
        
        item.innerHTML = `
            <img 
                src="${image.thumbnail_url || image.image_url}" 
                alt="${image.image_name || 'Image'}"
                class="gallery__image"
                loading="lazy"
            >
            <div class="gallery__info">
                <div class="gallery__title">${image.image_name || 'Untitled'}</div>
                <div class="gallery__meta">${image.capture_date || ''} ${image.bm_batch_year || ''}</div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

function updateLoadMoreState() {
    const loadMoreContainer = document.getElementById('gallery-load-more');
    const loadMoreButton = document.getElementById('load-more-button');
    
    if (!loadMoreContainer || !loadMoreButton) {
        return;
    }
    
    if (allImageIds.length === 0) {
        loadMoreContainer.classList.add('gallery__load-more--hidden');
        return;
    }
    
    loadMoreContainer.classList.remove('gallery__load-more--hidden');
    
    if (isLoading) {
        loadMoreButton.textContent = 'Loading…';
        loadMoreButton.disabled = true;
        return;
    }
    
    if (hasMore) {
        loadMoreButton.textContent = 'Load More';
        loadMoreButton.disabled = false;
    } else {
        loadMoreButton.textContent = 'All Images Loaded';
        loadMoreButton.disabled = true;
    }
}

function getGalleryCacheKey(page) {
    const filterKey = serializeFilters(currentFilters) || 'all';
    return `${GALLERY_CACHE_PREFIX}${filterKey}::${currentLimit}::${page}`;
}

function cacheGalleryPage(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({
            images: data.images || [],
            limit: data.limit,
            offset: data.offset,
            has_more: data.has_more ?? null,
            cached_at: Date.now()
        }));
    } catch (error) {
        console.warn('Unable to cache gallery page:', error);
    }
}

function getCachedGalleryPage(key) {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed.cached_at || (Date.now() - parsed.cached_at) > GALLERY_CACHE_TTL) {
            sessionStorage.removeItem(key);
            return null;
        }
        return parsed;
    } catch (error) {
        sessionStorage.removeItem(key);
        return null;
    }
}

function serializeFilters(filters) {
    const keys = Object.keys(filters).sort();
    const params = [];
    keys.forEach(key => {
        const value = filters[key];
        if (value === undefined || value === null || value === '') {
            return;
        }
        params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    });
    return params.join('&');
}

// Image Modal functions removed - using page navigation instead

// Auth Modals
function setupAuthModals() {
    // Login modal
    const loginModal = document.getElementById('login-modal');
    const loginOverlay = document.getElementById('login-overlay');
    const loginClose = document.getElementById('login-close');
    const loginForm = document.getElementById('login-form');
    const showRegister = document.getElementById('show-register');
    
    if (loginOverlay) loginOverlay.addEventListener('click', hideLoginModal);
    if (loginClose) loginClose.addEventListener('click', hideLoginModal);
    if (showRegister) showRegister.addEventListener('click', () => {
        hideLoginModal();
        showRegisterModal();
    });
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    
    // Register modal
    const registerModal = document.getElementById('register-modal');
    const registerOverlay = document.getElementById('register-overlay');
    const registerClose = document.getElementById('register-close');
    const registerForm = document.getElementById('register-form');
    const showLogin = document.getElementById('show-login');
    
    if (registerOverlay) registerOverlay.addEventListener('click', hideRegisterModal);
    if (registerClose) registerClose.addEventListener('click', hideRegisterModal);
    if (showLogin) showLogin.addEventListener('click', () => {
        hideRegisterModal();
        showLoginModal();
    });
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
}

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('modal--hidden');
}

function hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.add('modal--hidden');
}

function showRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) modal.classList.remove('modal--hidden');
}

function hideRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) modal.classList.add('modal--hidden');
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            updateAuthUI();
            hideLoginModal();
            document.getElementById('login-form').reset();
        } else {
            alert(data.detail || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Error logging in');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            updateAuthUI();
            hideRegisterModal();
            document.getElementById('register-form').reset();
        } else {
            alert(data.detail || 'Registration failed');
        }
    } catch (error) {
        console.error('Register error:', error);
        alert('Error registering');
    }
}

function handleLogout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    updateAuthUI();
}

// Annotations
async function handleAnnotationSubmit(e) {
    e.preventDefault();
    const imageId = parseInt(e.target.dataset.imageId);
    const content = document.getElementById('annotation-input').value.trim();
    
    if (!imageId || !content) return;
    
    if (!authToken) {
        alert('Please login to add annotations');
        showLoginModal();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/annotations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                image_id: imageId,
                annotation_type: 'comment',
                content: content
            })
        });
        
        if (response.ok) {
            document.getElementById('annotation-input').value = '';
            // Reload image to show new annotation
            window.location.href = `/image/${imageId}`;
        } else {
            const data = await response.json();
            alert(data.detail || 'Error adding annotation');
        }
    } catch (error) {
        console.error('Annotation error:', error);
        alert('Error adding annotation');
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    // Simple error display - can be enhanced
    alert(message);
}

