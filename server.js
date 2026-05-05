import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExam } from './exam.js';
import { parseExam, evaluateSection, summarizeExam } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/load-exam', async (req, res) => {
  try {
    const { subject = 'angol', year = 2023, season = 'tavasz' } = req.body || {};
    const meta = await fetchExam({ subject, year, season });
    const parsed = await parseExam(meta.feladatlapPath);
    if (!parsed || !Array.isArray(parsed.sections)) {
      return res.status(500).json({ error: 'A feldolgozott struktúra hibás. Próbáld újra.' });
    }
    res.json({
      examId: meta.id,
      subject: meta.subject,
      year: meta.year,
      season: meta.season,
      structure: parsed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const { subject, year, season, section, answers } = req.body;
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
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { subject, year, season, evaluations } = req.body;
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
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Érettségi app fut: http://localhost:${PORT}`);
  });
}

export default app;
