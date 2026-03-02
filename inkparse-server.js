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
// ─────────────────────────────────────────────────────────────
//  Scribbld Backend Server — server.js
//  Handles handwriting analysis AND prompt-to-document generation
// ─────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const OpenAI  = require("openai");

const app  = express();
const PORT = process.env.PORT || 3001;

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

app.use(express.json({ limit: "80mb" }));

// ── Health ────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({ status: "ok", service: "Scribbld", model: "gpt-4o" }));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ════════════════════════════════════════════════════════════════
//  ENDPOINT 1 — POST /api/analyze  (handwriting OCR — unchanged)
// ════════════════════════════════════════════════════════════════
const ANALYZE_SYSTEM = `You are ScriptAI, a specialist in converting handwritten notes into structured digital documents. You have expert-level skill in reading difficult handwriting — messy, rotated, faded, densely annotated, with arrows, diagrams, and margin notes.

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
- If multiple images are provided, treat them as sequential pages of the same document.

────────────────────────────────────────────
STEP 3 — MERMAID FLOWCHART
────────────────────────────────────────────
Generate a Mermaid flowchart that captures the LOGICAL STRUCTURE or PROCESS across all images.

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
Return ONLY a raw JSON object. No text before or after. No markdown fences. No backticks.

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

function buildVisionContent(imageList) {
  const blocks = [];
  imageList.forEach(({ imageBase64, imageMime = "image/jpeg" }, i) => {
    if (imageList.length > 1) blocks.push({ type: "text", text: `--- Page ${i + 1} of ${imageList.length} ---` });
    blocks.push({ type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}`, detail: "high" } });
  });
  blocks.push({ type: "text", text: imageList.length > 1
    ? `Please analyse all ${imageList.length} handwritten note images above as sequential pages. Combine them into one coherent set of notes. Return only the JSON object.`
    : `Please analyse this handwritten notes image and return the JSON object. Be thorough — capture every readable word.` });
  return blocks;
}

app.post("/api/analyze", async (req, res) => {
  const { imageBase64, imageMime, images } = req.body;
  let imageList = [];
  if (images && Array.isArray(images) && images.length > 0) {
    imageList = images;
    if (imageList.find(img => !img.imageBase64)) return res.status(400).json({ error: "Each image entry must include imageBase64." });
  } else if (imageBase64) {
    imageList = [{ imageBase64, imageMime: imageMime || "image/jpeg" }];
  } else {
    return res.status(400).json({ error: "Missing imageBase64 or images array." });
  }
  if (imageList.length > 10) return res.status(400).json({ error: "Maximum 10 images per request." });

  console.log(`📸 [${new Date().toISOString()}] Analysing ${imageList.length} image(s)…`);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", max_tokens: 4096, temperature: 0.15,
      messages: [{ role: "system", content: ANALYZE_SYSTEM }, { role: "user", content: buildVisionContent(imageList) }],
    });
    const rawText = response.choices[0]?.message?.content?.trim();
    if (!rawText) throw new Error("Empty response from OpenAI.");
    let parsed;
    try {
      let clean = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const objMatch = clean.match(/(\{[\s\S]*\})/);
      if (objMatch) clean = objMatch[1];
      try { parsed = JSON.parse(clean); } catch {
        parsed = JSON.parse(clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
      }
    } catch (parseErr) { throw new Error("Could not parse AI response: " + parseErr.message); }
    if (parsed.mermaidCode) parsed.mermaidCode = parsed.mermaidCode.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!parsed.title) parsed.title = "Handwritten Notes";
    if (!parsed.subject) parsed.subject = "General";
    console.log(`✅ Analyze success: "${parsed.title}"`);
    res.json(parsed);
  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key." });
    if (err?.status === 429) return res.status(429).json({ error: "Rate limit reached — wait and retry." });
    res.status(500).json({ error: err.message || "Unexpected error." });
  }
});

