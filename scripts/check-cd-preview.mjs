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
  await page.getByRole("heading", { name: /Nickyho/ }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-home.png`, fullPage: true });
  await page.getByRole("button", { name: "Nastavení" }).click();
  const settings = page.getByRole("dialog", { name: "Nastavení vzhledu aplikace" });
  await settings.waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-settings.png`, fullPage: true });
  await settings.getByRole("button", { name: "Zavřít", exact: true }).click();
  await page.getByRole("button", { name: "Start nové pohádky" }).click();
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-world.png`, fullPage: true });
  await page.getByRole("button", { name: "Pohádka podle mé polohy" }).click();
  await page.getByRole("button", { name: "Povolit" }).click();

  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.getByText("KROK 2 ZE 2 · POHÁDKA").waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-details.png`, fullPage: true });
  await page.getByRole("button", { name: "Rozvinout" }).click();
  await page.getByText("Motiv pohádky", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Rozvinout" }).click();
  await page.getByRole("button", { name: "Hotovo" }).click();

  await page.getByRole("button", { name: "Zpět" }).click();
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  await page.getByRole("button", { name: /Vlastní pohádka/ }).click();
  await page.getByText("Vytvořit vlastní pohádku").waitFor();
  await page.getByRole("button", { name: "Prostudovat" }).click();
  await page.getByText("Ukázkový svět je připravený.").waitFor();
  await page.getByRole("button", { name: "Zpět" }).click();
  await page.getByRole("button", { name: "Všechny pohádky" }).click();
  await page.getByRole("heading", { name: "Výběr pohádky" }).waitFor();
  await page.getByRole("button", { name: "Červená karkulka" }).click();
  await page.getByRole("button", { name: "Vybrat tuto pohádku" }).click();
  await page.getByText("KROK 2 ZE 2 · POHÁDKA").waitFor();
  await page.getByRole("button", { name: "Nicolásek" }).click();
  await page.getByRole("heading", { name: "Výběr postav" }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-characters.png`, fullPage: true });
  await page.getByRole("button", { name: "James" }).click();
  await page.getByRole("button", { name: "Potvrdit postavy" }).click();
  await page.getByText("KROK 2 ZE 2 · POHÁDKA").waitFor();
  await page.getByRole("button", { name: "Přidat postavu" }).click();
  await page.getByRole("button", { name: "Nová postava" }).click();
  await page.getByText("Nová postava").waitFor();
  await page.getByRole("button", { name: "Zpět" }).click();
  await page.getByRole("button", { name: /Žena/ }).click();
  await page.getByRole("heading", { name: "Výběr vypravěče" }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-voice.png`, fullPage: true });
  await page.getByRole("button", { name: "Vybrat tento hlas" }).click();
  await page.getByRole("button", { name: "Vytvořit pohádku" }).click();
  await page.getByRole("heading", { name: "Píšu scénář…" }).waitFor();
  await page.getByText("Nicolásek a Vája vstoupili do kouzelného světa.").waitFor({ timeout: 6000 });
  await page.screenshot({ path: `test-results/cd-${viewport.name}-reader-hidden.png`, fullPage: true });
  await page.locator("main").click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/cd-${viewport.name}-reader-controls.png`, fullPage: true });
  const next = page.getByRole("button", { name: "Další strana" });
  await next.click();
  await next.click();
  await next.click();
  await page.getByRole("heading", { name: "Konec" }).waitFor();
  await page.screenshot({ path: `test-results/cd-${viewport.name}-end.png`, fullPage: true });
  await page.getByRole("button", { name: "Poslechnout bonusovou písničku" }).click();
  await page.getByRole("button", { name: "Hotovo" }).click();
  await page.getByRole("heading", { name: "Moje pohádky" }).waitFor();
  results.push(`${viewport.name}: home → world → catalog → detail → characters → voice → progress → reader → end → song → library OK`);
  await page.close();
}

await browser.close();
console.log(results.join("\n"));
