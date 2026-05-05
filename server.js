import 'dotenv/config';
import express from 'express';
import db from './db.js';
import { fetchExam } from './exam.js';
import { parseExam, evaluateSection, summarizeExam } from './gemini.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Load exam: download PDFs (cached on disk) and return parsed structure.
// Client persists user answers/evaluations in localStorage — server is stateless re user data.
// Legacy data.json answers/evaluations are also returned IF present (one-time migration aid).
app.post('/api/load-exam', async (req, res) => {
  try {
    const { subject = 'angol', year = 2023, season = 'tavasz' } = req.body || {};

    const meta = await fetchExam({ subject, year, season });

    let exam = db.getExam(meta.id);
    if (!exam) {
      exam = db.upsertExam({
        id: meta.id,
        subject: meta.subject,
        year: meta.year,
        season: meta.season,
        feladatlapPath: meta.feladatlapPath,
        utmutatoPath: meta.utmutatoPath,
      });
    }

    const cachedValid = exam.parsed && Array.isArray(exam.parsed.sections);
    if (!cachedValid) {
      const parsed = await parseExam(meta.feladatlapPath);
      db.setParsed(meta.id, parsed);
      exam = db.getExam(meta.id);
    }

    res.json({
      examId: meta.id,
      subject: meta.subject,
      year: meta.year,
      season: meta.season,
      structure: exam.parsed,
      // Legacy: served once for clients to migrate into localStorage on first visit.
      legacyAnswers: db.getAnswers(meta.id),
      legacyEvaluations: db.getEvaluations(meta.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const { examId, sectionId, answers } = req.body;
    const exam = db.getExam(examId);
    if (!exam) return res.status(404).json({ error: 'Vizsga nincs betöltve' });
    const section = exam.parsed.sections.find(s => s.id === sectionId);
    if (!section) return res.status(404).json({ error: 'Szekció nem található' });

    const result = await evaluateSection({
      feladatlapPath: exam.feladatlapPath,
      utmutatoPath: exam.utmutatoPath,
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

// Client sends its evaluations (from localStorage) for the official summary.
app.post('/api/summarize', async (req, res) => {
  try {
    const { examId, evaluations } = req.body;
    const exam = db.getExam(examId);
    if (!exam) return res.status(404).json({ error: 'Vizsga nincs betöltve' });
    if (!evaluations || Object.keys(evaluations).length === 0) {
      return res.status(400).json({ error: 'Még nincs értékelt rész' });
    }
    const summary = await summarizeExam({
      utmutatoPath: exam.utmutatoPath,
      evaluations,
    });
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Érettségi app fut: http://localhost:${PORT}`);
});
