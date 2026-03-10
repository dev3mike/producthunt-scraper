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

### Handling Cloudflare “security verification”

Product Hunt is protected by Cloudflare. Sometimes you’ll see a page like “Just a moment...” or “Performing security verification”. When that happens:

- By default the script starts in **headless** mode.
- If a Cloudflare challenge is detected while headless:
  - The script **automatically restarts once with a visible browser window** (`headless: false`).
  - You’ll see Chrome open to the same category URL.
  - **Solve the verification in the browser**, then the scraper continues automatically.
- While a challenge page is shown in the visible browser:
  - The scraper pauses and asks you (in the terminal) to complete the check.
  - After solving, **press ENTER in the terminal** and scraping resumes.

Internally, the scraper uses `puppeteer-extra` with the stealth plugin and applies a realistic user agent, viewport, language, and timezone settings to behave more like a normal browser. This **may reduce** how often you are flagged as a bot, but **it does not guarantee** bypassing Cloudflare and **may still violate Product Hunt’s Terms of Service**. Use this tool responsibly and prefer official APIs or exports where available.

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
