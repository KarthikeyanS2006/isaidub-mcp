const API_BASE = window.location.origin;
let currentSource = 'isaidub';
let currentCategory = '2026';
let currentMovieUrl = null;

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const movieGrid = document.getElementById('movieGrid');
const loading = document.getElementById('loading');
const modal = document.getElementById('movieModal');
const closeModal = document.querySelector('.close');
const modalTitle = document.getElementById('modalTitle');
const modalPoster = document.getElementById('modalPoster');
const modalGenres = document.getElementById('modalGenres');
const modalDirector = document.getElementById('modalDirector');
const modalStarring = document.getElementById('modalStarring');
const modalQuality = document.getElementById('modalQuality');
const modalLanguage = document.getElementById('modalLanguage');
const modalRating = document.getElementById('modalRating');
const modalUpdated = document.getElementById('modalUpdated');
const modalSynopsis = document.getElementById('modalSynopsis');
const loadingDetails = document.getElementById('loadingDetails');
const qualityOptions = document.getElementById('qualityOptions');
const fileInfo = document.getElementById('fileInfo');
const downloadLinks = document.getElementById('downloadLinks');
const loadingLinks = document.getElementById('loadingLinks');
const tabs = document.querySelectorAll('.tab');
const catTabs = document.querySelectorAll('.cat-tab');
const categoryTabs = document.getElementById('categoryTabs');

const categoryUrls = {
    isaidub: {
        '2026': '/tamil-2026-dubbed-movies/',
        '2025': '/tamil-2025-dubbed-movies/',
        '2024': '/tamil-2024-dubbed-movies/'
    },
    moviesda: {
        '2026': '/tamil-2026-movies/',
        '2025': '/tamil-2025-movies/',
        '2024': '/tamil-2024-movies/'
    }
};

async function fetchMovies() {
    showLoading(true);
    movieGrid.innerHTML = '';
    
    try {
        const url = `${API_BASE}/api/${currentSource}/movies?url=${encodeURIComponent(categoryUrls[currentSource][currentCategory])}`;
        console.log('Fetching:', url);
        const response = await fetch(url);
        console.log('Response status:', response.status);
        const movies = await response.json();
        console.log('Got movies:', movies.length);
        
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
        const url = `${API_BASE}/api/${currentSource}/search?q=${encodeURIComponent(query)}`;
        const response = await fetch(url);
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
    const imgHtml = movie.thumbnail 
        ? `<img src="${movie.thumbnail}" alt="${escapeHtml(movie.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
        : '';
    const emojiHtml = `<div class="movie-poster" style="display:${movie.thumbnail ? 'none' : 'flex'};">🎬</div>`;
    card.innerHTML = `
        ${imgHtml}
        ${emojiHtml}
        <div class="movie-info">
            <h3 class="movie-title">${escapeHtml(movie.title)}</h3>
        </div>
    `;
    card.addEventListener('click', () => openModal(movie));
    return card;
}

async function fetchMovieDetails(url) {
    loadingDetails.style.display = 'block';
    
    try {
        const apiUrl = `${API_BASE}/api/${currentSource}/details?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const details = await response.json();
        
        if (details.title) {
            modalTitle.textContent = details.title;
        }
        
        if (details.thumbnail) {
            modalPoster.src = details.thumbnail;
            modalPoster.style.display = 'block';
        }
        
        modalGenres.textContent = details.genres || '';
        modalGenres.style.display = details.genres ? 'inline-block' : 'none';
        modalDirector.innerHTML = details.director ? `<strong>Director:</strong> ${details.director}` : '';
        modalStarring.innerHTML = details.starring ? `<strong>Starring:</strong> ${details.starring}` : '';
        modalQuality.innerHTML = details.quality ? `<strong>Quality:</strong> ${details.quality}` : '';
        modalLanguage.innerHTML = details.language ? `<strong>Language:</strong> ${details.language}` : '';
        modalRating.innerHTML = details.rating ? `<strong>Rating:</strong> ${details.rating}` : '';
        modalUpdated.innerHTML = details.updated ? `<strong>Updated:</strong> ${details.updated}` : '';
        modalSynopsis.textContent = details.synopsis || '';
        
        if (currentSource === 'isaidub') {
            renderISAIDUBQualities(url);
        } else {
            renderMoviesdaQualities(details.qualities || []);
        }
        
    } catch (error) {
        console.error('Error fetching details:', error);
    } finally {
        loadingDetails.style.display = 'none';
    }
}

