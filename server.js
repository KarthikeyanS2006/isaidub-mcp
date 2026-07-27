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
  isaidub: process.env.ISAIDUB_URL || "https://isaidub.guru",
  moviesda: process.env.MOVIESDA_URL || "https://moviesda33.com"
};

const axiosConfig = {
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    'Accept-Language': 'en-US,en;q=0.5',
  }
};

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
  // Prune old entries if cache grows too large
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

function generateISAIDUBThumbnail(title) {
  const name = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${SOURCES.isaidub}/uploads/posters/${name}.jpg`;
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

function parsePage($, seenLinks, source) {
  const movies = [];
  const prefix = source === 'isaidub' ? SOURCES.isaidub : SOURCES.moviesda;
  const selector = "div.f a, .folder a";
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().replace("[+]", "").trim();
    if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i) && !seenLinks.has(href)) {
      seenLinks.add(href);
      let link = href.startsWith("http") ? href : prefix + href;
      let thumbnail = null;
      if (source === 'isaidub') {
        thumbnail = generateISAIDUBThumbnail(title);
      } else {
        const nameForUrl = title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
        thumbnail = `${prefix}/uploads/posters/${nameForUrl}.jpg`;
      }
      movies.push({ title, link, thumbnail, source });
    }
  });
  return movies;
}

async function fetchPageResults(urls, seenLinks, source, concurrency = 10) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const htmls = await Promise.all(batch.map(url =>
      axios.get(url, axiosConfig).then(r => r.data).catch(() => null)
    ));
    for (const html of htmls) {
      if (html) {
        const $ = cheerio.load(html);
        results.push(...parsePage($, seenLinks, source));
      }
    }
  }
  return results;
}

app.get('/api/isaidub/movies', async (req, res) => {
  const { category = '2026' } = req.query;
  const cacheKey = `isaidub:movies:${category}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();
  
  // Step 1: Fetch page 1 of all years concurrently to get total pages per year
  const page1Results = await Promise.all(years.map(year =>
    axios.get(`${SOURCES.isaidub}/tamil-${year}-dubbed-movies/`, axiosConfig)
      .then(r => ({ year, html: r.data }))
      .catch(() => ({ year, html: null }))
  ));
  
  const yearUrls = [];
  for (const { year, html } of page1Results) {
    if (!html) continue;
    const $ = cheerio.load(html);
    movies.push(...parsePage($, seenLinks, 'isaidub'));
    const totalPages = getTotalPages($);
    for (let page = 2; page <= totalPages; page++) {
      yearUrls.push(`${SOURCES.isaidub}/tamil-${year}-dubbed-movies/?get-page=${page}`);
    }
  }
  
  // Step 2: Fetch remaining pages concurrently in batches
  const remaining = await fetchPageResults(yearUrls, seenLinks, 'isaidub');
  movies.push(...remaining);

  setCache(cacheKey, movies);
  res.json(movies);
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
        ? generateISAIDUBThumbnail(title)
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
    const isaidubBase = years.map(y => ({ year: y, source: 'isaidub', base: `${SOURCES.isaidub}/tamil-${y}-dubbed-movies/`, prefix: SOURCES.isaidub }));
    const moviesdaBase = years.map(y => ({ year: y, source: 'moviesda', base: `${SOURCES.moviesda}/tamil-${y}-movies/`, prefix: SOURCES.moviesda }));
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
    if (posterImg) details.thumbnail = posterImg.startsWith('http') ? posterImg : SOURCES.isaidub + posterImg;
    
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
        versionUrls.push(SOURCES.isaidub + href);
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
            const fullUrl = href.startsWith('http') ? href : SOURCES.isaidub + href;
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
              url: href.startsWith("http") ? href : SOURCES.isaidub + href
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

app.get('/api/isaidub/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seenDownloads = new Set();
    
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).find("strong").text().trim() || $(el).text().trim();
      
      if (href) {
        const dlUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
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

function parseMoviesdaPage($, seenLinks, source, defaultYear) {
  const movies = [];
  const prefix = SOURCES.moviesda;
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
  const { category = '2026' } = req.query;
  const cacheKey = `moviesda:movies:${category}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();

  // Step 1: Fetch page 1 of all years concurrently
  const page1Results = await Promise.all(years.map(year =>
    axios.get(`${SOURCES.moviesda}/tamil-${year}-movies/`, axiosConfig)
      .then(r => ({ year, html: r.data }))
      .catch(() => ({ year, html: null }))
  ));

  const yearUrls = [];
  for (const { year, html } of page1Results) {
    if (!html) continue;
    const $ = cheerio.load(html);
    movies.push(...parseMoviesdaPage($, seenLinks, 'moviesda', year));
    const totalPages = getTotalPages($);
    for (let page = 2; page <= totalPages; page++) {
      yearUrls.push(`${SOURCES.moviesda}/tamil-${year}-movies/?page=${page}`);
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
          movies.push(...parseMoviesdaPage($, seenLinks, 'moviesda', category));
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
      details.thumbnail = posterImg.startsWith('http') ? posterImg : SOURCES.moviesda + posterImg;
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
        const fullUrl = href.startsWith('http') ? href : SOURCES.moviesda + href;
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
              url: href.startsWith('http') ? href : SOURCES.moviesda + href
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
            url: href.startsWith('http') ? href : SOURCES.moviesda + href
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
    const { data } = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seenDownloads = new Set();
    
    // Find coral download links on the quality page
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) {
        const dlUrl = href.startsWith("http") ? href : SOURCES.moviesda + href;
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
        const dlUrl = href.startsWith("http") ? href : SOURCES.moviesda + href;
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
