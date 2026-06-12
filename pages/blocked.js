// ClearHead — block / intervention page behavior.
// Runs in a normal extension-page realm, so chrome.runtime.sendMessage to the
// background service worker fires onMessage natively (cross-realm).

import { makeStore } from "../src/lib/storage.js";

const FALLBACK_SECONDS = 90;

const els = {
  ring: document.getElementById("ring"),
  time: document.getElementById("time"),
  breath: document.getElementById("breath"),
  why: document.getElementById("why"),
  chips: document.getElementById("chips"),
  next: document.getElementById("next"),
  foot: document.getElementById("foot"),
};

// Breathing patterns: [phase label, seconds]. The block-page ring pulse is timed
// to one full cycle, and the cue word walks the phases so the page actually
// guides the chosen pattern (the toggle in Settings drives this).
const BREATH_PATTERNS = {
  box: [["Breathe in", 4], ["Hold", 4], ["Breathe out", 4], ["Hold", 4]],
  "478": [["Breathe in", 4], ["Hold", 7], ["Breathe out", 8]],
};

function startBreathing(pattern) {
  const phases = BREATH_PATTERNS[pattern] || BREATH_PATTERNS.box;
  const total = phases.reduce((sum, [, secs]) => sum + secs, 0);
  els.ring?.style.setProperty("--breath-duration", `${total}s`);
  let i = 0;
  const step = () => {
    const [label, secs] = phases[i % phases.length];
    els.breath.textContent = label;
    i += 1;
    setTimeout(step, secs * 1000);
  };
  step();
}

// Best-effort message send; the page must never crash if the worker is asleep
// or messaging rejects.
function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

async function init() {
  // 1. Record the encounter (our only signal that a block happened).
  send({ type: "encounter" });

  const store = makeStore();

  // 2. Settings: why statement + countdown length + breathing pattern (safe fallbacks).
  let surfSeconds = FALLBACK_SECONDS;
  let breathPattern = "box";
  try {
    const settings = await store.getSettings();
    els.why.textContent = settings?.whyStatement || "";
    const n = Number(settings?.surfSeconds);
    if (Number.isFinite(n) && n > 0) surfSeconds = n;
    if (settings?.breathPattern) breathPattern = settings.breathPattern;
  } catch {
    els.why.textContent = "";
  }

  startBreathing(breathPattern);

  // 3. Footer stat line.
  try {
    const stats = await store.getStats();
    const surfed = Number(stats?.surfsCompleted) || 0;
    els.foot.textContent = `${surfed} urges surfed`;
  } catch {
    els.foot.textContent = "0 urges surfed";
  }

  // 4. Countdown — tick once per second; on reaching 0, stop + record surf.
  let remaining = surfSeconds;
  els.time.textContent = formatTime(remaining);

  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      els.time.textContent = formatTime(0);
      clearInterval(interval);
      send({ type: "surf-complete" });
      return;
    }
    els.time.textContent = formatTime(remaining);
  }, 1000);

  // 5. Trigger chips — select + record the trigger by its text.
  els.chips.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !els.chips.contains(btn)) return;
    btn.classList.add("selected");
    send({ type: "trigger", name: btn.textContent.trim() });
  });
}

init();
