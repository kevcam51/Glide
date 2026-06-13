const storagePolyfill = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) throw new Error("Key not found: " + key);
    return { key, value, shared: false };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!prefix || k.startsWith(prefix)) keys.push(k);
    }
    return { keys, prefix, shared: false };
  },
};
window.storage = storagePolyfill;
export default storagePolyfill;