function renderISAIDUBQualities(movieUrl) {
    qualityOptions.innerHTML = `
        <button class="quality-btn" data-quality="480p">480p</button>
        <button class="quality-btn selected" data-quality="720p">720p</button>
        <button class="quality-btn" data-quality="1080p">1080p</button>
    `;
    
    qualityOptions.querySelectorAll('.quality-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            qualityOptions.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            fetchISAIDUBDownloadLinks(movieUrl, btn.dataset.quality);
        });
    });
}

function renderMoviesdaQualities(qualities) {
    if (qualities.length === 0) {
        qualityOptions.innerHTML = '<p style="color:#666;text-align:center;">No qualities available</p>';
        return;
    }
    
    qualityOptions.innerHTML = qualities.map((q, i) => 
        `<button class="quality-btn ${i === 0 ? 'selected' : ''}" data-url="${q.url}">${q.quality}</button>`
    ).join('');
    
    qualityOptions.querySelectorAll('.quality-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            qualityOptions.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            fetchMoviesdaDownloadLinks(btn.dataset.url);
        });
    });
    
    if (qualities.length > 0) {
        fetchMoviesdaDownloadLinks(qualities[0].url);
    }
}

async function fetchISAIDUBDownloadLinks(url, quality) {
    loadingLinks.style.display = 'block';
    downloadLinks.innerHTML = '';
    fileInfo.style.display = 'none';
    
    try {
        const response = await fetch(`${API_BASE}/api/isaidub/download?url=${encodeURIComponent(url)}&quality=${quality}`);
        const data = await response.json();
        
        if (data.error) {
            downloadLinks.innerHTML = `<p class="error-msg">${data.error}</p>`;
            return;
        }
        
        let html = '';
        
        if (data.download && data.download.length > 0) {
            html += '<h3 style="margin: 15px 0 10px;color:#c2185b;">Download Links</h3>';
            data.download.forEach(link => {
                html += `<a href="${link.url}" target="_blank" class="download-btn">${link.server} - Download</a>`;
            });
        }
        
        if (data.watch && data.watch.length > 0) {
            html += '<h3 style="margin: 15px 0 10px;color:#c2185b;">Watch Online</h3>';
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

async function fetchMoviesdaDownloadLinks(url) {
    loadingLinks.style.display = 'block';
    downloadLinks.innerHTML = '';
    fileInfo.style.display = 'none';
    
    try {
        const response = await fetch(`${API_BASE}/api/moviesda/download?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        if (data.info && Object.keys(data.info).length > 0) {
            let infoHtml = '<div class="file-info">';
            if (data.info.file_name) infoHtml += `<p><strong>File:</strong> ${data.info.file_name}</p>`;
            if (data.info.file_size) infoHtml += `<p><strong>Size:</strong> ${data.info.file_size}</p>`;
            if (data.info.duration) infoHtml += `<p><strong>Duration:</strong> ${data.info.duration}</p>`;
            if (data.info.video_resolution) infoHtml += `<p><strong>Resolution:</strong> ${data.info.video_resolution}</p>`;
            if (data.info.format) infoHtml += `<p><strong>Format:</strong> ${data.info.format}</p>`;
            infoHtml += '</div>';
            fileInfo.innerHTML = infoHtml;
            fileInfo.style.display = 'block';
        }
        
        let html = '';
        
        if (data.download && data.download.length > 0) {
            data.download.forEach(link => {
                html += `<a href="${link.url}" target="_blank" class="download-btn">${link.server} - Download</a>`;
            });
        }
        
        if (data.watch && data.watch.length > 0) {
            data.watch.forEach(link => {
                html += `<a href="${link.url}" target="_blank" class="watch-btn">${link.server} - Watch Online</a>`;
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

function openModal(movie) {
    currentMovieUrl = movie.link;
    modalTitle.textContent = movie.title;
    modalPoster.src = movie.thumbnail || '';
    modalPoster.style.display = movie.thumbnail ? 'block' : 'none';
    modalGenres.textContent = '';
    modalDirector.innerHTML = '';
    modalStarring.innerHTML = '';
    modalQuality.innerHTML = '';
    modalLanguage.innerHTML = '';
    modalRating.innerHTML = '';
    modalUpdated.innerHTML = '';
    modalSynopsis.textContent = '';
    qualityOptions.innerHTML = '';
    fileInfo.style.display = 'none';
    downloadLinks.innerHTML = '<p style="text-align:center;color:#888;">Loading qualities...</p>';
    
    modal.style.display = 'block';
    
    fetchMovieDetails(movie.link);
}

function closeModalHandler() {
    modal.style.display = 'none';
    currentMovieUrl = null;
    downloadLinks.innerHTML = '';
    loadingLinks.style.display = 'none';
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
        currentSource = tab.dataset.source;
        searchInput.value = '';
        fetchMovies();
    });
});

catTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        catTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        searchInput.value = '';
        fetchMovies();
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
