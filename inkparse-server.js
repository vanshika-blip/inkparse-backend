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
    "https://inkparse.vercel.app",   // ← replace with your actual Vercel URL
    /\.vercel\.app$/                  // allows all Vercel preview URLs too
  ],
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "20mb" }));

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: "gpt-4o" });
});

// ── Main endpoint: analyze notes image ───────────────────────
app.post("/api/analyze", async (req, res) => {
  const { imageBase64, imageMime = "image/jpeg" } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: "Missing imageBase64 in request body" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4000,
      messages: [
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
              text: `You are an expert at reading handwritten notes — messy, rotated, sketchy — with high accuracy.

STEP 1 — READ EVERYTHING:
- Rotate mentally if needed. Read ALL text at any angle.
- Read every region: main area, margins, corners, annotations, circled items, crossed-out text, arrows, labels on diagrams
- Best-guess unclear words from context. Mark truly unreadable spots with (unclear).
- Identify structure: headings, sections, bullets, numbered steps, formulas, drawn diagrams

STEP 2 — STRUCTURE AS MARKDOWN:
- # title, ## major section, ### sub-section
- **bold** key terms, *italic* emphasis, \`code\` for formulas/code
- - bullets, 1. numbered steps, --- dividers
Be complete. Every readable word should appear.

STEP 3 — FLOWCHART (always required):
Create a Mermaid flowchart representing the content's logic/structure:
- Process notes → step-by-step flow with decisions
- Concept notes → concept map showing relationships
- Mixed notes → hybrid showing main topics and their flow
- Always include a meaningful start and end node
- Make it reflect the ACTUAL content of the notes

STRICT Mermaid rules:
- Start: flowchart TD
- Node labels: plain words ONLY, max 5 words, NO brackets/equals/special chars inside labels
- Shapes: [step], {decision?}, ([start or end])
- Max 12 nodes

Return ONLY a raw JSON object. Rules:
- NO markdown fences, NO backticks, NO extra text before or after
- NO backslashes except inside string values where needed
- In mermaidCode, separate lines with \n (literal backslash-n)
- In notes, use plain text — no raw backslashes
- All quotes inside strings must be escaped with \"

{
  "title": "Descriptive title of the notes",
  "subject": "Subject area",
  "notes": "Complete thorough markdown — everything you can read",
  "mermaidCode": "flowchart TD\n  A([Start]) --> B[First step]\n  B --> C{Decision?}\n  C -->|Yes| D[Do this]\n  C -->|No| E[Do that]\n  D --> F([End])\n  E --> F"
}`
            }
          ]
        }
      ]
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response from OpenAI");

    let parsed;
    try {
      // Strip markdown fences if present
      let clean = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // Extract JSON object if surrounded by other text
      const objMatch = clean.match(/(\{[\s\S]*\})/);
      if (objMatch) clean = objMatch[1];

      // Fix common escape issues — unescaped backslashes in mermaidCode
      // Parse normally first
      try {
        parsed = JSON.parse(clean);
      } catch (innerErr) {
        // If normal parse fails, try to fix bad escape sequences
        // Replace lone backslashes that aren't valid JSON escapes
        const fixed = clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
        parsed = JSON.parse(fixed);
      }

      // Sanitize mermaidCode — ensure newlines are actual \n strings
      if (parsed.mermaidCode) {
        parsed.mermaidCode = parsed.mermaidCode
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
      }

      // Sanitize notes — remove any lone backslashes that could cause issues
      if (parsed.notes) {
        parsed.notes = parsed.notes.replace(/\\(?![*_`#])/g, "");
      }

    } catch (parseErr) {
      console.error("JSON parse failed:", parseErr.message);
      console.error("Raw response:", text.slice(0, 500));
      throw new Error("Could not parse AI response as JSON: " + parseErr.message);
    }

    res.json(parsed);

  } catch (err) {
    console.error("OpenAI error:", err.message);
    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key" });
    if (err?.status === 429) return res.status(429).json({ error: "OpenAI rate limit hit — try again shortly" });
    if (err?.status === 400) return res.status(400).json({ error: "Bad request to OpenAI: " + err.message });
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Scrivly backend running`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   POST /api/analyze  — analyze a notes image`);
  console.log(`   GET  /health       — health check\n`);

  // ── Keep-alive: ping every 5 minutes ─────────────────────────
  // Stops Render free tier from sleeping after inactivity
  const RENDER_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    fetch(`${RENDER_URL}/health`)
      .then(() => console.log(`🟢 [${new Date().toISOString()}] Keep-alive ping OK`))
      .catch(() => console.log(`🔴 [${new Date().toISOString()}] Keep-alive ping failed`));
  }, 5 * 60 * 1000); // 5 minutes
});
