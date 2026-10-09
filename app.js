/* Neo de bolso — the same face as the desktop Neo, with a small language model
   running on the phone itself (WebLLM on WebGPU). After the first download it
   answers with no internet at all. Nothing here talks to Claude or any cloud
   brain. Every state the sphere shows is a real one: downloading, thinking,
   speaking, listening. */
import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("neo." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("neo." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ── brains: three sizes; f16 builds when the GPU supports them ── */
const TIERS = {
  leve:        { label: "Leve", models: ["Llama-3.2-1B-Instruct-q4f16_1-MLC", "Llama-3.2-1B-Instruct-q4f32_1-MLC"] },
  equilibrado: { label: "Equilibrado", models: ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5-1.5B-Instruct-q4f32_1-MLC"] },
  melhor:      { label: "Melhor", models: ["Qwen2.5-3B-Instruct-q4f16_1-MLC", "Qwen2.5-3B-Instruct-q4f32_1-MLC"] },
};
const ORDER = ["melhor", "equilibrado", "leve"];
let engine = null, loadedModel = null, loading = null, f16 = false, gpuOk = false;

function modelFor(tier) {
  const [a, b] = TIERS[tier].models;
  return f16 ? a : b;
}
function modelRecord(id) { return webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id); }
function sizeGB(id) { const r = modelRecord(id); return r ? (r.vram_required_MB / 1024).toFixed(1).replace(".", ",") : "?"; }

async function probeGPU() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    f16 = adapter.features.has("shader-f16");
    return true;
  } catch { return false; }
}

async function isCached(id) { try { return await webllm.hasModelInCache(id); } catch { return false; } }

async function loadBrain(tier, { fallback = true } = {}) {
  if (loading) return loading;
  const id = modelFor(tier);
  if (engine && loadedModel === id) return engine;
  loading = (async () => {
    setPhase("loading");
    showProgress(0);
    const cached = await isCached(id);
    caption(cached ? "Acordando…" : `Baixando o cérebro (${sizeGB(id)} GB). Só desta vez.`);
    try {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      if (engine) { try { await engine.unload(); } catch {} }
      engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
        initProgressCallback: (r) => {
          showProgress(r.progress || 0);
          const pct = Math.round((r.progress || 0) * 100);
          if (!cached && pct < 100) hint(`Baixando o cérebro: ${pct}%. Deixe o app aberto.`);
          else hint("Preparando…");
        },
      });
      loadedModel = id;
      store.set("tier", tier);
      hint("");
      caption("");
      renderSettings();
      return engine;
    } catch (e) {
      engine = null; loadedModel = null;
      const lower = ORDER[ORDER.indexOf(tier) + 1];
      if (fallback && lower) {
        hint(`O cérebro ${TIERS[tier].label} não coube na memória. Tentando o ${TIERS[lower].label}…`, "warn");
        loading = null;
        return loadBrain(lower, { fallback });
      }
      throw e;
    } finally {
      showProgress(null);
      loading = null;
      setPhase("idle");
    }
  })();
  return loading;
}

/* ── memory: notes on this phone, plus "about me" always in context ── */
const norm = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set("que pra para com uma por mas como mais isso esse essa voce tem ter nao sim aqui meu minha seu sua tudo nada qual quando onde porque entao tambem ainda sobre neo".split(" "));
function notes() { return store.get("notes", []); }
function saveNotes(list) { store.set("notes", list); renderNotes(); }

function relevantNotes(text, limit = 3) {
  const words = [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
  if (!words.length) return [];
  return notes().map((n) => {
    const hay = norm(n.title + " " + n.text);
    const s = words.reduce((acc, w) => acc + (new RegExp("\\b" + w).test(hay) ? (norm(n.title).includes(w) ? 2 : 1) : 0), 0);
    return [s, n];
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, n]) => n);
}

const NUM = { um: 1, uma: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30 };
function spokenDates(text) {
  // "dia dez do dez" → "dia 10/10" (speech recognisers write numbers as words)
  return text.replace(/\bdia\s+(\w+(?:\s+e\s+\w+)?)\s+d[oe]\s+(\w+)\b/gi, (m, d, mo) => {
    const n = (w) => /^\d+$/.test(w) ? +w : w.split(/\s+e\s+/).reduce((s, p) => s + (NUM[norm(p)] || NaN), 0);
    const day = n(d), month = n(mo);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? `dia ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` : m;
  });
}

