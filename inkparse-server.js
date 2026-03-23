const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const puppeteer = require('puppeteer-core');
const chromium  = require('@sparticuz/chromium');

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

// ─── PREMIUM DOC SYSTEM PROMPT ────────────────────────────────────────────────

const DOC_SYSTEM_PROMPT = `You are a senior AI systems consultant creating a PREMIUM, print-ready, COLOURFUL HTML reference document for an AI-powered call centre system. Think: a dense, visually rich consultant deliverable — like an internal design doc printed on A4. Colour is MANDATORY. Every section must use solid colour backgrounds, coloured borders, coloured headers. No plain white boxes.

═══════════════════════════════════════════════════
OUTPUT RULES — NON-NEGOTIABLE
═══════════════════════════════════════════════════
1. Output a COMPLETE, self-contained <!DOCTYPE html> file. Start with <!DOCTYPE html>.
2. ALL CSS inside one <style> block in <head>. Zero external stylesheets except Google Fonts import.
3. Import Inter from Google Fonts: @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
4. No markdown. No code fences. No explanation text outside the HTML. Output ONLY valid HTML.
5. Embed this print CSS inside the <style> block:
   @media print {
     * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
     body { margin: 0; }
     .no-print { display: none !important; }
   }

═══════════════════════════════════════════════════
MANDATORY DESIGN SYSTEM — USE EXACTLY THESE VALUES
═══════════════════════════════════════════════════
CSS Variables in :root {
  --navy:  #0D2B4E;
  --teal:  #007A7A;
  --gold:  #C9882A;
  --red:   #C0392B;
  --green: #1A7A4A;
  --mint:  #E6F4F1;
  --gold-l:#FEF5E7;
  --navy-l:#EBF0F7;
  --mist:  #F4F7FA;
  --slate: #374151;
  --grey:  #6B7280;
  --rule:  #D0D7E0;
  --white: #FFFFFF;
}

Font: Inter, sans-serif
Body: background #f0f4f8; padding: 20px;
Page: max-width 794px; margin: 0 auto; background: white; padding: 28px 30px 24px;

Base content font sizes: 8–9px for cards/tables, 11–12px for body text. Dense and information-rich.

═══════════════════════════════════════════════════
COLOURED COMPONENT LIBRARY — USE THESE PATTERNS
═══════════════════════════════════════════════════

── HEADER BLOCK (top of every page) ──
  <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:3px solid var(--navy);margin-bottom:14px;">
    Left: <h1 style="font-size:18px;font-weight:800;color:var(--navy)">Agent Name — <span style="color:var(--teal)">Role Title</span></h1>
          <p style="font-size:9px;color:var(--grey);text-transform:uppercase;letter-spacing:0.5px">subtitle</p>
    Right: badge pills (see below)
  </div>

── BADGE PILLS ──
  <span style="background:var(--navy);color:white;padding:3px 8px;border-radius:20px;font-size:8.5px;font-weight:700">Label</span>
  <span style="background:var(--teal);color:white;padding:3px 8px;border-radius:20px;font-size:8.5px;font-weight:700">Label</span>
  <span style="background:var(--gold);color:white;padding:3px 8px;border-radius:20px;font-size:8.5px;font-weight:700">Label</span>

── SIDE CARDS (left column) ──
  <div style="background:var(--mist);border-radius:6px;padding:9px 10px;border-left:3px solid var(--teal);margin-bottom:10px;">
    <div style="font-size:8px;font-weight:800;color:var(--grey);letter-spacing:0.8px;text-transform:uppercase;margin-bottom:5px;">CARD TITLE</div>
    content rows using dot + text
  </div>
  Variants: border-left color → var(--gold) / var(--red) / var(--navy); background → var(--navy-l) for navy variant

── DOT ROWS ──
  <div style="display:flex;align-items:flex-start;gap:5px;margin-top:3px;">
    <span style="width:5px;height:5px;border-radius:50%;background:var(--teal);flex-shrink:0;margin-top:3px;display:inline-block;"></span>
    <p style="font-size:8px;color:var(--slate);line-height:1.5;"><strong>Label:</strong> value</p>
  </div>

── MINI TABLE ──
  <table style="width:100%;border-collapse:collapse;margin-top:4px;">
    <thead><tr>
      <td style="font-size:8px;padding:3px 4px;border:1px solid var(--rule);background:var(--navy);color:white;font-weight:700;">Col A</td>
      ...
    </tr></thead>
    <tbody>
      <tr><td style="font-size:8px;padding:3px 4px;border:1px solid var(--rule);background:white;">...</td></tr>
      <tr><td style="font-size:8px;padding:3px 4px;border:1px solid var(--rule);background:var(--mist);">...</td></tr>
    </tbody>
  </table>

── CALL FLOW STEP ROW ──
  Each step = a flex row with 4 segments:
  [Number Pill] [Body] [Data Pill] [Arrow]

  <div style="display:flex;align-items:stretch;">
    <!-- Number pill: alternates navy / teal -->
    <div style="width:26px;flex-shrink:0;background:var(--navy);color:white;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;border-radius:4px 0 0 4px;">1</div>
    <!-- Body -->
    <div style="flex:1;background:var(--mist);padding:5px 7px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);">
      <div style="font-size:9px;font-weight:700;color:var(--navy);">Step Name</div>
      <div style="font-size:7.5px;color:var(--slate);line-height:1.4;margin-top:1px;">Objective text</div>
    </div>
    <!-- Data pill -->
    <div style="width:100px;flex-shrink:0;background:var(--navy-l);padding:5px 6px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);">
      <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--grey);">Saves / Branches</div>
      <div style="font-size:7.5px;color:var(--teal);font-weight:600;margin-top:1px;">variable_name</div>
    </div>
    <!-- Arrow -->
    <div style="width:28px;flex-shrink:0;background:var(--gold-l);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);font-weight:700;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);border-radius:0 4px 4px 0;">→</div>
  </div>
  <!-- 6px connector between steps -->
  <div style="margin-left:13px;width:1px;height:6px;background:var(--teal);"></div>

  Special step: body background var(--gold-l), number pill background var(--gold)
  Terminal step: body background #FFF0F0, number pill background var(--red)

── HANDLER CARDS (4-col grid) ──
  <div style="background:var(--navy);border-radius:5px;padding:7px 8px;">
    <div style="font-size:8px;font-weight:800;color:white;letter-spacing:0.3px;">HANDLER NAME</div>
    <div style="font-size:7px;color:rgba(255,255,255,0.75);margin-top:2px;line-height:1.4;">Trigger: …</div>
    <div style="font-size:7px;color:rgba(255,255,255,0.9);margin-top:3px;line-height:1.4;border-top:1px solid rgba(255,255,255,0.2);padding-top:3px;">Action: …</div>
  </div>
  Variants: background var(--teal) / var(--gold) / var(--red)

── RULE CHIPS (5-col strip) ──
  <div style="border-radius:5px;padding:6px 7px;border:1.5px solid var(--rule);">
    <div style="font-size:7px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:2px;color:var(--red);">Never</div>
    <div style="font-size:7.5px;color:var(--slate);line-height:1.45;">rule text</div>
  </div>
  Label colors: Never → var(--red) | Always → var(--teal) | Rule → var(--navy)

── GROUP CARDS (for JSON output groups, evaluation section) ──
  <div style="border-radius:5px;overflow:hidden;border:1px solid var(--rule);">
    <div style="padding:5px 6px;background:var(--navy);color:white;">
      <div style="font-size:6.5px;opacity:0.8;margin-bottom:1px;">GROUP N</div>
      <div style="font-size:7.5px;font-weight:800;">Group Name</div>
    </div>
    <div style="padding:5px 6px;background:var(--mist);">
      field rows using dot + label pattern
      <div style="font-size:6.5px;color:var(--grey);font-style:italic;margin-top:3px;">purpose note</div>
    </div>
  </div>
  Header variants: var(--teal) / var(--gold) / #2D5F8A / #8B3A2A / #1A7A4A / #4A2080 / #B45309 / #0D5C4E

── EVAL FLOW NODES ──
  Horizontal flex row with nodes + arrows:
  <div style="background:var(--navy);color:white;border-radius:5px;padding:6px 9px;font-size:8px;font-weight:700;text-align:center;">
    Node Label<div style="font-size:6.5px;font-weight:400;opacity:0.85;margin-top:1px;">sublabel</div>
  </div>
  Arrow: <span style="color:var(--grey);font-size:14px;padding:0 5px;">›</span>

── SCORE RUBRIC TABLE ──
  Each row: [coloured badge] [description]
  Badges: 5.0=#0D2B4E | 4-4.9=#007A7A | 3-3.9=#C9882A | 2-2.9=#E07B39 | 1-1.9=#C0392B | 0-0.9=#7B1818

── GLP / ALERT BANNER ──
  <div style="background:var(--navy);border-radius:5px;padding:8px 12px;display:flex;align-items:center;gap:10px;margin-bottom:12px;">
    <div style="font-size:9px;font-weight:800;color:var(--gold);flex-shrink:0;">⚑ BANNER TITLE</div>
    category chips + action text
  </div>

── VIOLATION STRIP ──
  6 chips in a grid:
  VIOLATION label: color var(--red)
  REQUIRED label: color var(--green)
  CRITICAL label: color var(--gold)

═══════════════════════════════════════════════════
DOCUMENT STRUCTURE
═══════════════════════════════════════════════════

If script prompt provided → PAGE 1: CALL AGENT REFERENCE

  SECTION A — HEADER
    • System name + agent name (large, bold, navy/teal)
    • Subtitle: brand · doc type · flow description
    • Badge pills: step count, language, agent persona, primary goal

  SECTION B — MAIN GRID (220px left | 1fr right)

    LEFT COLUMN — 4 info cards:
    1. Agent Identity card (navy variant): name, gender, language, goal, tone
    2. Package/Decision Logic card (gold variant): decision table with thead navy, show all conditions → outcomes → prices
    3. Pitch Structure card (teal variant): all pitch blocks/phases with dot rows
    4. Variables card (teal variant): 2-col grid of ALL variable names in teal colour

    RIGHT COLUMN — FULL CALL FLOW:
    • One step row per step (NEVER skip any step)
    • Alternate number pill navy / teal
    • Decision/special steps: gold body background
    • Terminal/end step: red body background
    • 6px vertical connector line between each step

  SECTION C — HANDLERS GRID (4 columns)
    One coloured card per handler type: navy / teal / gold / red

  SECTION D — RULES STRIP (5-6 chips)
    Never (red) | Always (green) | Rule (navy)

  PAGE FOOTER: system · agent name · Confidential | hard stop rule

──────────────────────────────────────────────────
If eval prompt provided → PAGE 2: EVALUATION AI

  SECTION E — EVAL HEADER (same style as Page 1 header)
    Badges: output group count, field count, score range, special detections

  SECTION F — TOP ROW GRID (1fr right | 260px scoring)
    Left: EVAL FLOW horizontal diagram
      Nodes: Transcript → Duration Check → branches → Extract → Score → Scan → JSON Out
      After branches: two bullet lines (< threshold = skip, >= threshold = full eval)
    Right: Quality Score rubric table + Lead Intent classification chips

  SECTION G — SPECIAL DETECTION BANNER (if applicable, e.g. GLP-1, escalation)
    Full-width navy banner with category chips + escalation action

  SECTION H — OUTPUT GROUPS GRID (auto columns, 1 card per JSON group)
    Each card: coloured header (group # + name) | body: key fields with type | italic footer note
    Use distinct header colours for each group (cycle through provided colours)

  SECTION I — BOTTOM 3-CARD ROW
    Card 1 (navy): Core Extraction / Data Rules (numbered)
    Card 2 (dark red #8B3A2A): Issue/Objection Categories (numbered, most important ★ first)
    Card 3 (teal): Downstream Use (CRM / QA / Coaching / Escalation rows)

  SECTION J — VIOLATION STRIP (6 chips)
    Violations (red) | Required (green) | Critical checks (gold)

  PAGE FOOTER: system name · Confidential | output format note

═══════════════════════════════════════════════════
EXTRACTION RULES — NEVER VIOLATE
═══════════════════════════════════════════════════
• Extract EVERY step from the script prompt — never skip or combine steps
• Extract EVERY variable, handler, branch, rule verbatim
• Extract EVERY output field, scoring band, violation flag from the eval prompt
• Use the ACTUAL agent name, brand, language throughout — never "Agent Name" placeholders
• Every word of content comes from the source prompts — no invention
• If only one prompt is provided, generate only the relevant page
• If both prompts are provided, generate BOTH pages in sequence in the same HTML file

═══════════════════════════════════════════════════
SPACE UTILISATION — ALWAYS FILL THE PAGE
═══════════════════════════════════════════════════
The document must ALWAYS fill an A4 page fully. Never leave large empty white areas.

IF the script has fewer than 6 steps:
• Expand each step row to be taller (padding: 10px 7px instead of 5px 7px)
• Add a "SCRIPT EXCERPT" card in the left column showing the actual sample dialogue for key steps
• Add a "BRANCHING LOGIC" card listing every branch/condition with outcomes
• Add a "CALL TIPS" card with 4–5 coaching notes inferred from the prompt style and goal

IF the eval prompt is short or has fewer than 6 output groups:
• Expand each group card to show more field detail
• Add a "SCORING EXAMPLES" section: 3 rows of example scores (score | call scenario | why that score)
• Add a "COMMON FAILURE MODES" card listing the 4 most common quality issues for this type of call

IF only one prompt is provided and the page is less than ~90% full:
• Add an "IMPLEMENTATION NOTES" section: deployment checklist (5–6 items), integration requirements, testing approach
• Add a "QUICK REFERENCE" strip at the bottom: the 5 most important do's and don'ts for this specific agent

GENERAL DENSITY RULE: every section should have enough content that a reader would spend 30+ seconds reading it. Short cards should have 4+ dot rows. Tables should have 4+ rows. Never render a card with only 1–2 lines of content.`;


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

