import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCES = {
  isaidub: process.env.ISAIDUB_URL || "https://isaidub.green",
  moviesda: process.env.MOVIESDA_URL || "https://www.moviessda.com",
  isaimini: process.env.ISAIMINI_URL || "https://www.isaimini.doctor"
};

const axiosConfig = {
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    'Accept-Language': 'en-US,en;q=0.5',
  }
};

// Moviesda content is often behind gateway/ad pages (e.g. moviessda.com routes
// to gotopage.top). Resolve the live mirror that actually lists movies.
let moviesdaBaseCache = null;
const MOVIESDA_CANDIDATES = [
  process.env.MOVIESDA_URL || "https://www.moviessda.com",
  "https://moviezda.com",
  "https://moviesdatamil.net"
];

async function getMoviesdaBase() {
  if (moviesdaBaseCache) return moviesdaBaseCache;
  for (const base of MOVIESDA_CANDIDATES) {
    try {
      const { data } = await axios.get(`${base}/tamil-2026-movies/`, { ...axiosConfig, timeout: 12000 });
      const $ = cheerio.load(data);
      let hasRealContent = false;
      $("div.f a").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith('/') || href.includes('movie')) hasRealContent = true;
      });
      if (hasRealContent) {
        moviesdaBaseCache = base;
        return base;
      }
    } catch (e) {}
  }
  moviesdaBaseCache = SOURCES.moviesda;
  return SOURCES.moviesda;
}

// isaidub mirrors also churn frequently (isaidub.asia -> isaidub.love ->
// dead, etc.). Resolve a base that actually lists real year movies so a stale
// ISAIDUB_URL env value cannot brick the Tamil Dubbed section.
// isaiidub.com / isaidub.asia often 302 to a hub page (/moviesda/) whose only
// non-nav folder link is "Hollywood English Movies" — that must be rejected.
let isaidubBaseCache = null;
const ISAIDUB_CANDIDATES = [
  process.env.ISAIDUB_URL,
  "https://isaidub.green",
  "https://isaiidub.com",
  "https://isaidub.asia"
].filter((v, i, a) => v && a.indexOf(v) === i);

function countIsaidubMovieEntries($, base) {
  let relativeMovieLinks = 0;
  let realMovieTitles = 0;
  $("div.f a, .folder a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = $(el).text().replace("[+]", "").trim();
    const isMoviePath = href.startsWith("/movie/") ||
      (/^https?:\/\//.test(href) && /\/movie\//.test(href) && (!base || href.startsWith(base)));
    if (!isMoviePath) return;
    relativeMovieLinks++;
    if (title && /\(\d{4}\)/.test(title) && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
      realMovieTitles++;
    }
  });
  return { relativeMovieLinks, realMovieTitles };
}

async function getIsaidubBase() {
  if (isaidubBaseCache) return isaidubBaseCache;
  for (const base of ISAIDUB_CANDIDATES) {
    try {
      const resp = await axios.get(`${base}/tamil-2026-dubbed-movies/`, {
        ...axiosConfig,
        timeout: 12000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
      });
      const finalUrl = resp.request?.res?.responseUrl || `${base}/tamil-2026-dubbed-movies/`;
      // Hub / landing redirects (e.g. .../tamil-2026-dubbed-movies/ -> .../moviesda/)
      // are not year listings — skip this candidate.
      if (!/tamil-\d{4}-dubbed-movies/i.test(finalUrl)) continue;
      const $ = cheerio.load(resp.data);
      const { relativeMovieLinks, realMovieTitles } = countIsaidubMovieEntries($, base);
      if (relativeMovieLinks >= 3 && realMovieTitles >= 3) {
        isaidubBaseCache = base;
        return base;
      }
    } catch (e) {}
  }
  // Known-good live mirror rather than a possibly-dead env/default.
  isaidubBaseCache = "https://isaidub.green";
  return isaidubBaseCache;
}

function invalidateIsaidubBase() {
  isaidubBaseCache = null;
}

const ISAIMINI_CATEGORIES = {
  malayalam: '/2/category/malayalam-movies/default.html',
  tamil: '/6/category/tamil-movies/default.html',
  tamilDubbed: '/5/category/tamil-dubbed-movies/default.html',
  telugu: '/4/category/telugu-movies/default.html',
  teluguDubbed: '/3/category/telugu-dubbed-movies/default.html',
  kannada: '/1/category/kannada-movies/default.html'
};

