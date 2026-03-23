const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const path = require('path');

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

const DOC_SYSTEM_PROMPT = `You are an expert AI call centre consultant creating professional client-ready HTML documentation for AI calling systems.
Output ONLY the inner HTML body content. No <html>, <head>, or <body> tags. No markdown fences.

Use these exact pre-defined CSS classes in your output:
- .client-doc (wrap everything in this div)
- .doc-hero (header block with children: .d-eyebrow, h1, .d-sub, .d-meta containing .d-meta-item divs each with .d-label and .d-val)
- .doc-section (each major section — contains .sec-hdr with .sec-num span and h2, plus .sec-body)
- .stage-card (each call stage — contains .stage-hdr with .stage-label and .stage-name spans, plus .stage-body)
- .stage-body (two-column grid — two .stage-col divs each with an h4 label)
- .script-bubble (each script line / spoken text)
- .outcome-chip for positive outcomes, .outcome-chip.red for negative, .outcome-chip.yellow for pending
- <table class="eval-table"> with <th> and <td> (3 columns: Criterion, Weight, Description)
- .score-pill.high / .score-pill.med / .score-pill.low (inline score indicators)
- .info-grid containing .info-item divs (each with .i-label and .i-val)
- .flow-vis (visual flow row) containing .flow-node spans, .flow-node.end-node for final node, .flow-arr spans (use →)

Create ALL of these sections as .doc-section blocks:
1. Executive Overview — purpose, scope, target audience, expected outcomes
2. Call Flow Architecture — .flow-vis nodes showing the full path, then a summary table
3. Stage-by-Stage Scripts — one .stage-card per stage, left col = script bubbles, right col = decision outcomes
4. Objection Handling & Edge Cases — common objections with recommended responses
5. Quality Evaluation Framework — eval-table with all criteria, weights, scoring guide, pass/fail threshold
6. Performance KPIs & Benchmarks — info-grid with key metrics and targets
7. Implementation Notes & Best Practices — technical and operational guidance

Be VERY detailed and specific. Extract every stage, every decision point, every script line, and every evaluation criterion from the prompts provided. This should look like a premium consultant deliverable.`;

// ─── Route 1: Image → Flowchart or Notes ─────────────────────────────────────

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    const { type } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }

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
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high'
            }
          }
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

    const userText = `Generate a full, detailed, professional AI calling system documentation.

${client  ? `Client Name: ${client}`         : ''}
${product ? `Product / Use Case: ${product}` : ''}
Version: ${version || 'v1.0'}
Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

${scriptPrompt ? `=== CALL SCRIPT PROMPT ===\n${scriptPrompt}` : ''}
${evalPrompt   ? `\n=== CALL EVALUATION PROMPT ===\n${evalPrompt}` : ''}

Create a complete, detailed document covering all stages, scripts, evaluation criteria, and implementation guidance.`;

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