// Saving is done here, not by the model: a small model forgets to, a regex does not.
const REMEMBER = /^\s*(?:neo[,\s]+)?(?:me\s+)?(anota|anote|lembra|lembre|guarda|guarde|salva|salve)(?:\s+(?:a[ií]|isso|pra mim|que|de|da|do))*\s*[:,]?\s*(.+)$/i;
function tryRemember(text) {
  const m = REMEMBER.exec(text);
  if (!m || m[2].trim().length < 3) return null;
  const body = spokenDates(m[2].trim()).replace(/[.!]+$/, "");
  const title = body.split(/\s+/).slice(0, 5).join(" ").replace(/^\w/, (c) => c.toUpperCase());
  const list = notes();
  list.unshift({ id: Date.now(), title, text: body.replace(/^\w/, (c) => c.toUpperCase()) + ".", date: new Date().toISOString().slice(0, 10) });
  saveNotes(list);
  return title;
}

/* ── the voice of a friend, sized for a small model ── */
function systemPrompt(userText) {
  const now = new Date();
  const days = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const tom = new Date(now.getTime() + 864e5);
  const about = (store.get("about", "") || "").trim();
  const rel = relevantNotes(userText);
  // Small models follow short, positive instructions and imitate examples far
  // better than they follow lists of "don'ts" (those make them refuse everything).
  return [
    "Você é o Neo, o amigo do Gê. Vocês conversam por voz.",
    "Responda em português do Brasil, de um jeito informal e simpático, em uma a três frases curtas. Responda o que ele perguntou, com o que você sabe.",
    "Só para clima, notícias e preços de hoje: diga que, sem internet, não tem como saber agora.",
    "Em fatos, datas, história e números, fale só o que tiver certeza. Se não tiver, diga \"não tenho certeza\" em vez de chutar.",
    `Hoje é ${days[now.getDay()]}, ${now.toLocaleDateString("pt-BR")}, ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Amanhã é ${days[tom.getDay()]}.`,
    about ? `Sobre o Gê:\n${about.slice(0, 1200)}` : "",
    rel.length ? "Notas do Gê que podem ajudar agora:\n" + rel.map((n) => `- ${n.title}: ${n.text}`).join("\n").slice(0, 900) : "",
  ].filter(Boolean).join("\n\n");
}

// A few model turns to imitate: the tone, the length, answering for real.
const EXAMPLES = [
  ["oi", "E aí, Gê! Tudo certo?"],
  ["tô cansado", "Poxa, dia puxado? Dá uma pausa, toma uma água, que depois rende mais."],
  ["quanto é 15% de 200?", "Dá 30."],
  ["qual o maior planeta do sistema solar?", "Júpiter, de longe. Cabem uns mil e trezentos planetas Terra dentro dele."],
  ["vai chover hoje?", "Sem internet eu não tenho como ver a previsão agora, Gê. Dá uma olhada no app do tempo."],
  ["em que ano o homem pisou na Lua?", "Em 1969, com a Apollo 11."],
  ["quantos habitantes tem a cidade de Paramoti?", "Esse número eu não sei de cabeça, Gê. Melhor conferir quando tiver internet."],
].flatMap(([u, a]) => [{ role: "user", content: u }, { role: "assistant", content: a }]);

/* ── conversation ── */
let history = store.get("history", []);
let busy = false;

async function send(text) {
  text = (text || "").trim();
  if (!text || busy) return;
  unlockVoice();
  $("#ask").value = ""; syncAsk();
  addTurn("user", text);

  const saved = tryRemember(text);
  if (saved) { reply(`Anotado, Gê: ${saved}.`); return; }

  if (!gpuOk) {
    reply("Este aparelho não liberou a placa de vídeo para o navegador, então não consigo pensar aqui. No iPhone, precisa do iOS 26 ou mais novo, aberto pelo Safari.");
    return;
  }
  const tier = store.get("tier", "equilibrado");
  busy = true; setBusy(true);                       // nothing else is sent while the brain loads
  if (!engine) {
    const id = modelFor(tier);
    if (!(await isCached(id)) && !confirm(`Para responder sem internet, o Neo precisa baixar o cérebro uma vez: cerca de ${sizeGB(id)} GB. Use o Wi-Fi. Baixar agora?`)) {
      busy = false; setBusy(false);
      reply("Beleza. Quando quiser, é só mandar uma mensagem que eu baixo.");
      return;
    }
    try { await loadBrain(tier); }
    catch (e) {
      busy = false; setBusy(false);
      reply("Não consegui carregar o cérebro neste aparelho. " + String(e.message || e).slice(0, 160));
      return;
    }
  }

  setPhase("thinking"); caption("");
  const isQwen3 = /Qwen3/.test(loadedModel || "");
  const messages = [{ role: "system", content: systemPrompt(text) }, ...EXAMPLES,
    ...history.slice(-9, -1).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: text }];
  let out = "", shown = "";
  Speech.begin();
  try {
    const stream = await engine.chat.completions.create({
      messages, stream: true, temperature: 0.45, top_p: 0.85, max_tokens: 320,
      ...(isQwen3 ? { extra_body: { enable_thinking: false } } : {}),
    });
    for await (const chunk of stream) {
      out += chunk.choices[0]?.delta?.content || "";
      shown = cleanReply(out);
      caption(shown);
      Speech.feed(shown);
    }
  } catch (e) {
    if (!/interrupt|abort/i.test(String(e))) shown = shown || "Travei aqui. Tenta de novo?";
  }
  shown = cleanReply(out) || shown || "…";
  addTurn("assistant", shown);
  busy = false; setBusy(false);
  await Speech.finish(shown);
  setPhase("idle");
  fadeCaption();
}

