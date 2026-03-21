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
  const { category = '2026' } = req.query;
  const targetUrl = `${SOURCES.isaidub}/tamil-${category}-dubbed-movies/`;
  
  try {
    const response = await axios.get(targetUrl, axiosConfig);
    const data = response.data;
    const $ = cheerio.load(data);
    const movies = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      
      if (href && title && href.includes('movie') && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const nameForUrl = title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        
        const thumbnail = year 
          ? `${SOURCES.isaidub}/uploads/posters/${nameForUrl}.jpg`
          : null;
        
        movies.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: thumbnail
        });
      }
    });

    res.json(movies);
  } catch (error) {
    console.error('ISAIDUB Movies Error:', error.message);
    res.json([]);
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
      
      if (href && title && href.includes('movie') && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const nameForUrl = title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        
        const thumbnail = year 
          ? `${SOURCES.isaidub}/uploads/posters/${nameForUrl}.jpg`
          : null;
        
        results.push({
          title,
          link: href.startsWith("http") ? href : SOURCES.isaidub + href,
          thumbnail: thumbnail
        });
      }
    });

    res.json(results);
  } catch (error) {
    console.error('ISAIDUB search error:', error.message);
    res.json([]);
  }
});

app.get('/api/isaidub/qualities', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    const { data } = await axios.get(url, axiosConfig);
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
  const { category = '2026' } = req.query;
  const years = ['2026', '2025', '2024', '2023', '2022', '2021', '2020'];
  const movies = [];
  const seenLinks = new Set();

  for (const year of years) {
    const targetUrl = `${SOURCES.moviesda}/tamil-${year}-movies/`;

    try {
      const { data } = await axios.get(targetUrl, axiosConfig);
      const $ = cheerio.load(data);

      $(".f a").each((_, el) => {
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
            year: movieYear
          });
        }
      });
    } catch (error) {
      console.error(`Moviesda ${year} Error:`, error.message);
    }
  }

  res.json(movies);
});

app.get('/api/moviesda/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  console.log('Moviesda search for:', q);
  
  try {
    const searchUrl = `${SOURCES.moviesda}/?s=${encodeURIComponent(q)}`;
    console.log('Moviesda search URL:', searchUrl);
    
    const { data } = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(data);
    const results = [];

    console.log('Moviesda search page loaded, looking for .f a elements...');
    
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
          thumbnail: thumbnail
        });
      }
    });

    console.log('Found', results.length, 'from .f a selector');
    
    // Try additional selectors
    $('b').each((_, el) => {
      const text = $(el).text().trim();
      const parent = $(el).parent();
      const href = parent.attr('href');
      
      if (href && href.includes('movie') && text && text.length > 3) {
        const yearMatch = text.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const nameForUrl = text.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        
        const thumbnail = year 
          ? `${SOURCES.moviesda}/uploads/posters/${nameForUrl}.jpg`
          : null;
        
        if (!results.find(r => r.title === text)) {
          results.push({
            title: text,
            link: href.startsWith("http") ? href : SOURCES.moviesda + href,
            thumbnail: thumbnail
          });
        }
      }
    });

    console.log('Total results:', results.length);
    res.json(results);
  } catch (error) {
    console.error('Moviesda search error:', error.message);
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
    
    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && (href.includes('-movie/') || href.includes('-web-series/') || href.includes('-season-'))) {
        let quality = 'HQ PreDVD';
        if (/\d{3,4}p/i.test(text)) {
          quality = text.match(/(\d{3,4}p)/i)?.[1] || text;
        } else if (/Season/i.test(text)) {
          quality = text;
        } else if (/HQ|PreDVD/i.test(text)) {
          quality = 'HQ PreDVD';
        } else if (/Original/i.test(text)) {
          quality = 'Original';
        }
        details.qualities.push({
          quality: quality,
          url: href.startsWith("http") ? href : SOURCES.moviesda + href
        });
      }
    });
    
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

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && text.match(/\d{3,4}p/i)) {
        qualities.push({
          quality: text.match(/(\d{3,4}p)/i)?.[1] || text,
          url: href.startsWith("http") ? href : SOURCES.moviesda + href
        });
      }
    });

    res.json({ qualities });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getMoviesdaDirectLinks(downloadPageUrl) {
  try {
    const { data } = await axios.get(downloadPageUrl, axiosConfig);
    const $ = cheerio.load(data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    const info = {
      fileName: '',
      fileSize: '',
      duration: '',
      resolution: '',
      format: 'Mp4'
    };
    
    $('.songinfo .details').each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes('File Name:')) {
        info.fileName = text.replace('File Name:', '').trim();
      }
      if (text.includes('File Size:')) {
        info.fileSize = text.replace('File Size:', '').trim();
      }
      if (text.includes('Duration:')) {
        info.duration = text.replace('Duration:', '').trim();
      }
      if (text.includes('Video Resolution:')) {
        info.resolution = text.replace('Video Resolution:', '').trim();
      }
      if (text.includes('Download Format:')) {
        info.format = text.replace('Download Format:', '').trim();
      }
    });
    
    if (info.fileName) result.info.file_name = info.fileName;
    if (info.fileSize) result.info.file_size = info.fileSize;
    if (info.duration) result.info.duration = info.duration;
    if (info.resolution) result.info.video_resolution = info.resolution;
    if (info.format) result.info.format = info.format;
    
    let serverNum = 1;
    $('div.download div.dlink a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        result.download.push({
          server: `Server ${serverNum++}`,
          url: href
        });
      }
    });
    
    return result;
  } catch {
    return null;
  }
}

app.get('/api/moviesda/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    let downloadPageUrl = null;
    
    const { data } = await axios.get(url, axiosConfig);
    const $ = cheerio.load(data);
    
    const hasDirectDownloads = $('div.download div.dlink a').length > 0;
    
    if (hasDirectDownloads) {
      downloadPageUrl = url;
    } else {
      const qualityLinks = [];
      $('div.f a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && href.includes('-movie/') && !href.includes('/download/')) {
          qualityLinks.push({
            quality: text,
            url: href.startsWith('http') ? href : SOURCES.moviesda + href
          });
        }
      });
      
      if (qualityLinks.length === 0) {
        const dlLink = $('li a.coral').attr('href');
        if (dlLink) {
          downloadPageUrl = dlLink.startsWith('http') ? dlLink : SOURCES.moviesda + dlLink;
        }
      } else {
        const preferredLink = qualityLinks.find(l => l.quality.includes('720p')) || qualityLinks[0];
        
        const { data: qualityPage } = await axios.get(preferredLink.url, axiosConfig);
        const $q = cheerio.load(qualityPage);
        
        const dlLink = $q('li a.coral').attr('href');
        if (dlLink) {
          downloadPageUrl = dlLink.startsWith('http') ? dlLink : SOURCES.moviesda + dlLink;
        }
      }
    }
    
    if (!downloadPageUrl) {
      return res.status(404).json({ error: "Could not find download page" });
    }
    
    const result = await getMoviesdaDirectLinks(downloadPageUrl);
    
    if (!result) {
      return res.status(404).json({ error: "Could not extract download links" });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
