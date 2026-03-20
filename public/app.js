const API_BASE = window.location.origin;
let currentSource = 'isaidub';
let currentCategory = '2026';
let currentMovieUrl = null;
let heroMovies = [];
let heroIndex = 0;
let heroInterval = null;

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const movieGrid = document.getElementById('movieGrid');
const loading = document.getElementById('loading');
const modal = document.getElementById('movieModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalPoster = document.getElementById('modalPoster');
const modalBackdrop = document.getElementById('modalBackdrop');
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
const tabs = document.querySelectorAll('.source-tab');
const catTabs = document.querySelectorAll('.cat-tab');

const navbar = document.querySelector('.navbar');
const heroSection = document.getElementById('heroSection');
const heroBackdrop = document.getElementById('heroBackdrop');
const heroTitle = document.getElementById('heroTitle');
const heroDescription = document.getElementById('heroDescription');
const playTrailerBtn = document.getElementById('playTrailerBtn');
const moreInfoBtn = document.getElementById('moreInfoBtn');
const sliderPrev = document.getElementById('sliderPrev');
const sliderNext = document.getElementById('sliderNext');
const trailerModal = document.getElementById('trailerModal');
const trailerFrame = document.getElementById('trailerFrame');
const trailerClose = document.getElementById('trailerClose');

async function fetchMovies() {
    showLoading(true);
    movieGrid.innerHTML = '';
    
    try {
        const url = `${API_BASE}/api/${currentSource}/movies?category=${currentCategory}`;
        console.log('Fetching:', url);
        const response = await fetch(url);
        console.log('Response status:', response.status);
        const movies = await response.json();
        console.log('Got movies:', movies.length);
        
        if (movies.length === 0) {
            movieGrid.innerHTML = '<p class="no-results">No movies found</p>';
        } else {
            heroMovies = movies.slice(0, 5);
            updateHeroSection(heroMovies[0]);
            startHeroSlideshow();
            
            movies.forEach(movie => {
                const card = createMovieCard(movie);
                movieGrid.appendChild(card);
            });
        }
        
        updateRowTitle();
    } catch (error) {
        movieGrid.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        console.error('Fetch error:', error);
    } finally {
        showLoading(false);
    }
}

function updateRowTitle() {
    const rowTitle = document.getElementById('rowTitle');
    const sourceName = currentSource === 'isaidub' ? 'Tamil Dubbed' : 'Tamil Movies';
    rowTitle.textContent = `${sourceName} ${currentCategory}`;
}

function updateHeroSection(movie) {
    if (!movie) return;
    
    const movieName = movie.title.replace(/\s*\(\d{4}\)\s*/g, '').trim();
    const searchQuery = encodeURIComponent(movieName + ' movie trailer');
    
    heroBackdrop.style.backgroundImage = movie.thumbnail 
        ? `url(${movie.thumbnail})` 
        : 'linear-gradient(135deg, #1f1f1f, #141414)';
    
    heroTitle.textContent = movie.title;
    heroDescription.textContent = 'Watch and download the latest Tamil dubbed movies in HD quality. Direct download links available.';
    
    playTrailerBtn.onclick = () => playTrailer(searchQuery);
    moreInfoBtn.onclick = () => openModal(movie);
}

function startHeroSlideshow() {
    if (heroInterval) clearInterval(heroInterval);
    
    heroInterval = setInterval(() => {
        if (heroMovies.length > 1) {
            heroIndex = (heroIndex + 1) % heroMovies.length;
            const movie = heroMovies[heroIndex];
            heroBackdrop.style.opacity = '0';
            setTimeout(() => {
                updateHeroSection(movie);
                heroBackdrop.style.opacity = '1';
            }, 500);
        }
    }, 6000);
}

async function playTrailer(query) {
    try {
        const response = await fetch(`https://www.youtube.com/results?search_query=${query}`);
        const text = await response.text();
        const videoIdMatch = text.match(/"videoId":"([^"]+)"/);
        
        if (videoIdMatch && videoIdMatch[1]) {
            trailerFrame.src = `https://www.youtube.com/embed/${videoIdMatch[1]}?autoplay=1`;
            trailerModal.classList.add('active');
        } else {
            alert('Trailer not found');
        }
    } catch (error) {
        console.error('Trailer search error:', error);
        alert('Could not find trailer');
    }
}

function closeTrailerModal() {
    trailerFrame.src = '';
    trailerModal.classList.remove('active');
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
            heroMovies = movies.slice(0, 5);
            if (heroMovies.length > 0) {
                updateHeroSection(heroMovies[0]);
            }
            
            movies.forEach(movie => {
                const card = createMovieCard(movie);
                movieGrid.appendChild(card);
            });
        }
        
        const rowTitle = document.getElementById('rowTitle');
        rowTitle.textContent = `Search Results for "${query}"`;
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
    const overlayHtml = `
        <div class="movie-overlay">
            <span class="movie-badge">${currentSource === 'isaidub' ? 'Tamil Dubbed' : 'Tamil'}</span>
        </div>
    `;
    card.innerHTML = `
        ${imgHtml}
        ${emojiHtml}
        ${overlayHtml}
    `;
    card.addEventListener('click', () => openModal(movie));
    return card;
}