function getIsaiminiCategoryPages($) {
  const pages = new Set();
  $('a[href*="page="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/page=(\d+)/);
    if (match) pages.add(parseInt(match[1]));
  });
  return Array.from(pages).sort((a, b) => a - b);
}

function parseIsaiminiCategoryPage($, seenLinks) {
  const movies = [];
  $('.dir a[href*="/movie/"]').each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().trim();
    if (!href || !title || seenLinks.has(href)) return;
    if (title.match(/^(Download|Home|Contact|Check|Android|APP)/i)) return;
    if (!/\(\d{4}\)/.test(title)) return;
    seenLinks.add(href);
    const link = href.startsWith('http') ? href : SOURCES.isaimini + href;
    const imgName = title.replace(/ /g, '_') + '.jpg';
    const thumbnail = `${SOURCES.isaimini}/files/images/${imgName}`;
    movies.push({ title, link, thumbnail, source: 'isaimini' });
  });
  return movies;
}

async function scrapeIsaiminiCategory(category, year, maxPages = 10) {
  const catPath = ISAIMINI_CATEGORIES[category] || ISAIMINI_CATEGORIES.malayalam;
  const seenLinks = new Set();
  const allMovies = [];

  const baseUrl = SOURCES.isaimini + catPath;
  const page1Url = `${baseUrl}${year ? `?page=1` : ''}`;

  try {
    const { data } = await axios.get(page1Url, axiosConfig);
    const $ = cheerio.load(data);
    allMovies.push(...parseIsaiminiCategoryPage($, seenLinks));

    const pages = getIsaiminiCategoryPages($);
    const targetPages = year ? pages.filter(p => p <= maxPages) : pages.slice(0, maxPages);

    for (const page of targetPages) {
      if (page === 1) continue;
      const pageUrl = `${baseUrl}?page=${page}`;
      try {
        const { data } = await axios.get(pageUrl, axiosConfig);
        const $ = cheerio.load(data);
        allMovies.push(...parseIsaiminiCategoryPage($, seenLinks));
      } catch (e) {}
    }
  } catch (e) {}

  if (year) {
    return allMovies.filter(m => m.title.includes(`(${year})`));
  }
  return allMovies;
}

async function getIsaiminiMp4Url(url) {
  // url may be a /view/ page link, /download/ server link, or the file page
  let currentUrl = url;

  // If given the file page (has /file/), find the /view/ link
  if (currentUrl.includes('/file/')) {
    const { data } = await axios.get(currentUrl, axiosConfig);
    const $ = cheerio.load(data);
    const viewHref = $('a[href*="/view/"]').first().attr('href');
    if (viewHref) {
      currentUrl = viewHref.startsWith('http') ? viewHref : SOURCES.isaimini + viewHref;
    }
  }

  // If given a /view/ page, find the dwnLink (/download/.../server_N)
  if (currentUrl.includes('/view/')) {
    const { data } = await axios.get(currentUrl, axiosConfig);
    const $ = cheerio.load(data);
    const dwnHref = $('.downLink a.dwnLink, a.dwnLink').first().attr('href') || $('a[href*="/download/"]').first().attr('href');
    if (dwnHref) {
      currentUrl = dwnHref.startsWith('http') ? dwnHref : SOURCES.isaimini + dwnHref;
    }
  }

  // Now currentUrl should be a /download/.../server_1 link → follow 302 to CDN mp4
  try {
    const resp = await axios.get(currentUrl, {
      ...axiosConfig,
      headers: { ...axiosConfig.headers, 'Referer': SOURCES.isaimini + '/' },
      maxRedirects: 0
    });
    return null;
  } catch (e) {
    if (e.response && e.response.status >= 300 && e.response.status < 400) {
      const loc = e.response.headers?.location;
      if (loc) return loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
    }
    return null;
  }
}

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
  if (cache.size > 50) {
    const oldest = cache.entries().next().value;
    if (oldest) cache.delete(oldest[0]);
  }
}

