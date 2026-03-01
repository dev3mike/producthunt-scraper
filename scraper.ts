import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE_URL = "https://www.producthunt.com";
const RESULTS_DIR = "results";

export interface ProductResult {
  name: string;
  tagline: string;
  description: string | null;
  productHuntUrl: string;
  websiteUrl: string | null;
}

interface ProductStub {
  name: string;
  tagline: string;
  slug: string;
}

async function waitForProducts(page: Page): Promise<void> {
  await page.waitForSelector('[data-test^="product:"]', { timeout: 30000 });
}

async function extractProductStubs(page: Page): Promise<ProductStub[]> {
  return page.$$eval('[data-test^="product:"]', (items) => {
    return items.map((item) => {
      const anchor = item.querySelector<HTMLAnchorElement>(
        'a[data-grid-span="1"]'
      );
      const spans = anchor?.querySelectorAll("span") ?? [];
      const name = spans[0]?.textContent?.trim() ?? "";
      const tagline = spans[1]?.textContent?.trim() ?? "";
      const href = anchor?.getAttribute("href") ?? "";
      const slug = href.replace("/products/", "");
      return { name, tagline, slug };
    });
  });
}

async function detectTotalPages(page: Page): Promise<number> {
  const pageNumbers = await page.$$eval('a[href*="?page="]', (links) => {
    return links
      .map((a) => {
        const href = a.getAttribute("href") ?? "";
        const match = href.match(/\?page=(\d+)/);
        return match?.[1] ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => n > 0);
  });

  if (pageNumbers.length === 0) return 1;
  return Math.max(...pageNumbers);
}

function buildPageUrl(categoryUrl: string, pageNum: number): string {
  const url = new URL(categoryUrl);
  if (pageNum > 1) {
    url.searchParams.set("page", String(pageNum));
  } else {
    url.searchParams.delete("page");
  }
  return url.toString();
}

interface ProductPageData {
  websiteUrl: string | null;
  description: string | null;
}

async function scrapeProductPage(
  page: Page,
  slug: string
): Promise<ProductPageData> {
  const productUrl = `${BASE_URL}/products/${slug}`;
  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('a[data-test="visit-website-button"]', {
      timeout: 20000,
    });
    const websiteUrl = await page.$eval(
      'a[data-test="visit-website-button"]',
      (el) => el.getAttribute("href")
    );
    const description = await page.$eval(
      'meta[name="description"]',
      (el) => el.getAttribute("content")
    ).catch(() => null);
    return { websiteUrl: websiteUrl ?? null, description };
  } catch {
    console.warn(`  [warn] Could not fully scrape /products/${slug}`);
    return { websiteUrl: null, description: null };
  }
}

export async function scrapeCategory(
  categoryUrl: string,
  options: {
    headless: boolean;
  }
): Promise<ProductResult[]> {
  console.log(`\nScraping category: ${categoryUrl}\n`);

  const browser: Browser = await puppeteer.launch({
    headless: options.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const categoryPage = await browser.newPage();
    await categoryPage.setViewport({ width: 1280, height: 900 });
    await categoryPage.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const page1Url = buildPageUrl(categoryUrl, 1);
    console.log(`[1/1] Navigating to page 1: ${page1Url}`);
    await categoryPage.goto(page1Url, { waitUntil: "domcontentloaded" });
    await waitForProducts(categoryPage);

    const totalPages = await detectTotalPages(categoryPage);
    console.log(`Detected ${totalPages} page(s) of products.\n`);

    const allStubs: ProductStub[] = [];
    const seen = new Set<string>();

    const addStubs = (stubs: ProductStub[]) => {
      for (const stub of stubs) {
        if (stub.slug && !seen.has(stub.slug)) {
          seen.add(stub.slug);
          allStubs.push(stub);
        }
      }
    };

    addStubs(await extractProductStubs(categoryPage));
    console.log(`  Page 1: found ${allStubs.length} products so far.`);

    for (let p = 2; p <= totalPages; p++) {
      const pageUrl = buildPageUrl(categoryUrl, p);
      console.log(`[${p}/${totalPages}] Navigating to: ${pageUrl}`);
      await categoryPage.goto(pageUrl, { waitUntil: "domcontentloaded" });
      await waitForProducts(categoryPage);
      const stubs = await extractProductStubs(categoryPage);
      addStubs(stubs);
      console.log(`  Page ${p}: ${allStubs.length} unique products accumulated.`);
    }

    await categoryPage.close();
    console.log(`\nTotal unique products collected: ${allStubs.length}`);
    console.log("Now visiting each product page to get website URL...\n");

    const productPage = await browser.newPage();
    await productPage.setViewport({ width: 1280, height: 900 });
    await productPage.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const results: ProductResult[] = [];

    for (let i = 0; i < allStubs.length; i++) {
      const stub = allStubs[i]!;
      console.log(
        `[${i + 1}/${allStubs.length}] ${stub.name} → /products/${stub.slug}`
      );
      const { websiteUrl, description } = await scrapeProductPage(productPage, stub.slug);
      console.log(`  website: ${websiteUrl ?? "(not found)"}`);

      results.push({
        name: stub.name,
        tagline: stub.tagline,
        description,
        productHuntUrl: `${BASE_URL}/products/${stub.slug}`,
        websiteUrl,
      });
    }

    await productPage.close();

    const slug = new URL(categoryUrl).pathname.split("/").filter(Boolean).pop() ?? "category";
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = join(RESULTS_DIR, `${slug}.json`);
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to ${outPath}`);

    return results;
  } finally {
    await browser.close();
  }
}