function cleanReply(t) {
  return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/\*\*|__|#+\s|`/g, "").replace(/^\s+/, "");
}

async function reply(text) {
  addTurn("assistant", text);
  caption(text);
  Speech.begin();
  await Speech.finish(text);
  setPhase("idle");
  fadeCaption();
}

function addTurn(role, content) {
  history.push({ role, content });
  history = history.slice(-40);
  store.set("history", history);
  renderTranscript();
}

/* ── speaking: sentence by sentence while the answer is still arriving ── */
const MALE = /felipe|daniel|antonio|ricardo|eduardo|macerio|humberto/i;
const GOOD = /premium|melhorad|enhanced|natural|neural/i;
function ptVoices() {
  const all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return all.filter((v) => /^pt/i.test(v.lang)).map((v) => ({ v,
    s: (/pt[-_]BR/i.test(v.lang) ? 8 : 0) + (GOOD.test(v.name) ? 4 : 0) + (MALE.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0) }))
    .sort((a, b) => b.s - a.s).map((x) => x.v);
}
function chosenVoice() {
  const list = ptVoices(), name = store.get("voice", "");
  return list.find((v) => v.name === name) || list[0] || null;
}
let voiceUnlocked = false;
function unlockVoice() {
  // iOS only lets a page speak after a speech call made inside a tap
  if (voiceUnlocked || !window.speechSynthesis) return;
  voiceUnlocked = true;
  const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u);
}

const Speech = {
  said: 0, queue: [], token: 0, playing: false, done: null,
  begin() { this.cancel(); this.said = 0; this.queue = []; },
  feed(full) {
    if (!store.get("speak", true)) return;
    const rest = full.slice(this.said);
    const m = /^([\s\S]{30,}?[.!?…]+)\s/.exec(rest);
    if (m) { this.said += m[0].length; this.push(m[1]); }
  },
  push(text) { if (text.trim()) { this.queue.push(text.trim()); this.pump(); } },
  pump() {
    if (this.playing || !window.speechSynthesis) return;
    const text = this.queue.shift();
    if (!text) { if (this.done) { const d = this.done; this.done = null; d(); } return; }
    const token = this.token;
    this.playing = true; setPhase("speaking");
    const u = new SpeechSynthesisUtterance(text);
    const v = chosenVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "pt-BR";
    u.rate = 1.02; u.pitch = 1;
    u.onboundary = () => orb && orb.kick(0.5);
    const end = () => { if (token !== this.token) return; this.playing = false; if (busy) setPhase("thinking"); this.pump(); };
    u.onend = end; u.onerror = end;
    speechSynthesis.speak(u);
  },
  finish(full) {
    if (store.get("speak", true)) { const rest = (full || "").slice(this.said).trim(); if (rest) this.queue.push(rest); }
    this.said = (full || "").length;
    return new Promise((res) => { this.done = res; this.pump(); });
  },
  cancel() { this.token++; this.playing = false; this.queue = []; if (window.speechSynthesis) speechSynthesis.cancel(); if (this.done) { const d = this.done; this.done = null; d(); } },
};

