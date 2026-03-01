import { scrapeCategory } from "./scraper";

const categoryUrl =
  process.argv[2] ?? "https://www.producthunt.com/categories/vibe-coding";

scrapeCategory(categoryUrl, {
  headless: true,
})
  .then((results) => {
    console.log(`\nDone! ${results.length} products scraped.`);
    console.log("\nSample output:");
    console.log(JSON.stringify(results.slice(0, 3), null, 2));
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
