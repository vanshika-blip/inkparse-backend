// ─────────────────────────────────────────────────────────────
//  BACKEND SERVER  —  inkparse-server.js
//  Scrivly API — proxies requests to OpenAI securely
// ─────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const OpenAI  = require("openai");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Validate API key on startup ───────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error("❌  Missing OPENAI_API_KEY in .env file");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://inkparse.vercel.app",
    /\.vercel\.app$/
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "20mb" }));

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: "gpt-4o" });
});

// ── Prompt ────────────────────────────────────────────────────
// Separated out for readability and easy iteration.
const SYSTEM_PROMPT = `You are Scrivly, a specialist in converting handwritten notes into structured digital documents. You have expert-level skill in reading difficult handwriting — messy, rotated, faded, annotated.

Your job has two outputs: (1) faithful, well-structured Markdown notes and (2) a logically sound Mermaid flowchart.

───────────────────────────────────────────────
PART 1 — READING THE IMAGE
───────────────────────────────────────────────
Before writing anything, do a thorough pass of the image:

• Orientation: mentally rotate the image if text is written at an angle or upside-down.
• Coverage: scan every region — main body, margins, corners, sticky annotations, circled/boxed text, underlines, arrows connecting ideas, crossed-out revisions, small diagrams.
• Ambiguous words: use surrounding context to resolve unclear letters. Only write (unclear) if truly indecipherable after context reasoning.
• Hierarchy: identify what is a title, a section heading, a sub-point, a side note, a formula, an example, a warning, a key term.
• Completeness: every readable word must appear in your output — do not summarise or paraphrase unless something is completely illegible.

───────────────────────────────────────────────
PART 2 — MARKDOWN NOTES
───────────────────────────────────────────────
Format the notes faithfully using these conventions:

# Title          — the single main title of the notes
## Section       — major topic changes  
### Sub-section  — sub-topics within a section
**term**         — key terms, important phrases, defined vocabulary
*emphasis*       — stress, warnings, author emphasis (underlined words in original)
\`formula\`      — equations, code snippets, chemical notation
- bullet         — unordered list items
1. step          — numbered/ordered steps or procedures
---              — visual divider (use to separate clearly distinct sections)

QUALITY RULES:
- Preserve the author's original order and grouping.
- If there are diagrams with labels or tables, represent them as best you can in Markdown (ASCII if needed).
- Side notes and margin annotations belong in the section they annotate, indented with a > blockquote.
- Do NOT add any information that isn't in the image.
- Do NOT rewrite or paraphrase — transcribe what is written.

───────────────────────────────────────────────
PART 3 — MERMAID FLOWCHART
───────────────────────────────────────────────
Generate a Mermaid flowchart that represents the LOGICAL STRUCTURE or PROCESS in the notes. Choose the right type:

  TYPE A — Process/Procedure notes (how-to, steps, instructions, experiments):
    → Sequential flow with decision points. Show the actual process steps in order.

  TYPE B — Concept/Study notes (theory, definitions, relationships):
    → Concept map. Start from the main topic and branch into sub-topics/relationships.

  TYPE C — Mixed or Narrative notes:
    → Hybrid: a spine of main points, with branches for details or decisions.

STRICT MERMAID RULES (violations break the renderer):
  ✓ First line must be exactly: flowchart TD
  ✓ Each node ID: letters and numbers only (A, B1, Step3) — no spaces or symbols
  ✓ Node labels: plain words only, max 6 words, NO quotes, NO parentheses inside [], NO special characters
  ✓ Shapes: [process step], {decision or question?}, ([start or end terminal])
  ✓ Arrows: --> for plain, -->|label| for labelled (label max 3 words, no special chars)
  ✓ Line format: exactly two spaces before each node line
  ✗ NEVER use: quotes inside labels, colons in labels, equals signs, brackets inside brackets, semicolons, HTML tags
  ✓ 6–12 nodes is ideal. Never fewer than 4, never more than 14.
  ✓ Every node must be reachable from the start node.
  ✓ The flowchart must reflect the ACTUAL content — not a generic placeholder.

───────────────────────────────────────────────
OUTPUT FORMAT — STRICT
───────────────────────────────────────────────
Return ONLY a raw JSON object. Absolutely no text before or after it. No markdown fences. No backticks.

{
  "title": "Short descriptive title (5–8 words max)",
  "subject": "Subject or domain of the notes (e.g. Biology, Project Planning, Chemistry)",
  "notes": "Full markdown — every readable word from the image",
  "mermaidCode": "flowchart TD\\n  A([Start]) --> B[First Step]\\n  ..."
}

In mermaidCode: newlines must be the two-character sequence \\n (backslash + n), not actual line breaks.
In notes: use actual newlines (the string may be multi-line JSON).
Escape all double-quote characters inside string values with \\".`;

