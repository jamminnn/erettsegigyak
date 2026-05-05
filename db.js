import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) return { exams: {}, answers: {}, evaluations: {} };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let cache = load();

export const db = {
  getExam(id) {
    return cache.exams[id] || null;
  },
  upsertExam(exam) {
    cache.exams[exam.id] = { ...cache.exams[exam.id], ...exam };
    save(cache);
    return cache.exams[exam.id];
  },
  setParsed(id, parsed) {
    if (!cache.exams[id]) return;
    cache.exams[id].parsed = parsed;
    save(cache);
  },
  getAnswers(examId) {
    return cache.answers[examId] || {};
  },
  saveAnswers(examId, sectionId, answers) {
    cache.answers[examId] = cache.answers[examId] || {};
    cache.answers[examId][sectionId] = answers;
    save(cache);
  },
  getEvaluations(examId) {
    return cache.evaluations[examId] || {};
  },
  saveEvaluation(examId, sectionId, result) {
    cache.evaluations[examId] = cache.evaluations[examId] || {};
    cache.evaluations[examId][sectionId] = {
      ...result,
      saved_at: new Date().toISOString(),
    };
    save(cache);
  },
};

export default db;
