import { normalizeDomain } from "./domains.js";

export const DEFAULT_SETTINGS = { surfSeconds: 90, breathPattern: "box", whyStatement: "" };
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
  };
}
