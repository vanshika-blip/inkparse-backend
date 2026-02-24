// ─────────────────────────────────────────────────────────────
//  Scribbld Backend Server — server.js
//  Proxies handwriting analysis requests to OpenAI securely
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
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://scribbld.vercel.app",
    /\.vercel\.app$/,
    /localhost:\d+$/,
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
}));

app.use(express.json({ limit: "80mb" })); // generous limit for multiple high-res images

// ── Health check ──────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "ScriptAI", model: "gpt-4o" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), model: "gpt-4o" });
});

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are ScriptAI, a specialist in converting handwritten notes into structured digital documents. You have expert-level skill in reading difficult handwriting — messy, rotated, faded, densely annotated, with arrows, diagrams, and margin notes.

Your job produces two outputs: (1) faithful well-structured Markdown notes, and (2) a logically sound Mermaid flowchart.

────────────────────────────────────────────
STEP 1 — READ THE IMAGE(S) THOROUGHLY
────────────────────────────────────────────
Before writing anything, perform a thorough reading pass:

• ORIENTATION: Mentally rotate the image if text is at an angle or upside-down.
• COVERAGE: Scan every region — main body, margins, corners, sticky annotations, circled/boxed text, underlines, arrows between ideas, crossed-out revisions, embedded diagrams, tables, numbered lists.
• DISAMBIGUATION: Use surrounding context to resolve unclear letters or words. Only mark something as (unclear) if truly indecipherable after context reasoning.
• HIERARCHY: Identify what is a title, section heading, sub-point, side note, formula, example, warning, definition, or key term.
• COMPLETENESS: Every readable word must appear in your output — do not summarise, paraphrase, or omit unless content is completely illegible.

────────────────────────────────────────────
STEP 2 — MARKDOWN NOTES
────────────────────────────────────────────
Format the notes faithfully using these conventions:

# Title          — the main document title  
## Section       — major topic changes  
### Sub-section  — sub-topics within a section  
**term**         — key terms, important phrases, defined vocabulary  
*emphasis*       — author stress, warnings (underlined words in original)  
\`formula\`      — equations, code, chemical notation, technical expressions  
- bullet         — unordered list items  
1. step          — numbered/ordered steps or procedures  
---              — visual divider between clearly distinct sections  
> margin note    — side notes and annotations  

QUALITY RULES:
- Preserve the author's original order and grouping exactly.
- Represent tables and ASCII diagrams as best you can in Markdown.
- Margin annotations belong near the section they annotate, as > blockquotes.
- Do NOT add information not in the image.
- Do NOT rewrite or paraphrase — transcribe exactly what is written.
- If multiple images are provided, treat them as sequential pages of the same document. Use ## Page N headings only where pages cover significantly different topics.

────────────────────────────────────────────
STEP 3 — MERMAID FLOWCHART
────────────────────────────────────────────
Generate a Mermaid flowchart that captures the LOGICAL STRUCTURE or PROCESS across all images.

TYPE A — Process/Procedure notes → Sequential flow with decisions.  
TYPE B — Concept/Study notes → Concept map radiating from a main topic.  
TYPE C — Mixed → Hybrid spine with branching detail.

STRICT SYNTAX RULES:
✓ First line MUST be exactly: flowchart TD
✓ Node IDs: alphanumeric only (A, B1, Step3, NodeA)
✓ Node labels: plain words only, max 6 words, NO special characters
✓ Shapes: [process], {decision?}, ([start/end terminal])
✓ Arrows: --> for plain, -->|label| for labelled (label max 3 words, no special chars)
✗ NEVER use: quotes, colons, equals signs, brackets inside brackets, semicolons, HTML tags inside labels
✓ 6–12 nodes ideal. Never fewer than 4, never more than 14.
✓ Every node must be reachable from the start node.

────────────────────────────────────────────
OUTPUT FORMAT — STRICT JSON ONLY
────────────────────────────────────────────
Return ONLY a raw JSON object. No text before or after. No markdown fences. No backticks. No commentary.

{
  "title": "Short descriptive title (5–8 words max)",
  "subject": "Subject or domain of the notes",
  "notes": "Full markdown — every readable word from the image(s)",
  "mermaidCode": "flowchart TD\\n  A([Start]) --> B[First Step]\\n  ..."
}

IMPORTANT FORMATTING:
- In mermaidCode: actual newlines must be encoded as \\n (backslash + n as a literal escape)
- In notes: use real newlines
- Escape all double-quote characters inside string values with \\"
- Validate that your JSON is parseable before returning it`;

