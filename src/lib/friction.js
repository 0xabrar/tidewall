export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
export const CONFIRM_PHRASE = "I am choosing to remove this";
export function startCooldown(change, now, durationMs = DEFAULT_COOLDOWN_MS) {
  return { ...change, unlockAt: now + durationMs };
}
export function isUnlocked(pending, now) {
  return !!pending && now >= pending.unlockAt;
}
export function confirmPhraseMatches(input) {
  return typeof input === "string" && input.trim() === CONFIRM_PHRASE;
}
