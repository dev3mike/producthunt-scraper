import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE_URL = "https://www.producthunt.com";
const RESULTS_DIR = "results";

export const CLOUDFLARE_HEADLESS_ERROR_CODE =
  "CLOUDFLARE_CHALLENGE_IN_HEADLESS";

puppeteer.use(StealthPlugin());

export interface ProductResult {
  name: string;
  tagline: string;
  description: string | null;
  productHuntUrl: string;
  url: string | null;
}

interface ProductStub {
  name: string;
  tagline: string;
  slug: string;
}

export interface ScrapeCategoryOptions {
  headless: boolean;
  maxProducts?: number;
}

async function configurePage(page: Page): Promise<void> {
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });
  await page.emulateTimezone("America/Los_Angeles");
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "language", {
      get() {
        return "en-US";
      },
    });
    Object.defineProperty(navigator, "languages", {
      get() {
        return ["en-US", "en"];
      },
    });
  });
}

async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (
    title.includes("Just a moment") ||
    title.includes("Checking your browser") ||
    title.includes("Performing security verification")
  ) {
    return true;
  }

  const html = await page.content().catch(() => "");
  if (
    html.includes("cf-turnstile-response") ||
    html.includes("challenges.cloudflare.com/turnstile") ||
    html.includes("cf-chl-widget")
  ) {
    return true;
  }

  return false;
}

async function waitForUserToSolveChallenge(context: string): Promise<void> {
  console.warn(
    `\n[cloudflare] Detected Cloudflare security verification while ${context}.`
  );
  console.warn(
    "[cloudflare] Please complete the verification in the browser window, then press ENTER here to continue..."
  );

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      resolve();
    });
  });
}

async function handleCloudflareIfPresent(
  page: Page,
  context: string,
  headless: boolean
): Promise<void> {
  if (!(await isCloudflareChallenge(page))) return;

  if (headless) {
    console.error(
      `\n[cloudflare] Cloudflare challenge page detected while ${context} in headless mode.`
    );
    console.error(
      "[cloudflare] Automatically switching to a visible browser window to let you solve the challenge."
    );
    const err = new Error("Cloudflare challenge detected in headless mode.");
    // @ts-expect-error attach code for caller to inspect
    err.code = CLOUDFLARE_HEADLESS_ERROR_CODE;
    throw err;
  }

  await waitForUserToSolveChallenge(context);

  if (await isCloudflareChallenge(page)) {
    throw new Error(
      "Cloudflare challenge still present after manual verification."
    );
  }
}

async function waitForProducts(
  page: Page,
  options: {
    headless: boolean;
  }
): Promise<void> {
  try {
    await page.waitForSelector('[data-test^="product:"]', { timeout: 30000 });
  } catch (error) {
    await handleCloudflareIfPresent(page, "loading the product list", options.headless);
    try {
      const html = await page.content();
      mkdirSync(RESULTS_DIR, { recursive: true });
      const outPath = join(RESULTS_DIR, "error_response.html");
      writeFileSync(outPath, html, "utf8");
      console.error(
        `Saved error page HTML to ${outPath} after waitForSelector failure.`
      );
    } catch (innerError) {
      console.error("Failed to save error response HTML:", innerError);
    }
    throw error;
  }
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
  url: string | null;
  description: string | null;
}

async function scrapeProductPage(
  page: Page,
  slug: string,
  options: {
    headless: boolean;
  }
): Promise<ProductPageData> {
  const productUrl = `${BASE_URL}/products/${slug}`;
  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await handleCloudflareIfPresent(
      page,
      `visiting product page /products/${slug}`,
      options.headless
    );
    await page.waitForSelector('a[data-test="visit-website-button"]', {
      timeout: 20000,
    });
    const url = await page.$eval(
      'a[data-test="visit-website-button"]',
      (el) => el.getAttribute("href")
    );
    const description = await page.$eval(
      'meta[name="description"]',
      (el) => el.getAttribute("content")
    ).catch(() => null);
    return { url: url ?? null, description };
  } catch {
    console.warn(`  [warn] Could not fully scrape /products/${slug}`);
    return { url: null, description: null };
  }
}

export async function scrapeCategory(
  categoryUrl: string,
  options: ScrapeCategoryOptions
): Promise<ProductResult[]> {
  console.log(`\nScraping category: ${categoryUrl}\n`);

  const browser: Browser = await puppeteer.launch({
    headless: options.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const maxProducts = options.maxProducts ?? Number.POSITIVE_INFINITY;

    const categoryPage = await browser.newPage();
    await configurePage(categoryPage);

    const page1Url = buildPageUrl(categoryUrl, 1);
    console.log(`[1/1] Navigating to page 1: ${page1Url}`);
    await categoryPage.goto(page1Url, { waitUntil: "domcontentloaded" });
    await handleCloudflareIfPresent(
      categoryPage,
      "loading category page 1",
      options.headless
    );
    await waitForProducts(categoryPage, { headless: options.headless });

    const totalPages = await detectTotalPages(categoryPage);
    console.log(`Detected ${totalPages} page(s) of products.\n`);

    const allStubs: ProductStub[] = [];
    const seen = new Set<string>();

    const addStubs = (stubs: ProductStub[]) => {
      for (const stub of stubs) {
        if (allStubs.length >= maxProducts) {
          return;
        }
        if (stub.slug && !seen.has(stub.slug)) {
          seen.add(stub.slug);
          allStubs.push(stub);
        }
      }
    };

    addStubs(await extractProductStubs(categoryPage));
    console.log(`  Page 1: found ${allStubs.length} products so far.`);

    if (allStubs.length < maxProducts) {
      for (let p = 2; p <= totalPages; p++) {
        const pageUrl = buildPageUrl(categoryUrl, p);
        console.log(`[${p}/${totalPages}] Navigating to: ${pageUrl}`);
        await categoryPage.goto(pageUrl, { waitUntil: "domcontentloaded" });
        await handleCloudflareIfPresent(
          categoryPage,
          `loading category page ${p}`,
          options.headless
        );
        await waitForProducts(categoryPage, { headless: options.headless });
        const stubs = await extractProductStubs(categoryPage);
        addStubs(stubs);
        console.log(
          `  Page ${p}: ${allStubs.length} unique products accumulated.`
        );
        if (allStubs.length >= maxProducts) {
          console.log(
            `  Reached maxProducts limit (${maxProducts}); stopping page traversal.`
          );
          break;
        }
      }
    }

    await categoryPage.close();
    console.log(`\nTotal unique products collected: ${allStubs.length}`);
    console.log("Now visiting each product page to get website URL...\n");

    const productPage = await browser.newPage();
    await configurePage(productPage);

    const results: ProductResult[] = [];
    const limit = Math.min(allStubs.length, maxProducts);

    for (let i = 0; i < limit; i++) {
      const stub = allStubs[i]!;
      console.log(
        `[${i + 1}/${limit}] ${stub.name} → /products/${stub.slug}`
      );
      const { url, description } = await scrapeProductPage(productPage, stub.slug, {
        headless: options.headless,
      });
      console.log(`  website: ${url ?? "(not found)"}`);

      results.push({
        name: stub.name,
        tagline: stub.tagline,
        description,
        productHuntUrl: `${BASE_URL}/products/${stub.slug}`,
        url,
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
