// Vercel Serverless Function — Admin Chat API (v2)
// Single-pass: pre-fetches source file so AI can respond + act in one call

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mltgtiazvnxjlsznzywz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdGd0aWF6dm54amxzem56eXd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwOTUzNTksImV4cCI6MjA1NzY3MTM1OX0.CrOC4ps7hYa1fBJg8V_1wPJOaNXx7OjUlfRx67VM8wI';

const GITHUB_OWNER = 'empowerlo';
const GITHUB_REPO = 'brokertoolkit-website';
const KNOWLEDGE_PATH = 'site-knowledge.json';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

// --- GitHub helpers ---
async function ghGet(path, token) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha, path: data.path };
}

async function ghPut(path, content, sha, message, token) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha: sha || undefined })
  });
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function ghList(path, token) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path || ''}`, {
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.map(f => ({ name: f.name, path: f.path, type: f.type })) : [];
}

// Map URL path to source file
function pathToSourceFile(urlPath) {
  if (!urlPath || urlPath === '/') return 'src/pages/index.html';
  let p = urlPath.replace(/^\//, '').replace(/\/$/, '');
  if (!p.endsWith('.html')) p += '.html';
  return 'src/pages/' + p;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'propose_change',
      description: 'Propose a code change for the admin to review before deploying. The admin will see a diff and can approve or reject. Use this for ALL edits — changes are NEVER applied without approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g., src/partials/nav.html)' },
          patches: {
            type: 'array',
            description: 'Array of find-and-replace patches',
            items: {
              type: 'object',
              properties: {
                find: { type: 'string', description: 'Exact text to find (must match precisely including whitespace)' },
                replace: { type: 'string', description: 'New text to replace it with' }
              },
              required: ['find', 'replace']
            }
          },
          message: { type: 'string', description: 'Short description of the change' }
        },
        required: ['path', 'patches', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the repo. The current page source is already in context — use this for other files.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'learn',
      description: 'Save something you learned for future sessions.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['topic', 'content']
      }
    }
  }
];

const SYSTEM_PROMPT = `You are the Site Assistant for brokertoolkit.app.

SITE STRUCTURE:
- Source: src/pages/ (templates) + src/partials/ (nav, footer, shared components)
- Build: node build.js injects partials → root HTML. Always edit src/ files.
- Deploy: GitHub commit → Vercel auto-deploys ~30s
- Tech: Static HTML, Supabase auth

THE CURRENT PAGE SOURCE FILE IS PROVIDED IN CONTEXT. You don't need to read it first.

CRITICAL RULES:
1. Use propose_change to suggest edits. The admin reviews a diff and clicks Apply or Reject. Changes are NEVER auto-deployed.
2. The "find" text in patches must match EXACTLY (whitespace, indentation, everything). Copy precisely from source.
3. Explain what you're changing and why BEFORE calling propose_change.
4. Do NOT read a file you already have in context.
5. Keep patches minimal — only change what's needed.

