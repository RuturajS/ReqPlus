// ReqPlus Session Store – IndexedDB wrapper
const DB_NAME = 'reqplus_db';
const DB_VERSION = 1;
const STORE_NAME = 'requests';

class SessionStoreClass {
    constructor() {
        this._db = null;
        this._cache = new Map(); // in-memory cache for speed
        this._initPromise = this._init();
    }

    _init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('host', 'host', { unique: false });
                    store.createIndex('method', 'method', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
            };

            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve();
            };

            req.onerror = () => reject(req.error);
        });
    }

    async _ready() {
        await this._initPromise;
    }

    async saveRequest(entry) {
        await this._ready();
        this._cache.set(entry.id, entry);
        return this._put(entry);
    }

    async updateRequest(id, updates) {
        await this._ready();
        const existing = this._cache.get(id) || await this._get(id);
        if (!existing) return;
        const updated = { ...existing, ...updates };
        this._cache.set(id, updated);
        return this._put(updated);
    }

    getById(id) {
        return this._cache.get(id);
    }

    async getAll() {
        await this._ready();
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const idx = store.index('timestamp');
            const req = idx.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async clearAll() {
        await this._ready();
        this._cache.clear();
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async exportAll() {
        const all = await this.getAll();
        return JSON.stringify({ version: 1, exported: Date.now(), requests: all }, null, 2);
    }

    async importAll(jsonStr) {
        await this._ready();
        const data = JSON.parse(jsonStr);
        const requests = data.requests || [];
        this._cache.clear();
        const tx = this._db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        for (const entry of requests) {
            store.put(entry);
            this._cache.set(entry.id, entry);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async deleteRequest(id) {
        await this._ready();
        this._cache.delete(id);
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    _put(entry) {
        return new Promise((resolve, reject) => {
            if (!this._db) return reject(new Error('DB not ready'));
            const tx = this._db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(entry);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    _get(id) {
        return new Promise((resolve, reject) => {
            if (!this._db) return resolve(null);
            const tx = this._db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }
}

export const SessionStore = new SessionStoreClass();
