const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(cors({
  origin: [
    "https://scribbld.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ]
}));

app.use(express.json({ limit: '15mb' }));

// ─── Prompts ──────────────────────────────────────────────────────────────────

const FLOWCHART_PROMPT = `You are an expert at reading hand-drawn flowcharts and diagrams. Your job is to produce a perfectly valid Mermaid.js flowchart.
Analyze the image carefully and follow these rules precisely:
1. Identify every shape:
   - Rectangle/Box = process step → use [Label]
   - Diamond = decision → use {Label}
   - Oval/Rounded = start or end → use ([Label])
   - Parallelogram = input/output → use[/Label/]
2. Identify every arrow and its direction. If there is a label on the arrow (like Yes/No), include it.
3. Preserve the complete flow and logic exactly as drawn.
4. Output ONLY valid Mermaid.js code. Start with: flowchart TD
5. Use short, clean node IDs like A, B, C or meaningful ones like START, DECISION1.
6. Do NOT include markdown code fences, no backticks, no explanation. Just the raw Mermaid code.
Example output format:
flowchart TD
    A([Start]) --> B[Step One]
    B --> C{Decision?}
    C -->|Yes| D[Do This]
    C -->|No| E[Do That]
    D --> F([End])
    E --> F`;

const NOTES_PROMPT = `You are an expert at reading handwritten notes and converting them into clean, well-structured markdown.
Analyze the image carefully and follow these rules:
1. Read every word accurately, even messy handwriting.
2. Identify the structure: headings, subheadings, bullet points, numbered lists, paragraphs.
3. Preserve all hierarchy — if something was underlined or larger, make it a heading (#, ##, ###).
4. Maintain all bullet points (use -) and numbered lists.
5. Fix spelling mistakes and grammar while keeping the original meaning.
6. If there are multiple sections, separate them with proper markdown headings.
7. If there are any formulas, equations, or special symbols, preserve them accurately.
8. Output ONLY clean markdown. No backticks, no code fences, no explanations.
9. Make it look professional and easy to read.`;

// ─── Doc generation system prompt ─────────────────────────────────────────────

const DOC_SYSTEM_PROMPT = `You are a senior AI systems consultant who creates premium, print-ready HTML documentation for AI-powered call centre systems.

OUTPUT RULES — FOLLOW EXACTLY:
1. Output a COMPLETE, self-contained HTML file starting with <!DOCTYPE html>.
2. ALL CSS must be embedded inside a <style> block in <head>. No external stylesheets except Google Fonts.
3. No markdown. No code fences. No explanation outside the HTML. Output ONLY the HTML file.
4. The document must be dense and information-rich — designed to look like a premium consultant deliverable.
5. Import Inter font from Google Fonts.
6. Embed a print stylesheet: @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } }

DESIGN SYSTEM — USE EXACTLY:
  --primary: #0D2B4E
  --accent: #007A7A
  --highlight: #C9882A
  --danger: #C0392B
  --success: #1A7A4A
  --bg: #F4F7FA
  --bg-primary: #EBF0F7
  --bg-accent: #E6F4F1
  --bg-highlight: #FEF5E7
  --text: #374151
  --muted: #6B7280
  --border: #D0D7E0
  --white: #FFFFFF

font-family: Inter, system-ui, sans-serif
Page: max-width 1080px, margin 0 auto, padding 28px 32px, background white
Base font: 9px for dense table/card content, 11-12px for body paragraphs

DOCUMENT STRUCTURE:

PAGE 1 — CALL AGENT (if script prompt provided):

1. COVER HEADER
   - Three-segment color bar at very top (primary 60% | accent 25% | highlight 15%)
   - System + agent name (large, bold)
   - Subtitle: extracted purpose one-liner
   - Stat badge pills: step count, language, persona, primary goal
   - 3px solid primary bottom border

2. TWO-COLUMN BODY (220px left | 1fr right, gap 14px)
   LEFT: 3-4 info cards (border-left: 3px accent, bg-primary bg):
     • Agent Identity card: name, gender, language rules, tone
     • Decision Logic card: conditions → outcome table (full HTML table with thead)
     • Pitch Structure card: blocks/phases + content
     • Variables card: two-col grid of all variable names in teal

   RIGHT: CALL FLOW — one flex row per step:
     [Num pill 26px, navy/teal alternating] [Body: name bold + objective, flex-1] [Data 100px, teal] [Arrow 28px, gold bg]
     6px connector between rows (1px line from left)
     Decision/pitch steps: gold highlight body bg
     Terminal step: danger bg
     ALL steps must appear (don't skip any)

3. HANDLERS GRID — 4 cols, one card each (primary / accent / highlight / danger bg):
   handler name | trigger | action

4. RULES STRIP — 5-6 inline chips:
   NEVER → danger color | ALWAYS → success color

PAGE 2 — EVALUATION AI (if eval prompt provided):

5. EVAL HEADER — same style as Page 1 header

6. EVAL FLOW DIAGRAM — horizontal nodes:
   [Input] › [Duration Check] › [branches] › [Extract] › [Score] › [Scans] › [JSON Out]
   Node: colored rounded box + sublabel. Branch: two bullets (red short / green full).
   Beside it: quality score rubric table + lead classification chips

7. SPECIAL DETECTION BANNER (if any) — dark full-width band with category chips + escalation action

8. OUTPUT GROUPS GRID — one card per JSON group:
   Colored header (group # + name) | Body: key fields + types | Footer: one-line purpose

9. BOTTOM 3-CARD ROW:
   • Core Extraction Rules (numbered)
   • Objection/Issue Categories (numbered, most common ★ first)
   • Downstream Use: CRM / QA / Coaching / Escalation

10. VIOLATION STRIP — 6 chips: VIOLATION (danger) | REQUIRED (success) | CRITICAL (highlight)

FOOTER (both pages): system name · confidential · page number hint

EXTRACTION RULES:
- Extract EVERY step, variable, handler, branch, rule from the agent prompt — nothing omitted
- Extract EVERY output field, scoring band, violation flag from the eval prompt
- Use actual agent name, brand, language in all content
- Never use placeholder text — every word comes from the source prompts
- If only one prompt provided, generate only the relevant page`;

// ─── Route 1: Image → Flowchart or Notes ─────────────────────────────────────

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    const { type } = req.body;

    if (!req.file) return res.status(400).json({ success: false, error: 'No image uploaded' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const prompt = type === 'flowchart' ? FLOWCHART_PROMPT : NOTES_PROMPT;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } }
        ]
      }],
      max_tokens: 4096,
      temperature: 0.1,
    });

    let content = response.choices[0].message.content.trim();
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    res.json({ success: true, content, type });

  } catch (error) {
    console.error('Analyze error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Route 2: Prompts → Client Document ──────────────────────────────────────

app.post('/api/generate-doc', async (req, res) => {
  try {
    const { scriptPrompt, evalPrompt, client, product, version } = req.body;

    if (!scriptPrompt && !evalPrompt) {
      return res.status(400).json({ success: false, error: 'Provide at least one prompt (script or evaluation)' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const userText = `Generate a complete, self-contained HTML documentation file for this AI calling system.

${client  ? `Client Name: ${client}`         : ''}
${product ? `Product / Use Case: ${product}` : ''}
Version: ${version || 'v1.0'}
Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

${scriptPrompt ? `=== CALL SCRIPT / AGENT PROMPT ===\n${scriptPrompt}` : ''}
${evalPrompt   ? `\n=== CALL EVALUATION PROMPT ===\n${evalPrompt}` : ''}

Output a COMPLETE HTML file starting with <!DOCTYPE html>. Embed all CSS in <head>. Be exhaustive — extract every step, variable, handler, rule, evaluation field from the prompts above.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: DOC_SYSTEM_PROMPT },
        { role: 'user',   content: userText }
      ],
      max_tokens: 16000,
      temperature: 0.2,
    });

    let content = response.choices[0].message.content.trim();
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    res.json({ success: true, content });

  } catch (error) {
    console.error('Doc generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));