async function getMp4Url(url, maxRedirects = 15) {
  let currentUrl = url;
  
  for (let attempts = 0; attempts < maxRedirects; attempts++) {
    try {
      const response = await axios.get(currentUrl, {
        ...axiosConfig,
        headers: {
          ...axiosConfig.headers,
          'Referer': new URL(currentUrl).origin + '/'
        },
        maxRedirects: 0
      });
      const html = response.data;
      
      const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      if (mp4Match) {
        const mp4Url = mp4Match[0];
        // Try to follow download.php redirect to get raw .mp4 URL
        if (mp4Url.includes('download.php')) {
          try {
            const dlResp = await axios.get(mp4Url, {
              ...axiosConfig,
              headers: { ...axiosConfig.headers, 'Referer': currentUrl },
              maxRedirects: 0
            });
          } catch (dlErr) {
            if (dlErr.response && dlErr.response.status >= 300 && dlErr.response.status < 400) {
              const loc = dlErr.response.headers?.location;
              if (loc) return loc.startsWith('http') ? loc : new URL(loc, mp4Url).href;
            }
          }
        }
        return mp4Url;
      }
      
      const cdnMatch = html.match(/https?:\/\/[^\s"'<>]*(?:uptodub|dub)\.[^\s"'<>]*\/download\.php\?dl=[^\s"'<>]*/i);
      if (cdnMatch) {
        return cdnMatch[0];
      }
      
      const uptodubMatch = html.match(/https?:\/\/[^\s"'<>]*(?:dub\.)?uptodub\.ch[^\s"'<>]*/i);
      if (uptodubMatch) {
        return uptodubMatch[0];
      }
      
      const $ = cheerio.load(html);
      
      const dlink = $('div.dlink a').first().attr('href');
      if (dlink && dlink.startsWith('http')) {
        currentUrl = dlink;
        continue;
      }
      
      const coralLink = $('a.coral').first().attr('href');
      if (coralLink) {
        const fullUrl = coralLink.startsWith('http') ? coralLink : new URL(coralLink, currentUrl).href;
        currentUrl = fullUrl;
        continue;
      }
      
      const downloadMatch = html.match(/href="(https?:\/\/[^\s"]+)"[^>]*>\s*[^<]*(?:Download|download)[^<]*/i);
      if (downloadMatch) {
        currentUrl = downloadMatch[1];
        continue;
      }
      
      const dubpageMatch = html.match(/href="(https?:\/\/(?:dubpage|dubmv|dub)\.[^\s"]+)"[^>]*>/i);
      if (dubpageMatch) {
        currentUrl = dubpageMatch[1];
        continue;
      }
      
      break;
    } catch (error) {
      // Follow HTTP redirect (302/301) via Location header
      if (error.response && error.response.status >= 300 && error.response.status < 400) {
        const location = error.response.headers?.location;
        if (location) {
          const redirectUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
          // If redirect target looks like a direct .mp4 URL, return it immediately
          if (redirectUrl.match(/\.mp4($|\?)/i)) {
            return redirectUrl;
          }
          currentUrl = redirectUrl;
          continue;
        }
      }
      break;
    }
  }
  
  return null;
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/styles.css', express.static(path.join(__dirname, 'public', 'styles.css')));
app.use('/app.js', express.static(path.join(__dirname, 'public', 'app.js')));

// =====================
// ISAIDUB API
// =====================

function generateISAIDUBThumbnail(title, base) {
  const name = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || SOURCES.isaidub}/uploads/posters/${name}.jpg`;
}

function getTotalPages($) {
  let maxPage = 0;
  $('ul.pagination li a').each((_, el) => {
    const text = $(el).text().trim();
    const num = parseInt(text);
    if (!isNaN(num) && num > maxPage) maxPage = num;
  });
  return maxPage || 0;
}

function parsePage($, seenLinks, source, prefixOverride) {
  const movies = [];
  const prefix = prefixOverride || (source === 'isaidub' ? SOURCES.isaidub : SOURCES.moviesda);
  const selector = "div.f a, .folder a";
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().replace("[+]", "").trim();
    if (!href || !title || seenLinks.has(href)) return;
    if (title.match(/^(Download|Tamil|Home|Contact|Check)/i)) return;
    // isaidub year pages only list real titles under /movie/. Nav/hub folders
    // (category links, "Hollywood English Movies" on redirected hubs, etc.) are
    // not movies for the selected year.
    if (source === 'isaidub' && !/\/movie\//.test(href)) return;
    if (source === 'isaidub' && !/\(\d{4}\)/.test(title)) return;
    seenLinks.add(href);
    let link = href.startsWith("http") ? href : prefix + href;
    let thumbnail = null;
    if (source === 'isaidub') {
      thumbnail = generateISAIDUBThumbnail(title, prefix);
    } else {
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
      thumbnail = `${prefix}/uploads/posters/${nameForUrl}.jpg`;
    }
    movies.push({ title, link, thumbnail, source });
  });
  return movies;
}

async function fetchPageResults(urls, seenLinks, source, prefix, concurrency = 10) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const htmls = await Promise.all(batch.map(url =>
      axios.get(url, axiosConfig).then(r => r.data).catch(() => null)
    ));
    for (const html of htmls) {
      if (html) {
        const $ = cheerio.load(html);
        results.push(...parsePage($, seenLinks, source, prefix));
      }
    }
  }
  return results;
}

function isUsableIsaidubList(list) {
  return Array.isArray(list) && list.length >= 3 &&
    list.every(m => m && m.title && /\/movie\//.test(m.link || ''));
}

async function scrapeIsaidubYearList(year) {
  const seenLinks = new Set();
  const candidates = [...ISAIDUB_CANDIDATES];
  if (isaidubBaseCache && !candidates.includes(isaidubBaseCache)) {
    candidates.unshift(isaidubBaseCache);
  }
  if (!candidates.includes("https://isaidub.green")) {
    candidates.push("https://isaidub.green");
  }

  for (const isaBase of candidates) {
    try {
      const page1 = await axios.get(`${isaBase}/tamil-${year}-dubbed-movies/`, {
        ...axiosConfig,
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
      });
      const finalUrl = page1.request?.res?.responseUrl || page1.config?.url ||
        `${isaBase}/tamil-${year}-dubbed-movies/`;
      // Reject hub redirects — they are not the year listing.
      if (!new RegExp(`tamil-${year}-dubbed-movies`, 'i').test(finalUrl)) continue;

      const $ = cheerio.load(page1.data);
      const movies = parsePage($, seenLinks, 'isaidub', isaBase);
      if (movies.length < 3) continue;

      const yearUrls = [];
      const totalPages = getTotalPages($);
      for (let page = 2; page <= totalPages; page++) {
        yearUrls.push(`${isaBase}/tamil-${year}-dubbed-movies/?get-page=${page}`);
      }
      const remaining = await fetchPageResults(yearUrls, seenLinks, 'isaidub', isaBase);
      movies.push(...remaining);

      if (isUsableIsaidubList(movies)) {
        isaidubBaseCache = isaBase;
        return movies;
      }
    } catch (e) {}
  }
  return null;
}

app.get('/api/isaidub/movies', async (req, res) => {
  const { category = '2026', refresh } = req.query;
  const cacheKey = `isaidub:movies:${category}`;
  // ?refresh=1 bypasses the in-memory cache so a warm serverless instance can
  // never keep pinning a stale cold-start scrape (self-heal escape hatch).
  // Also ignore any cached junk list (old hub-page scrapes returned 1 item).
  let cached = refresh === '1' ? null : getCached(cacheKey);
  if (cached && !isUsableIsaidubList(cached)) {
    cache.delete(cacheKey);
    cached = null;
    invalidateIsaidubBase();
  }
  if (cached) return res.json(cached);

  // Scrape only the requested year so cold-start serverless finishes in time.
  const movies = await scrapeIsaidubYearList(category);

  // Never pin a bad/empty/hub scrape into the cache — that is what stuck
  // "Hollywood English Movies" as the only result on Vercel.
  if (movies && isUsableIsaidubList(movies)) {
    setCache(cacheKey, movies);
    return res.json(movies);
  }

  invalidateIsaidubBase();
  res.json([]);
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });

  const searchTerm = q.toLowerCase().trim();
  const cacheKey = `search:${searchTerm}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return res.json(cached.data);
  }

  const shortConfig = { ...axiosConfig, timeout: 10000 };
  const years = ['2026','2025','2024','2023','2022','2021','2020','2019','2018','2017','2016','2015'];
  const allResults = [];
  const seenLinks = new Set();

  function scrapePage($, source, prefix, year) {
    const selector = ".folder a, .f a, div.f a";
    $(selector).each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      if (!href || !title) return;
      if (title.match(/^(Download|Tamil|Home|Contact|Check)/i)) return;
      if (source === 'isaidub' && !/\/movie\//.test(href)) return;
      if (!title.toLowerCase().includes(searchTerm) || seenLinks.has(href)) return;
      seenLinks.add(href);
      const titleLower = title.toLowerCase();
      let score = 0;
      if (titleLower === searchTerm) score = 5;
      else if (titleLower.startsWith(searchTerm)) score = 4;
      else if (titleLower.includes(searchTerm)) score = 3;
      else score = 1;
      score += parseInt(year) / 1000;
      const fullLink = href.startsWith("http") ? href : prefix + href;
      const nameForUrl = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
      const thumb = source === 'isaidub'
        ? generateISAIDUBThumbnail(title, prefix)
        : `${prefix}/uploads/posters/${nameForUrl}.jpg`;
      allResults.push({ title, link: fullLink, thumbnail: thumb, source, score, year });
    });
  }

  async function fetchWithRetry(url, retries = 1) {
    try {
      const r = await axios.get(url, shortConfig);
      return { url, html: r.data };
    } catch (err) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return fetchWithRetry(url, retries - 1);
      }
      return null;
    }
  }

  async function fetchInBatches(urls, batchSize = 10) {
    const results = [];
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(url => fetchWithRetry(url)));
      results.push(...batchResults);
    }
    return results;
  }

  try {
    const isaBase = await getIsaidubBase();
    const mdBase = await getMoviesdaBase();
    const isaidubBase = years.map(y => ({ year: y, source: 'isaidub', base: `${isaBase}/tamil-${y}-dubbed-movies/`, prefix: isaBase }));
    const moviesdaBase = years.map(y => ({ year: y, source: 'moviesda', base: `${mdBase}/tamil-${y}-movies/`, prefix: mdBase }));
    const allBaseUrls = [...isaidubBase, ...moviesdaBase];

    const page1Results = await fetchInBatches(allBaseUrls.map(e => e.base));

    const moreUrls = [];
    for (let i = 0; i < page1Results.length; i++) {
      const r = page1Results[i];
      const info = allBaseUrls[i];
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { html } = r.value;
      const $ = cheerio.load(html);
      scrapePage($, info.source, info.prefix, info.year);
      const totalPages = getTotalPages($);
      const isIsaidub = info.source === 'isaidub';
      for (let page = 2; page <= totalPages; page++) {
        const pageUrl = isIsaidub
          ? `${info.base}?get-page=${page}`
          : `${info.base}?page=${page}`;
        moreUrls.push({ url: pageUrl, source: info.source, prefix: info.prefix, year: info.year });
      }
    }

    if (moreUrls.length > 0) {
      const moreResults = await fetchInBatches(moreUrls.map(e => e.url));
      for (let i = 0; i < moreResults.length; i++) {
        const r = moreResults[i];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const { html } = r.value;
        const $ = cheerio.load(html);
        scrapePage($, moreUrls[i].source, moreUrls[i].prefix, moreUrls[i].year);
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    const final = allResults.slice(0, 30);

    searchCache.set(cacheKey, { data: final, timestamp: Date.now() });
    if (searchCache.size > 100) {
      const oldest = searchCache.keys().next().value;
      searchCache.delete(oldest);
    }

    res.json(final);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/isaidub/search', async (req, res) => {
  res.redirect(301, `/api/search?q=${req.query.q || ''}`);
});

app.get('/api/moviesda/search', async (req, res) => {
  res.redirect(301, `/api/search?q=${req.query.q || ''}`);
});

app.get('/api/isaidub/details', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const isaBase = await getIsaidubBase();
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const details = {
      title: '',
      genres: '',
      director: '',
      starring: '',
      quality: '',
      language: 'Tamil',
      rating: '',
      synopsis: '',
      thumbnail: null,
      qualities: []
    };
    
    details.title = $('title').text().split('(')[0].trim() || '';
    
    const posterImg = $('picture img').attr('src') || $('img[src*="poster"]').attr('src') || $('img[alt*="poster"]').attr('src');
    if (posterImg) details.thumbnail = posterImg.startsWith('http') ? posterImg : isaBase + posterImg;
    
    $('ul.movie-info li').each((_, el) => {
      const text = $(el).text();
      if (text.includes('Director:')) {
        details.director = $(el).find('span').text().trim();
      }
      if (text.includes('Starring:')) {
        details.starring = $(el).find('span').text().trim();
      }
      if (text.includes('Genres:')) {
        details.genres = $(el).find('span').text().trim();
      }
      if (text.includes('Quality:')) {
        details.quality = $(el).find('span').text().trim();
      }
      if (text.includes('Movie Rating:')) {
        details.rating = $(el).find('span').text().trim();
      }
      if (text.includes('Language:')) {
        details.language = $(el).find('span').text().trim();
      }
    });
    
    const synopsisText = $('.movie-synopsis').text() || '';
    if (synopsisText) {
      details.synopsis = synopsisText.replace(/^Synopsis:\s*/i, '').trim();
    }
    
    // Collect version/season page URLs from div.f a links
    const versionUrls = [];
    $('div.f a, .folder a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('/')) {
        versionUrls.push(isaBase + href);
      } else if (href && href.startsWith('http')) {
        versionUrls.push(href);
      }
    });
    
    // Follow the first version page to find quality-specific pages
    if (versionUrls.length > 0) {
      const versionUrl = versionUrls[0];
      try {
        const vResp = await axios.get(versionUrl, { ...axiosConfig, timeout: 10000 });
        const $v = cheerio.load(vResp.data);
        $v('div.f a, .folder a').each((_, el) => {
          const href = $v(el).attr('href');
          const text = $v(el).text().trim();
          if (href) {
            const fullUrl = href.startsWith('http') ? href : isaBase + href;
            details.qualities.push({
              quality: text || 'Download',
              url: fullUrl
            });
          }
        });
      } catch (e) {
        // Fallback: if version page fails, try getting coral links from main page
        $("a.coral").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          if (href) {
            details.qualities.push({
              quality: text || 'Download',
              url: href.startsWith("http") ? href : isaBase + href
            });
          }
        });
      }
    }

    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaidub/mp4', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const mp4Url = await getMp4Url(url);
    res.json({ mp4Url });
  } catch (error) {
    res.json({ mp4Url: null, error: error.message });
  }
});