// ── Main endpoint: analyze notes image ───────────────────────
app.post("/api/analyze", async (req, res) => {
  const { imageBase64, imageMime = "image/jpeg" } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: "Missing imageBase64 in request body" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      // temperature slightly lowered for more faithful transcription
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMime};base64,${imageBase64}`,
                detail: "high"
              }
            },
            {
              type: "text",
              // Concise user turn — all instructions are in the system prompt.
              // Repeating the output format here helps GPT-4o stay on track.
              text: `Please analyse this handwritten notes image and return the JSON object described in your instructions. Be thorough — capture every word you can read. The mermaidCode must reflect the actual content of these specific notes.`
            }
          ]
        }
      ]
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response from OpenAI");

    // ── Parse & sanitize ──────────────────────────────────────
    let parsed;
    try {
      // 1. Strip any markdown fences the model snuck in
      let clean = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // 2. Extract the JSON object if surrounded by prose
      const objMatch = clean.match(/(\{[\s\S]*\})/);
      if (objMatch) clean = objMatch[1];

      // 3. Try direct parse first
      try {
        parsed = JSON.parse(clean);
      } catch (_) {
        // 4. Fix unescaped backslashes (common GPT-4o issue in mermaidCode)
        const fixed = clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
        parsed = JSON.parse(fixed);
      }
    } catch (parseErr) {
      console.error("JSON parse failed:", parseErr.message);
      console.error("Raw response (first 800 chars):", text.slice(0, 800));
      throw new Error("Could not parse AI response as JSON: " + parseErr.message);
    }

    // ── Sanitize fields ───────────────────────────────────────

    // Normalise line endings in mermaidCode
    if (parsed.mermaidCode) {
      parsed.mermaidCode = parsed.mermaidCode
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Remove any illegal characters from node labels
        // (quotes and colons inside [] or {} break the renderer)
        .replace(/\[([^\]]*?)["':=]([^\]]*?)\]/g, (_, a, b) => `[${a}${b}]`)
        .replace(/\{([^\}]*?)["':=]([^\}]*?)\}/g, (_, a, b) => `{${a}${b}}`);
    }

    // Remove stray backslashes from notes (except valid markdown)
    if (parsed.notes) {
      parsed.notes = parsed.notes.replace(/\\(?![*_`#>\-\[\]])/g, "");
    }

    // Fallback title if missing
    if (!parsed.title) parsed.title = "Handwritten Notes";

    res.json(parsed);

  } catch (err) {
    console.error("OpenAI error:", err.message);

    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key. Check your .env file." });
    if (err?.status === 429) return res.status(429).json({ error: "OpenAI rate limit reached — please wait a moment and try again." });
    if (err?.status === 400) return res.status(400).json({ error: "Bad request to OpenAI: " + err.message });
    if (err?.status === 413) return res.status(413).json({ error: "Image is too large. Please reduce the file size and try again." });

    res.status(500).json({ error: err.message || "An unexpected error occurred." });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Scrivly backend running`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   POST /api/analyze  — analyse a notes image`);
  console.log(`   GET  /health       — health check\n`);

  // Keep-alive ping every 5 min — prevents Render free tier from sleeping
  const RENDER_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    fetch(`${RENDER_URL}/health`)
      .then(() => console.log(`🟢 [${new Date().toISOString()}] Keep-alive OK`))
      .catch(() => console.log(`🔴 [${new Date().toISOString()}] Keep-alive failed`));
  }, 5 * 60 * 1000);
});