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
        return mp4Match[0];
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

app.get('/api/isaidub/movies', async (req, res) => {
  const { category = '2026' } = req.query;
  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();
  
  for (const year of years) {
    for (let page = 1; page <= 5; page++) {
      const targetUrl = page === 1 
        ? `${SOURCES.isaidub}/tamil-${year}-dubbed-movies/`
        : `${SOURCES.isaidub}/tamil-${year}-dubbed-movies/page/${page}/`;
      
      try {
        const { data } = await axios.get(targetUrl, axiosConfig);
        const $ = cheerio.load(data);
        
        let foundMovies = 0;

        $(".f a").each((_, el) => {
          const href = $(el).attr("href");
          const title = $(el).text().replace("[+]", "").trim();
          
          if (href && href.includes("/movie/") && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i) && !seenLinks.has(href)) {
            seenLinks.add(href);
            movies.push({
              title,
              link: href.startsWith("http") ? href : SOURCES.isaidub + href,
              thumbnail: generateISAIDUBThumbnail(title),
              source: 'isaidub'
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

app.get('/api/isaidub/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  const searchTerm = q.toLowerCase().trim();
  const results = [];
  const seenLinks = new Set();
  
  try {
    for (const year of ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018']) {
      try {
        const yearUrl = `${SOURCES.isaidub}/tamil-${year}-dubbed-movies/`;
        const yearData = await axios.get(yearUrl, axiosConfig);
        const $year = cheerio.load(yearData.data);
        
        $year(".f a").each((_, el) => {
          const href = $year(el).attr("href");
          const title = $year(el).text().replace("[+]", "").trim();
          
          if (href && href.includes("/movie/") && title && title.toLowerCase().includes(searchTerm) && !seenLinks.has(href)) {
            seenLinks.add(href);
            const titleLower = title.toLowerCase();
            let score = 0;
            if (titleLower.startsWith(searchTerm)) score = 3;
            else if (titleLower.includes(searchTerm)) score = 2;
            else score = 1;
            
            results.push({
              title,
              link: href.startsWith("http") ? href : SOURCES.isaidub + href,
              thumbnail: generateISAIDUBThumbnail(title),
              source: 'isaidub',
              score
            });
          }
        });
        
        if (results.length >= 20) break;
      } catch (e) {}
    }
    
    results.sort((a, b) => b.score - a.score);

    res.json(results.slice(0, 50));
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

app.get('/api/isaidub/mp4', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const response = await axios.get(url, { ...axiosConfig, timeout: 15000 });
    const html = response.data;
    
    let mp4Url = null;
    
    const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (mp4Match) mp4Url = mp4Match[0];
    
    if (!mp4Url) {
      const cdnMatch = html.match(/https?:\/\/[^\s"'<>]*(?:uptodub|dub)\.[^\s"'<>]*\/download\.php[^\s"'<>]*/i);
      if (cdnMatch) mp4Url = cdnMatch[0];
    }
    
    if (!mp4Url) {
      const coralMatch = html.match(/href="([^"]+)"[^>]*>\s*<strong>([^<]+)<\/strong>/);
      if (coralMatch) {
        const downloadPageUrl = coralMatch[1].startsWith('http') 
          ? coralMatch[1] 
          : new URL(coralMatch[1], url).href;
        
        try {
          const dlResponse = await axios.get(downloadPageUrl, { ...axiosConfig, timeout: 15000 });
          const dlHtml = dlResponse.data;
          
          const dubpageMatch = dlHtml.match(/href="(https?:\/\/(?:dubpage|dubmv|dub)\.[^"]+)"[^>]*>/i);
          if (dubpageMatch) {
            try {
              const dubResponse = await axios.get(dubpageMatch[1], { ...axiosConfig, timeout: 15000 });
              const dubHtml = dubResponse.data;
              
              const finalMatch = dubHtml.match(/href="(https?:\/\/[^\s"]+)"[^>]*>\s*[^<]*(?:Download|download)[^<]*/i);
              if (finalMatch) {
                try {
                  const finalResponse = await axios.get(finalMatch[1], { ...axiosConfig, timeout: 15000 });
                  const finalHtml = finalResponse.data;
                  
                  const uptodubMatch = finalHtml.match(/(https?:\/\/[^\s"'<>]*(?:uptodub|dub)\.[^\s"'<>]*\/download\.php[^\s"'<>]*)/i);
                  if (uptodubMatch) mp4Url = uptodubMatch[1];
                } catch (e) {}
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }
    
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
          result.download.push({
            server: title || 'Download',
            url: dlUrl,
            thumbnail: thumbnail,
            fileSize: fileSize
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

app.get('/api/moviesda/movies', async (req, res) => {
  const { category = '2026' } = req.query;
  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();

  for (const year of years) {
    for (let page = 1; page <= 5; page++) {
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
  
  const searchTerm = q.toLowerCase().trim();
  const results = [];
  const seenLinks = new Set();
  
  try {
    for (const year of ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017']) {
      try {
        const yearUrl = `${SOURCES.moviesda}/tamil-${year}-movies/`;
        const yearData = await axios.get(yearUrl, axiosConfig);
        const $year = cheerio.load(yearData.data);
        
        $year("div.f a").each((_, el) => {
          const href = $year(el).attr("href");
          const title = $year(el).text().replace("[+]", "").trim();
          
          if (href && title && title.toLowerCase().includes(searchTerm) && !seenLinks.has(href)) {
            seenLinks.add(href);
            const yearMatch = title.match(/\((\d{4})\)/);
            const movieYear = yearMatch ? yearMatch[1] : year;
            const nameForUrl = title.toLowerCase()
              .replace(/[^a-z0-9\s]/g, '')
              .replace(/\s+/g, '-');
            
            const titleLower = title.toLowerCase();
            let score = 0;
            if (titleLower.startsWith(searchTerm)) score = 3;
            else if (titleLower.includes(searchTerm)) score = 2;
            else score = 1;
            
            results.push({
              title,
              link: href.startsWith("http") ? href : SOURCES.moviesda + href,
              thumbnail: `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`,
              year: movieYear,
              source: 'moviesda',
              score
            });
          }
        });
        
        if (results.length >= 20) break;
      } catch (e) {}
    }
    
    results.sort((a, b) => b.score - a.score);

    res.json(results.slice(0, 50));
  } catch (error) {
    console.log(`Outer error: ${error.message}`);
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
    
    if (details.qualities.length === 0 || details.qualities.length === 1) {
      const pageContent = $('body').html();
      const qualityPatterns = [
        { pattern: /href="([^"]*original[^"]*hd[^"]*)"/gi, quality: 'Original HD' },
        { pattern: /href="([^"]*720p[^"]*hd[^"]*)"/gi, quality: '720p HD' },
        { pattern: /href="([^"]*1080p[^"]*hd[^"]*)"/gi, quality: '1080p HD' },
        { pattern: /href="([^"]*480p[^"]*hd[^"]*)"/gi, quality: '480p HD' },
        { pattern: /href="([^"]*360p[^"]*hd[^"]*)"/gi, quality: '360p HD' },
        { pattern: /href="([^"]*320p[^"]*hd[^"]*)"/gi, quality: '320p HD' },
        { pattern: /href="([^"]*original[^"]*)"/gi, quality: 'Original' },
        { pattern: /href="([^"]*720p[^"]*)"/gi, quality: '720p' },
        { pattern: /href="([^"]*1080p[^"]*)"/gi, quality: '1080p' },
        { pattern: /href="([^"]*480p[^"]*)"/gi, quality: '480p' }
      ];
      
      const seenUrls = new Set();
      qualityPatterns.forEach(({ pattern, quality }) => {
        let match;
        while ((match = pattern.exec(pageContent)) !== null) {
          const href = match[1];
          if (href && href.includes('/') && !seenUrls.has(href)) {
            seenUrls.add(href);
            details.qualities.push({
              quality,
              url: href.startsWith("http") ? href : SOURCES.moviesda + href
            });
          }
        }
      });
      
      if (details.qualities.length <= 2) {
        const qualities = [
          { suffix: 'movie-original-hd', name: 'Original HD' },
          { suffix: 'movie-1080p-hd', name: '1080p HD' },
          { suffix: 'movie-720p-hd', name: '720p HD' },
          { suffix: 'movie-480p-hd', name: '480p HD' },
          { suffix: 'movie-360p-hd', name: '360p HD' },
          { suffix: 'movie-320p-hd', name: '320p HD' }
        ];
        
        const urlParts = url.match(/https?:\/\/[^/]+\/([^-]+-[^-]+)-\d{4}-movie\//);
        if (urlParts) {
          const movieName = urlParts[1];
          const base = `${url.match(/https?:\/\/[^/]+/)[0]}/${movieName}`;
          qualities.forEach(({ suffix, name }) => {
            const newUrl = `${base}-movie-${suffix}/`;
            if (!seenUrls.has(newUrl) && newUrl !== url) {
              seenUrls.add(newUrl);
              details.qualities.push({ quality: name, url: newUrl });
            }
          });
        }
      }
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