// =====================
// ISAIMINI API
// =====================

app.get('/api/isaimini/movies', async (req, res) => {
  const { category = 'malayalam', year, refresh } = req.query;
  const cacheKey = `isaimini:movies:${category}:${year || 'all'}`;
  const cached = refresh === '1' ? null : getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const movies = await scrapeIsaiminiCategory(category, year);
    if (movies && movies.length > 0) {
      setCache(cacheKey, movies);
      return res.json(movies);
    }
    res.json([]);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/isaimini/details', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const details = {
      title: '',
      genres: '',
      director: '',
      starring: '',
      quality: '',
      language: '',
      rating: '',
      synopsis: '',
      thumbnail: null,
      qualities: []
    };
    
    details.title = $('title').text().split('(')[0].trim() || '';
    
    const ldJson = $('script[type="application/ld+json"]').first().text();
    if (ldJson) {
      try {
        const parsed = JSON.parse(ldJson);
        if (parsed['@type'] === 'Movie') {
          details.title = parsed.name || details.title;
          details.genres = parsed.genre?.join(', ') || '';
          details.director = parsed.director?.name || '';
          details.starring = parsed.actor?.map(a => a.name).join(', ') || '';
          details.quality = parsed.encodingFormat || '';
          details.language = parsed.inLanguage || '';
          details.synopsis = parsed.description || '';
          details.thumbnail = parsed.image || null;
          if (parsed.offers) {
            details.qualities = parsed.offers.map(o => ({
              quality: o.name?.replace('Full Movie ', '').replace('.mp4', '').trim() || 'Download',
              url: o.url
            }));
          }
        }
      } catch (e) {}
    }
    
    if (!details.thumbnail) {
      const posterImg = $('img[src*="files/images"]').first().attr('src');
      if (posterImg) details.thumbnail = posterImg.startsWith('http') ? posterImg : SOURCES.isaimini + posterImg;
    }
    
    if (details.qualities.length === 0) {
      $('.file-item a[href*="/file/"]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href) {
          details.qualities.push({
            quality: text || 'Download',
            url: href.startsWith('http') ? href : SOURCES.isaimini + href
          });
        }
      });
    }
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaimini/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seen = new Set();
    
    // Each file page links to a /view/ page (Go To Download Page)
    const viewLinks = [];
    $('a[href*="/view/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);
      const fullUrl = href.startsWith('http') ? href : SOURCES.isaimini + href;
      const label = $(el).text().trim() || 'Download';
      viewLinks.push({ label, fullUrl });
    });
    
    // Resolve each view page → download server → direct MP4
    for (const { label, fullUrl } of viewLinks) {
      const labelLower = label.toLowerCase();
      let fileSize = null;
      const sizeMatch = labelLower.match(/(\d+(\.\d+)?\s*(gb|mb|kb))/i);
      if (sizeMatch) fileSize = sizeMatch[1];
      
      const mp4 = await getIsaiminiMp4Url(fullUrl);
      result.download.push({
        server: mp4 ? (mp4.split('/').pop() || label) : label,
        url: mp4 || fullUrl,
        thumbnail: null,
        fileSize
      });
    }
    
    if (result.download.length === 0) {
      // Direct /download/ links on the page (e.g. file page already has them)
      const directLinks = [];
      $('a[href*="/download/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || seen.has(href)) return;
        seen.add(href);
        const fullUrl = href.startsWith('http') ? href : SOURCES.isaimini + href;
        const label = $(el).text().trim() || 'Download';
        directLinks.push({ label, fullUrl });
      });
      for (const { label, fullUrl } of directLinks) {
        const mp4 = await getIsaiminiMp4Url(fullUrl);
        result.download.push({
          server: label,
          url: mp4 || fullUrl,
          thumbnail: null,
          fileSize: null
        });
      }
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaimini/mp4', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const mp4Url = await getIsaiminiMp4Url(url);
    res.json({ mp4Url });
  } catch (error) {
    res.json({ mp4Url: null, error: error.message });
  }
});