// ─── Route 2b: Workflow Stage+Column Doc ─────────────────────────────────────

const WORKFLOW_DOC_PROMPT = `You are a senior AI systems consultant creating a WORKFLOW STAGE DIAGRAM document — like a Hunar/Swiggy AI calling workflow chart. This is NOT a call script reference card. It is a visual stage-by-stage workflow with channel columns (SSU, Referral, Non-Agency) and speech bubbles for each channel.

OUTPUT: A complete self-contained <!DOCTYPE html> file. All CSS in <style>. No markdown. No code fences.

DESIGN: Import Inter from Google Fonts. White page background. Print-exact colours.

═══════════════════════════════════════════════
LAYOUT — EXACT STRUCTURE TO REPRODUCE
═══════════════════════════════════════════════

HEADER SECTION:
• Client logo area (left): bold client name + product name
• Date (top right): formatted date
• Title: "AI Calling Workflow" — large, bold, left-aligned
• Channel column headers row: [Stage | Channel 1 | Channel 2 | Channel 3] as bold centered labels

STAGE ROWS (one per stage/step in the flow):
Each stage row has a coloured background (alternating: yellow #FFF9C4, green #E8F5E2, light grey #F4F7FA):
• LEFT cell (20% width): Stage box — white rounded rectangle with bold stage number + name
  Below the stage box: 
  - "Action to take by User:" (bold) — bullet list
  - "Info to provide by [Agent]:" (bold) — bullet list  
  - "Stage Exit Metric:" (bold) — 1–2 lines
• MIDDLE cells (channels, ~25% each): Speech bubble boxes for each channel variant
  Speech bubble: white box with thin border, rounded corners, bottom-left tail
  Content: the exact script/message for that channel
• BOTTOM of each stage row: "Confirmation question:" in bold + the question text spanning full width

ARROWS: vertical arrows between stage rows in the left column (↓)

TERMINAL: final stage box at bottom showing the end state

CSS PATTERNS:
.workflow-wrap { max-width: 900px; margin: 0 auto; padding: 24px; font-family: Inter, sans-serif; }
.col-headers { display: grid; grid-template-columns: 20% 1fr 1fr 1fr; gap: 0; margin-bottom: 0; }
.col-hdr { text-align: center; font-weight: 800; font-size: 13px; padding: 10px; }
.stage-row { display: grid; grid-template-columns: 20% 1fr 1fr 1fr; border: 1px solid #e0e0e0; margin-bottom: 0; }
.stage-row:nth-child(odd)  { background: #FFF9C4; }
.stage-row:nth-child(even) { background: #E8F5E2; }
.stage-cell { padding: 14px; border-right: 1px solid #ddd; }
.stage-box { background: white; border: 1.5px solid #aaa; border-radius: 8px; padding: 10px 12px; text-align: center; margin-bottom: 10px; }
.stage-box .num { font-size: 11px; color: #666; }
.stage-box .name { font-size: 13px; font-weight: 700; color: #1a1a1a; }
.stage-info { font-size: 11px; line-height: 1.6; color: #333; }
.stage-info strong { font-size: 11px; font-weight: 700; display: block; margin-top: 6px; }
.speech-bubble { background: white; border: 1.5px solid #bbb; border-radius: 12px; padding: 10px 12px; font-size: 11px; font-style: italic; color: #333; line-height: 1.5; position: relative; margin-bottom: 6px; }
.speech-bubble::after { content: ''; position: absolute; bottom: -10px; left: 16px; width: 0; height: 0; border-left: 8px solid transparent; border-right: 4px solid transparent; border-top: 10px solid #bbb; }
.confirm-row { grid-column: 1/-1; padding: 8px 14px; border-top: 1px solid #ddd; background: rgba(255,255,255,0.5); }
.confirm-row strong { font-size: 11px; font-weight: 700; }
.confirm-row span { font-size: 11px; color: #333; }
.arrow-row { display: flex; justify-content: flex-start; padding: 4px 0 4px 9%; }
.arrow-row span { font-size: 20px; color: #555; }
.terminal-box { background: white; border: 2px solid #aaa; border-radius: 8px; padding: 12px 18px; text-align: center; display: inline-block; margin: 8px 0 8px 5%; font-weight: 700; font-size: 13px; }

═══════════════════════════════════════════════
EXTRACTION RULES
═══════════════════════════════════════════════
• Extract every stage/step name and number
• For each stage extract: user actions, agent info to provide, exit metric
• For each channel (SSU/Referral/Non-Agency or equivalent) extract the exact script message
• Extract the confirmation question for each stage
• If channel names differ from SSU/Referral/Non-Agency, use the actual names from the prompt
• If some channels share the same message, render it identically in both cells
• Never invent content — only use what is in the source prompt
• Wrap in proper <!DOCTYPE html> with embedded CSS`;

