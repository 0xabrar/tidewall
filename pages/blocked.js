// ClearHead — block / intervention page.
// Progressive disclosure state machine: breathe -> trigger -> action -> done.
// Only anonymous trigger tallies are stored (CBT self-monitoring); the chosen
// action and free text are NOT stored. Runs in an extension-page realm, so
// chrome.runtime.sendMessage reaches the worker natively.

import { makeStore } from "../src/lib/storage.js";

const FALLBACK_SECONDS = 90;

const els = {
  wrap: document.querySelector(".wrap"),
  stages: [...document.querySelectorAll(".stage")],
  core: document.getElementById("breathCore"),
  word: document.getElementById("breathWord"),
  dots: document.getElementById("dots"),
  chips: document.getElementById("chips"),
  actions: document.getElementById("actions"),
  next: document.getElementById("next"),
  why: document.getElementById("why"),
  foot: document.getElementById("foot"),
};

// Breath phases per pattern: [label, seconds, scale, expanded-glow].
const PATTERNS = {
  box: [
    ["Breathe in", 4, 1.45, true],
    ["Hold", 4, 1.45, true],
    ["Breathe out", 4, 1.0, false],
    ["Hold", 4, 1.0, false],
  ],
  478: [
    ["Breathe in", 4, 1.45, true],
    ["Hold", 7, 1.45, true],
    ["Breathe out", 8, 1.0, false],
  ],
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function goState(name) {
  els.wrap.dataset.state = name;
  for (const stage of els.stages) stage.hidden = stage.dataset.stage !== name;
}

// ---- Breathing ----------------------------------------------------------

function startBreathing(pattern, surfSeconds, onComplete) {
  const phases = PATTERNS[pattern] || PATTERNS.box;
  const cycleSeconds = phases.reduce((sum, p) => sum + p[1], 0);
  const totalCycles = clamp(Math.round(surfSeconds / cycleSeconds), 2, 8);

  // progress dots (soft, no numbers — no anxiety-inducing clock)
  els.dots.replaceChildren(
    ...Array.from({ length: totalCycles }, () => {
      const d = document.createElement("span");
      d.className = "dot";
      return d;
    })
  );
  const paintDots = (active) => {
    [...els.dots.children].forEach((d, i) => {
      d.classList.toggle("done", i < active);
      d.classList.toggle("active", i === active);
    });
  };

  const setWord = (text) => {
    els.word.style.opacity = "0.3";
    setTimeout(() => {
      els.word.textContent = text;
      els.word.style.opacity = "1";
    }, 200);
  };

  let cycle = 0;
  let phaseIdx = 0;
  paintDots(0);

  const step = () => {
    if (phaseIdx >= phases.length) {
      phaseIdx = 0;
      cycle += 1;
      paintDots(cycle);
      if (cycle >= totalCycles) {
        onComplete();
        return;
      }
    }
    const [label, secs, scale, expanded] = phases[phaseIdx++];
    setWord(label);
    els.core.style.transitionDuration = `${secs}s`;
    els.core.style.transform = `scale(${scale})`;
    els.core.classList.toggle("expanded", expanded);
    setTimeout(step, secs * 1000);
  };
  step();
}

// ---- Flow ---------------------------------------------------------------

async function init() {
  send({ type: "encounter" });

  const store = makeStore();
  let surfSeconds = FALLBACK_SECONDS;
  let breathPattern = "box";
  let whyStatement = "";
  let surfed = 0;
  try {
    const settings = await store.getSettings();
    const n = Number(settings?.surfSeconds);
    if (Number.isFinite(n) && n > 0) surfSeconds = n;
    if (settings?.breathPattern) breathPattern = settings.breathPattern;
    whyStatement = settings?.whyStatement || "";
  } catch {}
  try {
    surfed = Number((await store.getStats())?.surfsCompleted) || 0;
  } catch {}

  if (whyStatement) els.why.textContent = `Remember: ${whyStatement}`;

  // Stage 1: breathe, then reveal the questioning (only after breathing).
  startBreathing(breathPattern, surfSeconds, () => {
    send({ type: "surf-complete" });
    goState("trigger");
  });

  // Stage 2: what's going on? — record the trigger (anonymous tally only).
  els.chips.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !els.chips.contains(btn)) return;
    btn.classList.add("selected");
    send({ type: "trigger", name: btn.textContent.trim() });
    setTimeout(() => goState("action"), 240);
  });

  // Stage 3: do one thing instead — NOT stored (acknowledge only).
  const toDone = () => {
    els.foot.textContent = `${surfed} urges surfed`;
    goState("done");
  };
  els.actions.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !els.actions.contains(btn)) return;
    btn.classList.add("selected");
    setTimeout(toDone, 240);
  });
  els.next.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && els.next.value.trim()) toDone();
  });

  // Minimal namespaced handle so the e2e harness can drive states without
  // waiting out a full real-time breathing session. Inert in normal use.
  window.__clearhead = { go: goState };
}

init();
