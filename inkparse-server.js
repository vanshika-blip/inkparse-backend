// ─────────────────────────────────────────────────────────────
//  BACKEND SERVER  —  server.js
//  Inkparse API — proxies requests to OpenAI securely
// ─────────────────────────────────────────────────────────────
//
//  SETUP INSTRUCTIONS:
//  1. npm install express cors openai dotenv
//  2. Create a .env file in this folder with:
//       OPENAI_API_KEY=sk-...your-key-here...
//       PORT=3001
//  3. node server.js
//
//  Your frontend (notes-reader.jsx) should point to:
//       http://localhost:3001
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
  origin: ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "20mb" })); // images can be large

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: "gpt-4o" });
});

// ── Main endpoint: analyze notes image ───────────────────────
// POST /api/analyze
// Body: { imageBase64: string, imageMime: string }
// Returns: { title, subject, notes, mermaidCode }
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
                detail: "high"   // use high detail for handwriting
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

Return ONLY valid JSON, no markdown fences, no extra text:
{
  "title": "Descriptive title of the notes",
  "subject": "Subject area",
  "notes": "Complete thorough markdown — everything you can read",
  "mermaidCode": "flowchart TD\\n  A([Start]) --> B[First step]\\n  B --> C{Decision?}\\n  C -->|Yes| D[Do this]\\n  C -->|No| E[Do that]\\n  D --> F([End])\\n  E --> F"
}`
            }
          ]
        }
      ]
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response from OpenAI");

    // Parse JSON from response
    let parsed;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      parsed = JSON.parse(text);
    }

    res.json(parsed);

  } catch (err) {
    console.error("OpenAI error:", err.message);

    // Handle OpenAI API errors specifically
    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key" });
    if (err?.status === 429) return res.status(429).json({ error: "OpenAI rate limit hit — try again shortly" });
    if (err?.status === 400) return res.status(400).json({ error: "Bad request to OpenAI: " + err.message });

    res.status(500).json({ error: err.message || "Something went wrong" });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Inkparse backend running`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   POST /api/analyze  — analyze a notes image`);
  console.log(`   GET  /health       — health check\n`);
});
