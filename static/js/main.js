// Public Site JavaScript
// Handles API calls, UI interactions, and state management

const API_BASE = ''; // Same origin
let currentPage = 0;
let currentLimit = 1000; // Show all images
let currentFilters = {};
let allImageIds = []; // Store all image IDs for navigation
let authToken = localStorage.getItem('authToken');
let currentUser = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
    loadImages();
    setupEventListeners();
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
async function loadImages() {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    
    container.innerHTML = '<p class="gallery__loading">Loading images...</p>';
    
    try {
        const params = new URLSearchParams({
            limit: currentLimit,
            offset: currentPage * currentLimit,
            ...currentFilters
        });
        
        const response = await fetch(`${API_BASE}/api/public/images?${params}`);
        const data = await response.json();
        
        if (data.images && data.images.length > 0) {
            // Store all image IDs for navigation
            allImageIds = data.images.map(img => img.image_id);
            displayImages(data.images);
        } else {
            container.innerHTML = '<p class="gallery__loading">No images found</p>';
        }
    } catch (error) {
        console.error('Error loading images:', error);
        container.innerHTML = '<p class="gallery__loading">Error loading images</p>';
    }
}

function displayImages(images) {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    
    container.innerHTML = '';
    
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

// Pagination functions removed - showing all images now
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

