# ISAIDUB - Tamil Dubbed Movies Download Website

A beautiful movie search and download website that scrapes ISAIDUB to provide direct download links in 480p, 720p, and 1080p quality.

![Preview](preview.png)

## Features

- Search movies by title
- Browse latest Tamil dubbed movies
- Filter by year (2025, 2026)
- Direct download links (480p, 720p, 1080p)
- Watch online links
- Modern dark theme UI
- Mobile responsive

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open http://localhost:3000 in your browser.

## Configuration

Change the ISAIDUB domain by setting the `ISAIDUB_URL` environment variable:

```bash
ISAIDUB_URL=https://isaidub.free npm start
```

Or edit `BASE_URL` in `server.js`:

```js
const BASE_URL = "https://your-domain.com";
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/movies` | Get latest movies list |
| `GET /api/search?q=movie+name` | Search for movies |
| `GET /api/download?url=...&quality=720p` | Get download links |

## Tech Stack

- Node.js + Express
- Cheerio (web scraping)
- Vanilla JS/CSS/HTML

## License

MIT
