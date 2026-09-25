import { CABINETS } from './tables.generated';

const STORAGE_KEY = 'klabak.collection.v1';

export type Collection = Record<string, number>; // charm key -> times won

export function loadCollection(): Collection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Collection;
  } catch {
    return {};
  }
}

export function saveCollection(value: Collection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Sandboxed iframes can refuse storage; the shelf is cosmetic, so ignore.
  }
}

export function allCharms(): { key: string; prize: string; cabinet: number; tier: number }[] {
  const charms: { key: string; prize: string; cabinet: number; tier: number }[] = [];
  CABINETS.forEach(cabinet => {
    cabinet.tiers.forEach(tier => {
      if (tier.charm) charms.push({ key: tier.charm, prize: tier.prize, cabinet: cabinet.id, tier: tier.tier });
    });
  });
  return charms;
}

export function shelfCompletion(collection: Collection): number {
  const charms = allCharms();
  const owned = charms.filter(c => (collection[c.key] ?? 0) > 0).length;
  return charms.length === 0 ? 0 : (owned / charms.length) * 100;
}
