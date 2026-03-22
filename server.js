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

async function getQualityPage(movieUrl, quality) {
  try {
    const { data } = await axios.get(movieUrl);
    const $ = cheerio.load(data);
    
    const allLinks = await extractLinks($, ".f a");
    const originalLink = allLinks.find(l => l.text.toLowerCase().includes("original"));
    
    if (!originalLink) return null;
    
    const origUrl = originalLink.href.startsWith("http") 
      ? originalLink.href 
      : SOURCES.isaidub + originalLink.href;
    
    const { data: origData } = await axios.get(origUrl);
    const $orig = cheerio.load(origData);
    
    const origLinks = await extractLinks($orig, ".f a");
    const qualityLink = origLinks.find(l => l.text.toLowerCase().includes(quality.toLowerCase()));
    
    if (!qualityLink) return null;
    
    return qualityLink.href.startsWith("http") 
      ? qualityLink.href 
      : SOURCES.isaidub + qualityLink.href;
  } catch {
    return null;
  }
}

async function getDubmvPage(qualityPageUrl) {
  try {
    const { data } = await axios.get(qualityPageUrl);
    const $ = cheerio.load(data);
    
    const allLinks = await extractLinks($, "a");
    const downloadLink = allLinks.find(l => l.href.includes("/download/page/"));
    
    if (!downloadLink) return null;
    
    const dlUrl = downloadLink.href.startsWith("http") 
      ? downloadLink.href 
      : SOURCES.isaidub + downloadLink.href;
    
    const { data: dlData } = await axios.get(dlUrl, {
      headers: { "Referer": SOURCES.isaidub + "/" }
    });
    const $dl = cheerio.load(dlData);
    
    const dlLinks = await extractLinks($dl, "div.dlink a");
    const dubpageLink = dlLinks.find(l => l.href.includes("dubpage.xyz"));
    
    if (!dubpageLink) return null;
    
    const { data: dubpageData } = await axios.get(dubpageLink.href, {
      headers: { "Referer": SOURCES.isaidub + "/" }
    });
    const $dubpage = cheerio.load(dubpageData);
    
    const dubpageLinks = await extractLinks($dubpage, "div.dlink a");
    const dubmvLink = dubpageLinks.find(l => l.href.includes("dubmv.top"));
    
    if (!dubmvLink) return null;
    
    return dubmvLink.href;
  } catch {
    return null;
  }
}

async function getFinalLinks(dubmvUrl) {
  try {
    const { data } = await axios.get(dubmvUrl, {
      headers: { "Referer": "https://dubpage.xyz/" }
    });
    const $ = cheerio.load(data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    $("a[href*='uptodub']").each((_, el) => {
      result.download.push({ server: "Uptodub", url: $(el).attr("href") });
    });
    
    $("a[href*='onestream']").each((_, el) => {
      result.watch.push({ server: "Onestream", url: $(el).attr("href") });
    });
    
    $(".details").each((_, el) => {
      const text = $(el).text().trim();
      const keyMatch = text.match(/^(File Name|File Size|Video Size|Format|Duration|Added On)/);
      if (keyMatch) {
        const key = keyMatch[1].toLowerCase().replace(/ /g, "_");
        const value = text.replace(keyMatch[1], "").replace(/<[^>]*>/g, "").trim();
        result.info[key] = value;
      }
    });
    
    return result;
  } catch {
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
  const { url, quality } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  const qual = quality || "720p";
  
  try {
    const qualityPage = await getQualityPage(url, qual);
    if (!qualityPage) {
      return res.status(404).json({ error: `Could not find ${qual} quality page` });
    }

    const dubmvPage = await getDubmvPage(qualityPage);
    if (!dubmvPage) {
      return res.status(404).json({ error: "Could not find download server page" });
    }

    const finalLinks = await getFinalLinks(dubmvPage);
    if (!finalLinks || (finalLinks.download.length === 0 && finalLinks.watch.length === 0)) {
      return res.status(404).json({ error: "Could not extract final links" });
    }

    res.json({
      movie_url: url,
      quality: qual,
      ...finalLinks,
    });
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
    // Fetch the quality page
    const qualityPage = await axios.get(url, axiosConfig);
    const $ = cheerio.load(qualityPage.data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    // Get file info from quality page
    $('div.details').each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes('File Name:')) {
        result.info.file_name = text.replace('File Name:', '').trim();
      }
      if (text.includes('File Size:')) {
        result.info.file_size = text.replace('File Size:', '').trim();
      }
      if (text.includes('Duration:')) {
        result.info.duration = text.replace('Duration:', '').trim();
      }
      if (text.includes('Video Resolution:')) {
        result.info.video_resolution = text.replace('Video Resolution:', '').trim();
      }
    });
    
    // Find download links (.coral links point to download page)
    const downloadPageLinks = [];
    $('a.coral').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        downloadPageLinks.push(href.startsWith('http') ? href : SOURCES.moviesda + href);
      }
    });
    
    // Also check for direct download links
    $('a[href*="hotshare"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        result.download.push({ server: "HotShare", url: href });
      }
    });
    
    // If we have download page links, fetch them to get direct links
    for (const dlUrl of downloadPageLinks.slice(0, 2)) {
      try {
        const dlPage = await axios.get(dlUrl, axiosConfig);
        const $dl = cheerio.load(dlPage.data);
        
        // Get final download links from div.dlink
        $dl('div.dlink a').each((_, el) => {
          const href = $dl(el).attr('href');
          const text = $dl(el).text().trim();
          if (href) {
            result.download.push({
              server: text || 'Download',
              url: href
            });
          }
        });
      } catch (e) {
        console.log('Error fetching download page');
      }
    }
    
    // If still no downloads, try to find any direct links
    if (result.download.length === 0) {
      $('a[href*="download"], a[href*=".mp4"], a[href*=".mkv"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          result.download.push({ server: "Direct", url: href });
        }
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
