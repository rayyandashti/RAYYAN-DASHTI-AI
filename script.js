"use strict";
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const DEFAULTS = {
  provider: "groq", apiKey: "", model: "llama-3.3-70b-versatile",
  system: "तुम एक मददगार AI असिस्टेंट हो। यूज़र जिस भाषा में लिखे, उसी भाषा में साफ़ और सरल जवाब दो।"
};
const GEMINI_MODEL = "gemini-2.5-flash";
const MODELS = { groq: "llama-3.3-70b-versatile", gemini: GEMINI_MODEL, claude: "claude-sonnet-5-5" };

let settings = { ...DEFAULTS, ...store.get("ai_settings", {}) };
let chats = store.get("ai_chats", []);
let currentId = store.get("ai_current", null);
let busy = false;

const current = () => chats.find((c) => c.id === currentId);
const save = () => { store.set("ai_chats", chats); store.set("ai_current", currentId); };

/* ---------- Markdown (छोटा और सुरक्षित) ---------- */
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function md(text) {
  const parts = text.split(/```/);
  return parts.map((seg, i) => {
    if (i % 2 === 1) {
      const nl = seg.indexOf("\n");
      const code = nl >= 0 ? seg.slice(nl + 1) : seg;
      return `<pre><button class="btn copy" type="button">कॉपी</button><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
    }
    let html = "", list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    seg.split("\n").forEach((line) => {
      let m;
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^#{1,6}\s+(.*)/))) { close(); html += `<p><strong>${inline(m[1])}</strong></p>`; }
      else if (line.trim() === "") { close(); }
      else { close(); html += `<p>${inline(line)}</p>`; }
    });
    close();
    return html;
  }).join("");
}

/* ---------- UI ---------- */
function addMsg(role, text, cls = "") {
  const d = document.createElement("div");
  d.className = `msg ${role} ${cls}`;
  if (role === "user") d.textContent = text; else d.innerHTML = md(text);
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
  return d;
}
function renderChats() {
  const list = $("chatList"); list.innerHTML = "";
  chats.forEach((c) => {
    const el = document.createElement("div");
    el.className = "chat-item" + (c.id === currentId ? " active" : "");
    el.textContent = c.title;
    el.onclick = () => { currentId = c.id; save(); renderAll(); $("sidebar").classList.remove("open"); };
    list.appendChild(el);
  });
}
function renderMessages() {
  const box = $("messages");
  box.querySelectorAll(".msg").forEach((n) => n.remove());
  const c = current();
  $("empty").style.display = c && c.messages.length ? "none" : "";
  $("chatTitle").textContent = c ? c.title : "AI Assistant";
  if (c) c.messages.forEach((m) => addMsg(m.role === "user" ? "user" : "bot", m.content));
}
function renderAll() { renderChats(); renderMessages(); }

function newChat() {
  const c = { id: Date.now().toString(36), title: "नई चैट", messages: [] };
  chats.unshift(c); currentId = c.id; save(); renderAll();
}

/* ---------- API ---------- */
async function callClaude(messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model: settings.model, max_tokens: 2048, system: settings.system, messages })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Error ${r.status}`);
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
async function callGroq(messages) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + settings.apiKey },
    body: JSON.stringify({ model: settings.model, messages: [{ role: "system", content: settings.system }, ...messages] })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Error ${r.status}`);
  return data.choices?.[0]?.message?.content || "(خالی جواب)";
}
async function callGemini(messages) {
  const model = settings.model || GEMINI_MODEL;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": settings.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: settings.system }] },
      contents: messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }))
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Error ${r.status}`);
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n") || "(खाली जवाब)";
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (!settings.apiKey) { openSettings(); return; }
  if (!current()) newChat();
  const c = current();
  c.messages.push({ role: "user", content: text });
  if (c.messages.length === 1) c.title = text.slice(0, 40);
  save(); $("input").value = ""; autosize();
  $("empty").style.display = "none";
  renderChats(); $("chatTitle").textContent = c.title;
  addMsg("user", text);
  const wait = addMsg("bot", "सोच रहा हूँ…", "typing");
  busy = true; $("sendBtn").disabled = true;
  try {
    const history = c.messages.slice(-30);
    const fn = { groq: callGroq, gemini: callGemini, claude: callClaude }[settings.provider] || callGroq;
    const reply = await fn(history);
    wait.remove(); addMsg("bot", reply);
    c.messages.push({ role: "assistant", content: reply });
  } catch (e) {
    wait.remove();
    addMsg("bot", "गड़बड़ हुई: " + e.message + "\n\nसेटिंग्स में API key और model का नाम जाँच लें।", "err");
    c.messages.pop(); // फेल हुआ संदेश हटाएं ताकि दोबारा भेज सकें
  } finally {
    busy = false; $("sendBtn").disabled = false; save(); $("input").focus();
  }
}

/* ---------- Settings ---------- */
function openSettings() {
  $("provider").value = settings.provider; $("apiKey").value = settings.apiKey;
  $("model").value = settings.model; $("system").value = settings.system;
  $("settings").showModal();
}
$("provider").onchange = () => { $("model").value = MODELS[$("provider").value]; };
$("saveSettings").onclick = () => {
  settings = { provider: $("provider").value, apiKey: $("apiKey").value.trim(), model: $("model").value.trim() || DEFAULTS.model, system: $("system").value.trim() || DEFAULTS.system };
  store.set("ai_settings", settings);
};

/* ---------- Voice (हिंदी में बोलकर लिखें) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$("micBtn").onclick = () => {
  if (!SR) { alert("आपका ब्राउज़र voice input सपोर्ट नहीं करता। Chrome इस्तेमाल करें।"); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = "hi-IN"; rec.interimResults = false;
  $("micBtn").classList.add("rec");
  rec.onresult = (e) => { $("input").value += (($("input").value ? " " : "") + e.results[0][0].transcript); autosize(); };
  rec.onend = () => { rec = null; $("micBtn").classList.remove("rec"); };
  rec.onerror = () => { rec = null; $("micBtn").classList.remove("rec"); };
  rec.start();
};

/* ---------- Events ---------- */
function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
$("input").addEventListener("input", autosize);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("input").value); } });
$("sendBtn").onclick = () => send($("input").value);
$("newChat").onclick = () => { newChat(); $("sidebar").classList.remove("open"); };
$("openSettings").onclick = openSettings;
$("menuBtn").onclick = () => $("sidebar").classList.toggle("open");
$("clearBtn").onclick = () => {
  if (!current() || !confirm("यह चैट हटाएं?")) return;
  chats = chats.filter((c) => c.id !== currentId); currentId = chats[0]?.id || null; save(); renderAll();
};
$("messages").addEventListener("click", (e) => {
  const b = e.target.closest(".suggest button");
  if (b) send(b.dataset.p);
  if (e.target.classList.contains("copy")) {
    navigator.clipboard?.writeText(e.target.parentElement.querySelector("code").textContent);
    e.target.textContent = "कॉपी हो गया"; setTimeout(() => (e.target.textContent = "कॉपी"), 1200);
  }
});

if (!current()) currentId = chats[0]?.id || null;
renderAll();
if (!settings.apiKey) setTimeout(openSettings, 400);