// ── Build vision content blocks for one or many images ────────
function buildVisionContent(imageList) {
  const blocks = [];

  imageList.forEach(({ imageBase64, imageMime = "image/jpeg" }, i) => {
    if (imageList.length > 1) {
      blocks.push({ type: "text", text: `--- Page ${i + 1} of ${imageList.length} ---` });
    }
    blocks.push({
      type: "image_url",
      image_url: {
        url: `data:${imageMime};base64,${imageBase64}`,
        detail: "high",
      },
    });
  });

  blocks.push({
    type: "text",
    text: imageList.length > 1
      ? `Please analyse all ${imageList.length} handwritten note images above as sequential pages of the same document. Combine them into one coherent set of notes. Return only the JSON object as described in your system instructions.`
      : `Please analyse this handwritten notes image and return the JSON object as described in your system instructions. Be thorough — capture every readable word.`,
  });

  return blocks;
}

// ── POST /api/analyze ─────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  const { imageBase64, imageMime, images } = req.body;

  // Normalise input into a list
  let imageList = [];

  if (images && Array.isArray(images) && images.length > 0) {
    imageList = images;
    const bad = imageList.find(img => !img.imageBase64);
    if (bad) {
      return res.status(400).json({ error: "Each image entry must include an imageBase64 field." });
    }
  } else if (imageBase64) {
    imageList = [{ imageBase64, imageMime: imageMime || "image/jpeg" }];
  } else {
    return res.status(400).json({ error: "Missing imageBase64 or images array in request body." });
  }

  if (imageList.length > 10) {
    return res.status(400).json({ error: "Maximum 10 images per request." });
  }

  console.log(`📸 [${new Date().toISOString()}] Analysing ${imageList.length} image(s)…`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildVisionContent(imageList),
        },
      ],
    });

    const rawText = response.choices[0]?.message?.content?.trim();
    if (!rawText) throw new Error("Empty response from OpenAI.");

    // ── Parse JSON ────────────────────────────────────────────
    let parsed;
    try {
      // Strip any accidental markdown fences
      let clean = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // Extract object if wrapped in extra text
      const objMatch = clean.match(/(\{[\s\S]*\})/);
      if (objMatch) clean = objMatch[1];

      // First attempt
      try {
        parsed = JSON.parse(clean);
      } catch {
        // Fix unescaped backslashes as a fallback
        const fixed = clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
        parsed = JSON.parse(fixed);
      }
    } catch (parseErr) {
      console.error("❌ JSON parse failed:", parseErr.message);
      console.error("Raw (first 600 chars):", rawText.slice(0, 600));
      throw new Error("Could not parse AI response as valid JSON: " + parseErr.message);
    }

    // ── Sanitize & normalise fields ───────────────────────────
    if (parsed.mermaidCode) {
      parsed.mermaidCode = parsed.mermaidCode
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Strip dangerous chars from inside node labels
        .replace(/\[([^\]]*?)["':=]([^\]]*?)\]/g, (_, a, b) => `[${a} ${b}]`)
        .replace(/\{([^}]*?)["':=]([^}]*?)\}/g, (_, a, b) => `{${a} ${b}}`);
    }

    if (parsed.notes) {
      // Remove stray backslashes not used for markdown
      parsed.notes = parsed.notes.replace(/\\(?![*_`#>\-\[\]])/g, "");
    }

    if (!parsed.title) parsed.title = "Handwritten Notes";
    if (!parsed.subject) parsed.subject = "General";

    console.log(`✅ Success: "${parsed.title}" (${(parsed.notes || "").length} chars)`);
    res.json(parsed);

  } catch (err) {
    console.error("❌ Error:", err.message);

    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key. Check your .env file." });
    if (err?.status === 429) return res.status(429).json({ error: "OpenAI rate limit reached — please wait a moment and try again." });
    if (err?.status === 400) return res.status(400).json({ error: "Bad request to OpenAI: " + err.message });
    if (err?.status === 413) return res.status(413).json({ error: "Image(s) too large. Reduce file size and try again." });
    if (err?.status === 500) return res.status(502).json({ error: "OpenAI service error. Try again shortly." });

    res.status(500).json({ error: err.message || "An unexpected error occurred." });
  }
});

// ── 404 catch-all ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  const url = process.env.RENDER_URL || `http://localhost:${PORT}`;
  console.log(`\n✅  ScriptAI backend running`);
  console.log(`   ${url}`);
  console.log(`   POST /api/analyze  — analyse 1–10 handwritten note images`);
  console.log(`   GET  /health       — health check\n`);

  // Keep-alive ping for Render free tier (spins down after inactivity)
  const KEEP_ALIVE_URL = process.env.RENDER_URL;
  if (KEEP_ALIVE_URL) {
    setInterval(async () => {
      try {
        await fetch(`${KEEP_ALIVE_URL}/health`);
        console.log(`🟢 [${new Date().toISOString()}] Keep-alive OK`);
      } catch {
        console.log(`🔴 [${new Date().toISOString()}] Keep-alive failed`);
      }
    }, 4 * 60 * 1000); // every 4 minutes
  }
});