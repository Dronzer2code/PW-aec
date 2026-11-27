/**
 * Action Cards created in this browser tab. Kept in memory and mirrored to sessionStorage,
 * which the browser clears when the tab closes. Nothing is sent to or stored on the server.
 */

const KEY = 'lifebridge.cards.v1';
const ID_RE = /^[\w-]{1,64}$/;

const isEntry = (v) => Boolean(v) && typeof v === 'object' && ID_RE.test(String(v.id)) &&
  Number.isFinite(v.createdAt) && Boolean(v.card) && typeof v.card === 'object';

/**
 * @param {Storage | null | undefined} storage Usually `sessionStorage`; may be unavailable or throw.
 * @param {{ max?: number }} [options] Oldest cards beyond `max` are dropped.
 */
export function createCardStore(storage, { max = 25 } = {}) {
  /** @type {{ id: string, createdAt: number, card: any }[]} */
  let items = [];
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? '[]');
    items = Array.isArray(saved) ? saved.filter(isEntry).slice(0, max) : [];
  } catch {
    items = []; // corrupt or blocked storage: start empty
  }

  const save = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(items));
    } catch {
      // quota exceeded or storage blocked: keep the in-memory copy only
    }
  };

  return {
    /**
     * Adds a card and returns its URL-safe id (from the request id when possible).
     * @param {any} card
     * @param {number} [now]
     * @returns {string}
     */
    add(card, now = Date.now()) {
      const base = String(card?.meta?.requestId ?? '').replace(/[^\w-]/g, '').slice(0, 48) || `card-${now.toString(36)}`;
      let id = base;
      for (let n = 2; items.some((i) => i.id === id); n++) id = `${base}-${n}`;
      items = [{ id, createdAt: now, card }, ...items].slice(0, max);
      save();
      return id;
    },
    /** @param {string} id */
    get: (id) => items.find((i) => i.id === id) ?? null,
    /** Newest first. */
    list: () => items.slice(),
  };
}