/* ── listening: tap the mic, speak, it sends when you stop ── */
let rec = null;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { hint("Este navegador não reconhece fala. Digite a mensagem.", "warn"); return; }
  if (rec) { rec.stop(); return; }
  unlockVoice(); Speech.cancel();
  rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false;
  let finalText = "";
  rec.onstart = () => { setPhase("listening"); $("#btnMic").classList.add("live"); $("#btnMic").setAttribute("aria-pressed", "true"); };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    caption(finalText + interim);
  };
  rec.onerror = (e) => {
    if (e.error === "network") hint("O ditado do iPhone precisou de internet. Sem rede, digite a mensagem.", "warn");
    else if (e.error === "not-allowed" || e.error === "service-not-allowed") hint("Microfone bloqueado. Libere em Ajustes do iPhone → Safari → Microfone.", "warn");
    else if (e.error !== "no-speech" && e.error !== "aborted") hint("Não entendi o áudio. Tenta de novo?", "warn");
  };
  rec.onend = () => {
    rec = null; $("#btnMic").classList.remove("live"); $("#btnMic").setAttribute("aria-pressed", "false");
    if (!busy) setPhase("idle");
    if (finalText.trim()) send(spokenDates(finalText));
  };
  try { rec.start(); } catch { rec = null; }
}

/* ── interface ── */
let orb = null, phase = "idle";
const PHASES = { idle: ["idle", "Pronto"], loading: ["thinking", "Carregando"], thinking: ["thinking", "Pensando"],
  speaking: ["speaking", "Falando"], listening: ["listening", "Ouvindo"] };
function setPhase(p) {
  phase = p;
  const [state, label] = PHASES[p] || PHASES.idle;
  document.body.dataset.phase = state;
  $("#phaseText").textContent = label;
  $("#phaseDot").className = "dot" + (state === "idle" ? "" : " hot");
  if (orb) orb.setState(state);
}
let capTimer = 0;
function caption(t) { clearTimeout(capTimer); const el = $("#caption"); el.classList.remove("fade"); el.textContent = t.length > 220 ? "…" + t.slice(-220).replace(/^\S*\s/, "") : t; }
function fadeCaption() { clearTimeout(capTimer); capTimer = setTimeout(() => $("#caption").classList.add("fade"), 6000); }
function hint(t, kind) { const el = $("#hint"); el.textContent = t || ""; el.className = "hint" + (kind ? " " + kind : ""); }
function showProgress(p) {
  const bar = $("#progress");
  if (p == null) { bar.hidden = true; return; }
  bar.hidden = false; $("#progressFill").style.width = Math.round(p * 100) + "%";
}
function syncAsk() { $("#askbar").classList.toggle("has-text", !!$("#ask").value.trim()); }
function setBusy(on) {
  $("#askbar").classList.toggle("busy", on);
  $("#btnStop").hidden = !on;
}

function renderTranscript() {
  $("#transcript").innerHTML = history.map((t) =>
    `<div class="bubble ${t.role === "user" ? "me" : "jarvis"}">${esc(t.content)}</div>`).join("");
  $("#convoEmpty").hidden = history.length > 0;
  $("#btnClearConvo").hidden = !history.length;
  const last = $("#transcript").lastElementChild; if (last) last.scrollIntoView({ block: "end" });
}

function renderNotes() {
  const q = norm($("#memSearch").value);
  const list = notes().filter((n) => !q || norm(n.title + " " + n.text).includes(q));
  $("#memCount").textContent = notes().length ? notes().length + (notes().length === 1 ? " nota" : " notas") : "";
  $("#memEmpty").hidden = list.length > 0;
  $("#notes").innerHTML = list.map((n) => `<article><header><h4>${esc(n.title)}</h4><time>${esc(new Date(n.date + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" }))}</time></header><p>${esc(n.text)}</p><button class="del" data-id="${n.id}">Apagar</button></article>`).join("");
}

async function renderSettings() {
  const tier = store.get("tier", "equilibrado");
  document.querySelectorAll("#tierSeg button").forEach((b) => {
    const on = b.dataset.tier === tier; b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
  });
  const id = modelFor(tier);
  const cached = await isCached(id);
  $("#brainInfo").textContent = !gpuOk ? "Este aparelho não liberou a placa de vídeo para o navegador: sem cérebro local aqui."
    : `${TIERS[tier].label}: cerca de ${sizeGB(id)} GB. ${tier === "leve" ? "Mais rápido, mas erra bem mais. " : ""}${loadedModel === id ? "Carregado e pronto, sem internet." : cached ? "Já baixado: funciona sem internet." : "Ainda não baixado: ele baixa na primeira conversa."}`;
  const sel = $("#voicePick"), list = ptVoices(), pick = store.get("voice", "");
  sel.innerHTML = `<option value="">Automática</option>` + list.map((v) => `<option${v.name === pick ? " selected" : ""} value="${esc(v.name)}">${esc(v.name)}${v.localService ? "" : " (online)"}</option>`).join("");
  $("#speakOn").checked = store.get("speak", true);
  $("#aboutMe").value = store.get("about", "");
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $("#storageInfo").textContent = `Usando ${(usage / 1073741824).toFixed(2).replace(".", ",")} GB de ${(quota / 1073741824).toFixed(1).replace(".", ",")} GB disponíveis.` + (persisted ? " Guardado de forma permanente." : "");
  }
}

