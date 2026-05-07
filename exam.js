import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bundled cache: PDFs committed to the repo, deployed read-only.
const BUNDLED_CACHE = path.join(__dirname, 'cache');

// Writable cache: only used when downloading new PDFs that aren't bundled.
// On Vercel the only writable path is /tmp; locally we can use ./cache.
const WRITABLE_CACHE = process.env.VERCEL ? '/tmp/cache' : BUNDLED_CACHE;
if (!fs.existsSync(WRITABLE_CACHE)) fs.mkdirSync(WRITABLE_CACHE, { recursive: true });

function buildUrls({ subject, year, season }) {
  const yy = String(year).slice(2);
  const monthCode = season === 'tavasz' ? 'maj' : 'okt';
  const folder = `feladatok_${year}${season}_emelt`;
  const base = `https://dload-oktatas.educatio.hu/erettsegi/${folder}`;
  return {
    feladatlap: `${base}/e_${subject}_${yy}${monthCode}_fl.pdf`,
    utmutato: `${base}/e_${subject}_${yy}${monthCode}_ut.pdf`,
  };
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/pdf,*/*',
  'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.8',
};

async function resolvePdf(filename, url) {
  // 1) Use bundled (committed) cache first — works on Vercel where IP is blocked.
  const bundled = path.join(BUNDLED_CACHE, filename);
  if (fs.existsSync(bundled)) return bundled;

  // 2) Otherwise try writable cache (already downloaded earlier locally).
  const writable = path.join(WRITABLE_CACHE, filename);
  if (fs.existsSync(writable)) return writable;

  // 3) Last resort: fetch from oktatas.hu (works locally; fails on Vercel due to IP block).
  let res;
  try {
    res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || err?.message || 'unknown';
    throw new Error(
      `Ez a vizsga (${filename}) nincs feltöltve a szerverre, és letöltés is sikertelen (${cause}). ` +
      `Helyileg töltsd le, majd commit-old a cache/ mappába.`
    );
  }
  if (!res.ok) throw new Error(`Letöltés sikertelen (${res.status}): ${url}`);
  await pipeline(res.body, fs.createWriteStream(writable));
  return writable;
}

export async function fetchExam({ subject, year, season }) {
  const urls = buildUrls({ subject, year, season });
  const id = `${subject}_${year}_${season}`;

  const [feladatlapPath, utmutatoPath] = await Promise.all([
    resolvePdf(`${id}_fl.pdf`, urls.feladatlap),
    resolvePdf(`${id}_ut.pdf`, urls.utmutato),
  ]);

  return { id, subject, year, season, feladatlapPath, utmutatoPath };
}
