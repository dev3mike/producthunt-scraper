# Product Hunt Category Scraper

A Puppeteer-based scraper that takes a Product Hunt category URL, collects all products across all pages, then visits each product page to grab its direct website URL. Results are saved as JSON.

## How it works

1. Opens a real browser (Chrome) with Puppeteer
2. Navigates to the category page and waits for the React app to fully render
3. Collects all product names, taglines, and Product Hunt links
4. Detects if there are multiple pages and scrapes all of them
5. Visits each product's page and extracts the "Visit website" link
6. Saves everything to `results/<category-name>.json`

## Requirements

- [Bun](https://bun.sh) installed
- Chrome downloaded for Puppeteer (one-time setup, see below)

## Setup

Install dependencies:

```bash
bun install
```

Download Chrome (only needed once):

```bash
bunx puppeteer browsers install chrome
```

## Running

Scrape the default category (vibe-coding):

```bash
bun run index.ts
```

Scrape a specific category by passing its URL:

```bash
bun run index.ts https://www.producthunt.com/categories/ai-chatbots
```

## Output

Results are saved to `results/<category-slug>.json`, for example `results/vibe-coding.json`.

Each entry looks like this:

```json
{
  "name": "Cursor",
  "tagline": "The AI Code Editor",
  "productHuntUrl": "https://www.producthunt.com/products/cursor",
  "url": "https://cursor.com/?ref=producthunt"
}
```

## Project structure

```
index.ts      — entry point, reads CLI arg and prints summary
scraper.ts    — all scraping logic, exports scrapeCategory()
results/      — output folder (created automatically)
```

## Warning: This is not an official Product Hunt tool. This is a personal project, and Product Hunt may change their website at any time. If that happens, this scraper might stop working or need updates.
