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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  }
};

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use('/styles.css', express.static(path.join(process.cwd(), 'public', 'styles.css')));
app.use('/app.js', express.static(path.join(process.cwd(), 'public', 'app.js')));

async function extractLinks($, selector) {
  const links = [];
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href) links.push({ href, text });
  });
  return links;
}

// ISAIDUB API - Tamil Dubbed Movies
app.get('/api/isaidub/movies', async (req, res) => {
  const { url } = req.query;
  const targetUrl = url || `${SOURCES.isaidub}/tamil-2026-dubbed-movies/`;
  
  try {
    const { data } = await axios.get(targetUrl);
    const $ = cheerio.load(data);
    const movies = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      let thumbnail = null;
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : '';
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      if (year) {
        thumbnail = `${SOURCES.isaidub}/uploads/posters/${nameForUrl}.jpg`;
      }
      
      if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        movies.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: thumbnail
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
    const { data } = await axios.get(`${SOURCES.isaidub}/?s=${encodeURIComponent(q)}`);
    const $ = cheerio.load(data);
    const results = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      let thumbnail = null;
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : '';
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      if (year) {
        thumbnail = `${SOURCES.isaidub}/uploads/posters/${nameForUrl}.jpg`;
      }
      
      if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        results.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: thumbnail
        });
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/isaidub/qualities', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const allLinks = await extractLinks($, ".f a");
    const originalLink = allLinks.find(l => l.text.toLowerCase().includes("original"));
    
    if (!originalLink) {
      return res.json({ qualities: [] });
    }
    
    const origUrl = originalLink.href.startsWith("http") 
      ? originalLink.href 
      : SOURCES.isaidub + originalLink.href;
    
    const { data: origData } = await axios.get(origUrl);
    const $orig = cheerio.load(origData);
    
    const origLinks = await extractLinks($orig, ".f a");
    const qualities = origLinks
      .filter(l => l.text.match(/\d{3,4}p/i))
      .map(l => ({
        quality: l.text.match(/(\d{3,4}p)/i)?.[1] || l.text,
        url: l.href.startsWith("http") ? l.href : SOURCES.isaidub + l.href
      }));
    
    res.json({ qualities });
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
    // Get movie page and find quality page links
    const moviePage = await axios.get(url, axiosConfig);
    const $ = cheerio.load(moviePage.data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    // Find quality page links
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && href.includes("-movie-") && !href.includes("/download/")) {
        const fullUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
        result.download.push({
          server: text || "Quality Page",
          url: fullUrl
        });
      }
    });
    
    if (result.download.length === 0) {
      return res.json({ 
        error: "No quality pages found. Movie may be removed.",
        download: [],
        watch: [],
        info: {}
      });
    }

    res.json(result);
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
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const details = {
      title: '',
      genres: '',
      director: '',
      starring: '',
      quality: '',
      language: '',
      rating: '',
      updated: '',
      synopsis: '',
      thumbnail: null
    };
    
    details.title = $('title').text().split('(')[0].trim() || $('h1').first().text().trim() || '';
    
    const posterImg = $('ul.movie-info img').attr('src') || $('img[alt*="poster"]').attr('src') || $('picture img').attr('src');
    if (posterImg) {
      details.thumbnail = posterImg.startsWith('http') ? posterImg : SOURCES.isaidub + posterImg;
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
      if (text.includes('Language:')) {
        details.language = $(el).find('span').text().trim();
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
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MOVIESDA API - Tamil Movies
app.get('/api/moviesda/movies', async (req, res) => {
  const { url } = req.query;
  const targetUrl = url || `${SOURCES.moviesda}/tamil-2026-movies/`;
  
  try {
    const { data } = await axios.get(targetUrl);
    const $ = cheerio.load(data);
    const movies = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      let thumbnail = null;
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : '';
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      if (year) {
        thumbnail = `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`;
      }
      
      if (href && title && !title.match(/^(Home|Download|Tamil)/i)) {
        movies.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.moviesda + href,
          thumbnail: thumbnail
        });
      }
    });

    res.json(movies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moviesda/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  try {
    const { data } = await axios.get(`${SOURCES.moviesda}/?s=${encodeURIComponent(q)}`);
    const $ = cheerio.load(data);
    const results = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      let thumbnail = null;
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : '';
      const nameForUrl = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      if (year) {
        thumbnail = `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`;
      }
      
      if (href && title && !title.match(/^(Home|Download|Tamil)/i)) {
        results.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.moviesda + href,
          thumbnail: thumbnail
        });
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    
    // Also check for links directly
    if (details.qualities.length === 0) {
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && href.match(/\/[^\/]+-movie\//)) {
          details.qualities.push({
            quality: text || 'Quality',
            url: href.startsWith("http") ? href : SOURCES.moviesda + href
          });
        }
      });
    }
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moviesda/qualities', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    const qualities = [];

    $("div.f a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && href.includes('-movie')) {
        qualities.push({
          quality: text || 'Quality',
          url: href.startsWith("http") ? href : SOURCES.moviesda + href
        });
      }
    });

    res.json({ qualities });
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
    // Get the movie/quality page
    const page = await axios.get(url, axiosConfig);
    const $ = cheerio.load(page.data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    // Get file info
    $('div.details').each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes('File Name:')) result.info.file_name = text.replace('File Name:', '').trim();
      if (text.includes('File Size:')) result.info.file_size = text.replace('File Size:', '').trim();
      if (text.includes('Duration:')) result.info.duration = text.replace('Duration:', '').trim();
      if (text.includes('Video Resolution:')) result.info.video_resolution = text.replace('Video Resolution:', '').trim();
    });
    
    // Find quality/download page links
    $("div.f a").each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && href.includes('-movie')) {
        const fullUrl = href.startsWith('http') ? href : SOURCES.moviesda + href;
        result.download.push({
          server: text || 'Quality Page',
          url: fullUrl
        });
      }
    });
    
    // Also find .coral download links
    $("a.coral").each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href) {
        const fullUrl = href.startsWith('http') ? href : SOURCES.moviesda + href;
        result.download.push({
          server: text || 'Download Page',
          url: fullUrl
        });
      }
    });
    
    // Remove duplicates
    const seen = new Set();
    result.download = result.download.filter(d => {
      if (!d.url || seen.has(d.url)) return false;
      seen.add(d.url);
      return true;
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
