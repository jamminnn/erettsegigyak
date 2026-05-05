import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// On Vercel filesystem is read-only except /tmp; locally use ./cache
const CACHE_DIR = process.env.VERCEL ? '/tmp/cache' : path.resolve('cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// 2-digit year + month code based on season
function buildUrls({ subject, year, season }) {
  const yy = String(year).slice(2);
  const monthCode = season === 'tavasz' ? 'maj' : 'okt';
  const folder = `feladatok_${year}${season}_emelt`;
  const base = `https://www.oktatas.hu/bin/content/dload/erettsegi/${folder}`;
  return {
    feladatlap: `${base}/e_${subject}_${yy}${monthCode}_fl.pdf`,
    utmutato: `${base}/e_${subject}_${yy}${monthCode}_ut.pdf`,
  };
}

async function downloadIfMissing(url, destPath) {
  if (fs.existsSync(destPath)) return destPath;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'application/pdf,*/*',
    },
  });
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
