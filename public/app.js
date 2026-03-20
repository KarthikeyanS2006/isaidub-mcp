const API_BASE = window.location.origin;
let currentSource = 'isaidub';
let currentCategory = '2026';
let currentMediaType = 'all';
let currentMovieUrl = null;
let currentMovieTitle = null;
let heroMovies = [];
let heroIndex = 0;
let heroInterval = null;
let allMovies = [];
let reduceMotion = false;

const splashScreen = document.getElementById('splashScreen');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const moviesSection = document.getElementById('moviesSection');
const loading = document.getElementById('loading');
const modal = document.getElementById('movieModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalPoster = document.getElementById('modalPoster');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalQuality = document.getElementById('modalQuality');
const modalDirector = document.getElementById('modalDirector');
const modalStarring = document.getElementById('modalStarring');
const modalLanguage = document.getElementById('modalLanguage');
const modalRating = document.getElementById('modalRating');
const modalSynopsis = document.getElementById('modalSynopsis');
const qualityOptions = document.getElementById('qualityOptions');
const fileInfo = document.getElementById('fileInfo');
const downloadLinks = document.getElementById('downloadLinks');
const loadingLinks = document.getElementById('loadingLinks');
const tabs = document.querySelectorAll('.source-tab');
const catTabs = document.querySelectorAll('.cat-tab');
const typeTabs = document.querySelectorAll('.type-tab');

const navbar = document.querySelector('.navbar');
const heroSection = document.getElementById('heroSection');
const heroBackdrop = document.getElementById('heroBackdrop');
const heroTitle = document.getElementById('heroTitle');
const heroDescription = document.getElementById('heroDescription');
const heroIndicators = document.getElementById('heroIndicators');
const playTrailerBtn = document.getElementById('playTrailerBtn');
const moreInfoBtn = document.getElementById('moreInfoBtn');
const sliderPrev = document.getElementById('sliderPrev');
const sliderNext = document.getElementById('sliderNext');
const trailerModal = document.getElementById('trailerModal');
const trailerFrame = document.getElementById('trailerFrame');
const trailerClose = document.getElementById('trailerClose');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const mobileSearchInput = document.getElementById('mobileSearchInput');
const modalPlayTrailer = document.getElementById('modalPlayTrailer');
const previewModal = document.getElementById('previewModal');
const previewClose = document.getElementById('previewClose');
const previewTitle = document.getElementById('previewTitle');
const previewDesc = document.getElementById('previewDesc');
const previewAddList = document.getElementById('previewAddList');
const previewPlay = document.getElementById('previewPlay');
const previewThumb = document.getElementById('previewThumb');
const searchSuggestions = document.getElementById('searchSuggestions');
const myListSection = document.getElementById('myListSection');
const myListGrid = document.getElementById('myListGrid');
const continueSection = document.getElementById('continueSection');
const continueGrid = document.getElementById('continueGrid');
const reduceMotionBtn = document.getElementById('reduceMotionBtn');
const mobileReduceMotionBtn = document.getElementById('mobileReduceMotionBtn');

// LocalStorage Manager
const Storage = {
    MY_LIST_KEY: 'srikcyan_my_list',
    CONTINUE_WATCHING_KEY: 'srikcyan_continue',
    REDUCE_MOTION_KEY: 'srikcyan_reduce_motion',
    LAST_SOURCE_KEY: 'srikcyan_source',
    LAST_CATEGORY_KEY: 'srikcyan_category',
    
    getMyList() {
        const data = localStorage.getItem(this.MY_LIST_KEY);
        return data ? JSON.parse(data) : [];
    },
    
    saveMyList(list) {
        localStorage.setItem(this.MY_LIST_KEY, JSON.stringify(list));
        updateMyListCount();
    },
    
    addToMyList(movie) {
        const list = this.getMyList();
        if (!list.find(m => m.link === movie.link)) {
            list.unshift(movie);
            this.saveMyList(list);
            showToast('Added to My List');
        }
    },
    
    removeFromMyList(movie) {
        let list = this.getMyList();
        list = list.filter(m => m.link !== movie.link);
        this.saveMyList(list);
        showToast('Removed from My List');
        renderMyList();
    },
    
    isInMyList(movie) {
        const list = this.getMyList();
        return list.some(m => m.link === movie.link);
    },
    
    getContinueWatching() {
        const data = localStorage.getItem(this.CONTINUE_WATCHING_KEY);
        return data ? JSON.parse(data) : [];
    },
    
    addToContinue(movie) {
        let list = this.getContinueWatching();
        list = list.filter(m => m.link !== movie.link);
        list.unshift({ ...movie, lastWatched: Date.now() });
        list = list.slice(0, 20);
        localStorage.setItem(this.CONTINUE_WATCHING_KEY, JSON.stringify(list));
        renderContinueWatching();
    },
    
    setReduceMotion(value) {
        reduceMotion = value;
        localStorage.setItem(this.REDUCE_MOTION_KEY, value);
        document.body.classList.toggle('reduce-motion', value);
        updateMotionButtons();
    },
    
    getReduceMotion() {
        return localStorage.getItem(this.REDUCE_MOTION_KEY) === 'true';
    },
    
    setLastSource(source) {
        localStorage.setItem(this.LAST_SOURCE_KEY, source);
    },
    
    getLastSource() {
        return localStorage.getItem(this.LAST_SOURCE_KEY) || 'isaidub';
    },
    
    setLastCategory(category) {
        localStorage.setItem(this.LAST_CATEGORY_KEY, category);
    },
    
    getLastCategory() {
        return localStorage.getItem(this.LAST_CATEGORY_KEY) || '2026';
    }
};

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function updateMotionButtons() {
    const btns = [reduceMotionBtn, mobileReduceMotionBtn];
    btns.forEach(btn => {
        if (btn) btn.classList.toggle('active', reduceMotion);
    });
}

window.addEventListener('load', () => {
    reduceMotion = Storage.getReduceMotion();
    document.body.classList.toggle('reduce-motion', reduceMotion);
    updateMotionButtons();
    
    currentSource = Storage.getLastSource();
    currentCategory = Storage.getLastCategory();
    
    const sourceTab = document.querySelector(`.source-tab[data-source="${currentSource}"]`);
    const catTab = document.querySelector(`.cat-tab[data-category="${currentCategory}"]`);
    if (sourceTab) sourceTab.classList.add('active');
    if (catTab) catTab.classList.add('active');
    
    setTimeout(() => {
        splashScreen.classList.add('hidden');
    }, 4000);
});

async function fetchMovies() {
    showLoading(true);
    
    try {
        const url = `${API_BASE}/api/${currentSource}/movies?category=${currentCategory}`;
        console.log('Fetching:', url);
        const response = await fetch(url);
        console.log('Response status:', response.status);
        const movies = await response.json();
        console.log('Got movies:', movies.length);
        
        if (movies.length === 0) {
            moviesSection.innerHTML = '<p style="text-align:center;color:#b3b3b3;padding:50px;">No movies found</p>';
        } else {
            allMovies = movies;
            heroMovies = movies.slice(0, 5);
            createHeroIndicators();
            updateHeroSection(heroMovies[0]);
            startHeroSlideshow();
            
            createMovieRows(movies);
        }
        
        renderMyList();
        renderContinueWatching();
    } catch (error) {
        moviesSection.innerHTML = `<p style="text-align:center;color:#e50914;padding:50px;">Error: ${error.message}</p>`;
        console.error('Fetch error:', error);
    } finally {
        showLoading(false);
    }
}

function createMovieRows(movies) {
    moviesSection.innerHTML = '';
    
    let filteredMovies = movies;
    if (currentMediaType === 'movies') {
        filteredMovies = movies.filter(m => 
            !m.title.toLowerCase().match(/season|episode|web series|series/i)
        );
    } else if (currentMediaType === 'webseries') {
        filteredMovies = movies.filter(m => 
            m.title.toLowerCase().match(/season|episode|web series|series/i) ||
            m.link.toLowerCase().includes('web-series') ||
            m.link.toLowerCase().includes('season')
        );
    }
    
    const allRow = createRow('Latest', filteredMovies, 'all');
    moviesSection.appendChild(allRow);
    
    const isaidubMovies = filteredMovies.filter(m => m.source === 'isaidub');
    const moviesdaMovies = filteredMovies.filter(m => m.source === 'moviesda');
    
    if (isaidubMovies.length >= 5) {
        moviesSection.appendChild(createRow('Tamil Dubbed', isaidubMovies, 'isaidub'));
    }
    
    if (moviesdaMovies.length >= 5) {
        moviesSection.appendChild(createRow('Tamil Movies', moviesdaMovies, 'moviesda'));
    }
    
    const shuffled = [...filteredMovies].sort(() => Math.random() - 0.5);
    const actionMovies = shuffled.filter(m => 
        m.title.toLowerCase().match(/action|war|battle|fight|superhero|army|martial|kick|punch/) || 
        Math.random() > 0.6
    ).slice(0, 15);
    
    const horrorMovies = shuffled.filter(m => 
        m.title.toLowerCase().match(/horror|ghost|devil|nightmare|evil|haunted|curse|dead|undead/) ||
        Math.random() > 0.7
    ).slice(0, 15);
    
    const comedyMovies = shuffled.filter(m => 
        m.title.toLowerCase().match(/comedy|fun|funny|party|hilarious|laugh/) ||
        Math.random() > 0.65
    ).slice(0, 15);
    
    const dramaMovies = shuffled.filter(m => 
        m.title.toLowerCase().match(/drama|family|emotion|heart|sad|love|romance/) ||
        Math.random() > 0.65
    ).slice(0, 15);
    
    if (actionMovies.length >= 5) {
        moviesSection.appendChild(createRow('Action', actionMovies, 'action'));
    }
    
    if (horrorMovies.length >= 5) {
        moviesSection.appendChild(createRow('Horror', horrorMovies, 'horror'));
    }
    
    if (comedyMovies.length >= 5) {
        moviesSection.appendChild(createRow('Comedy', comedyMovies, 'comedy'));
    }
    
    if (dramaMovies.length >= 5) {
        moviesSection.appendChild(createRow('Drama', dramaMovies, 'drama'));
    }
    
    addScrollListeners();
}

function createRow(title, movies, rowId) {
    const row = document.createElement('div');
    row.className = 'movies-row';
    row.innerHTML = `
        <div class="row-header">
            <h2 class="row-title">${title}</h2>
            <div class="row-nav">
                <button class="row-nav-btn prev-btn" data-row="${rowId}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                    </svg>
                </button>
                <button class="row-nav-btn next-btn" data-row="${rowId}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="movies-slider">
            <div class="movie-grid" id="grid-${rowId}"></div>
        </div>
    `;
    
    const grid = row.querySelector(`#grid-${rowId}`);
    movies.forEach(movie => {
        const card = createMovieCard(movie);
        grid.appendChild(card);
    });
    
    row.querySelector('.prev-btn').addEventListener('click', () => slideRow(rowId, -1));
    row.querySelector('.next-btn').addEventListener('click', () => slideRow(rowId, 1));
    
    return row;
}

function slideRow(rowId, direction) {
    const grid = document.getElementById(`grid-${rowId}`);
    if (grid) {
        const scrollAmount = 220;
        grid.scrollBy({
            left: direction * scrollAmount,
            behavior: 'smooth'
        });
    }
}

function addScrollListeners() {
    document.querySelectorAll('.movie-grid').forEach(grid => {
        let isDown = false;
        let startX;
        let scrollLeft;

        grid.addEventListener('mousedown', (e) => {
            isDown = true;
            grid.style.cursor = 'grabbing';
            startX = e.pageX - grid.offsetLeft;
            scrollLeft = grid.scrollLeft;
        });

        grid.addEventListener('mouseleave', () => {
            isDown = false;
            grid.style.cursor = 'grab';
        });

        grid.addEventListener('mouseup', () => {
            isDown = false;
            grid.style.cursor = 'grab';
        });

        grid.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - grid.offsetLeft;
            const walk = (x - startX) * 2;
            grid.scrollLeft = scrollLeft - walk;
        });
    });
}

