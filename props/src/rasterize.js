// Renders the SVGs beside this file to transparent PNGs in web/props/, scaled
// so the longest side is TARGET px.
//
//     npm i -D playwright && node rasterize.js
//
// Then add any new file to props/manifest.json (see ../README.md) and to the
// precache list in ../../sw.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const OUT = path.join(__dirname, '..');
const TARGET = 900;   // longest side; props draw at up to 80% of frame height

// Chromium is the only rasteriser on hand. Point this at your own if it moves.
const CHROME = process.env.CHROME_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();

  for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.svg')).sort()) {
    const svg = fs.readFileSync(path.join(SRC, file), 'utf8');
    const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    if (!vb) { console.log('SKIP (no viewBox)', file); continue; }
    const w = +vb[1], h = +vb[2];
    const scale = TARGET / Math.max(w, h);
    const W = Math.round(w * scale), H = Math.round(h * scale);

    await page.setViewportSize({ width: W, height: H });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:transparent}
              svg{display:block;width:${W}px;height:${H}px}</style>${svg}`,
      { waitUntil: 'load' });
    await page.waitForTimeout(120);   // let webfonts/text metrics settle

    const out = path.join(OUT, file.replace(/\.svg$/, '.png'));
    await page.screenshot({ path: out, omitBackground: true });
    console.log(`  ${file.padEnd(18)} -> ${path.basename(out).padEnd(18)} ${W}x${H}  ${(fs.statSync(out).size/1024).toFixed(0)}KB`);
  }
  await browser.close();
})();