// ════════════════════════════════════════════════════════════════
//  ENDPOINT 2 — POST /api/generate-doc  (prompt → document)
// ════════════════════════════════════════════════════════════════
const DOC_SYSTEM = `You are an expert technical writer and AI product analyst. Your job is to read one or more AI agent system prompts (call prompts, eval prompts, or both) and produce a comprehensive, professional, customer-facing document that explains what this AI agent does, how it works, and how to understand its behaviour.

The output will be shared with clients, stakeholders, and customers — so it must be polished, clear, and complete.

────────────────────────────────────────────
WHAT YOU MUST DO
────────────────────────────────────────────

1. Read the entire prompt(s) carefully before writing anything.
2. Identify: the agent's identity, purpose, audience, key rules, conversation flow, language style, error handling, special states, and any evaluation criteria.
3. Write a full document with clear sections — no fluff, no vague descriptions, just concrete accurate information extracted directly from the prompt.
4. Generate a Mermaid flowchart of the main conversation/call flow.
5. Return everything as a single JSON object.

────────────────────────────────────────────
SECTION GUIDANCE
────────────────────────────────────────────

Always include these sections if applicable:
- "Overview" — what this agent does, who it talks to, and what it's trying to achieve
- "Agent Identity & Persona" — name, role, gender, language, tone, personality
- "Primary Objective" — the main goal/conversion target
- "Call Flow / Process Steps" — step-by-step conversation phases with clear descriptions
- "Key Rules & Behaviours" — hard rules, prohibitions, decision logic
- "Language & Communication Style" — language used, tone guidelines, forbidden phrases
- "Objection Handling" — how objections are handled, scripts used
- "Special States" — silence handling, disconnections, voicemail, busy callbacks
- "Evaluation Criteria" (only if eval prompt provided) — what metrics are tracked, how success is measured
- "Variables & Data Collected" — what user data is captured and why
- "Integration & Technical Notes" — any technical details about the system

Skip sections that are genuinely not applicable. Add extra sections if the prompt has significant content not covered above.

────────────────────────────────────────────
MERMAID FLOWCHART RULES
────────────────────────────────────────────

Generate a flowchart of the main conversation flow:
✓ First line MUST be exactly: flowchart TD
✓ Node IDs: alphanumeric only (A, B1, Step3)
✓ Node labels: plain words only, max 6 words, NO special characters (no quotes, colons, equals, brackets-in-brackets)
✓ Use: [process step], {decision?}, ([start/end])
✓ Arrows: --> or -->|short label|
✓ 8–14 nodes ideal
✓ Every node reachable from start
✗ NEVER use quotes, colons, HTML, or special characters inside node labels

────────────────────────────────────────────
OUTPUT FORMAT — STRICT JSON ONLY
────────────────────────────────────────────

Return ONLY a raw JSON object. No markdown fences. No backticks. No commentary before or after.

{
  "title": "Concise document title (e.g. 'WeightWise AI Call Agent — System Overview')",
  "subtitle": "One sentence describing the agent and its purpose",
  "agentName": "The agent's name if specified",
  "company": "The company/brand if specified",
  "primaryGoal": "One-sentence description of the primary conversion or outcome goal",
  "tags": ["tag1", "tag2", "tag3"],
  "keyHighlights": [
    "Short bullet highlight 1",
    "Short bullet highlight 2",
    "Short bullet highlight 3",
    "Short bullet highlight 4"
  ],
  "sections": [
    {
      "id": "unique_snake_case_id",
      "heading": "Section Heading",
      "icon": "single emoji",
      "content": "Full markdown content for this section. Use ## subheadings, **bold**, bullet lists as appropriate. Be thorough and specific — copy exact details from the prompt. This should be a detailed, useful section.",
      "type": "prose"
    }
  ],
  "callFlowMermaid": "flowchart TD\\n  A([Call Starts]) --> B[Greeting]\\n  ..."
}

IMPORTANT:
- sections must be a real array of objects, not a string
- In callFlowMermaid: encode newlines as \\n (literal backslash-n)
- In section content: use real newlines
- Escape double-quotes inside strings with \\"
- keyHighlights: 4–6 short punchy bullet strings
- tags: 3–6 short topic tags
- Be comprehensive — each section content should be 100–400 words with real detail from the prompt`;

