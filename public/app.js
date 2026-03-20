const API_BASE = window.location.origin;
let currentMovieUrl = null;
let currentCategory = 'latest';

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const movieGrid = document.getElementById('movieGrid');
const loading = document.getElementById('loading');
const modal = document.getElementById('movieModal');
const closeModal = document.querySelector('.close');
const modalTitle = document.getElementById('modalTitle');
const qualityOptions = document.getElementById('qualityOptions');
const downloadLinks = document.getElementById('downloadLinks');
const loadingLinks = document.getElementById('loadingLinks');
const tabs = document.querySelectorAll('.tab');

const categoryUrls = {
    latest: '',
    '2026': '/tamil-2026-dubbed-movies/',
    '2025': '/tamil-2025-dubbed-movies/'
};

async function fetchMovies(url) {
    showLoading(true);
    movieGrid.innerHTML = '';
    
    try {
        const response = await fetch(`${API_BASE}/api/movies?url=${encodeURIComponent(url || '')}`);
        const movies = await response.json();
        
        if (movies.length === 0) {
            movieGrid.innerHTML = '<p class="no-results">No movies found</p>';
        } else {
            movies.forEach(movie => {
                const card = createMovieCard(movie);
                movieGrid.appendChild(card);
            });
        }
    } catch (error) {
        movieGrid.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

async function searchMovies(query) {
    if (!query.trim()) return;
    
    showLoading(true);
    movieGrid.innerHTML = '';
    
    try {
        const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
        const movies = await response.json();
        
        if (movies.length === 0) {
            movieGrid.innerHTML = '<p class="no-results">No movies found for your search</p>';
        } else {
            movies.forEach(movie => {
                const card = createMovieCard(movie);
                movieGrid.appendChild(card);
            });
        }
    } catch (error) {
        movieGrid.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.innerHTML = `
        <div class="movie-poster">🎬</div>
        <div class="movie-info">
            <h3 class="movie-title">${escapeHtml(movie.title)}</h3>
        </div>
    `;
    card.addEventListener('click', () => openModal(movie));
    return card;
}

function openModal(movie) {
    currentMovieUrl = movie.link;
    modalTitle.textContent = movie.title;
    downloadLinks.innerHTML = '<p style="text-align:center;color:#888;">Select a quality to get download links</p>';
    
    qualityOptions.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    modal.style.display = 'block';
}

function closeModalHandler() {
    modal.style.display = 'none';
    currentMovieUrl = null;
    downloadLinks.innerHTML = '';
    loadingLinks.style.display = 'none';
}

async function fetchDownloadLinks(url, quality) {
    loadingLinks.style.display = 'block';
    downloadLinks.innerHTML = '';
    
    try {
        const response = await fetch(`${API_BASE}/api/download?url=${encodeURIComponent(url)}&quality=${quality}`);
        const data = await response.json();
        
        if (data.error) {
            downloadLinks.innerHTML = `<p class="error-msg">${data.error}</p>`;
            return;
        }
        
        let html = '';
        
        if (data.download && data.download.length > 0) {
            html += '<h3 style="margin: 15px 0 10px;color:#28a745;">Download Links</h3>';
            data.download.forEach(link => {
                html += `<a href="${link.url}" target="_blank" class="download-btn">${link.server} - Download</a>`;
            });
        }
        
        if (data.watch && data.watch.length > 0) {
            html += '<h3 style="margin: 15px 0 10px;color:#007bff;">Watch Online</h3>';
            data.watch.forEach(link => {
                html += `<a href="${link.url}" target="_blank" class="watch-btn">${link.server} - Watch</a>`;
            });
        }
        
        if (html) {
            downloadLinks.innerHTML = html;
        } else {
            downloadLinks.innerHTML = '<p class="error-msg">No download links found</p>';
        }
    } catch (error) {
        downloadLinks.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
    } finally {
        loadingLinks.style.display = 'none';
    }
}

function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

searchBtn.addEventListener('click', () => {
    searchMovies(searchInput.value);
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchMovies(searchInput.value);
    }
});

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        searchInput.value = '';
        fetchMovies(API_BASE + categoryUrls[currentCategory]);
    });
});

qualityOptions.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        qualityOptions.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const quality = btn.dataset.quality;
        fetchDownloadLinks(currentMovieUrl, quality);
    });
});

closeModal.addEventListener('click', closeModalHandler);

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        closeModalHandler();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModalHandler();
    }
});

fetchMovies();
