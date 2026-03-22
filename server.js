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
  const years = ['2026', '2025', '2024', '2023', '2022', '2021', '2020'];
  const movies = [];
  const seenLinks = new Set();

  for (const year of years) {
    const targetUrl = `${SOURCES.isaidub}/tamil-${year}-dubbed-movies/`;

    try {
      const response = await axios.get(targetUrl, axiosConfig);
      const data = response.data;
      const $ = cheerio.load(data);

      $(".f a").each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).text().replace("[+]", "").trim();

        if (href && title && href.includes('movie') && !title.match(/^(Download|Tamil|Home|Contact|Check)/i) && !seenLinks.has(href)) {
          seenLinks.add(href);
          const yearMatch = title.match(/\((\d{4})\)/);
          const movieYear = yearMatch ? yearMatch[1] : year;
          const nameForUrl = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');

          const thumbnail = movieYear
            ? `${SOURCES.isaidub}/uploads/posters/${nameForUrl}.jpg`
            : null;

          movies.push({
            title,
            link: href.startsWith("http") ? href : SOURCES.isaidub + href,
            thumbnail: thumbnail,
            year: movieYear
          });
        }
      });
    } catch (error) {
      console.error(`ISAIDUB ${year} Error:`, error.message);
    }
  }

  res.json(movies);
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
  // Only fetch current year + last 2 years for faster loading
  const years = [category, String(parseInt(category) - 1), String(parseInt(category) - 2)];
  const movies = [];
  const seenLinks = new Set();

  for (const year of years) {
    // Only fetch first 3 pages for speed
    for (let page = 1; page <= 3; page++) {
      const targetUrl = page === 1 
        ? `${SOURCES.moviesda}/tamil-${year}-movies/`
        : `${SOURCES.moviesda}/tamil-${year}-movies/?page=${page}`;

      try {
        const { data } = await axios.get(targetUrl, axiosConfig);
        const $ = cheerio.load(data);
        
        let foundMovies = 0;

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
            foundMovies++;
          }
        });
        
        // If no movies found on this page, stop pagination
        if (foundMovies === 0 && page > 1) break;
      } catch (error) {
        break; // Stop on error
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
          thumbnail: thumbnail
        });
      }
    });

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

app.get('/api/moviesda/download', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }
  
  try {
    // Fetch the movie page
    const moviePage = await axios.get(url, axiosConfig);
    const $ = cheerio.load(moviePage.data);
    
    const result = {
      download: [],
      watch: [],
      info: {}
    };
    
    // Get movie info
    const title = $('title').text().split('(')[0].replace('Tamil Movie', '').trim();
    if (title) result.info.title = title;
    
    // Find all links on the movie page
    const allLinks = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href) {
        allLinks.push({ href, text });
      }
    });
    
    // Find quality page links (Original, 720p, 1080p, HQ PreDVD, etc.)
    const qualityLinks = [];
    for (const link of allLinks) {
      const href = link.href;
      const text = link.text;
      
      // Look for quality links
      if (href.includes('-movie/') && !href.includes('/download/')) {
        const isQuality = text.match(/\d{3,4}p/i) || 
                          text.toLowerCase().includes('hq') || 
                          text.toLowerCase().includes('predvd') ||
                          text.toLowerCase().includes('original') ||
                          text.toLowerCase().includes('hd');
        
        if (isQuality) {
          qualityLinks.push({
            quality: text,
            url: href.startsWith('http') ? href : SOURCES.moviesda + href
          });
        }
      }
      
      // Also look for download page links directly
      if (href.includes('/download/') || href.includes('coral') || href.includes('link')) {
        qualityLinks.push({
          quality: text || 'Download',
          url: href.startsWith('http') ? href : SOURCES.moviesda + href
        });
      }
    }
    
    // Remove duplicates
    const seenUrls = new Set();
    const uniqueQualityLinks = qualityLinks.filter(l => {
      if (seenUrls.has(l.url)) return false;
      seenUrls.add(l.url);
      return true;
    });
    
    // Process quality links to find direct download URLs
    for (const ql of uniqueQualityLinks.slice(0, 5)) {
      try {
        // Fetch the quality/download page
        const qualityPage = await axios.get(ql.url, {
          ...axiosConfig,
          maxRedirects: 10,
          validateStatus: (status) => status < 500
        });
        
        // Check for redirect URL (often the direct file)
        const finalUrl = qualityPage.request?.res?.responseUrl || ql.url;
        
        // If it's a direct file URL
        if (finalUrl.includes('.mp4') || finalUrl.includes('.mkv') || finalUrl.includes('hotshare')) {
          result.download.push({
            server: ql.quality,
            url: finalUrl
          });
          continue;
        }
        
        const $q = cheerio.load(qualityPage.data);
        
        // Find download links on this page
        $q('a').each((_, el) => {
          const href = $q(el).attr('href');
          const text = $q(el).text().trim();
          
          if (href) {
            // Direct video files
            if (href.includes('.mp4') || href.includes('.mkv')) {
              result.download.push({
                server: ql.quality + ' - ' + (text || 'Direct'),
                url: href.startsWith('http') ? href : SOURCES.moviesda + href
              });
            }
            
            // Download links (hotshare, etc.)
            if (href.includes('hotshare') || href.includes('download') || href.includes('link') || href.includes('drive')) {
              result.download.push({
                server: ql.quality,
                url: href.startsWith('http') ? href : SOURCES.moviesda + href
              });
            }
            
            // Coral/Waste links (common on Moviesda)
            if (href.includes('coral') || href.includes('wasdt')) {
              // Follow these links to get the final URL
              try {
                const coralPage = await axios.get(href.startsWith('http') ? href : SOURCES.moviesda + href, {
                  ...axiosConfig,
                  maxRedirects: 5
                });
                const coralFinalUrl = coralPage.request?.res?.responseUrl || href;
                if (coralFinalUrl && coralFinalUrl !== href) {
                  result.download.push({
                    server: ql.quality,
                    url: coralFinalUrl
                  });
                }
              } catch {}
            }
          }
        });
        
        // Also check for li links with download buttons
        $q('li a, .download a, a.download, a[download]').each((_, el) => {
          const href = $q(el).attr('href');
          if (href && !href.includes('moviesda')) {
            result.download.push({
              server: ql.quality,
              url: href.startsWith('http') ? href : SOURCES.moviesda + href
            });
          }
        });
        
      } catch (e) {
        console.log('Error on quality page:', ql.quality, e.message);
      }
    }
    
    // Remove duplicates and empty URLs
    const seen = new Set();
    result.download = result.download.filter(d => {
      if (!d.url || d.url.length < 10) return false;
      if (seen.has(d.url)) return false;
      seen.add(d.url);
      return true;
    });
    
    if (result.download.length === 0) {
      return res.json({ 
        error: "No download links found. The movie links may not be available yet.",
        movieUrl: url,
        message: "Try visiting the movie page directly on Moviesda for download options."
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