app.post("/api/generate-doc", async (req, res) => {
  const { callPrompt, evalPrompt } = req.body;

  if (!callPrompt && !evalPrompt) {
    return res.status(400).json({ error: "Provide at least one of: callPrompt, evalPrompt." });
  }

  let userMessage = "";
  if (callPrompt && evalPrompt) {
    userMessage = `I am providing TWO prompts for the same AI agent system.\n\n---\n## CALL PROMPT (System Prompt)\n\n${callPrompt}\n\n---\n## EVAL PROMPT (Evaluation Prompt)\n\n${evalPrompt}\n\n---\n\nPlease generate a comprehensive customer-facing document covering both prompts. Include an "Evaluation Criteria" section based on the eval prompt. Return only the JSON object.`;
  } else if (callPrompt) {
    userMessage = `Here is the AI agent system prompt (call prompt):\n\n${callPrompt}\n\nPlease generate a comprehensive customer-facing document. Return only the JSON object.`;
  } else {
    userMessage = `Here is the AI agent evaluation prompt:\n\n${evalPrompt}\n\nPlease generate a comprehensive document covering the evaluation criteria and what this agent is being measured against. Return only the JSON object.`;
  }

  console.log(`📄 [${new Date().toISOString()}] Generating doc from prompt(s) — call:${!!callPrompt}, eval:${!!evalPrompt}`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: "system", content: DOC_SYSTEM },
        { role: "user", content: userMessage },
      ],
    });

    const rawText = response.choices[0]?.message?.content?.trim();
    if (!rawText) throw new Error("Empty response from OpenAI.");

    let parsed;
    try {
      let clean = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const objMatch = clean.match(/(\{[\s\S]*\})/s);
      if (objMatch) clean = objMatch[1];
      try { parsed = JSON.parse(clean); } catch {
        parsed = JSON.parse(clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
      }
    } catch (parseErr) {
      console.error("❌ JSON parse failed:", parseErr.message);
      console.error("Raw (first 600):", rawText.slice(0, 600));
      throw new Error("Could not parse AI response: " + parseErr.message);
    }

    // Sanitize
    if (!parsed.title) parsed.title = "AI Agent Documentation";
    if (!parsed.subtitle) parsed.subtitle = "System overview and behaviour guide";
    if (!parsed.sections) parsed.sections = [];
    if (!parsed.keyHighlights) parsed.keyHighlights = [];
    if (!parsed.tags) parsed.tags = [];
    if (parsed.callFlowMermaid) {
      parsed.callFlowMermaid = parsed.callFlowMermaid
        .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    console.log(`✅ Doc generated: "${parsed.title}" (${parsed.sections.length} sections)`);
    res.json(parsed);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err?.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key." });
    if (err?.status === 429) return res.status(429).json({ error: "Rate limit reached — wait and retry." });
    if (err?.status === 413) return res.status(413).json({ error: "Prompt too large." });
    res.status(500).json({ error: err.message || "Unexpected error." });
  }
});

// ── 404 ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  const url = process.env.RENDER_URL || `http://localhost:${PORT}`;
  console.log(`\n✅  Scribbld backend running`);
  console.log(`   ${url}`);
  console.log(`   POST /api/analyze      — handwriting OCR`);
  console.log(`   POST /api/generate-doc — prompt to document\n`);

  const KEEP_ALIVE_URL = process.env.RENDER_URL;
  if (KEEP_ALIVE_URL) {
    setInterval(async () => {
      try {
        await fetch(`${KEEP_ALIVE_URL}/health`);
        console.log(`🟢 [${new Date().toISOString()}] Keep-alive OK`);
      } catch {
        console.log(`🔴 [${new Date().toISOString()}] Keep-alive failed`);
      }
    }, 4 * 60 * 1000);
  }
});