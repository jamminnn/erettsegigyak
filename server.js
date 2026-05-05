import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExamHandler, evaluateHandler, summarizeHandler } from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/load-exam', loadExamHandler);
app.post('/api/evaluate', evaluateHandler);
app.post('/api/summarize', summarizeHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Érettségi app fut: http://localhost:${PORT}`);
});
