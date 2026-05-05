import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// On Vercel filesystem is read-only except /tmp; locally use ./cache
const CACHE_DIR = process.env.VERCEL ? '/tmp/cache' : path.resolve('cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Direct PDF host (the www.oktatas.hu path 302 redirects here, but datacenter IPs may be blocked on www).
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

async function downloadIfMissing(url, destPath) {
  if (fs.existsSync(destPath)) return destPath;
  let res;
  try {
    res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || err?.message || 'unknown';
    throw new Error(`fetch hiba: ${cause} | URL: ${url}`);
  }
  if (!res.ok) throw new Error(`Letöltés sikertelen (${res.status}): ${url}`);
  await pipeline(res.body, fs.createWriteStream(destPath));
  return destPath;
}

export async function fetchExam({ subject, year, season }) {
  const urls = buildUrls({ subject, year, season });
  const id = `${subject}_${year}_${season}`;
  const flPath = path.join(CACHE_DIR, `${id}_fl.pdf`);
  const utPath = path.join(CACHE_DIR, `${id}_ut.pdf`);

  await Promise.all([
    downloadIfMissing(urls.feladatlap, flPath),
    downloadIfMissing(urls.utmutato, utPath),
  ]);

  return { id, subject, year, season, feladatlapPath: flPath, utmutatoPath: utPath };
}
