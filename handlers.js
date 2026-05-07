import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExam } from './exam.js';
import { parseExam, evaluateSection, summarizeExam } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRUCTURES_DIR = path.join(__dirname, 'cache', 'structures');

function loadBundledStructure(examId) {
  const file = path.join(STRUCTURES_DIR, `${examId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.sections)) return parsed;
  } catch {}
  return null;
}

// Read JSON body — handles both Express (parsed) and raw Vercel requests.
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export async function loadExamHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { subject = 'angol', year = 2023, season = 'tavasz' } = await readJson(req);
    const examId = `${subject}_${year}_${season}`;

    // 1) Try bundled pre-parsed structure first (instant, no Gemini call)
    const bundled = loadBundledStructure(examId);
    if (bundled) {
      return res.json({ examId, subject, year, season, structure: bundled });
    }

    // 2) Fallback: parse with Gemini (slow, may timeout on Vercel)
    const meta = await fetchExam({ subject, year, season });
    const parsed = await parseExam(meta.feladatlapPath);
    if (!parsed || !Array.isArray(parsed.sections)) {
      return res.status(500).json({ error: 'A feldolgozott struktúra hibás. Próbáld újra.' });
    }
    res.json({ examId, subject, year, season, structure: parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export async function evaluateHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { subject, year, season, section, answers } = await readJson(req);
    if (!section) return res.status(400).json({ error: 'Hiányzó section' });
    const meta = await fetchExam({ subject, year, season });
    const result = await evaluateSection({
      feladatlapPath: meta.feladatlapPath,
      utmutatoPath: meta.utmutatoPath,
      section,
      answers,
    });
    if (Array.isArray(result.items)) {
      const sum = result.items.reduce((a, it) => a + (Number(it.points_awarded) || 0), 0);
      const max = result.items.reduce((a, it) => a + (Number(it.max_points) || 0), 0);
      result.total_points = sum;
      result.total_max = max;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export async function summarizeHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { subject, year, season, evaluations } = await readJson(req);
    if (!evaluations || Object.keys(evaluations).length === 0) {
      return res.status(400).json({ error: 'Még nincs értékelt rész' });
    }
    const meta = await fetchExam({ subject, year, season });
    const summary = await summarizeExam({
      utmutatoPath: meta.utmutatoPath,
      evaluations,
    });
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
