import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://isaidub.love";

const server = new Server({
  name: "isaidub-scraper",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_movie_list",
      description: "Get list of movies from isaidub. Defaults to 2026 Tamil dubbed movies.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Page URL (e.g., tamil-2026-dubbed-movies)" }
        }
      },
    },
    {
      name: "search_movies",
      description: "Search for movies on isaidub by title",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Movie title to search for" }
        }
      },
    },
    {
      name: "get_download_links",
      description: "Get download and watch online links for a movie. Pass a movie page URL like https://isaidub.love/movie/movie-name/",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The movie page URL from isaidub" },
          quality: { type: "string", description: "Quality: 720p, 1080p, or 360p (defaults to 720p)" }
        }
      },
    },
  ],
}));

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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_movie_list") {
    const targetUrl = args?.url || `${BASE_URL}/tamil-2026-dubbed-movies/`;
    
    try {
      const { data } = await axios.get(targetUrl);
      const $ = cheerio.load(data);
      const movies = [];

      $(".f a").each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).text().replace("[+]", "").trim();
        if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
          movies.push({
            title,
            link: href.startsWith("http") ? href : BASE_URL + href,
          });
        }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(movies, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "search_movies") {
    const query = args?.query || "";
    
    try {
      const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
      const $ = cheerio.load(data);
      const results = [];

      $(".f a").each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).text().replace("[+]", "").trim();
        if (href && title && !title.match(/^(Download|Tamil|Home|Contact|Check)/i)) {
          results.push({
            title,
            link: href.startsWith("http") ? href : BASE_URL + href,
          });
        }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "get_download_links") {
    const movieUrl = args?.url;
    const quality = args?.quality || "720p";
    
    if (!movieUrl) {
      return {
        content: [{ type: "text", text: "Please provide a movie URL" }],
        isError: true,
      };
    }

    try {
      const qualityPage = await getQualityPage(movieUrl, quality);
      if (!qualityPage) {
        return {
          content: [{ type: "text", text: `Could not find ${quality} quality page for this movie` }],
          isError: true,
        };
      }

      const dubmvPage = await getDubmvPage(qualityPage);
      if (!dubmvPage) {
        return {
          content: [{ type: "text", text: "Could not find download server page" }],
          isError: true,
        };
      }

      const finalLinks = await getFinalLinks(dubmvPage);
      if (!finalLinks || (finalLinks.download.length === 0 && finalLinks.watch.length === 0)) {
        return {
          content: [{ type: "text", text: "Could not extract final links" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          movie_url: movieUrl,
          quality: quality,
          ...finalLinks,
        }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