app.get('/api/isaimini/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });
  
  try {
    const searchUrl = `${SOURCES.isaimini}/mobile/search?find=${encodeURIComponent(q)}&per_page=10`;
    const { data } = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(data);
    
    const results = [];
    const seen = new Set();
    $('.dir a[href*="/movie/"]').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      if (!href || !title || seen.has(href)) return;
      seen.add(href);
      const fullLink = href.startsWith('http') ? href : SOURCES.isaimini + href;
      const imgName = title.replace(/ /g, '_') + '.jpg';
      const thumbnail = `${SOURCES.isaimini}/files/images/${imgName}`;
      results.push({ title, link: fullLink, thumbnail, source: 'isaimini', year: '' });
    });
    
    res.json(results);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/isaidub/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const isaBase = await getIsaidubBase();
    const { data } = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seenDownloads = new Set();
    
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).find("strong").text().trim() || $(el).text().trim();
      
      if (href) {
        const dlUrl = href.startsWith("http") ? href : isaBase + href;
        if (!seenDownloads.has(dlUrl)) {
          seenDownloads.add(dlUrl);
          result.download.push({
            server: title || 'Download',
            url: dlUrl,
            thumbnail: null,
            fileSize: null
          });
        }
      }
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// MOVIESDA API
// =====================

