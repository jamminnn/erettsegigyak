import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExamHandler, evaluateHandler, summarizeHandler } from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));

// Frontend (csak a 3 statikus fájl, semmi más)
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/client.js', (_, res) => res.sendFile(path.join(__dirname, 'client.js')));
app.get('/style.css', (_, res) => res.sendFile(path.join(__dirname, 'style.css')));

// API
app.post('/api/load-exam', loadExamHandler);
app.post('/api/evaluate', evaluateHandler);
app.post('/api/summarize', summarizeHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Érettségi app fut: http://localhost:${PORT}`);
});
