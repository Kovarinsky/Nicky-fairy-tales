import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.CD_PREVIEW_URL || "http://127.0.0.1:3000/cd-preview";
const browser = await chromium.launch({ headless: true });
await mkdir("test-results", { recursive: true });
const results = [];

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1920, height: 1080 },
]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-world.png`, fullPage: true });

  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.getByText("KROK 2 ZE 2 · POHÁDKA").waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-details.png`, fullPage: true });

  await page.getByRole("button", { name: "Zpět" }).click();
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  await page.getByRole("button", { name: "Všechny pohádky" }).click();
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  results.push(`${viewport.name}: world → details → world → catalog OK`);
  await page.close();
}

await browser.close();
console.log(results.join("\n"));