function renderMyList() {
    const list = Storage.getMyList();
    myListGrid.innerHTML = '';
    
    if (list.length === 0) {
        myListSection.style.display = 'none';
        return;
    }
    
    myListSection.style.display = 'block';
    document.getElementById('myListRowCount').textContent = `${list.length} movies`;
    
    list.forEach(movie => {
        const card = createMovieCard(movie, true);
        myListGrid.appendChild(card);
    });
    
    addScrollListeners();
}

function renderContinueWatching() {
    const list = Storage.getContinueWatching();
    continueGrid.innerHTML = '';
    
    if (list.length === 0) {
        continueSection.style.display = 'none';
        return;
    }
    
    continueSection.style.display = 'block';
    
    list.forEach(movie => {
        const card = createMovieCard(movie, true);
        continueGrid.appendChild(card);
    });
    
    addScrollListeners();
}

function updateMyListCount() {
    const count = Storage.getMyList().length;
    const countEls = [
        document.getElementById('myListCount'),
        document.getElementById('mobileMyListCount')
    ];
    countEls.forEach(el => {
        if (el) {
            el.textContent = count;
            el.style.display = count > 0 ? 'inline-block' : 'none';
        }
    });
}

function createHeroIndicators() {
    heroIndicators.innerHTML = '';
    heroMovies.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = `hero-indicator ${i === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToHeroSlide(i));
        heroIndicators.appendChild(dot);
    });
}

function updateHeroIndicators() {
    const dots = heroIndicators.querySelectorAll('.hero-indicator');
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === heroIndex);
    });
}

function goToHeroSlide(index) {
    if (heroMovies.length === 0) return;
    heroIndex = index;
    heroBackdrop.style.opacity = '0';
    setTimeout(() => {
        updateHeroSection(heroMovies[heroIndex]);
        heroBackdrop.style.opacity = '1';
    }, reduceMotion ? 0 : 400);
    updateHeroIndicators();
    resetHeroSlideshow();
}

function updateHeroSection(movie) {
    if (!movie) return;
    
    currentMovieTitle = movie.title.replace(/\s*\(\d{4}\)\s*/g, '').trim();
    const searchQuery = encodeURIComponent(currentMovieTitle + ' movie trailer');
    
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
            heroBackdrop.style.opacity = '0';
            setTimeout(() => {
                updateHeroSection(heroMovies[heroIndex]);
                heroBackdrop.style.opacity = '1';
            }, reduceMotion ? 0 : 400);
            updateHeroIndicators();
        }
    }, reduceMotion ? 15000 : 7000);
}

function resetHeroSlideshow() {
    if (heroInterval) {
        clearInterval(heroInterval);
        startHeroSlideshow();
    }
}

async function playTrailer(query) {
    try {
        loading.style.display = 'flex';
        const response = await fetch(`https://www.youtube.com/results?search_query=${query}`);
        const text = await response.text();
        const videoIdMatch = text.match(/"videoId":"([^"]+)"/);
        
        loading.style.display = 'none';
        
        if (videoIdMatch && videoIdMatch[1]) {
            trailerFrame.src = `https://www.youtube.com/embed/${videoIdMatch[1]}?autoplay=1`;
            trailerModal.classList.add('active');
        } else {
            alert('Trailer not found. Try searching on YouTube.');
        }
    } catch (error) {
        loading.style.display = 'none';
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
    searchSuggestions.style.display = 'none';
    
    try {
        const [isaidubRes, moviesdaRes] = await Promise.all([
            fetch(`${API_BASE}/api/isaidub/search?q=${encodeURIComponent(query)}`),
            fetch(`${API_BASE}/api/moviesda/search?q=${encodeURIComponent(query)}`)
        ]);
        
        const isaidubMovies = await isaidubRes.json();
        const moviesdaMovies = await moviesdaRes.json();
        
        const combinedMovies = [
            ...isaidubMovies.map(m => ({ ...m, source: 'isaidub' })),
            ...moviesdaMovies.map(m => ({ ...m, source: 'moviesda' }))
        ];
        
        if (combinedMovies.length === 0) {
            moviesSection.innerHTML = '<p style="text-align:center;color:#b3b3b3;padding:50px;">No movies found for your search</p>';
        } else {
            allMovies = combinedMovies;
            heroMovies = combinedMovies.slice(0, 5);
            createHeroIndicators();
            if (heroMovies.length > 0) {
                updateHeroSection(heroMovies[0]);
            }
            
            createMovieRows(combinedMovies);
        }
        
        closeMobileMenu();
    } catch (error) {
        moviesSection.innerHTML = `<p style="text-align:center;color:#e50914;padding:50px;">Error: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

function createMovieCard(movie, showRemove = false) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    const imgHtml = movie.thumbnail 
        ? `<img src="${movie.thumbnail}" alt="${escapeHtml(movie.title)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
        : '';
    const emojiHtml = `<div class="movie-poster" style="display:${movie.thumbnail ? 'none' : 'flex'};">🎬</div>`;
    const sourceBadge = movie.source === 'moviesda' ? 'Tamil' : 'Tamil Dubbed';
    const isInList = Storage.isInMyList(movie);
    
    let actionsHtml = '';
    if (showRemove) {
        actionsHtml = `
            <div class="card-actions">
                <button class="card-action-btn remove-btn" data-link="${movie.link}" title="Remove">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        `;
    }
    
    const overlayHtml = `
        <div class="movie-overlay">
            ${actionsHtml}
            <span class="movie-badge">${sourceBadge}</span>
            <h3 class="movie-title">${escapeHtml(movie.title)}</h3>
            <button class="add-list-btn ${isInList ? 'added' : ''}" data-link="${movie.link}" data-title="${escapeHtml(movie.title)}" data-thumb="${movie.thumbnail || ''}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    ${isInList 
                        ? '<path d="M19 13H5v-2h14v2z"/>' 
                        : '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>'}
                </svg>
            </button>
        </div>
    `;
    
    card.innerHTML = `${imgHtml}${emojiHtml}${overlayHtml}`;
    card.addEventListener('click', (e) => {
        if (e.target.closest('.add-list-btn')) {
            e.stopPropagation();
            handleAddToList(e.target.closest('.add-list-btn'), movie);
        } else if (e.target.closest('.remove-btn')) {
            e.stopPropagation();
            Storage.removeFromMyList(movie);
        } else if (e.target.closest('.card-action-btn')) {
            e.stopPropagation();
        } else {
            openModal(movie);
        }
    });
    
    return card;
}

function handleAddToList(btn, movie) {
    if (Storage.isInMyList(movie)) {
        Storage.removeFromMyList(movie);
        btn.classList.remove('added');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
        `;
    } else {
        Storage.addToMyList(movie);
        btn.classList.add('added');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13H5v-2h14v2z"/>
            </svg>
        `;
    }
}

async function fetchMovieDetails(url) {
    try {
        const apiUrl = `${API_BASE}/api/${currentSource}/details?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const details = await response.json();
        
        if (details.title) {
            modalTitle.textContent = details.title;
            currentMovieTitle = details.title.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        }
        
        if (details.thumbnail) {
            modalPoster.style.backgroundImage = `url(${details.thumbnail})`;
            modalBackdrop.style.backgroundImage = `url(${details.thumbnail})`;
        }
        
        modalQuality.textContent = details.quality || '';
        modalQuality.style.display = details.quality ? 'inline-block' : 'none';
        modalLanguage.textContent = details.language || 'Tamil';
        modalRating.textContent = details.rating ? `⭐ ${details.rating}` : '';
        modalRating.style.display = details.rating ? 'inline-block' : 'none';
        modalDirector.innerHTML = details.director ? `<strong>Director:</strong> ${details.director}` : '';
        modalStarring.innerHTML = details.starring ? `<strong>Starring:</strong> ${details.starring}` : '';
        modalSynopsis.textContent = details.synopsis || '';
        
        modalPlayTrailer.onclick = () => playTrailer(encodeURIComponent(currentMovieTitle + ' movie trailer'));
        
        if (currentSource === 'isaidub') {
            renderISAIDUBQualities(url);
        } else {
            renderMoviesdaQualities(details.qualities || []);
        }
        
    } catch (error) {
        console.error('Error fetching details:', error);
        qualityOptions.innerHTML = '<p style="color:#b3b3b3;">Error loading details</p>';
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
    if (!qualities || qualities.length === 0) {
        qualityOptions.innerHTML = '<p style="color:#b3b3b3;">No qualities available</p>';
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
    
    fetchMoviesdaDownloadLinks(qualities[0].url);
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
        modalBackdrop.style.backgroundImage = `url(${movie.thumbnail})`;
    }
    
    modalQuality.innerHTML = '';
    modalQuality.style.display = 'none';
    modalRating.innerHTML = '';
    modalRating.style.display = 'none';
    modalDirector.innerHTML = '';
    modalStarring.innerHTML = '';
    modalSynopsis.textContent = '';
    qualityOptions.innerHTML = '<p style="color:#b3b3b3;">Loading...</p>';
    fileInfo.style.display = 'none';
    downloadLinks.innerHTML = '';
    loadingLinks.style.display = 'flex';
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    Storage.addToContinue(movie);
    closeMobileMenu();
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

function toggleMobileMenu() {
    hamburger.classList.toggle('active');
    mobileMenu.classList.toggle('active');
}

function closeMobileMenu() {
    hamburger.classList.remove('active');
    mobileMenu.classList.remove('active');
}

if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        searchMovies(searchInput.value);
    });
}

if (searchInput) {
    searchInput.addEventListener('focus', () => {
        searchSuggestions.style.display = 'block';
    });
    
    searchInput.addEventListener('blur', () => {
        setTimeout(() => searchSuggestions.style.display = 'none', 200);
    });
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchMovies(searchInput.value);
        }
    });
}

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const query = chip.dataset.query;
        if (searchInput) searchInput.value = query;
        searchMovies(query);
    });
});

if (hamburger) {
    hamburger.addEventListener('click', toggleMobileMenu);
}

if (mobileSearchInput) {
    mobileSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchMovies(mobileSearchInput.value);
        }
    });
}

document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        closeMobileMenu();
    });
});

document.getElementById('mobileHomeLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    goHome();
});

document.getElementById('mobileMyListLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showMyList();
    closeMobileMenu();
});

document.getElementById('mobileContinueLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showContinueWatching();
    closeMobileMenu();
});

const homeLink = document.getElementById('homeLink');
const myListLink = document.getElementById('myListLink');
const continueWatchingLink = document.getElementById('continueWatchingLink');

function goHome() {
    currentSource = Storage.getLastSource();
    currentCategory = Storage.getLastCategory();
    currentMediaType = 'all';
    
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector(`.source-tab[data-source="${currentSource}"]`)?.classList.add('active');
    
    catTabs.forEach(t => t.classList.remove('active'));
    document.querySelector(`.cat-tab[data-category="${currentCategory}"]`)?.classList.add('active');
    
    typeTabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.type-tab[data-type="all"]')?.classList.add('active');
    
    myListSection.style.display = 'none';
    continueSection.style.display = 'none';
    moviesSection.style.display = 'block';
    
    if (searchInput) searchInput.value = '';
    if (mobileSearchInput) mobileSearchInput.value = '';
    
    fetchMovies();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMyList() {
    myListSection.style.display = 'block';
    continueSection.style.display = 'none';
    moviesSection.style.display = 'none';
    renderMyList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showContinueWatching() {
    continueSection.style.display = 'block';
    myListSection.style.display = 'none';
    moviesSection.style.display = 'none';
    renderContinueWatching();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

if (homeLink) {
    homeLink.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });
}

if (myListLink) {
    myListLink.addEventListener('click', (e) => {
        e.preventDefault();
        showMyList();
    });
}

if (continueWatchingLink) {
    continueWatchingLink.addEventListener('click', (e) => {
        e.preventDefault();
        showContinueWatching();
    });
}

typeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        typeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentMediaType = tab.dataset.type;
        if (allMovies.length > 0) {
            createMovieRows(allMovies);
        }
    });
});

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        catTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.cat-tab[data-category="${currentCategory}"]`)?.classList.add('active');
        currentSource = tab.dataset.source;
        Storage.setLastSource(currentSource);
        if (searchInput) searchInput.value = '';
        if (mobileSearchInput) mobileSearchInput.value = '';
        fetchMovies();
    });
});

catTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        catTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        Storage.setLastCategory(currentCategory);
        if (searchInput) searchInput.value = '';
        if (mobileSearchInput) mobileSearchInput.value = '';
        fetchMovies();
    });
});

if (reduceMotionBtn) {
    reduceMotionBtn.addEventListener('click', () => {
        Storage.setReduceMotion(!reduceMotion);
    });
}

if (mobileReduceMotionBtn) {
    mobileReduceMotionBtn.addEventListener('click', () => {
        Storage.setReduceMotion(!reduceMotion);
    });
}

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

if (previewClose) {
    previewClose.addEventListener('click', () => {
        previewModal.classList.remove('active');
    });
}

if (sliderPrev) {
    sliderPrev.addEventListener('click', () => {
        if (heroMovies.length > 0) {
            goToHeroSlide((heroIndex - 1 + heroMovies.length) % heroMovies.length);
        }
    });
}

if (sliderNext) {
    sliderNext.addEventListener('click', () => {
        if (heroMovies.length > 0) {
            goToHeroSlide((heroIndex + 1) % heroMovies.length);
        }
    });
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
        } else if (previewModal && previewModal.classList.contains('active')) {
            previewModal.classList.remove('active');
        }
    }
});

updateMyListCount();
fetchMovies();
