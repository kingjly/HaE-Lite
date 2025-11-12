export class Storage {
  static dbName = 'HaE_Lite_DB';
  static version = 1;
  static db = null;
  static useChrome = false; // 回退到 chrome.storage.local 模式

  // 简易 Promise 封装 chrome.storage.local
  static async _getLocal(key, defaultValue = null) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (res) => {
          if (res && Object.prototype.hasOwnProperty.call(res, key)) {
            resolve(res[key]);
          } else {
            resolve(defaultValue);
          }
        });
      } catch {
        resolve(defaultValue);
      }
    });
  }

  static async _setLocal(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve(true));
      } catch {
        resolve(false);
      }
    });
  }

  static async _getLocalArray(key) {
    const v = await this._getLocal(key, []);
    return Array.isArray(v) ? v : [];
  }

  static async init() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, this.version);
        req.onerror = () => {
          // 回退到 chrome.storage.local，避免初始化失败导致整个扩展报错
          this.useChrome = true;
          this.db = null;
          console.warn(
            '[Storage] IndexedDB init failed, fallback to chrome.storage.local:',
            req.error
          );
          resolve();
        };
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
      } catch (e) {
        // indexedDB 不可用（极少数环境），直接回退
        this.useChrome = true;
        this.db = null;
        console.warn('[Storage] IndexedDB not available, fallback to chrome.storage.local:', e);
        resolve();
      }
    });
  }

  static async saveRequest(requestData, matches) {
    const record = {
      ...requestData,
      matches: matches || [],
      categories: [...new Set((matches || []).map((m) => m.category))],
      timestamp: Date.now(),
    };
    if (!this.db || this.useChrome) {
      const arr = await this._getLocalArray('requests');
      let id = await this._getLocal('__req_id_counter', 0);
      id = (Number(id) || 0) + 1;
      record.id = id;
      arr.push(record);
      await this._setLocal('__req_id_counter', id);
      await this._setLocal('requests', arr);
      return id;
    }
    const tx = this.db.transaction(['requests'], 'readwrite');
    const store = tx.objectStore('requests');
    return new Promise((resolve, reject) => {
      const r = store.add(record);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  static async queryHistory(filter = {}, limit = 100) {
    if (!this.db || this.useChrome) {
      const arr = await this._getLocalArray('requests');
      const filtered = arr.filter((rec) => this._match(rec, filter));
      filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return filtered.slice(0, limit);
    }
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
    if (!this.db || this.useChrome) {
      const arr = await this._getLocalArray('requests');
      const kept = arr.filter((rec) => (rec.timestamp || 0) >= cutoff);
      await this._setLocal('requests', kept);
      return;
    }
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
    const out = [];
    if (!this.db || this.useChrome) {
      const arr = await this._getLocalArray('requests');
      for (const rec of arr) {
        if (!ids.length || ids.includes(rec.id)) out.push(rec);
      }
      return JSON.stringify(out, null, 2);
    }
    const tx = this.db.transaction(['requests'], 'readonly');
    const store = tx.objectStore('requests');
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
    if (!this.db || this.useChrome) {
      await this._setLocal('requests', []);
      await this._setLocal('__req_id_counter', 0);
      return true;
    }
    const tx = this.db.transaction(['requests'], 'readwrite');
    const store = tx.objectStore('requests');
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async getRules() {
    if (!this.db || this.useChrome) {
      const list = await this._getLocalArray('rules');
      // 去重
      const byId = new Map();
      for (const r of list) if (r?.id) byId.set(r.id, r);
      return [...byId.values()];
    }
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
    if (!this.db || this.useChrome) {
      const list = await this._getLocalArray('rules');
      const idx = list.findIndex((r) => r?.id === rule?.id);
      if (idx >= 0) list[idx] = rule;
      else list.push(rule);
      await this._setLocal('rules', list);
      return true;
    }
    const tx = this.db.transaction(['rules'], 'readwrite');
    const store = tx.objectStore('rules');
    return new Promise((resolve, reject) => {
      const r = store.put(rule);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async deleteRule(ruleId) {
    if (!this.db || this.useChrome) {
      const list = await this._getLocalArray('rules');
      const kept = list.filter((r) => r?.id !== ruleId);
      await this._setLocal('rules', kept);
      return true;
    }
    const tx = this.db.transaction(['rules'], 'readwrite');
    const store = tx.objectStore('rules');
    return new Promise((resolve, reject) => {
      const r = store.delete(ruleId);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  static async getConfig() {
    if (!this.db || this.useChrome) {
      const enabledRules = await this._getLocal('config.enabledRules', []);
      return { key: 'enabledRules', enabledRules: Array.isArray(enabledRules) ? enabledRules : [] };
    }
    const tx = this.db.transaction(['config'], 'readonly');
    const store = tx.objectStore('config');
    return new Promise((resolve) => {
      const req = store.get('enabledRules');
      req.onsuccess = () => resolve(req.result || { key: 'enabledRules', enabledRules: [] });
      req.onerror = () => resolve({ key: 'enabledRules', enabledRules: [] });
    });
  }

  static async setConfig({ key, value }) {
    if (!this.db || this.useChrome) {
      if (key === 'enabledRules') {
        await this._setLocal('config.enabledRules', Array.isArray(value) ? value : []);
        return true;
      }
      // 其他键统一走 setValue
      await this._setLocal(`value.${key}`, value);
      return true;
    }
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
    if (!this.db || this.useChrome) {
      const v = await this._getLocal(`flag.${key}`, false);
      return !!v;
    }
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
    if (!this.db || this.useChrome) {
      await this._setLocal(`flag.${key}`, !!value);
      return true;
    }
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
    if (!this.db || this.useChrome) {
      const v = await this._getLocal(`value.${key}`, defaultValue);
      return v;
    }
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
    if (!this.db || this.useChrome) {
      await this._setLocal(`value.${key}`, value);
      return true;
    }
    const tx = this.db.transaction(['config'], 'readwrite');
    const store = tx.objectStore('config');
    return new Promise((resolve, reject) => {
      const r = store.put({ key, value });
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }
}
