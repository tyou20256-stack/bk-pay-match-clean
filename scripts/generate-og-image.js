#!/usr/bin/env node
// Generate OGP PNG from SVG using Puppeteer (already in Docker image)
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const svgPath = path.join(__dirname, '..', 'public', 'og-image.svg');
  const pngPath = path.join(__dirname, '..', 'public', 'og-image.png');

  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const html = `<!DOCTYPE html><html><head><style>body{margin:0;padding:0;background:transparent;}</style></head><body>${svgContent}</body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();

  console.log('OG image generated:', pngPath);
})().catch(e => { console.error(e); process.exit(1); });