function parseMoviesdaPage($, seenLinks, source, defaultYear, prefix) {
  const movies = [];
  prefix = prefix || SOURCES.moviesda;
  $("div.f a").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().replace("[+]", "").trim();
    if (href && title && href.includes('movie') && !title.match(/^(Home|Download|Tamil)/i) && !seenLinks.has(href)) {
      seenLinks.add(href);
      const yearMatch = title.match(/\((\d{4})\)/);
      const movieYear = yearMatch ? yearMatch[1] : defaultYear;
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
      const thumbnail = movieYear ? `${prefix}/uploads/posters/${nameForUrl}.jpg` : null;
      movies.push({
        title,
        link: href.startsWith("http") ? href : prefix + href,
        thumbnail,
        year: movieYear,
        source: 'moviesda'
      });
    }
  });
  return movies;
}

app.get('/api/moviesda/movies', async (req, res) => {
  const { category = '2026', refresh } = req.query;
  const cacheKey = `moviesda:movies:${category}`;
  const cached = refresh === '1' ? null : getCached(cacheKey);
  if (cached) return res.json(cached);

  // Speed-fix: scrape only the requested year (single year) instead of 3 years,
  // so cold-start serverless deploys finish within the request timeout.
  const years = [category];
  const movies = [];
  const seenLinks = new Set();
  const mdBase = await getMoviesdaBase();

  // Step 1: Fetch page 1 of all years concurrently
  const page1Results = await Promise.all(years.map(year =>
    axios.get(`${mdBase}/tamil-${year}-movies/`, axiosConfig)
      .then(r => ({ year, html: r.data }))
      .catch(() => ({ year, html: null }))
  ));

  const yearUrls = [];
  for (const { year, html } of page1Results) {
    if (!html) continue;
    const $ = cheerio.load(html);
    movies.push(...parseMoviesdaPage($, seenLinks, 'moviesda', year, mdBase));
    const totalPages = getTotalPages($);
    for (let page = 2; page <= totalPages; page++) {
      yearUrls.push(`${mdBase}/tamil-${year}-movies/?page=${page}`);
    }
  }

  // Step 2: Fetch remaining pages concurrently in batches
  // Need a separate parse function for moviesda since it handles year differently
  async function fetchMoviesdaPages(urls) {
    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      const htmls = await Promise.all(batch.map(url =>
        axios.get(url, axiosConfig).then(r => r.data).catch(() => null)
      ));
      for (const html of htmls) {
        if (html) {
          const $ = cheerio.load(html);
          movies.push(...parseMoviesdaPage($, seenLinks, 'moviesda', category, mdBase));
        }
      }
    }
  }
  await fetchMoviesdaPages(yearUrls);

  setCache(cacheKey, movies);
  res.json(movies);
});

