import { scrapeCategory, CLOUDFLARE_HEADLESS_ERROR_CODE } from "./scraper";

const defaultMaxProducts = 30;
const categoryUrl =
  process.argv[2] ?? "https://www.producthunt.com/categories/music-generation";

const rawMaxProducts = process.argv[3];
const maxProducts = rawMaxProducts !== undefined
  ? Number.parseInt(rawMaxProducts, 10)
  : defaultMaxProducts;

async function main() {
  try {
    if (
      rawMaxProducts !== undefined &&
      (Number.isNaN(maxProducts) || maxProducts! <= 0)
    ) {
      console.error(
        `Invalid max products value: "${rawMaxProducts}". Please provide a positive integer.`
      );
      process.exit(1);
    }

    const results = await scrapeCategory(categoryUrl, {
      headless: true,
      maxProducts,
    });
    console.log(`\nDone! ${results.length} products scraped.`);
    console.log("\nSample output:");
    console.log(JSON.stringify(results.slice(0, 3), null, 2));
  } catch (err: unknown) {
    const code = (err as any)?.code;
    if (code === CLOUDFLARE_HEADLESS_ERROR_CODE) {
      console.warn(
        "\n[cloudflare] Retrying once with a visible browser window (headless: false)..."
      );
      const results = await scrapeCategory(categoryUrl, {
        headless: false,
        maxProducts,
      });
      console.log(`\nDone! ${results.length} products scraped.`);
      console.log("\nSample output:");
      console.log(JSON.stringify(results.slice(0, 3), null, 2));
      return;
    }

    console.error("Fatal error:", err);
    process.exit(1);
  }
}

void main();
