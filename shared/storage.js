export class Storage {
  static dbName = 'HaE_Lite_DB';
  static version = 1;
  static db = null;

  static async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('requests')) {
          const s = db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
          s.createIndex('timestamp', 'timestamp', { unique: false });
          s.createIndex('url', 'url', { unique: false });
          s.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('rules')) {
          db.createObjectStore('rules', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
      };
    });
  }

  static async saveRequest(requestData, matches) {
    const tx = this.db.transaction(['requests'], 'readwrite');
    const store = tx.objectStore('requests');
    const record = {
      ...requestData,
      matches: matches || [],
      categories: [...new Set((matches || []).map((m) => m.category))],
      timestamp: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const r = store.add(record);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  static async queryHistory(filter = {}, limit = 100) {
    const tx = this.db.transaction(['requests'], 'readonly');
    const store = tx.objectStore('requests');
    const req = store.openCursor(null, 'prev');
    return new Promise((resolve, reject) => {
      const results = [];
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor || results.length >= limit) return resolve(results);
        const rec = cursor.value;
        if (this._match(rec, filter)) results.push(rec);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  static _match(record, filter) {
    if (filter.url && !String(record.url || '').includes(filter.url)) return false;
    if (filter.category && !(record.categories || []).includes(filter.category)) return false;
    if (filter.method && String(record.method || '') !== String(filter.method)) return false;
    return true;
  }

  static async cleanExpired(expireTime) {
    const cutoff = Date.now() - expireTime;
    const tx = this.db.transaction(['requests'], 'readwrite');
    const store = tx.objectStore('requests');
    const idx = store.index('timestamp');
    const range = IDBKeyRange.upperBound(cutoff);
    const req = idx.openCursor(range);
    req.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }

  static async exportData(ids = []) {
    const tx = this.db.transaction(['requests'], 'readonly');
    const store = tx.objectStore('requests');
    const out = [];
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return resolve(JSON.stringify(out, null, 2));
        const rec = cursor.value;
        if (!ids.length || ids.includes(rec.id)) out.push(rec);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  static async clearHistory() {
    const tx = this.db.transaction(['requests'], 'readwrite');
    const store = tx.objectStore('requests');
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async getRules() {
    const tx = this.db.transaction(['rules'], 'readonly');
    const store = tx.objectStore('rules');
    return new Promise((resolve) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => resolve([]);
    });
  }

  static async saveRule(rule) {
    const tx = this.db.transaction(['rules'], 'readwrite');
    const store = tx.objectStore('rules');
    return new Promise((resolve, reject) => {
      const r = store.put(rule);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async deleteRule(ruleId) {
    const tx = this.db.transaction(['rules'], 'readwrite');
    const store = tx.objectStore('rules');
    return new Promise((resolve, reject) => {
      const r = store.delete(ruleId);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async getConfig() {
    const tx = this.db.transaction(['config'], 'readonly');
    const store = tx.objectStore('config');
    return new Promise((resolve) => {
      const req = store.get('enabledRules');
      req.onsuccess = () => resolve(req.result || { key: 'enabledRules', enabledRules: [] });
      req.onerror = () => resolve({ key: 'enabledRules', enabledRules: [] });
    });
  }

  static async setConfig({ key, value }) {
    const tx = this.db.transaction(['config'], 'readwrite');
    const store = tx.objectStore('config');
    return new Promise((resolve, reject) => {
      const r = store.put({ key, enabledRules: value });
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  // 通用配置标记读写（用于禁用默认规则等）
  static async getFlag(key) {
    const tx = this.db.transaction(['config'], 'readonly');
    const store = tx.objectStore('config');
    return new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        const rec = req.result;
        resolve(rec ? !!rec.value : false);
      };
      req.onerror = () => resolve(false);
    });
  }

  static async setFlag(key, value) {
    const tx = this.db.transaction(['config'], 'readwrite');
    const store = tx.objectStore('config');
    return new Promise((resolve, reject) => {
      const r = store.put({ key, value: !!value });
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  // 泛型值读写（对象/数组/字符串等）
  static async getValue(key, defaultValue = null) {
    const tx = this.db.transaction(['config'], 'readonly');
    const store = tx.objectStore('config');
    return new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        const rec = req.result;
        resolve(rec && 'value' in rec ? rec.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  }

  static async setValue(key, value) {
    const tx = this.db.transaction(['config'], 'readwrite');
    const store = tx.objectStore('config');
    return new Promise((resolve, reject) => {
      const r = store.put({ key, value });
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }
}
