import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.ISAIDUB_URL || "https://isaidub.love";

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
      : BASE_URL + originalLink.href;
    
    const { data: origData } = await axios.get(origUrl);
    const $orig = cheerio.load(origData);
    
    const origLinks = await extractLinks($orig, ".f a");
    const qualityLink = origLinks.find(l => l.text.toLowerCase().includes(quality.toLowerCase()));
    
    if (!qualityLink) return null;
    
    return qualityLink.href.startsWith("http") 
      ? qualityLink.href 
      : BASE_URL + qualityLink.href;
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
      : BASE_URL + downloadLink.href;
    
    const { data: dlData } = await axios.get(dlUrl, {
      headers: { "Referer": BASE_URL + "/" }
    });
    const $dl = cheerio.load(dlData);
    
    const dlLinks = await extractLinks($dl, "div.dlink a");
    const dubpageLink = dlLinks.find(l => l.href.includes("dubpage.xyz"));
    
    if (!dubpageLink) return null;
    
    const { data: dubpageData } = await axios.get(dubpageLink.href, {
      headers: { "Referer": BASE_URL + "/" }
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

app.get('/api/movies', async (req, res) => {
  const { url } = req.query;
  const targetUrl = url || `${BASE_URL}/tamil-2026-dubbed-movies/`;
  
  try {
    const { data } = await axios.get(targetUrl);
    const $ = cheerio.load(data);
    const movies = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      let thumbnail = null;
      
      const parent = $(el).parent();
      const img = parent.find("img");
      if (img.length) {
        let imgSrc = img.attr("src") || img.attr("data-src") || null;
        if (imgSrc) {
          thumbnail = imgSrc.startsWith("http") ? imgSrc : BASE_URL + imgSrc;
        }
      }
      
      if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        movies.push({
          title,
          link: href.startsWith("http") ? href : BASE_URL + href,
          thumbnail: thumbnail || null
        });
      }
    });

    res.json(movies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }
  
  try {
    const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(q)}`);
    const $ = cheerio.load(data);
    const results = [];

    $(".f a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace("[+]", "").trim();
      let thumbnail = null;
      
      const parent = $(el).parent();
      const img = parent.find("img");
      if (img.length) {
        let imgSrc = img.attr("src") || img.attr("data-src") || null;
        if (imgSrc) {
          thumbnail = imgSrc.startsWith("http") ? imgSrc : BASE_URL + imgSrc;
        }
      }
      
      if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
        results.push({
          title,
          link: href.startsWith("http") ? href : BASE_URL + href,
          thumbnail: thumbnail || null
        });
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qualities', async (req, res) => {
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
      : BASE_URL + originalLink.href;
    
    const { data: origData } = await axios.get(origUrl);
    const $orig = cheerio.load(origData);
    
    const origLinks = await extractLinks($orig, ".f a");
    const qualities = origLinks
      .filter(l => l.text.match(/\d{3,4}p/i))
      .map(l => ({
        quality: l.text.match(/(\d{3,4}p)/i)?.[1] || l.text,
        url: l.href.startsWith("http") ? l.href : BASE_URL + l.href
      }));
    
    res.json({ qualities });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download', async (req, res) => {
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

export default app;
