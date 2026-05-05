import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];

let _ai = null;
function client() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Hiányzik a GEMINI_API_KEY a .env fájlból');
  }
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _ai;
}

function pdfPart(path) {
  const data = fs.readFileSync(path).toString('base64');
  return { inlineData: { mimeType: 'application/pdf', data } };
}

// Try each model in MODELS list, with retry on transient errors per model
const RETRYABLE = ['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'DEADLINE_EXCEEDED', 'overloaded'];
const RETRY_CODES = [503, 429, 500];
function isTransient(err) {
  const msg = String(err?.message || err);
  const code = err?.status || err?.code;
  return RETRYABLE.some(s => msg.toLowerCase().includes(s.toLowerCase())) || RETRY_CODES.includes(Number(code));
}

async function callWithFallback(buildRequest, label = 'Gemini', { parseJson = false } = {}) {
  let lastErr;
  for (const model of MODELS) {
    const PER_MODEL_RETRIES = 2;
    for (let attempt = 0; attempt < PER_MODEL_RETRIES; attempt++) {
      try {
        const resp = await client().models.generateContent(buildRequest(model));
        if (parseJson) {
          // Validate that response is parseable JSON; if not, treat as transient and try next
          try {
            const parsed = JSON.parse(resp.text);
            return { resp, parsed };
          } catch (jsonErr) {
            const finishReason = resp.candidates?.[0]?.finishReason;
            const truncated = finishReason && finishReason !== 'STOP';
            const errMsg = `JSON parse fail (finishReason=${finishReason || 'unknown'}, ${truncated ? 'TRUNCATED' : 'invalid'}): ${jsonErr.message}`;
            console.log(`[${label}] ${model} ${errMsg}`);
            lastErr = new Error(errMsg);
            // Treat as transient — try next attempt / model
            if (attempt < PER_MODEL_RETRIES - 1) {
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            break;
          }
        }
        return resp;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        const transient = isTransient(err);
        console.log(`[${label}] ${model} attempt ${attempt + 1} failed (transient=${transient}): ${msg.slice(0, 120)}`);
        if (!transient) throw err;
        if (attempt < PER_MODEL_RETRIES - 1) {
          const delay = 1500 * Math.pow(2, attempt) + Math.random() * 800;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    console.log(`[${label}] ${model} unavailable, falling back to next model`);
  }
  throw new Error(`Minden Gemini modell sikertelen (próbált: ${MODELS.join(', ')}). Próbáld újra pár perc múlva. Eredeti hiba: ${lastErr?.message || lastErr}`);
}

export async function parseExam(feladatlapPath) {
  const prompt = `Ez egy magyar emelt szintű érettségi feladatlap PDF-je (angol nyelv).
Bontsd szét a feladatlapot strukturált JSON-ra a következő séma szerint:

{
  "sections": [
    {
      "id": "olvasott" | "nyelvhelyesseg" | "hallott" | "iras",
      "title": "Olvasott szöveg értése" stb.,
      "tasks": [
        {
          "id": "1" | "2.A" stb.,
          "instruction": "feladat utasítása röviden",
          "type": "multiple_choice" | "matching" | "fill_in" | "short_answer" | "true_false" | "essay" | "other",
          "multi_select": true | false,   // true ha EGY itemen belül több választ kell bejelölni (pl. "Tick the THREE true statements")
          "shared_options": ["A. valami", "B. másik", ...],   // CSAK ha minden item közös opciókészletből választ (pl. matching, párosítós feladatok)
          "items": [
            { "id": "1", "prompt": "kérdés vagy mondatkezdet", "options": ["A. ...", "B. ..."] }
          ],
          "max_points": szám (ha leírt),
          "notes": "bármi extra (pl. szöveg címe, hossz limit)"
        }
      ]
    }
  ]
}

Csak JSON-t adj vissza, semmi mást. Az 'items' tartalmazza a kérdéseket EGYESÉVEL — pl. egy 5 kérdéses feleletválasztós feladatnak 5 itemje van.
Az "iras" szekciónál az item maga a fogalmazási feladat (általában 1-2 db: rövid + hosszabb).

OPCIÓK MEGADÁSA — KRITIKUS:
- Ha minden itemnek SAJÁT, KÜLÖNBÖZŐ opciói vannak (klasszikus multiple choice — pl. minden kérdéshez 4 saját válaszopció): ➜ tedd az 'options' tömböt MINDEN item-be külön.
- Ha az itemek KÖZÖS opciókészletből választanak (matching/párosítós — pl. "Match speakers A-E to statements 1-5"): ➜ használd a feladat szintű 'shared_options' mezőt és NE rakj 'options'-t az itemekbe. A helyes válasz minden itemhez egy betű/azonosító a shared_options-ból.
- Ha egy hallott vagy olvasott feladat multiple choice típusú DE a PDF-ben az opciók egy közös listában szerepelnek (pl. felül egy doboz az A-H opciókkal és lent a kérdések): ➜ ez is shared_options eset.
- Soha ne hagyd 'options' nélkül a multiple_choice / matching / true_false típusú itemeket — vagy item-szintű options, vagy task-szintű shared_options legyen.

TÖBBSZÖRÖS VÁLASZ (multi_select) — KRITIKUS:
- Ha a feladat utasítása arra kér hogy TÖBB választ jelölj be (pl. "Tick the THREE statements that are TRUE", "Choose the FOUR sentences which are correct", "Mark all that apply", "Karikázd be azokat amelyek..."): ➜ tedd a feladatra 'multi_select: true'-t, és az opciók az 'items' közös listájaként vagy 'shared_options'-ként legyenek megadva.
- Ha a feladat csak EGY választ kér itemenként (klasszikus single-choice): ➜ 'multi_select: false' (vagy hagyd ki).
- Multi-select esetén a felhasználó válasza több elem lesz egy listából.

FONTOS — KIHAGYNI:
- A "0." feladat (vagy bármi amit "Példa"-ként/"Example"-ként jelölnek) NE kerüljön bele — ez kidolgozott minta, nem kérdés.
- A feladatok bemutató/példa itemjeit (általában "0" sorszámmal) szintén hagyd ki — csak a tényleges, megválaszolandó itemek kerüljenek be.

PÉLDAVÁLASZ BETŰJÉT VEDD KI A SHARED_OPTIONS-BÓL — DE CSAK MATCHING / PÁROSÍTÓS FELADATOKNÁL:
- CSAK akkor alkalmazd ha a feladat olyan típusú, hogy minden opció MAXIMUM EGYSZER használható (pl. matching: minden bekezdéshez egy heading; gap-fill közös listából: minden mondathoz egy mondatkiegészítés). Ott a 0. példa által felhasznált betű "el van használva" → vedd ki.
- Például matching A-K betűkkel, 6 itemmel + 0 példa, 3 distractor: ha a 0. válasza E, a shared_options-ból az E-t hagyd ki.

NE VEDD KI A SHARED_OPTIONS-BÓL — true/false/T-F-NS és más ismétlődő opció típusoknál:
- HA a shared_options olyan opciókészlet, ahol minden item UGYANAZOKBÓL az opciókból választ, és egy opció TÖBBSZÖR is lehet helyes válasz (pl. true/false: A=True/B=False/C=Not enough info; vagy gyakori példa: 4 emberhez 4 vélemény ahol egy vélemény több emberre is illik): ➜ MINDEN opciót megtartani, semmit ne hagyj ki.
- Tipikus eset: true/false/the text does not say feladatok. Itt MINDIG mindhárom A, B, C megtartandó akkor is, ha a 0. példa válasza pl. B.

DÖNTÉSI SZABÁLY:
- Ha az opciók egyszer használhatók (matching/párosítás, distractor-os fill-in): KIVENNI a példa betűjét.
- Ha az opciók korlátlanul ismétlődhetnek (T/F/NS, és minden olyan amikor 3-4 opció keveredik a kérdéseken át): MINDET megtartani.

KRITIKUS — TELJES SZÖVEG kell az item promptjába, NE legyél lusta:
- SOHA ne írj olyat hogy "line 24", "see paragraph 3", "as in line 7", "(line 12)", "lásd 5. sor", "az alábbi mondatban" — a felhasználó NEM látja a feladatlapot, csak amit te kiírsz.
- HA a feladat egy hosszú szövegre hivatkozik (pl. "fill in the gap on line 24" vagy "which paragraph contains..."), akkor:
  * Az olvasott / hallott / nyelvhelyesség feladatok tetejére, a 'notes' mezőbe MÁSOLD BE az alapszöveget szó szerint (ha rövid, max 2-3 bekezdés). Ha túl hosszú, legalább annyit a notes-ba: "Az olvasandó szöveg a feladatlapon — alapja: <a teljes szöveg>".
  * Az item.prompt mezőbe azt a KONKRÉT mondatot/üres helyet/kérdést tedd amit a kérdés feltesz — pl. "Complete: 'I have ___ to the cinema twice this week.'" NEM "Question on line 24".
  * Ha gap-fill feladat: a mondat AHOGY OTT VAN, a hiányzó hellyel együtt (pl. "___" vagy "(24) ___").
  * Ha "match the heading to the paragraph" típusú: az item promptja LEGYEN AZ ADOTT BEKEZDÉS első 1-2 mondata, hogy ráismerjek.
- A felhasználó a böngészőben látja amit írsz — bármi amit nem teszel be, az számára nem létezik. Ezért inkább redundáns legyen, mint hiányos.`;

  const { parsed: rawParsed } = await callWithFallback((model) => ({
    model,
    contents: [{ role: 'user', parts: [pdfPart(feladatlapPath), { text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 65536,
    },
  }), 'parseExam', { parseJson: true });

  let parsed = rawParsed;
  if (Array.isArray(parsed)) parsed = parsed[0];
  if (!parsed || !Array.isArray(parsed.sections)) {
    throw new Error('A Gemini válasza nem a várt formátum (hiányzó "sections" mező). Próbáld újra.');
  }
  return parsed;
}

export async function evaluateSection({ feladatlapPath, utmutatoPath, section, answers }) {
  const prompt = `Magyar emelt szintű angol érettségi értékelése.

A felhasználó válaszait a "${section.title}" rész feladataira KIZÁRÓLAG a mellékelt hivatalos JAVÍTÁSI ÚTMUTATÓ alapján értékeld. Ne találj ki saját pontozást — az útmutatóban szereplő pontszámokat és kritériumokat használd.

A felhasználó válaszai (JSON):
${JSON.stringify(answers, null, 2)}

Az adott rész feladatainak struktúrája (JSON):
${JSON.stringify(section, null, 2)}

Add vissza az értékelést szigorúan ezen a sémán:
{
  "section_id": "${section.id}",
  "items": [
    {
      "task_id": "feladat azonosító",
      "item_id": "item azonosító",
      "user_answer": "amit a felhasználó beírt",
      "correct_answer": "az útmutató szerinti helyes válasz (ha van)",
      "points_awarded": szám,
      "max_points": szám,
      "feedback": "rövid magyar magyarázat: miért kapta ezt a pontot, mi volt a hiba"
    }
  ],
  "total_points": szám,
  "total_max": szám,
  "summary": "1-3 mondatos összegzés magyarul: legjellemzőbb hibák, mire figyeljen"
}

FONTOS:
- Az írásfeladatnál (essay) az útmutatóban lévő szempontok szerint pontozz (tartalom, kommunikáció, szókincs, nyelvhelyesség külön).
- Hallott szöveg értésénél a transcript az útmutatóban van — annak alapján értékelj.
- Ha a felhasználó válasza tömb (array — pl. multi-select feladatnál több bejelölt opció), akkor a HELYES VÁLASZOK HALMAZÁHOZ hasonlítsd: minden helyes pipa pont, minden hiányzó vagy téves levonás az útmutató szerint. A correct_answer mezőben add meg az összes helyes választ tömbként vagy vesszővel elválasztva.
- Csak JSON, semmi más.`;

  const { parsed } = await callWithFallback((model) => ({
    model,
    contents: [{
      role: 'user',
      parts: [
        pdfPart(feladatlapPath),
        pdfPart(utmutatoPath),
        { text: prompt },
      ],
    }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 32768,
    },
  }), 'evaluateSection', { parseJson: true });

  return parsed;
}

export async function summarizeExam({ utmutatoPath, evaluations }) {
  const sectionScores = Object.entries(evaluations).map(([id, ev]) => ({
    section_id: id,
    feladatpont: ev.total_points,
    max_feladatpont: ev.total_max,
  }));

  const prompt = `Magyar emelt szintű érettségi végeredmény kiszámítása.

A felhasználó az írásbeli vizsga 4 részén ezt érte el (feladatpont):
${JSON.stringify(sectionScores, null, 2)}

A mellékelt hivatalos JAVÍTÁSI ÚTMUTATÓ alapján:
1. Ellenőrizd a max_feladatpont értékeket az útmutató szerinti hivatalos pontszámokkal (pl. emelt szintű angolnál általában: Olvasott 30, Nyelvhelyesség 30, Hallott 30, Íráskészség 27 — de mindig az útmutatóból olvasd).
2. Számítsd ki a feladatpont → vizsgapont átváltást ahogy az útmutatóban szerepel:
   - Emelt szintű idegen nyelv: feladatpont = vizsgapont (1:1, nincs szorzó)
   - Középszintű idegen nyelv: feladatpont * (100/117) = vizsgapont (ha alkalmazandó)
   - Egyéb tantárgyaknál az útmutató szerint
3. Az írásbeli max vizsgapont = max feladatpont összege (a szóbelit NEM számoljuk, csak az írásbelit).
4. A százalék = elért vizsgapont / max vizsgapont * 100.

Add vissza pontosan ezen a sémán (csak JSON):
{
  "sections": [
    { "section_id": "olvasott", "feladatpont": szám, "max_feladatpont": szám, "vizsgapont": szám, "max_vizsgapont": szám }
  ],
  "total_feladatpont": szám,
  "max_feladatpont": szám,
  "total_vizsgapont": szám,
  "max_vizsgapont": szám,
  "percentage": szám (1 tizedesre kerekítve),
  "conversion_note": "rövid magyar magyarázat: hogyan számolódott ki a vizsgapont (átváltási képlet az útmutatóból)",
  "grade_estimate": "becsült osztályzat ha az útmutatóban szerepel ponthatár (különben null)"
}`;

  const { parsed } = await callWithFallback((model) => ({
    model,
    contents: [{
      role: 'user',
      parts: [pdfPart(utmutatoPath), { text: prompt }],
    }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  }), 'summarizeExam', { parseJson: true });

  return parsed;
}