const Sheet = {
  open() { $("#sheet").hidden = false; $("#scrim").hidden = false; $("#sheet").classList.remove("closing"); document.body.classList.add("sheet-open"); $("#btnMenu").setAttribute("aria-expanded", "true"); renderSettings(); },
  close() {
    if ($("#sheet").hidden) return;
    $("#sheet").classList.add("closing"); $("#scrim").classList.add("closing"); document.body.classList.remove("sheet-open");
    setTimeout(() => { $("#sheet").hidden = true; $("#scrim").hidden = true; $("#sheet").classList.remove("closing"); $("#scrim").classList.remove("closing"); }, 200);
    $("#btnMenu").setAttribute("aria-expanded", "false");
  },
  show(tab) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.dataset.pane === tab));
  },
};

/* ── start ── */
async function start() {
  orb = new Orb($("#orbCanvas"), $("#orbGlow"));
  setPhase("idle");
  renderTranscript(); renderNotes();

  $("#ask").addEventListener("input", syncAsk);
  $("#ask").addEventListener("keydown", (e) => { if (e.key === "Enter") send($("#ask").value); });
  $("#btnSend").onclick = () => send($("#ask").value);
  $("#btnMic").onclick = toggleMic;
  $("#btnStop").onclick = () => { try { engine && engine.interruptGenerate(); } catch {} Speech.cancel(); };
  $("#btnMenu").onclick = () => ($("#sheet").hidden ? Sheet.open() : Sheet.close());
  $("#btnClose").onclick = Sheet.close; $("#scrim").onclick = Sheet.close;
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => Sheet.show(b.dataset.tab)));
  $("#memSearch").addEventListener("input", renderNotes);
  $("#notes").addEventListener("click", (e) => {
    const b = e.target.closest(".del"); if (!b) return;
    saveNotes(notes().filter((n) => String(n.id) !== b.dataset.id));
  });
  $("#btnClearConvo").onclick = () => { if (confirm("Apagar a conversa deste celular?")) { history = []; store.set("history", history); renderTranscript(); } };
  document.querySelectorAll("#tierSeg button").forEach((b) => (b.onclick = async () => {
    store.set("tier", b.dataset.tier); renderSettings();
    if (engine && !busy) { hint("Trocando de cérebro…"); try { await loadBrain(b.dataset.tier, { fallback: false }); } catch (e) { hint("Esse não coube neste aparelho.", "warn"); } }
  }));
  $("#voicePick").onchange = (e) => { store.set("voice", e.target.value); unlockVoice(); Speech.begin(); Speech.finish("Oi, Gê! É assim que eu vou falar com você."); };
  $("#speakOn").onchange = (e) => store.set("speak", e.target.checked);
  $("#btnSaveAbout").onclick = () => { store.set("about", $("#aboutMe").value.trim()); hint("Guardado. O Neo vai levar isso em conta."); setTimeout(() => hint(""), 2500); };
  $("#btnForget").onclick = async () => {
    if (!confirm("Apagar o cérebro baixado? Para voltar a conversar sem internet, ele terá que ser baixado de novo.")) return;
    try { if (engine) await engine.unload(); } catch {}
    engine = null; loadedModel = null;
    for (const t of Object.values(TIERS)) for (const id of t.models) { try { await webllm.deleteModelAllInfoInCache(id); } catch {} }
    renderSettings(); hint("Cérebro apagado.");
  };
  if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", renderSettings);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  gpuOk = await probeGPU();
  if (!gpuOk) { hint("Este aparelho não liberou a placa de vídeo para o navegador. No iPhone: iOS 26 ou mais novo, pelo Safari.", "warn"); return; }
  // If the brain is already on the phone, wake it now so the first answer is quick.
  const tier = store.get("tier", "equilibrado");
  if (await isCached(modelFor(tier))) loadBrain(tier).catch(() => hint("Não consegui acordar o cérebro. Tente fechar e abrir o app.", "warn"));
  else hint("Mande uma mensagem para começar. Na primeira vez, o Neo baixa o cérebro (use o Wi-Fi).");
}
start();