app.get('/api/moviesda/search', async (req, res) => {
  res.redirect(301, `/api/search?q=${req.query.q || ''}`);
});

app.get('/api/moviesda/details', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const mdBase = await getMoviesdaBase();
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const details = {
      title: '',
      genres: '',
      director: '',
      starring: '',
      quality: '',
      language: 'Tamil',
      rating: '',
      updated: '',
      synopsis: '',
      thumbnail: null,
      qualities: []
    };
    
    details.title = $('title').text().split('(')[0].replace('Tamil Movie', '').trim() || $('h1').first().text().trim() || '';
    
    const posterImg = $('picture img').attr('src') || $('img[alt*="poster"]').attr('src');
    if (posterImg) {
      details.thumbnail = posterImg.startsWith('http') ? posterImg : mdBase + posterImg;
    }
    
    $('ul.movie-info li').each((_, el) => {
      const text = $(el).text();
      if (text.includes('Director:')) {
        details.director = $(el).find('span').text().trim();
      }
      if (text.includes('Starring:')) {
        details.starring = $(el).find('span').text().trim();
      }
      if (text.includes('Genres:')) {
        details.genres = $(el).find('span').text().trim();
      }
      if (text.includes('Quality:')) {
        details.quality = $(el).find('span').text().trim();
      }
      if (text.includes('Movie Rating:')) {
        details.rating = $(el).find('span').text().trim();
      }
      if (text.includes('Last Updated:')) {
        details.updated = $(el).find('span').text().trim();
      }
    });
    
    const synopsisText = $('.movie-synopsis').text() || '';
    if (synopsisText) {
      details.synopsis = synopsisText.replace(/^Synopsis:\s*/i, '').trim();
    }
    
    // Collect sub-page URLs from .f a and .folder a links
    const subUrls = [];
    $('.f a, .folder a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.startsWith('/') || href.startsWith('http')) && !href.includes('/download/')) {
        const fullUrl = href.startsWith('http') ? href : mdBase + href;
        subUrls.push(fullUrl);
      }
    });
    
    // Follow the first sub-page to find quality-specific pages
    for (const subUrl of subUrls) {
      try {
        const sResp = await axios.get(subUrl, { ...axiosConfig, timeout: 10000 });
        const $s = cheerio.load(sResp.data);
        $s('.folder a, .f a').each((_, el) => {
          const href = $s(el).attr('href');
          const text = $s(el).text().trim();
          if (href && text && !text.match(/^(Home|Download|Tamil)/i)) {
            details.qualities.push({
              quality: text,
              url: href.startsWith('http') ? href : mdBase + href
            });
          }
        });
        if (details.qualities.length > 0) break;
      } catch (e) {}
    }
    
    // Fallback: get quality links directly from main page
    if (details.qualities.length === 0) {
      $('.f a, .folder a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text && (href.includes('-movie') || href.includes('-hd')) && !text.match(/^(Home|Download|Tamil)/i)) {
          details.qualities.push({
            quality: text,
            url: href.startsWith('http') ? href : mdBase + href
          });
        }
      });
    }
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moviesda/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const mdBase = await getMoviesdaBase();
    const { data } = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seenDownloads = new Set();
    
    // Find coral download links on the quality page
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) {
        const dlUrl = href.startsWith("http") ? href : mdBase + href;
        if (!seenDownloads.has(dlUrl)) {
          seenDownloads.add(dlUrl);
          result.download.push({ server: text || 'Download', url: dlUrl, mp4Url: null });
        }
      }
    });
    
    // Find download links inside .folder or .f
    $('.folder a, .f a').each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && (href.includes('/download/') || href.includes('.mp4'))) {
        const dlUrl = href.startsWith("http") ? href : mdBase + href;
        if (!seenDownloads.has(dlUrl)) {
          seenDownloads.add(dlUrl);
          result.download.push({ server: text || 'Download', url: dlUrl, mp4Url: null });
        }
      }
    });
    
    // Also find div.dlink links (sometimes on quality page itself)
    $('div.dlink a').each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.startsWith('http') && !seenDownloads.has(href)) {
        seenDownloads.add(href);
        const text = $(el).text().trim();
        result.download.push({ server: text || 'Download', url: href, mp4Url: null });
      }
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moviesda/mp4', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const mp4Url = await getMp4Url(url);
    res.json({ mp4Url });
  } catch (error) {
    res.json({ mp4Url: null, error: error.message });
  }
});

// Vercel exports the app; local uses app.listen
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://192.168.1.20:${PORT}`);
  });
}