Use learn() when you discover something non-obvious for future sessions.
Be concise. The admin is technical.`;

async function executeTool(name, args, githubToken, pendingChanges) {
  if (name === 'propose_change') {
    const existing = await ghGet(args.path, githubToken);
    if (!existing) return JSON.stringify({ error: `File not found: ${args.path}` });
    let content = existing.content;
    const validPatches = [];
    const errors = [];
    for (const patch of args.patches) {
      if (!content.includes(patch.find)) {
        errors.push(`Could not find: "${patch.find.slice(0, 60)}..." — check whitespace`);
        continue;
      }
      content = content.replace(patch.find, patch.replace);
      validPatches.push(patch);
    }
    if (validPatches.length === 0) {
      return JSON.stringify({ error: 'No patches matched. ' + errors.join('; ') });
    }
    const proposal = {
      type: 'proposal',
      path: args.path,
      patches: validPatches,
      message: args.message,
      errors: errors.length ? errors : undefined,
      sha: existing.sha
    };
    pendingChanges.push(proposal);
    return `Proposed ${validPatches.length} change(s) to ${args.path}. Waiting for admin approval.`;
  } else if (name === 'read_file') {
    const file = await ghGet(args.path, githubToken);
    return file ? file.content : `File not found: ${args.path}`;
  } else if (name === 'learn') {
    const file = await ghGet(KNOWLEDGE_PATH, githubToken);
    if (!file) {
      // Create knowledge base if it doesn't exist
      const kb = { entries: [{ topic: args.topic, learned: new Date().toISOString().split('T')[0], content: args.content }] };
      await ghPut(KNOWLEDGE_PATH, JSON.stringify(kb, null, 2), null, `knowledge: ${args.topic}`, githubToken);
      return `✅ Created knowledge base and learned "${args.topic}".`;
    }
    const kb = JSON.parse(file.content);
    const idx = kb.entries.findIndex(e => e.topic === args.topic);
    const entry = { topic: args.topic, learned: new Date().toISOString().split('T')[0], content: args.content };
    if (idx >= 0) kb.entries[idx] = entry; else kb.entries.push(entry);
    await ghPut(KNOWLEDGE_PATH, JSON.stringify(kb, null, 2), file.sha, `knowledge: ${args.topic}`, githubToken);
    return `✅ Learned "${args.topic}".`;
  }
  return 'Unknown tool';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.split(' ')[1]);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

    const { messages, pageContext, model } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages required' });

    const selectedModel = model || DEFAULT_MODEL;
    const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GATEWAY_KEY) return res.status(500).json({ error: 'AI_GATEWAY_API_KEY not configured' });

    // --- Pre-fetch: load source file + knowledge in parallel ---
    const sourcePath = pageContext?.path ? pathToSourceFile(pageContext.path) : null;
    const [sourceFile, knowledgeFile] = await Promise.all([
      sourcePath && GITHUB_TOKEN ? ghGet(sourcePath, GITHUB_TOKEN) : null,
      GITHUB_TOKEN ? ghGet(KNOWLEDGE_PATH, GITHUB_TOKEN) : null
    ]);

    let preContext = '';
    if (sourceFile) {
      preContext += `\n\n--- SOURCE FILE: ${sourcePath} ---\n${sourceFile.content}\n--- END SOURCE ---`;
    }
    if (knowledgeFile) {
      const kb = JSON.parse(knowledgeFile.content);
      preContext += '\n\nKNOWN FACTS:\n' + kb.entries.map(e => `- [${e.topic}] ${e.content}`).join('\n');
    }

    // Build messages
    const apiMessages = messages.map((m, i) => ({
      role: m.role,
      content: i === 0 && m.role === 'user' && pageContext
        ? `[Page: ${pageContext.path} — "${pageContext.title}"${pageContext.selectedElement ? ` — 🎯 Selected: ${JSON.stringify(pageContext.selectedElement)}` : ''}]\n\n${m.content}`
        : (typeof m.content === 'string' && m.content.length > 2000
          ? m.content.slice(0, 2000) + '\n... [truncated]'
          : m.content)
    }));

    const trimmedMessages = apiMessages.length > 6 ? apiMessages.slice(-6) : apiMessages;

    const systemContent = SYSTEM_PROMPT + preContext;
    const actions = [];
    const pendingChanges = [];

    let currentMessages = [{ role: 'system', content: systemContent }, ...trimmedMessages];
    let maxIterations = 25;

    while (maxIterations-- > 0) {
      const body = { model: selectedModel, messages: currentMessages, max_tokens: 16384 };
      if (GITHUB_TOKEN) { body.tools = TOOLS; body.tool_choice = 'auto'; }

      const gatewayRes = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_KEY}` },
        body: JSON.stringify(body)
      });

      if (!gatewayRes.ok) {
        const errText = await gatewayRes.text();
        return res.status(500).json({ error: `AI error (${gatewayRes.status}): ${errText.slice(0, 200)}` });
      }

      const data = await gatewayRes.json();
      const choice = data.choices?.[0];
      if (!choice) return res.status(500).json({ error: 'No response from AI' });

      if (choice.message?.tool_calls?.length) {
        currentMessages.push(choice.message);

        for (const tc of choice.message.tool_calls) {
          const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          let result;
          try {
            result = await executeTool(tc.function.name, args, GITHUB_TOKEN, pendingChanges);
            if (tc.function.name === 'propose_change') actions.push(`Proposed: ${args.message}`);
            if (tc.function.name === 'read_file') actions.push(`Read ${args.path}`);
            if (tc.function.name === 'learn') actions.push(`Learned: ${args.topic}`);
          } catch (err) { result = `Error: ${err.message}`; }

          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      } else {
        const reply = choice.message?.content || 'Done.';
        return res.status(200).json({ reply, model: selectedModel, actions, proposals: pendingChanges.length ? pendingChanges : undefined });
      }
    }

    return res.status(200).json({ reply: 'I ran out of steps before finishing. Try asking again with a simpler request.', model: selectedModel, actions });

  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal error: ' + err.message });
  }
};
