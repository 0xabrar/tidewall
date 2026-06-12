// Tidewall — block / intervention page.
// Progressive disclosure state machine: breathe -> trigger -> action -> done.
// Only anonymous trigger tallies are stored (CBT self-monitoring); the chosen
// action and free text are NOT stored. Runs in an extension-page realm, so
// chrome.runtime.sendMessage reaches the worker natively.

import { makeStore } from "../src/lib/storage.js";

const FALLBACK_SECONDS = 90;

const els = {
  wrap: document.querySelector(".wrap"),
  stages: [...document.querySelectorAll(".stage")],
  beginBtn: document.getElementById("beginBtn"),
  breath: document.getElementById("breathWrap"),
  core: document.getElementById("breathCore"),
  glow: document.getElementById("breathGlow"),
  word: document.getElementById("breathWord"),
  dots: document.getElementById("dots"),
  chips: document.getElementById("chips"),
  actions: document.getElementById("actions"),
  next: document.getElementById("next"),
  why: document.getElementById("why"),
  breathWhy: document.getElementById("breathWhy"),
  doneAction: document.getElementById("doneAction"),
  doneStatNum: document.getElementById("doneStatNum"),
};

// Count a number up from 0 to `to` (easeOutCubic) — the done-screen reward.
// Starts after the stage has eased in, so the count reads cleanly on its own
// instead of running underneath the entrance animation.
function animateCount(el, to, ms = 900) {
  if (!el) return;
  el.textContent = "0";
  setTimeout(() => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(to * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 450);
}

// Breath phases per pattern: [label, seconds, expanded].
// "expanded" drives the circle + glow via the .expanded class; each phase's
// transition duration is set inline so inhale/exhale ease over their full
// length — one rhythm shared by every animated element on screen.
const PATTERNS = {
  box: [
    ["Breathe in", 4, true],
    ["Hold", 4, true],
    ["Breathe out", 4, false],
    ["Hold", 4, false],
  ],
  478: [
    ["Breathe in", 4, true],
    ["Hold", 7, true],
    ["Breathe out", 8, false],
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

  // progress dots (soft, no numbers — no clock anxiety)
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
    els.word.style.opacity = "0.25";
    setTimeout(() => {
      els.word.textContent = text;
      els.word.style.opacity = "1";
    }, 220);
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
    const [label, secs, expanded] = phases[phaseIdx++];
    setWord(label);
    const duration = `${secs}s`;
    els.core.style.transitionDuration = duration;
    els.glow.style.transitionDuration = duration;
    els.breath.classList.toggle("expanded", expanded);
    setTimeout(step, secs * 1000);
  };
  step();
}

// ---- Flow ---------------------------------------------------------------

async function init() {
  // "self" mode = a breathing session the user started themselves from Settings
  // (not a blocked-site redirect). Don't count it as an encounter, and use
  // gentler, non-relapse intro copy.
  const selfMode = new URLSearchParams(location.search).get("mode") === "self";
  if (!selfMode) send({ type: "encounter" });
  if (selfMode) {
    const title = document.querySelector(".intro-title");
    const sub = document.querySelector(".intro-sub");
    if (title) title.textContent = "Let's take a few breaths.";
    if (sub) sub.textContent = "A moment to slow down and clear your head.";
  }

  const store = makeStore();
  let surfSeconds = FALLBACK_SECONDS;
  let breathPattern = "478";
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

  // Surface the user's "why" during the breathing (the long contemplative phase)
  // as well as on the action step. It's their reason — keep it in view.
  if (whyStatement) {
    els.why.textContent = `Remember: ${whyStatement}`;
    if (els.breathWhy) els.breathWhy.textContent = whyStatement;
  }

  // Stage 0 -> 1: the person eases in and taps Begin to start the breathing.
  // (Breathing never auto-starts — starting it is their first small choice.)
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    goState("breathe");
    startBreathing(breathPattern, surfSeconds, () => {
      send({ type: "surf-complete" });
      surfed += 1;
      goState("trigger");
    });
  };
  els.beginBtn.addEventListener("click", begin);

  // Stage 2: what's going on? — record the trigger (anonymous tally only).
  els.chips.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !els.chips.contains(btn)) return;
    btn.classList.add("selected");
    send({ type: "trigger", name: btn.textContent.trim() });
    setTimeout(() => goState("action"), 240);
  });

  // Stage 3: do one thing instead — NOT stored (acknowledge only). We keep the
  // chosen action only in memory, to close the loop on the done screen.
  let chosenAction = "";
  const toDone = () => {
    if (chosenAction && els.doneAction) {
      els.doneAction.textContent = `When you're ready, ${chosenAction.toLowerCase()}.`;
    }
    animateCount(els.doneStatNum, surfed); // count up the total as the reward
    goState("done");
  };
  els.actions.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !els.actions.contains(btn)) return;
    btn.classList.add("selected");
    chosenAction = btn.textContent.trim();
    setTimeout(toDone, 240);
  });
  els.next.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && els.next.value.trim()) {
      chosenAction = els.next.value.trim();
      toDone();
    }
  });

  // Minimal namespaced handle so the e2e harness can drive states without
  // waiting out a full real-time breathing session. Inert in normal use.
  window.__tidewall = { go: goState, begin };
}

init();