app.post('/api/generate-workflow', async (req, res) => {
  try {
    const { prompt, client, product, version } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'No prompt provided' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userText = `Generate a workflow stage diagram HTML document.

Client: ${client || 'Company'}
Product: ${product || 'AI Calling Workflow'}
Version: ${version || 'v1.0'}
Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

=== WORKFLOW / CALL FLOW PROMPT ===
${prompt}

Output ONLY a complete <!DOCTYPE html> file. No code fences. No explanation.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: WORKFLOW_DOC_PROMPT },
        { role: 'user',   content: userText },
      ],
      max_tokens: 8000,
      temperature: 0.15,
    });

    let content = response.choices[0].message.content.trim();
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    if (!content.startsWith('<!DOCTYPE') && !content.startsWith('<html')) {
      const start = content.indexOf('<!DOCTYPE');
      if (start > -1) content = content.slice(start);
    }
    res.json({ success: true, content });
  } catch (error) {
    console.error('Workflow doc error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Route 2c: Prompt → Client Doc ───────────────────────────────────────────

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

CRITICAL REQUIREMENTS:
- Output ONLY a complete <!DOCTYPE html> file — no explanation, no code fences
- Use ALL the coloured component patterns from the design system
- Every section must have colour: coloured card headers, coloured borders, coloured badges
- Extract and render EVERY step, variable, handler, rule, field from the prompts above
- FILL THE PAGE: if the prompt is short, expand content with script excerpts, branching logic, coaching tips, implementation notes — never leave white space
- Dense, information-rich — minimum 1 full A4 page per prompt provided`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: DOC_SYSTEM_PROMPT },
        { role: 'user',   content: userText }
      ],
      max_tokens: 16000,
      temperature: 0.15,
    });

    let content = response.choices[0].message.content.trim();
    // Strip any accidental markdown fences
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    // Ensure it starts with DOCTYPE
    if (!content.startsWith('<!DOCTYPE') && !content.startsWith('<html')) {
      const start = content.indexOf('<!DOCTYPE');
      if (start > -1) content = content.slice(start);
    }

    res.json({ success: true, content });

  } catch (error) {
    console.error('Doc generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Route 3: HTML → PDF via Puppeteer ───────────────────────────────────────

app.post('/api/html-to-pdf', async (req, res) => {
  let browser;
  try {
    const { html, filename } = req.body;
    if (!html) return res.status(400).json({ success: false, error: 'No HTML provided' });

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Set content and wait for fonts + layout to settle
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Inject print-colour CSS so background colours are preserved
    await page.addStyleTag({
      content: `
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
      `,
    });

    // Wait for @import fonts to settle
    await new Promise(r => setTimeout(r, 800));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,       // ← renders all background colours/images
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
      preferCSSPageSize: false,
    });

    await browser.close();
    browser = null;

    const safeFilename = (filename || 'AI_Call_Documentation').replace(/[^a-zA-Z0-9_\-]/g, '_') + '.pdf';

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('PDF generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));