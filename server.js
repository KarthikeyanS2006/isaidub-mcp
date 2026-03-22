import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCES = {
  isaidub: process.env.ISAIDUB_URL || "https://isaidub.love",
  moviesda: process.env.MOVIESDA_URL || "https://moviesda18.com"
};

const axiosConfig = {
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    'Accept-Language': 'en-US,en;q=0.5',
  }
};

async function getMp4Url(url, maxRedirects = 5) {
  let currentUrl = url;
  
  for (let attempts = 0; attempts < maxRedirects; attempts++) {
    try {
      const response = await axios.get(currentUrl, axiosConfig);
      const html = response.data;
      
      const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      if (mp4Match) {
        return mp4Match[0];
      }
      
      const $ = cheerio.load(html);
      
      const dlink = $('div.dlink a').first().attr('href');
      if (dlink) {
        currentUrl = dlink.startsWith('http') ? dlink : new URL(dlink, currentUrl).href;
        continue;
      }
      
      const anyDownload = $('a[href*="download"]').first().attr('href');
      if (anyDownload) {
        currentUrl = anyDownload.startsWith('http') ? anyDownload : new URL(anyDownload, currentUrl).href;
        continue;
      }
      
      break;
    } catch (error) {
      break;
    }
  }
  
  return null;
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use('/styles.css', express.static(path.join(process.cwd(), 'public', 'styles.css')));
app.use('/app.js', express.static(path.join(process.cwd(), 'public', 'app.js')));

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

app.get('/api/isaidub/movies', async (req, res) => {
  const { category = '2026' } = req.query;
  const targetUrl = `${SOURCES.isaidub}/tamil-${category}-dubbed-movies/`;
  
  try {
    const { data } = await axios.get(targetUrl, axiosConfig);
    const $ = cheerio.load(data);
    const movies = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      if (href && href.includes("/movie/") && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        movies.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: generateISAIDUBThumbnail(title),
          source: 'isaidub'
        });
      }
    });

    res.json(movies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaidub/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  try {
    const { data } = await axios.get(`${SOURCES.isaidub}/?s=${encodeURIComponent(q)}`, axiosConfig);
    const $ = cheerio.load(data);
    const results = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      if (href && href.includes("/movie/") && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        results.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: generateISAIDUBThumbnail(title),
          source: 'isaidub'
        });
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    
    const img = $('img[src*="poster"]').attr('src') || $('img[alt*="poster"]').attr('src');
    if (img) details.thumbnail = img.startsWith('http') ? img : SOURCES.isaidub + img;
    
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      
      if (href && href.includes("-movie-") && !href.includes("/download/")) {
        details.qualities.push({
          quality: text || 'Quality',
          url: href.startsWith("http") ? href : SOURCES.isaidub + href
        });
      }
    });
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaidub/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {}, episodes: [] };
    const seenPages = new Set();
    const seenDownloads = new Set();
    const qualityQueue = [];
    
    const hasEpisodes = $(".mv-content").length > 0;
    
    if (hasEpisodes) {
      $(".mv-content").each((_, el) => {
        const linkEl = $(el).find("a.coral");
        const href = linkEl.attr("href");
        const title = linkEl.find("strong").text().trim() || $(el).find("a").text().trim();
        const imgEl = $(el).find("img");
        const thumbnail = imgEl.attr("src") ? SOURCES.isaidub + imgEl.attr("src") : null;
        const sizeEl = $(el).find("li").filter((i, l) => $(l).text().includes("File Size"));
        const fileSize = sizeEl.length > 0 ? sizeEl.text().replace("File Size:", "").trim() : null;
        
        if (href) {
          const dlUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
          if (!seenDownloads.has(dlUrl)) {
            seenDownloads.add(dlUrl);
            result.episodes.push({
              server: title || 'Episode',
              url: dlUrl,
              thumbnail: thumbnail,
              fileSize: fileSize,
              mp4Url: null
            });
          }
        }
      });
      
      for (const ep of result.episodes) {
        const mp4Url = await getMp4Url(ep.url);
        if (mp4Url) ep.mp4Url = mp4Url;
      }
      
      return res.json(result);
    }
    
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && href.includes("-movie-") && !href.includes("/download/")) {
        const fullUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
        if (!seenPages.has(fullUrl)) {
          seenPages.add(fullUrl);
          qualityQueue.push({ quality: text || 'Quality', url: fullUrl });
        }
      }
    });
    
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) {
        const dlUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
        if (!seenDownloads.has(dlUrl)) {
          seenDownloads.add(dlUrl);
          result.download.push({ server: text || 'Download', url: dlUrl, mp4Url: null });
        }
      }
    });
    
    let queueIndex = 0;
    while (queueIndex < qualityQueue.length) {
      const qpage = qualityQueue[queueIndex++];
      
      try {
        const qdata = await axios.get(qpage.url, axiosConfig);
        const $q = cheerio.load(qdata.data);
        
        $q("a.coral").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          if (href) {
            const dlUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
            if (!seenDownloads.has(dlUrl)) {
              seenDownloads.add(dlUrl);
              result.download.push({ server: text || qpage.quality, url: dlUrl, mp4Url: null });
            }
          }
        });
        
        $q("a").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          if (href && href.includes("-movie-") && !href.includes("/download/")) {
            const fullUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
            if (!seenPages.has(fullUrl)) {
              seenPages.add(fullUrl);
              qualityQueue.push({ quality: text || 'Quality', url: fullUrl });
            }
          }
        });
      } catch (e) {}
    }
    
    for (const item of result.download) {
      const mp4Url = await getMp4Url(item.url);
      if (mp4Url) {
        item.mp4Url = mp4Url;
      }
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// MOVIESDA API
// =====================

app.get('/api/moviesda/movies', async (req, res) => {
  const { category = '2026' } = req.query;
  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();

  for (const year of years) {
    for (let page = 1; page <= 3; page++) {
      const targetUrl = page === 1 
        ? `${SOURCES.moviesda}/tamil-${year}-movies/`
        : `${SOURCES.moviesda}/tamil-${year}-movies/?page=${page}`;

      try {
        const { data } = await axios.get(targetUrl, axiosConfig);
        const $ = cheerio.load(data);
        
        let foundMovies = 0;

        $("div.f a").each((_, el) => {
          const href = $(el).attr("href");
          const title = $(el).text().replace("[+]", "").trim();

          if (href && title && href.includes('movie') && !title.match(/^(Home|Download|Tamil)/i) && !seenLinks.has(href)) {
            seenLinks.add(href);
            const yearMatch = title.match(/\((\d{4})\)/);
            const movieYear = yearMatch ? yearMatch[1] : year;
            const nameForUrl = title.toLowerCase()
              .replace(/[^a-z0-9\s]/g, '')
              .replace(/\s+/g, '-')
              .replace(/-+/g, '-');

            const thumbnail = movieYear
              ? `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`
              : null;

            movies.push({
              title,
              link: href.startsWith("http") ? href : SOURCES.moviesda + href,
              thumbnail: thumbnail,
              year: movieYear,
              source: 'moviesda'
            });
            foundMovies++;
          }
        });
        
        if (foundMovies === 0 && page > 1) break;
      } catch (error) {
        break;
      }
    }
  }

  res.json(movies);
});

app.get('/api/moviesda/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  try {
    const { data } = await axios.get(`${SOURCES.moviesda}/?s=${encodeURIComponent(q)}`, axiosConfig);
    const $ = cheerio.load(data);
    const results = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      if (href && title && href.includes('movie') && !title.match(/^(Home|Download|Tamil)/i)) {
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const nameForUrl = title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        
        const thumbnail = year 
          ? `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`
          : null;
        
        results.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.moviesda + href,
          thumbnail: thumbnail,
          source: 'moviesda'
        });
      }
    });

    res.json(results);
  } catch (error) {
    res.json([]);
  }
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
    
    $("div.f a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && href.includes('-movie')) {
        details.qualities.push({
          quality: text || 'Quality',
          url: href.startsWith("http") ? href : SOURCES.moviesda + href
        });
      }
    });
    
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
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const result = { download: [], watch: [], info: {} };
    const seenPages = new Set();
    const seenDownloads = new Set();
    const qualityQueue = [];
    
    $("div.f a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && href.includes('-movie') && !href.includes('/download/')) {
        const url = href.startsWith("http") ? href : SOURCES.moviesda + href;
        if (!seenPages.has(url)) {
          seenPages.add(url);
          qualityQueue.push({ quality: text || 'Quality', url });
        }
      }
    });
    
    $("a.coral").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) {
        const url = href.startsWith("http") ? href : SOURCES.moviesda + href;
        if (!seenDownloads.has(url)) {
          seenDownloads.add(url);
          result.download.push({ server: text || 'Download', url, mp4Url: null });
        }
      }
    });
    
    let queueIndex = 0;
    while (queueIndex < qualityQueue.length) {
      const qpage = qualityQueue[queueIndex++];
      
      try {
        const qdata = await axios.get(qpage.url, axiosConfig);
        const $q = cheerio.load(qdata.data);
        
        $q("a.coral").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          if (href) {
            const dlUrl = href.startsWith("http") ? href : SOURCES.moviesda + href;
            if (!seenDownloads.has(dlUrl)) {
              seenDownloads.add(dlUrl);
              result.download.push({ server: text || qpage.quality, url: dlUrl, mp4Url: null });
            }
          }
        });
        
        $q("div.f a").each((_, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          if (href && href.includes('-movie') && !href.includes('/download/')) {
            const fullUrl = href.startsWith("http") ? href : SOURCES.moviesda + href;
            if (!seenPages.has(fullUrl)) {
              seenPages.add(fullUrl);
              qualityQueue.push({ quality: text || 'Quality', url: fullUrl });
            }
          }
        });
      } catch (e) {}
    }
    
    const uniqueDownloads = [];
    const uniqueUrls = new Set();
    for (const d of result.download) {
      if (!uniqueUrls.has(d.url)) {
        uniqueUrls.add(d.url);
        uniqueDownloads.push(d);
      }
    }
    result.download = uniqueDownloads;
    
    for (const item of result.download) {
      const mp4Url = await getMp4Url(item.url);
      if (mp4Url) {
        item.mp4Url = mp4Url;
      }
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
