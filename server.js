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

async function getISAIDUBDownloadLinks(movieUrl) {
  const result = { download: [], watch: [], info: {} };
  
  try {
    // Step 1: Get movie page, find original link
    const moviePage = await axios.get(movieUrl, axiosConfig);
    const $ = cheerio.load(moviePage.data);
    
    const allLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) allLinks.push({ href, text });
    });
    
    // Find original link
    const originalLink = allLinks.find(l => l.text.toLowerCase().includes("original"));
    if (!originalLink) return null;
    
    const origUrl = originalLink.href.startsWith("http") 
      ? originalLink.href 
      : SOURCES.isaidub + originalLink.href;
    
    // Step 2: Get original page, find quality links
    const origPage = await axios.get(origUrl, axiosConfig);
    const $orig = cheerio.load(origPage.data);
    
    const qualityLinks = [];
    $orig("a").each((_, el) => {
      const href = $orig(el).attr("href");
      const text = $orig(el).text().trim();
      if (href && href.includes("-movie-") && (text.includes("720p") || text.includes("1080p") || text.includes("360p"))) {
        qualityLinks.push({ href: href.startsWith("http") ? href : SOURCES.isaidub + href, text });
      }
    });
    
    if (qualityLinks.length === 0) {
      // Try any movie link
      $orig("a").each((_, el) => {
        const href = $orig(el).attr("href");
        const text = $orig(el).text().trim();
        if (href && href.includes("-movie-")) {
          qualityLinks.push({ href: href.startsWith("http") ? href : SOURCES.isaidub + href, text });
        }
      });
    }
    
    // Step 3: Get quality page, find download page link
    for (const ql of qualityLinks.slice(0, 2)) {
      try {
        const qualityPage = await axios.get(ql.href, axiosConfig);
        const $q = cheerio.load(qualityPage.data);
        
        // Find /download/page/ link
        let downloadPageUrl = null;
        $q("a").each((_, el) => {
          const href = $q(el).attr("href");
          if (href && href.includes("/download/page/")) {
            downloadPageUrl = href.startsWith("http") ? href : SOURCES.isaidub + href;
          }
        });
        
        if (!downloadPageUrl) continue;
        
        // Step 4: Get download page, find dubpage.xyz link
        const dlPage = await axios.get(downloadPageUrl, {
          ...axiosConfig,
          headers: { ...axiosConfig.headers, "Referer": SOURCES.isaidub + "/" }
        });
        const $dl = cheerio.load(dlPage.data);
        
        let dubpageUrl = null;
        $dl("a").each((_, el) => {
          const href = $dl(el).attr("href");
          if (href && href.includes("dubpage.xyz")) {
            dubpageUrl = href;
          }
        });
        
        if (!dubpageUrl) continue;
        
        // Step 5: Get dubpage.xyz, find dubmv.top link
        const dubpage = await axios.get(dubpageUrl, {
          ...axiosConfig,
          headers: { ...axiosConfig.headers, "Referer": downloadPageUrl }
        });
        const $db = cheerio.load(dubpage.data);
        
        let dubmvUrl = null;
        $db("a").each((_, el) => {
          const href = $db(el).attr("href");
          if (href && href.includes("dubmv.top")) {
            dubmvUrl = href;
          }
        });
        
        if (!dubmvUrl) continue;
        
        // Step 6: Get dubmv.top, find direct download links
        const dubmv = await axios.get(dubmvUrl, {
          ...axiosConfig,
          headers: { ...axiosConfig.headers, "Referer": dubpageUrl }
        });
        const $dm = cheerio.load(dubmv.data);
        
        // Get direct download links
        $dm("a").each((_, el) => {
          const href = $dm(el).attr("href");
          if (href && (href.includes("dubshare") || href.includes(".mp4") || href.includes(".mkv"))) {
            result.download.push({ server: ql.text || "Download", url: href });
          }
        });
        
        // Get watch online links
        $dm("a").each((_, el) => {
          const href = $dm(el).attr("href");
          if (href && href.includes("onestream")) {
            result.watch.push({ server: "Onestream", url: href });
          }
        });
        
      } catch (e) {
        console.log("Error in ISAIDUB chain:", e.message);
      }
    }
    
    return result.download.length > 0 || result.watch.length > 0 ? result : null;
  } catch (e) {
    console.log("ISAIDUB error:", e.message);
    return null;
  }
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
    const result = await getISAIDUBDownloadLinks(url);
    
    if (!result || (result.download.length === 0 && result.watch.length === 0)) {
      return res.json({ 
        error: "No download links found. Movie may be new or links not available.",
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
    // Step 1: Fetch the quality page
    const qualityPage = await axios.get(url, axiosConfig);
    const $ = cheerio.load(qualityPage.data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    // Step 2: Find resolution pages (720p, 1080p, etc.)
    const resolutionPages = [];
    $('div.f a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && href.includes('-movie')) {
        resolutionPages.push({
          quality: text,
          url: href.startsWith('http') ? href : SOURCES.moviesda + href
        });
      }
    });
    
    // Step 3: For each resolution page, find .coral download links
    for (const resPage of resolutionPages.slice(0, 3)) {
      try {
        const resPageData = await axios.get(resPage.url, axiosConfig);
        const $res = cheerio.load(resPageData.data);
        
        // Get file info
        $res('div.details').each((_, el) => {
          const text = $res(el).text().trim();
          if (text.includes('File Name:')) result.info.file_name = text.replace('File Name:', '').trim();
          if (text.includes('File Size:')) result.info.file_size = text.replace('File Size:', '').trim();
          if (text.includes('Duration:')) result.info.duration = text.replace('Duration:', '').trim();
          if (text.includes('Video Resolution:')) result.info.video_resolution = text.replace('Video Resolution:', '').trim();
        });
        
        // Find .coral links (download page links)
        $res('a.coral').each((_, el) => {
          const href = $res(el).attr('href');
          const text = $res(el).text().trim();
          if (href) {
            const dlPageUrl = href.startsWith('http') ? href : SOURCES.moviesda + href;
            
            // Fetch the download page to get direct links
            try {
              const dlPage = axios.get(dlPageUrl, axiosConfig).then(dlRes => {
                const $dl = cheerio.load(dlRes.data);
                $dl('div.dlink a').each((_, link) => {
                  const dlHref = $dl(link).attr('href');
                  const dlText = $dl(link).text().trim();
                  if (dlHref) {
                    result.download.push({
                      server: dlText || resPage.quality,
                      url: dlHref
                    });
                  }
                });
              }).catch(() => {});
            } catch {}
          }
        });
        
        // Also find direct hotshare links
        $res('a[href*="hotshare"]').each((_, el) => {
          const href = $res(el).attr('href');
          if (href) {
            result.download.push({ server: "HotShare", url: href });
          }
        });
        
      } catch (e) {
        console.log('Error on resolution page:', resPage.url);
      }
    }
    
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
