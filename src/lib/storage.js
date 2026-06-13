import { normalizeDomain } from "./domains.js";

// Default to 4-7-8: the extended exhale drives a stronger parasympathetic /
// vagal response than equal-phase box breathing, so it's the better default for
// an acute urge moment. (Box stays available as the gentler option.)
export const DEFAULT_SETTINGS = { surfSeconds: 90, breathPattern: "478", whyStatement: "" };
const DEFAULT_STATS = { encounters: 0, surfsCompleted: 0, triggers: {} };

export function makeStore(chromeStorage = globalThis.chrome?.storage) {
  const local = chromeStorage.local;
  async function get(key, fallback) {
    const res = await local.get([key]);
    return res[key] ?? fallback;
  }
  return {
    async getDomains() { return await get("userDomains", []); },
    async addDomain(input) {
      const host = normalizeDomain(input);
      if (!host) return { ok: false, error: "invalid" };
      const domains = await this.getDomains();
      if (!domains.includes(host)) await local.set({ userDomains: [...domains, host] });
      return { ok: true, host };
    },
    async removeDomain(host) {
      const domains = await this.getDomains();
      await local.set({ userDomains: domains.filter(d => d !== host) });
    },
    async getSettings() { return { ...DEFAULT_SETTINGS, ...(await get("settings", {})) }; },
    async setSettings(patch) {
      await local.set({ settings: { ...(await this.getSettings()), ...patch } });
    },
    async getStats() { return { ...DEFAULT_STATS, ...(await get("stats", {})) }; },
    async recordEncounter() {
      const s = await this.getStats();
      await local.set({ stats: { ...s, encounters: s.encounters + 1 } });
    },
    async recordSurf() {
      const s = await this.getStats();
      await local.set({ stats: { ...s, surfsCompleted: s.surfsCompleted + 1 } });
    },
    async recordTrigger(name) {
      const s = await this.getStats();
      await local.set({ stats: { ...s, triggers: { ...s.triggers, [name]: (s.triggers[name] || 0) + 1 } } });
    },
    async getPendingUnlock() { return await get("pendingUnlock", null); },
    async setPendingUnlock(p) { await local.set({ pendingUnlock: p }); },
    // Theme is its own top-level key (not inside settings) so the toggle never
    // races the settings object. "light" (default) or "dark".
    async getTheme() { return await get("theme", "light"); },
    async setTheme(t) { await local.set({ theme: t === "dark" ? "dark" : "light" }); },
  };
}