async function fetchMovieDetails(url) {
    loadingDetails.style.display = 'flex';
    
    try {
        const apiUrl = `${API_BASE}/api/${currentSource}/details?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const details = await response.json();
        
        if (details.title) {
            modalTitle.textContent = details.title;
        }
        
        if (details.thumbnail) {
            modalPoster.style.backgroundImage = `url(${details.thumbnail})`;
            modalPoster.style.backgroundSize = 'cover';
            modalPoster.style.backgroundPosition = 'center';
            modalBackdrop.style.backgroundImage = `url(${details.thumbnail})`;
        }
        
        modalGenres.textContent = details.genres || '';
        modalGenres.style.display = details.genres ? 'inline-block' : 'none';
        modalDirector.innerHTML = details.director ? `<strong>Director:</strong> ${details.director}` : '';
        modalStarring.innerHTML = details.starring ? `<strong>Starring:</strong> ${details.starring}` : '';
        modalQuality.innerHTML = details.quality ? details.quality : '';
        modalQuality.style.display = details.quality ? 'inline-block' : 'none';
        modalLanguage.innerHTML = details.language || 'Tamil';
        modalRating.innerHTML = details.rating ? details.rating : '';
        modalRating.style.display = details.rating ? 'inline-block' : 'none';
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
    
    fetchISAIDUBDownloadLinks(movieUrl, '720p');
}

function renderMoviesdaQualities(qualities) {
    if (qualities.length === 0) {
        qualityOptions.innerHTML = '<p style="color:#b3b3b3;text-align:center;">No qualities available</p>';
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
    loadingLinks.style.display = 'flex';
    downloadLinks.innerHTML = '';
    fileInfo.style.display = 'none';
    
    try {
        const response = await fetch(`${API_BASE}/api/isaidub/download?url=${encodeURIComponent(url)}&quality=${quality}`);
        const data = await response.json();
        
        if (data.error) {
            downloadLinks.innerHTML = `<p class="error-msg">${data.error}</p>`;
            loadingLinks.style.display = 'none';
            return;
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

async function fetchMoviesdaDownloadLinks(url) {
    loadingLinks.style.display = 'flex';
    downloadLinks.innerHTML = '';
    fileInfo.style.display = 'none';
    
    try {
        const response = await fetch(`${API_BASE}/api/moviesda/download?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        if (data.info && Object.keys(data.info).length > 0) {
            let infoHtml = '';
            if (data.info.file_name) infoHtml += `<p><strong>File:</strong> ${data.info.file_name}</p>`;
            if (data.info.file_size) infoHtml += `<p><strong>Size:</strong> ${data.info.file_size}</p>`;
            if (data.info.duration) infoHtml += `<p><strong>Duration:</strong> ${data.info.duration}</p>`;
            if (data.info.video_resolution) infoHtml += `<p><strong>Resolution:</strong> ${data.info.video_resolution}</p>`;
            if (data.info.format) infoHtml += `<p><strong>Format:</strong> ${data.info.format}</p>`;
            if (infoHtml) {
                fileInfo.innerHTML = infoHtml;
                fileInfo.style.display = 'block';
            }
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
    
    if (movie.thumbnail) {
        modalPoster.style.backgroundImage = `url(${movie.thumbnail})`;
        modalPoster.style.backgroundSize = 'cover';
        modalBackdrop.style.backgroundImage = `url(${movie.thumbnail})`;
    }
    
    modalGenres.textContent = '';
    modalDirector.innerHTML = '';
    modalStarring.innerHTML = '';
    modalQuality.innerHTML = '';
    modalQuality.style.display = 'none';
    modalRating.innerHTML = '';
    modalRating.style.display = 'none';
    modalUpdated.innerHTML = '';
    modalSynopsis.textContent = '';
    qualityOptions.innerHTML = '<p style="color:#b3b3b3;">Loading qualities...</p>';
    fileInfo.style.display = 'none';
    downloadLinks.innerHTML = '';
    loadingDetails.style.display = 'flex';
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    fetchMovieDetails(movie.link);
}

function closeModalHandler() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    currentMovieUrl = null;
    downloadLinks.innerHTML = '';
    loadingLinks.style.display = 'none';
}

function showLoading(show) {
    loading.style.display = show ? 'flex' : 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function slideMovies(direction) {
    const grid = movieGrid;
    const scrollAmount = 220;
    grid.scrollBy({
        left: direction * scrollAmount,
        behavior: 'smooth'
    });
}

if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        searchMovies(searchInput.value);
    });
}

if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchMovies(searchInput.value);
        }
    });
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        catTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.cat-tab[data-category="${currentCategory}"]`)?.classList.add('active');
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

if (modalClose) {
    modalClose.addEventListener('click', closeModalHandler);
}

if (modal) {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModalHandler();
        }
    });
}

if (trailerClose) {
    trailerClose.addEventListener('click', closeTrailerModal);
}

if (trailerModal) {
    trailerModal.addEventListener('click', (e) => {
        if (e.target === trailerModal) {
            closeTrailerModal();
        }
    });
}

if (sliderPrev) {
    sliderPrev.addEventListener('click', () => slideMovies(-1));
}

if (sliderNext) {
    sliderNext.addEventListener('click', () => slideMovies(1));
}

window.addEventListener('scroll', () => {
    if (navbar) {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (trailerModal && trailerModal.classList.contains('active')) {
            closeTrailerModal();
        } else if (modal && modal.classList.contains('active')) {
            closeModalHandler();
        }
    }
});

fetchMovies();
