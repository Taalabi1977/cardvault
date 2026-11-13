/*
 * CardVault — private business card file.
 * All data lives in this browser's IndexedDB, encrypted with AES-256-GCM.
 * The key is derived from the master password (PBKDF2-SHA256, 600k rounds)
 * and only ever held in memory while the vault is unlocked.
 * Card reading (OCR) runs on the device with Tesseract; nothing is uploaded.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  const DB_NAME = 'cardvault';
  // App + data versions. Rule for every future update: IndexedDB stores are only ever
  // ADDED (never deleted or renamed), and contact changes go through MIGRATIONS below,
  // so saved cards always survive an update.
  const APP_VERSION = '1.1.0';
  const DB_VERSION = 1;
  const DATA_VERSION = 2;
  const WHATS_NEW = [
    'After saving a card: add it to your phone contacts or export it to Excel in one tap.',
    'Excel export of one card, a filtered list (for example one event) or all cards, ready to send by WhatsApp, WeChat, email, AirDrop or Bluetooth.',
    'Phone contacts now include the card photo, where you met, tags, follow-up and notes.',
    'Safe updates: new versions install without touching your saved cards, and the app tells you when an update is ready.',
  ];
  const KDF_ITERATIONS = 600000;
  const MAX_FREE_ATTEMPTS = 5;
  const HIDDEN_LOCK_MS = 60 * 1000;
  const LANGS = [
    { code: 'eng', label: 'English' },
    { code: 'fra', label: 'Français' },
    { code: 'ara', label: 'العربية' },
    { code: 'spa', label: 'Español' },
    { code: 'deu', label: 'Deutsch' },
  ];
  const PHONE_LABELS = { mobile: 'Mobile', work: 'Work', phone: 'Phone', fax: 'Fax', home: 'Home' };
  const ASSIGN_FIELDS = [
    ['name', 'Name'], ['title', 'Job title'], ['company', 'Company'], ['phone', 'Phone'],
    ['email', 'Email'], ['website', 'Website'], ['address', 'Address'], ['notes', 'Notes'],
  ];

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------------
  // Icons (inline SVG, stroke-based)
  // ------------------------------------------------------------------
  const P = {
    cards: '<rect x="3" y="6" width="15" height="10" rx="1.5"/><path d="M6 19h13.5A1.5 1.5 0 0 0 21 17.5V9"/><path d="M6 10h5M6 13h8"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M7 12h10"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

  const LOGO = `<svg viewBox="0 0 96 64" fill="none" aria-hidden="true">
    <rect x="14" y="4" width="78" height="46" rx="5" fill="currentColor" opacity=".18"/>
    <rect x="4" y="14" width="78" height="46" rx="5" fill="var(--surface)" stroke="currentColor" stroke-width="3"/>
    <path d="M16 30h26M16 39h40M16 48h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <rect x="58" y="24" width="14" height="14" rx="2" stroke="currentColor" stroke-width="3"/>
    <path d="M62 24v-3a3 3 0 0 1 6 0v3" stroke="currentColor" stroke-width="3"/></svg>`;

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => {
    const b = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  const todayISO = () => isoDate(new Date());
  function isoDate(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function addMonths(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setMonth(d.getMonth() + n);
    return isoDate(d);
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function daysFromToday(iso) {
    const a = new Date(todayISO() + 'T12:00:00');
    const b = new Date(iso + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }
  function relDue(iso) {
    const n = daysFromToday(iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n < 0) return `${-n} days late`;
    if (n < 14) return `In ${n} days`;
    return 'On ' + fmtDate(iso, { day: 'numeric', month: 'short' });
  }
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f\u064B-\u065F]/g, '')
      .toLowerCase();
  function initials(c) {
    const src = (c.name || c.company || '?').trim();
    const parts = src.split(/\s+/).filter(Boolean);
    const letters = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2)) || '?';
    return letters.toUpperCase();
  }
  const b64 = {
    from(u8) {
      let s = '';
      const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    to(str) {
      const s = atob(str);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  function downloadFile(name, mime, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function canShareFile(file) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  // Shows a sheet for a file that is ready. Tapping a button there is a fresh tap,
  // which phones require before they open the share menu.
  function offerFile(file, opts) {
    const share = canShareFile(file);
    openSheet(`<h2>${esc(opts.title)}</h2>
      ${opts.body ? `<p class="muted small">${opts.body}</p>` : ''}
      <p class="xs mono muted">${esc(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${share ? `<button class="btn btn-primary" id="fShare">${icon('share')} ${esc(opts.shareLabel || 'Send or save…')}</button>` : ''}
        <button class="btn ${share ? '' : 'btn-primary'}" id="fDl">${icon('download')} ${esc(opts.downloadLabel || 'Download to this phone')}</button>
        <button class="btn btn-ghost" data-close>Close</button>
      </div>
      ${opts.foot ? `<p class="xs muted">${opts.foot}</p>` : ''}`);
    if ($('#fShare')) $('#fShare').addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file], title: file.name });
        closeSheet();
        if (opts.onDone) opts.onDone();
      } catch (e) {
        if (e && e.name === 'AbortError') return; // the person closed the share menu
        downloadFile(file.name, file.type, file);
        closeSheet();
      }
    });
    $('#fDl').addEventListener('click', () => {
      downloadFile(file.name, file.type, file);
      closeSheet();
      toast(opts.downloadToast || 'File downloaded');
      if (opts.onDone) opts.onDone();
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch (e) {
      toast(text);
    }
  }

  // ------------------------------------------------------------------
  // IndexedDB
  // ------------------------------------------------------------------
  let dbPromise = null;
  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
          if (!d.objectStoreNames.contains('contacts')) d.createObjectStore('contacts', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function run(stores, mode, fn) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let result;
      const r = fn(t);
      if (r && 'onsuccess' in r) r.onsuccess = () => (result = r.result);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }
  const idb = {
    get: (store, key) => run(store, 'readonly', (t) => t.objectStore(store).get(key)),
    put: (store, val, key) => run(store, 'readwrite', (t) => (key === undefined ? t.objectStore(store).put(val) : t.objectStore(store).put(val, key))),
    del: (store, key) => run(store, 'readwrite', (t) => t.objectStore(store).delete(key)),
    all: (store) => run(store, 'readonly', (t) => t.objectStore(store).getAll()),
  };

  // ------------------------------------------------------------------
  // Crypto
  // ------------------------------------------------------------------
  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function encryptBytes(key, bytes, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes);
    return { iv, ct: new Uint8Array(ct) };
  }
  async function decryptBytes(key, rec, aad) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: enc.encode(aad) }, key, rec.ct);
    return new Uint8Array(pt);
  }
  const CHECK_TEXT = 'cardvault-check-v1';
  async function makeCheck(key) {
    return encryptBytes(key, enc.encode(CHECK_TEXT), 'check');
  }
  async function verifyKey(key, check) {
    try {
      const out = await decryptBytes(key, check, 'check');
      return dec.decode(out) === CHECK_TEXT;
    } catch (e) {
      return false;
    }
  }
  async function sealContact(key, c) {
    const { iv, ct } = await encryptBytes(key, enc.encode(JSON.stringify(c)), 'contact:' + c.id);
    return { id: c.id, iv, ct };
  }
  async function openContact(key, rec) {
    return normalizeContact(JSON.parse(dec.decode(await decryptBytes(key, rec, 'contact:' + rec.id))));
  }
  // Fills in any field an older version did not have, so old cards always open in new versions.
  function normalizeContact(c) {
    const d = {
      name: '', title: '', company: '', phones: [], emails: [], website: '', address: '',
      cardFront: null, cardBack: null, eventPhoto: null, tags: [], notes: '', ocrText: '', ocrLangs: [],
      createdAt: Date.now(), updatedAt: Date.now(), exportedToPhoneAt: null,
    };
    for (const k in d) if (c[k] === undefined) c[k] = d[k];
    c.met = Object.assign({ date: '', event: '', place: '' }, c.met || {});
    c.followUp = Object.assign({ date: '', note: '', done: false }, c.followUp || {});
    if (!Array.isArray(c.phones)) c.phones = [];
    if (!Array.isArray(c.emails)) c.emails = [];
    if (!Array.isArray(c.tags)) c.tags = [];
    return c;
  }
  // Data migrations, keyed by the data version they lead to. Each takes a contact and returns it.
  const MIGRATIONS = {
    2: (c) => normalizeContact(c), // 1.0 -> 1.1: adds exportedToPhoneAt, fills defaults
  };
  async function sealBlob(key, id, bytes) {
    const { iv, ct } = await encryptBytes(key, bytes, 'blob:' + id);
    return { id, iv, ct };
  }

  function passwordScore(pw) {
    const rules = {
      length: pw.length >= 12,
      mix: [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length >= 3 || pw.length >= 20,
      notCommon: !/(password|motdepasse|azerty|qwerty|123456|111111|abc123|letmein|welcome|admin|cardvault|iloveyou)/i.test(pw) && !/^(.)\1+$/.test(pw),
    };
    let score = 0;
    if (pw.length >= 8) score++;
    if (rules.length) score++;
    if (rules.mix) score++;
    if (pw.length >= 16 && rules.mix) score++;
    if (!rules.notCommon) score = Math.min(score, 1);
    const ok = rules.length && rules.mix && rules.notCommon;
    return { score: pw ? Math.max(score, 1) : 0, ok, rules };
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const S = {
    key: null,
    vault: null, // {salt, iterations, check}
    contacts: [],
    tab: 'contacts',
    screen: 'list', // list | detail | edit
    detailId: null,
    query: '',
    filter: null, // {type:'tag'|'event', value}
    sort: 'recent',
    draft: null,
    sticky: null, // remembered "where you met" for batch scanning
    urls: [],
    settings: { autoLockMin: 5, ocrLangs: ['eng', 'fra'] },
    lastActive: Date.now(),
    hiddenAt: 0,
    picking: false,
    showDone: false,
    settingsPanel: null,
    importData: null,
  };

  function trackUrl(u) {
    S.urls.push(u);
    return u;
  }
  function releaseUrls() {
    S.urls.forEach((u) => URL.revokeObjectURL(u));
    S.urls = [];
  }

  // ------------------------------------------------------------------
  // Vault lifecycle
  // ------------------------------------------------------------------
  async function loadSettings() {
    try {
      const s = await idb.get('meta', 'settings');
      if (s) S.settings = Object.assign(S.settings, s);
    } catch (e) { /* defaults */ }
  }
  async function saveSettings() {
    await idb.put('meta', S.settings, 'settings');
  }

  async function createVault(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, KDF_ITERATIONS);
    const check = await makeCheck(key);
    const vault = { v: 1, salt, iterations: KDF_ITERATIONS, check, createdAt: Date.now() };
    await idb.put('meta', vault, 'vault');
    await idb.put('meta', DATA_VERSION, 'dataVersion');
    S.settings.seenVersion = APP_VERSION;
    await saveSettings();
    S.vault = vault;
    S.key = key;
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* optional */ }
    await loadContacts();
  }

  async function getLockout() {
    return (await idb.get('meta', 'lockout')) || { fails: 0, until: 0 };
  }

  async function unlock(password) {
    const lock = await getLockout();
    if (lock.until > Date.now()) throw new Error('wait');
    const key = await deriveKey(password, S.vault.salt, S.vault.iterations);
    if (!(await verifyKey(key, S.vault.check))) {
      const fails = lock.fails + 1;
      const extra = fails - MAX_FREE_ATTEMPTS;
      const until = extra >= 0 ? Date.now() + Math.min(30000 * Math.pow(2, extra), 3600000) : 0;
      await idb.put('meta', { fails, until }, 'lockout');
      throw new Error('bad');
    }
    await idb.put('meta', { fails: 0, until: 0 }, 'lockout');
    S.key = key;
    await loadContacts();
  }

  // Runs after unlock (cards are encrypted, so changes need the key). Saves a safety copy first,
  // then rewrites every card in ONE transaction: either all cards are updated or none.
  async function runMigrations() {
    const from = (await idb.get('meta', 'dataVersion')) || 1;
    if (from > DATA_VERSION) {
      toast('These cards were saved by a newer CardVault. Update the app before editing.');
      return;
    }
    if (from === DATA_VERSION) return;
    const recs = await idb.all('contacts');
    if (recs.length) {
      await idb.put('meta', { fromVersion: from, at: Date.now(), records: recs }, 'snapshot');
      const updated = [];
      for (const r of recs) {
        let c = JSON.parse(dec.decode(await decryptBytes(S.key, r, 'contact:' + r.id)));
        for (let v = from + 1; v <= DATA_VERSION; v++) if (MIGRATIONS[v]) c = MIGRATIONS[v](c);
        updated.push(await sealContact(S.key, c));
      }
      await run(['contacts', 'meta'], 'readwrite', (t) => {
        const st = t.objectStore('contacts');
        updated.forEach((r) => st.put(r));
        t.objectStore('meta').put(DATA_VERSION, 'dataVersion');
      });
    } else {
      await idb.put('meta', DATA_VERSION, 'dataVersion');
    }
  }

  async function loadContacts() {
    await runMigrations();
    const recs = await idb.all('contacts');
    const out = [];
    for (const r of recs) {
      try { out.push(await openContact(S.key, r)); } catch (e) { console.warn('Could not decrypt record', r.id); }
    }
    S.contacts = out;
  }

  function lock(reason) {
    if (!S.key) return;
    S.key = null;
    S.contacts = [];
    S.draft = null;
    S.sticky = null;
    S.screen = 'list';
    S.detailId = null;
    S.query = '';
    S.filter = null;
    S.importData = null;
    S.settingsPanel = null;
    releaseUrls();
    closeSheet();
    terminateOcr();
    renderLock(reason);
  }

  // Auto-lock on inactivity and when the app is left in the background.
  function markActive() { S.lastActive = Date.now(); }
  ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, markActive, { passive: true, capture: true })
  );
  setInterval(() => {
    if (S.key && Date.now() - S.lastActive > S.settings.autoLockMin * 60000) lock('Locked after inactivity.');
  }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      S.hiddenAt = Date.now();
      if (S.key) document.body.classList.add('veil');
    } else {
      document.body.classList.remove('veil');
      const away = Date.now() - S.hiddenAt;
      if (S.picking) { S.picking = false; markActive(); return; }
      if (S.key && S.hiddenAt && away > HIDDEN_LOCK_MS) lock('Locked while the app was in the background.');
      else markActive();
    }
  });

  // ------------------------------------------------------------------
  // Contacts persistence
  // ------------------------------------------------------------------
  async function saveContact(c) {
    c.updatedAt = Date.now();
    const rec = await sealContact(S.key, c);
    await idb.put('contacts', rec);
    const i = S.contacts.findIndex((x) => x.id === c.id);
    if (i >= 0) S.contacts[i] = c; else S.contacts.push(c);
  }
  async function deleteContact(c) {
    for (const id of imageIds(c)) await idb.del('blobs', id);
    await idb.del('contacts', c.id);
    S.contacts = S.contacts.filter((x) => x.id !== c.id);
  }
  function imageIds(c) {
    return [c.cardFront, c.cardBack, c.eventPhoto].filter(Boolean);
  }
  async function storeImage(blob) {
    const id = uid();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await idb.put('blobs', await sealBlob(S.key, id, bytes));
    return id;
  }
  const imageCache = new Map();
  async function imageUrl(id) {
    if (!id) return null;
    if (imageCache.has(id)) return imageCache.get(id);
    const rec = await idb.get('blobs', id);
    if (!rec) return null;
    const bytes = await decryptBytes(S.key, rec, 'blob:' + id);
    const url = trackUrl(URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    imageCache.set(id, url);
    return url;
  }
  function clearImageCache() { imageCache.clear(); }

  function blankContact() {
    const base = {
      id: uid(), createdAt: Date.now(), updatedAt: Date.now(),
      name: '', title: '', company: '', phones: [], emails: [], website: '', address: '',
      cardFront: null, cardBack: null, eventPhoto: null,
      met: { date: todayISO(), event: '', place: '' }, tags: [], notes: '',
      followUp: { date: '', note: '', done: false }, ocrText: '', ocrLangs: [],
    };
    if (S.sticky) {
      base.met = Object.assign({}, base.met, { event: S.sticky.event, place: S.sticky.place, date: S.sticky.date || base.met.date });
      base.tags = S.sticky.tags.slice();
    }
    return base;
  }

  function haystack(c) {
    return norm([
      c.name, c.title, c.company, c.website, c.address, c.notes, c.met && c.met.event, c.met && c.met.place,
      (c.tags || []).join(' '), (c.emails || []).join(' '), (c.phones || []).map((p) => p.value + ' ' + p.value.replace(/\D/g, '')).join(' '),
      c.followUp && c.followUp.note, c.ocrText,
    ].join(' \n '));
  }
  function filteredContacts() {
    const tokens = norm(S.query).split(/\s+/).filter(Boolean);
    let list = S.contacts.filter((c) => {
      if (S.filter) {
        if (S.filter.type === 'tag' && !(c.tags || []).includes(S.filter.value)) return false;
        if (S.filter.type === 'event' && (c.met && c.met.event) !== S.filter.value) return false;
      }
      if (!tokens.length) return true;
      const h = haystack(c);
      return tokens.every((t) => h.includes(t) || (/^\d{3,}$/.test(t) && h.includes(t)));
    });
    if (S.sort === 'name') list.sort((a, b) => (a.name || a.company || '').localeCompare(b.name || b.company || ''));
    else list.sort((a, b) => (b.met && b.met.date || '').localeCompare(a.met && a.met.date || '') || b.createdAt - a.createdAt);
    return list;
  }
  function allTags() {
    const m = new Map();
    S.contacts.forEach((c) => (c.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }
  function allValues(fn) {
    const set = new Set();
    S.contacts.forEach((c) => { const v = fn(c); if (v) set.add(v); });
    return Array.from(set).sort();
  }
  function dueFollowUps() {
    return S.contacts.filter((c) => c.followUp && c.followUp.date && !c.followUp.done && daysFromToday(c.followUp.date) <= 0).length;
  }

  // ------------------------------------------------------------------
  // Rendering: lock screen
  // ------------------------------------------------------------------
  const app = () => $('#app');

  function pwField(id, label, autocomplete) {
    return `<div class="field"><label for="${id}">${label}</label>
      <div class="pw-wrap"><input class="input" type="password" id="${id}" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" required>
      <button type="button" class="icon-btn" data-reveal="${id}" aria-label="Show password">${icon('eye')}</button></div></div>`;
  }

  function renderLock(message) {
    const setup = !S.vault;
    if (setup) {
      app().innerHTML = `<main class="lock">
        <div class="lock-mark">${LOGO}</div>
        <div><h1>CardVault</h1><p class="muted">Your business cards, encrypted on this phone.</p></div>
        <form id="setupForm" novalidate>
          ${pwField('pw1', 'Create a master password', 'new-password')}
          <div class="meter" id="meter" data-score="0"><i></i><i></i><i></i><i></i></div>
          <ul class="rules" id="rules">
            <li data-r="length">At least 12 characters</li>
            <li data-r="mix">Three of: lowercase, capitals, numbers, symbols (or 20+ characters)</li>
            <li data-r="notCommon">Not a common password</li>
          </ul>
          ${pwField('pw2', 'Type it again', 'new-password')}
          <p class="error" id="err" hidden></p>
          <div class="note warn">There is no password recovery. Nobody, including us, can open your cards without it. Write it down somewhere safe.</div>
          <button class="btn btn-primary btn-block" type="submit" id="setupBtn">Create my vault</button>
        </form>
      </main>`;
      const pw1 = $('#pw1');
      $('#pw2').addEventListener('input', () => ($('#err').hidden = true));
      pw1.addEventListener('input', () => {
        $('#err').hidden = true;
        const r = passwordScore(pw1.value);
        $('#meter').dataset.score = r.score;
        $$('#rules li').forEach((li) => li.classList.toggle('met', !!r.rules[li.dataset.r]));
      });
      $('#setupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#err');
        const a = $('#pw1').value, b = $('#pw2').value;
        const r = passwordScore(a);
        err.hidden = true;
        if (!r.ok) { err.textContent = 'Choose a stronger password: meet all three rules above.'; err.hidden = false; return; }
        if (a !== b) { err.textContent = 'The two passwords are different.'; err.hidden = false; return; }
        const btn = $('#setupBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spin"></span> Creating vault…';
        try {
          await createVault(a);
          markActive();
          renderApp();
          toast('Vault created');
        } catch (ex) {
          console.error(ex);
          err.textContent = 'This browser could not create the encrypted vault. Use Safari or Chrome, not a private window.';
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = 'Create my vault';
        }
      });
      return;
    }

    app().innerHTML = `<main class="lock">
      <div class="lock-mark">${LOGO}</div>
      <div><h1>CardVault</h1><p class="muted">${esc(message || 'Locked. Enter your master password.')}</p></div>
      <form id="unlockForm" novalidate>
        ${pwField('pw', 'Master password', 'current-password')}
        <p class="error" id="err" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="unlockBtn">${icon('lock')} Unlock</button>
      </form>
      <button class="btn btn-ghost small" type="button" id="forgot">Forgot your password?</button>
    </main>`;
    const err = $('#err');
    const btn = $('#unlockBtn');
    let tick;
    async function showWait() {
      const l = await getLockout();
      clearInterval(tick);
      if (l.until > Date.now()) {
        btn.disabled = true;
        const upd = () => {
          const s = Math.ceil((l.until - Date.now()) / 1000);
          if (s <= 0) { clearInterval(tick); btn.disabled = false; err.hidden = true; return; }
          err.textContent = `Too many wrong passwords. Try again in ${s} s.`;
          err.hidden = false;
        };
        upd();
        tick = setInterval(upd, 1000);
      }
    }
    showWait();
    setTimeout(() => { try { $('#pw').focus(); } catch (e) {} }, 50);
    $('#unlockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#pw').value;
      if (!pw) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span> Unlocking…';
      try {
        await unlock(pw);
        clearInterval(tick);
        markActive();
        renderApp();
        afterUnlock();
      } catch (ex) {
        btn.disabled = false;
        btn.innerHTML = `${icon('lock')} Unlock`;
        if (ex.message === 'bad') {
          const l = await getLockout();
          const left = MAX_FREE_ATTEMPTS - l.fails;
          err.textContent = left > 0 ? `Wrong password. ${left} ${left === 1 ? 'try' : 'tries'} left before a waiting time.` : 'Wrong password.';
          err.hidden = false;
          $('#pw').select();
        }
        showWait();
      }
    });
    $('#forgot').addEventListener('click', () => {
      openSheet(`<h2>Forgot your password?</h2>
        <p>Your cards are encrypted with the master password, so they cannot be recovered without it.</p>
        <p class="muted small">You can erase this vault and start again. If you have a backup file, you can import it after, using that backup's password.</p>
        <div class="field"><label for="wipeConfirm">Type ERASE to delete all cards on this device</label><input class="input" id="wipeConfirm" autocomplete="off" autocapitalize="characters"></div>
        <div class="btn-row"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="wipeGo" disabled>Erase everything</button></div>`);
      $('#wipeConfirm').addEventListener('input', (ev) => ($('#wipeGo').disabled = ev.target.value.trim().toUpperCase() !== 'ERASE'));
      $('#wipeGo').addEventListener('click', wipeAll);
    });
  }

  async function wipeAll() {
    S.key = null;
    S.contacts = [];
    terminateOcr();
    const d = await openDB();
    d.close();
    dbPromise = null;
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
    S.vault = null;
    closeSheet();
    releaseUrls();
    clearImageCache();
    renderLock();
    toast('All data erased');
  }

  // ------------------------------------------------------------------
  // Sheets (in-page dialogs)
  // ------------------------------------------------------------------
  function openSheet(html) {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.id = 'sheet';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) closeSheet();
    });
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input, button:not([data-close])');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeSheet() {
    const s = $('#sheet');
    if (s) s.remove();
  }
  function confirmSheet(title, body, actionLabel, onYes) {
    openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="btn-row"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="sheetYes">${esc(actionLabel)}</button></div>`);
    $('#sheetYes').addEventListener('click', async () => { closeSheet(); await onYes(); });
  }

  // ------------------------------------------------------------------
  // Rendering: app shell
  // ------------------------------------------------------------------
  function renderApp() {
    if (!S.key) return renderLock();
    if (S.screen === 'detail') return renderDetail();
    if (S.screen === 'edit') return renderEditor();
    const views = { contacts: viewContacts, followups: viewFollowUps, events: viewEvents, settings: viewSettings };
    const v = views[S.tab]();
    app().innerHTML = `<div class="shell">${v}</div>${tabbar()}`;
    bindCommon();
    if (S.tab === 'contacts') bindContacts();
    if (S.tab === 'settings') bindSettings();
  }

  function tabbar() {
    const due = dueFollowUps();
    const t = (id, ic, label) =>
      `<button class="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${id === 'followups' && due ? `<span class="dot">${due}</span>` : ''}</button>`;
    return `<nav class="tabbar" aria-label="Main"><div class="tabbar-inner">
      ${t('contacts', 'cards', 'Cards')}
      ${t('followups', 'bell', 'Follow-ups')}
      <button class="tab tab-scan" data-action="scan"><span class="key">${icon('scan')}</span><span>Scan</span></button>
      ${t('events', 'flag', 'Events')}
      ${t('settings', 'gear', 'Settings')}
    </div></nav>`;
  }

  function bindCommon() {
    $$('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        S.tab = b.dataset.tab;
        S.screen = 'list';
        S.settingsPanel = null;
        renderApp();
        window.scrollTo(0, 0);
      })
    );
    $$('[data-action="scan"]').forEach((b) => b.addEventListener('click', () => startEdit(null)));
    $$('[data-open]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.open)));
    $$('[data-reveal]').forEach(bindReveal);
  }
  function bindReveal(b) {
    b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.reveal);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.setAttribute('aria-label', inp.type === 'password' ? 'Show password' : 'Hide password');
    });
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reveal]');
    if (r && !r.dataset.bound && $('.lock')) {
      // lock screen reveal buttons are bound here (renderLock has no bindCommon)
      const inp = document.getElementById(r.dataset.reveal);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }
  });

  function contactRow(c) {
    const sub = [c.title, c.company].filter(Boolean).join(' · ') || (c.emails || [])[0] || '';
    const fu = c.followUp && c.followUp.date && !c.followUp.done ? daysFromToday(c.followUp.date) : null;
    return `<button class="row" data-open="${c.id}">
      <span class="mini-card" aria-hidden="true">${esc(initials(c))}</span>
      <span class="row-main">
        <span class="row-name" dir="auto">${esc(c.name || c.company || 'Unnamed card')}</span>
        <span class="row-sub" dir="auto">${esc(sub)}</span>
      </span>
      <span class="row-side">
        ${c.met && c.met.date ? `<span class="mono">${esc(fmtDate(c.met.date, c.met.date.slice(0, 4) === todayISO().slice(0, 4) ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }))}</span>` : ''}
        ${fu !== null && fu <= 7 ? `<span class="due-pill ${fu < 0 ? 'over' : ''}">${esc(relDue(c.followUp.date))}</span>` : (c.met && c.met.event ? `<span class="tag">${esc(c.met.event.slice(0, 18))}</span>` : '')}
      </span>
    </button>`;
  }

  // ---------- Contacts tab ----------
  function viewContacts() {
    const list = filteredContacts();
    const tags = allTags();
    const total = S.contacts.length;
    if (!total) {
      return `<header class="topbar"><div class="topbar-row"><h1>Cards</h1></div></header>
      <div class="content"><div class="empty">
        <div class="art">${LOGO}</div>
        <h2>No cards yet</h2>
        <p>Tap <strong>Scan</strong> and take a photo of a business card. CardVault reads it on this phone and fills in the details.</p>
        <button class="btn btn-primary" data-action="scan">${icon('camera')} Scan your first card</button>
        <button class="btn btn-ghost small" id="examples">Add 3 example cards to try the app</button>
      </div></div>`;
    }
    const filterChip = S.filter
      ? `<button class="chip" aria-pressed="true" id="clearFilter">${S.filter.type === 'event' ? icon('flag').replace('<svg', '<svg width="14" height="14"') : ''}${esc(S.filter.value)} <span class="x">×</span></button>`
      : '';
    return `<header class="topbar">
        <div class="topbar-row"><h1>Cards</h1><button class="icon-btn" id="lockNow" aria-label="Lock now">${icon('lock')}</button></div>
        <label class="search"><span class="sr-only">Search cards</span>${icon('search')}
          <input class="input" type="search" id="q" placeholder="Search name, company, event, notes…" value="${esc(S.query)}" autocomplete="off" dir="auto"></label>
        <div class="chips" id="tagChips">${filterChip}${tags.filter((t) => !(S.filter && S.filter.value === t)).slice(0, 15).map((t) => `<button class="chip" data-tagf="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </header>
      <div class="content">
        <div class="list-meta"><span class="small muted mono" id="count">${list.length} of ${total}</span>
          <button class="btn btn-sm" id="xlsList" aria-label="Export the cards shown to Excel">${icon('sheet')} Excel</button>
          <div class="chips"><button class="chip btn-sm" data-sort="recent" aria-pressed="${S.sort === 'recent'}">Recent</button><button class="chip btn-sm" data-sort="name" aria-pressed="${S.sort === 'name'}">A–Z</button></div></div>
        <div id="results">${resultsHtml(list)}</div>
      </div>`;
  }
  function resultsHtml(list) {
    if (!list.length) return `<div class="empty"><h2>No match</h2><p>Nothing matches “${esc(S.query)}”. Search looks in names, companies, events, places, tags, notes and the full card text.</p></div>`;
    return `<div class="list">${list.map(contactRow).join('')}</div>`;
  }
  function bindContacts() {
    const q = $('#q');
    if (q) {
      q.addEventListener('input', () => {
        S.query = q.value;
        const list = filteredContacts();
        $('#results').innerHTML = resultsHtml(list);
        $('#count').textContent = `${list.length} of ${S.contacts.length}`;
        $$('#results [data-open]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.open)));
      });
    }
    $$('[data-tagf]').forEach((b) => b.addEventListener('click', () => { S.filter = { type: 'tag', value: b.dataset.tagf }; renderApp(); }));
    const cf = $('#clearFilter');
    if (cf) cf.addEventListener('click', () => { S.filter = null; renderApp(); });
    $$('[data-sort]').forEach((b) => b.addEventListener('click', () => { S.sort = b.dataset.sort; renderApp(); }));
    const ln = $('#lockNow');
    if (ln) ln.addEventListener('click', () => lock('Locked.'));
    const xl = $('#xlsList');
    if (xl) xl.addEventListener('click', () => exportExcel(filteredContacts(), S.filter ? S.filter.value : S.query || 'all-cards'));
    const ex = $('#examples');
    if (ex) ex.addEventListener('click', addExamples);
  }

  // ---------- Follow-ups tab ----------
  function viewFollowUps() {
    const items = S.contacts.filter((c) => c.followUp && c.followUp.date);
    const open = items.filter((c) => !c.followUp.done).sort((a, b) => a.followUp.date.localeCompare(b.followUp.date));
    const done = items.filter((c) => c.followUp.done).sort((a, b) => b.followUp.date.localeCompare(a.followUp.date));
    const groups = [
      ['Overdue', open.filter((c) => daysFromToday(c.followUp.date) < 0), 'over'],
      ['Today', open.filter((c) => daysFromToday(c.followUp.date) === 0), ''],
      ['Next 7 days', open.filter((c) => { const n = daysFromToday(c.followUp.date); return n > 0 && n <= 7; }), ''],
      ['Later', open.filter((c) => daysFromToday(c.followUp.date) > 7), ''],
    ];
    const item = (c) => `<div class="fu-item">
      <div class="row-main" data-open="${c.id}" role="button" tabindex="0">
        <span class="row-name" dir="auto">${esc(c.name || c.company || 'Unnamed card')}</span>
        <span class="row-sub" dir="auto">${esc(c.followUp.note || [c.company, c.met && c.met.event].filter(Boolean).join(' · '))}</span>
        <span class="xs mono ${!c.followUp.done && daysFromToday(c.followUp.date) < 0 ? 'error' : 'muted'}">${esc(fmtDate(c.followUp.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(c.followUp.done ? 'Done' : relDue(c.followUp.date))}</span>
      </div>
      <div class="fu-actions">
        <button class="icon-btn" data-ics="${c.id}" aria-label="Add reminder to calendar">${icon('cal')}</button>
        <button class="icon-btn" data-done="${c.id}" aria-label="${c.followUp.done ? 'Mark as not done' : 'Mark as done'}">${c.followUp.done ? icon('rotate') : icon('check')}</button>
      </div></div>`;
    const body = open.length
      ? groups.filter((g) => g[1].length).map((g) => `<div class="group-h ${g[2]}">${g[0]} · ${g[1].length}</div><div class="list">${g[1].map(item).join('')}</div>`).join('')
      : `<div class="empty"><div class="art" style="width:56px">${icon('bell')}</div><h2>Nothing to follow up</h2><p>When you save a card, set a follow-up date. It shows up here, and you can add it to your phone's calendar.</p></div>`;
    const doneHtml = done.length
      ? `<button class="btn btn-ghost small" id="toggleDone">${S.showDone ? 'Hide' : 'Show'} ${done.length} done</button>${S.showDone ? `<div class="list">${done.map(item).join('')}</div>` : ''}`
      : '';
    setTimeout(bindFollowUps, 0);
    return `<header class="topbar"><div class="topbar-row"><h1>Follow-ups</h1></div></header><div class="content">${body}${doneHtml}</div>`;
  }
  function bindFollowUps() {
    $$('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      const c = S.contacts.find((x) => x.id === b.dataset.done);
      c.followUp.done = !c.followUp.done;
      await saveContact(c);
      toast(c.followUp.done ? 'Marked as done' : 'Marked as open');
      renderApp();
    }));
    $$('[data-ics]').forEach((b) => b.addEventListener('click', () => exportICS(S.contacts.find((x) => x.id === b.dataset.ics))));
    const t = $('#toggleDone');
    if (t) t.addEventListener('click', () => { S.showDone = !S.showDone; renderApp(); });
  }

  // ---------- Events tab ----------
  function viewEvents() {
    const ev = new Map();
    S.contacts.forEach((c) => {
      const k = c.met && c.met.event;
      if (!k) return;
      const e = ev.get(k) || { name: k, count: 0, first: null, last: null, place: '' };
      e.count++;
      const d = c.met.date;
      if (d) { if (!e.first || d < e.first) e.first = d; if (!e.last || d > e.last) e.last = d; }
      if (!e.place && c.met.place) e.place = c.met.place;
      ev.set(k, e);
    });
    const events = Array.from(ev.values()).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    const tags = allTags();
    setTimeout(() => {
      $$('[data-evf]').forEach((b) => b.addEventListener('click', () => { S.filter = { type: 'event', value: b.dataset.evf }; S.tab = 'contacts'; renderApp(); }));
      $$('[data-tagf]').forEach((b) => b.addEventListener('click', () => { S.filter = { type: 'tag', value: b.dataset.tagf }; S.tab = 'contacts'; renderApp(); }));
    }, 0);
    const range = (e) => (e.first === e.last ? fmtDate(e.first) : `${fmtDate(e.first, { day: 'numeric', month: 'short' })} – ${fmtDate(e.last)}`);
    return `<header class="topbar"><div class="topbar-row"><h1>Events</h1></div></header>
      <div class="content">
        ${events.length ? `<div class="list">${events.map((e) => `<button class="row event-row" data-evf="${esc(e.name)}">
            <span class="mini-card" aria-hidden="true">${icon('flag').replace('<svg', '<svg width="16" height="16"')}</span>
            <span class="row-main"><span class="row-name" dir="auto">${esc(e.name)}</span><span class="row-sub">${esc([e.place, e.first ? range(e) : ''].filter(Boolean).join(' · '))}</span></span>
            <span class="count">${e.count}</span></button>`).join('')}</div>`
          : `<div class="empty"><div class="art" style="width:56px">${icon('flag')}</div><h2>No events yet</h2><p>Add the event where you met someone, like “SIAL Paris 2026”. Cards from the same event are grouped here.</p></div>`}
        ${tags.length ? `<div class="panel"><div class="panel-h"><h2>Tags</h2><span class="xs muted">${tags.length}</span></div><div class="chips wrap">${tags.map((t) => `<button class="chip" data-tagf="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>` : ''}
      </div>`;
  }

  // ------------------------------------------------------------------
  // Detail screen
  // ------------------------------------------------------------------
  function openDetail(id) {
    S.detailId = id;
    S.screen = 'detail';
    renderApp();
    window.scrollTo(0, 0);
  }

  function renderDetail() {
    const c = S.contacts.find((x) => x.id === S.detailId);
    if (!c) { S.screen = 'list'; return renderApp(); }
    const tel = (c.phones || [])[0];
    const mobile = (c.phones || []).find((p) => p.label === 'mobile') || tel;
    const email = (c.emails || [])[0];
    const site = c.website ? (/^https?:\/\//i.test(c.website) ? c.website : 'https://' + c.website) : '';
    const wa = mobile ? mobile.value.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '') : '';
    const act = (href, ic, label, ok, ext) =>
      `<a class="action" ${ok ? `href="${esc(href)}"` : 'aria-disabled="true"'} ${ext ? 'target="_blank" rel="noopener noreferrer"' : ''}>${icon(ic)}<span>${label}</span></a>`;
    const kvRow = (label, value, copyVal, dirAuto = true) =>
      `<dt>${esc(label)}</dt><dd ${dirAuto ? 'dir="auto"' : ''}>${value}</dd><button class="icon-btn copy" data-copy="${esc(copyVal)}" aria-label="Copy ${esc(label)}">${icon('copy')}</button>`;
    const fu = c.followUp || {};
    const fuDays = fu.date ? daysFromToday(fu.date) : null;

    app().innerHTML = `<div class="shell">
      <header class="topbar"><div class="topbar-row">
        <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
        <h1 class="sm" dir="auto">${esc(c.name || c.company || 'Card')}</h1>
        <button class="icon-btn" id="edit" aria-label="Edit">${icon('edit')}</button>
      </div></header>
      <div class="content">
        <div class="card-photo ${c.cardFront ? '' : 'placeholder'}" id="cardPhoto">${c.cardFront ? '<span class="spin"></span>' : 'No card photo'}</div>
        ${c.cardBack ? `<div class="btn-row"><button class="btn btn-sm" id="flip">Show back of card</button></div>` : ''}
        <div class="who">
          <h2 dir="auto">${esc(c.name || 'No name')}</h2>
          ${c.title ? `<div class="t" dir="auto">${esc(c.title)}</div>` : ''}
          ${c.company ? `<div dir="auto"><strong>${esc(c.company)}</strong></div>` : ''}
        </div>
        <div class="actions">
          ${act(tel ? 'tel:' + tel.value.replace(/[^\d+]/g, '') : '', 'phone', 'Call', !!tel)}
          ${act(email ? 'mailto:' + email : '', 'mail', 'Email', !!email)}
          ${act(wa ? 'https://wa.me/' + wa : '', 'chat', 'WhatsApp', !!wa, true)}
          ${act(site, 'globe', 'Website', !!site, true)}
        </div>
        ${(c.phones || []).length || (c.emails || []).length || c.website || c.address ? `<div class="panel"><dl class="kv">
          ${(c.phones || []).map((p) => kvRow(PHONE_LABELS[p.label] || 'Phone', `<span class="mono" dir="ltr">${esc(p.value)}</span>`, p.value, false)).join('')}
          ${(c.emails || []).map((e) => kvRow('Email', esc(e), e, false)).join('')}
          ${c.website ? kvRow('Website', esc(c.website), c.website, false) : ''}
          ${c.address ? kvRow('Address', esc(c.address), c.address) : ''}
        </dl></div>` : ''}
        <div class="panel">
          <div class="panel-h"><h2>Where you met</h2>${c.met && c.met.date ? `<span class="timeline-stamp">${esc(fmtDate(c.met.date))}</span>` : ''}</div>
          ${c.met && (c.met.event || c.met.place) ? `<dl class="kv">
            ${c.met.event ? `<dt>Event</dt><dd dir="auto">${esc(c.met.event)}</dd><span></span>` : ''}
            ${c.met.place ? `<dt>Place</dt><dd dir="auto">${esc(c.met.place)}</dd><span></span>` : ''}
          </dl>` : '<p class="muted small">No event or place saved. Tap edit to add where you met.</p>'}
          ${(c.tags || []).length ? `<div class="chips wrap">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          ${c.eventPhoto ? `<div class="event-photo" id="eventPhoto"><span class="spin"></span></div>` : ''}
        </div>
        ${fu.date ? `<div class="followup-box ${fu.done ? 'done' : ''}">
            <div class="panel-h"><strong>${fu.done ? 'Follow-up done' : 'Follow up: ' + esc(relDue(fu.date))}</strong><span class="mono xs">${esc(fmtDate(fu.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span></div>
            ${fu.note ? `<p dir="auto">${esc(fu.note)}</p>` : ''}
            <div class="btn-row"><button class="btn btn-sm" id="fuDone">${fu.done ? 'Reopen' : 'Mark done'}</button><button class="btn btn-sm" id="fuIcs">${icon('cal')} Add to calendar</button></div>
          </div>` : ''}
        ${c.notes ? `<div class="panel"><div class="panel-h"><h2>Notes</h2></div><p dir="auto" style="white-space:pre-wrap">${esc(c.notes)}</p></div>` : ''}
        ${c.ocrText ? `<details class="raw"><summary>Text read from the card</summary><pre dir="auto">${esc(c.ocrText)}</pre></details>` : ''}
        <div class="btn-row">
          <button class="btn" id="vcf">${icon('user')} Add to phone contacts</button>
          <button class="btn" id="xls">${icon('sheet')} Export to Excel</button>
        </div>
        ${c.exportedToPhoneAt ? `<p class="xs muted">Added to phone contacts on ${esc(new Date(c.exportedToPhoneAt).toLocaleDateString())}. If you change this card, add it again and choose “Add to Existing Contact”.</p>` : ''}
        <div class="btn-row">
          <button class="btn btn-danger" id="del">${icon('trash')} Delete</button>
        </div>
        <p class="xs muted mono">Added ${esc(new Date(c.createdAt).toLocaleString())}${fuDays !== null ? '' : ''}</p>
      </div></div>`;

    $('#back').addEventListener('click', () => { S.screen = 'list'; renderApp(); });
    $('#edit').addEventListener('click', () => startEdit(c));
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
    $('#vcf').addEventListener('click', () => addToPhoneContacts(c));
    $('#xls').addEventListener('click', () => exportExcel([c], c.name || c.company));
    $('#del').addEventListener('click', () =>
      confirmSheet('Delete this card?', `${c.name || c.company || 'This card'} and its photos will be removed from this phone.`, 'Delete card', async () => {
        await deleteContact(c);
        S.screen = 'list';
        renderApp();
        toast('Card deleted');
      })
    );
    if ($('#fuDone')) $('#fuDone').addEventListener('click', async () => { c.followUp.done = !c.followUp.done; await saveContact(c); renderDetail(); });
    if ($('#fuIcs')) $('#fuIcs').addEventListener('click', () => exportICS(c));

    let showingBack = false;
    const showImg = async (id, el) => {
      try {
        const url = await imageUrl(id);
        if (url && el.isConnected) el.innerHTML = `<img src="${url}" alt="">`;
      } catch (e) { el.textContent = 'Photo could not be opened'; }
    };
    if (c.cardFront) showImg(c.cardFront, $('#cardPhoto'));
    if (c.eventPhoto) showImg(c.eventPhoto, $('#eventPhoto'));
    if ($('#flip')) $('#flip').addEventListener('click', () => {
      showingBack = !showingBack;
      showImg(showingBack ? c.cardBack : c.cardFront, $('#cardPhoto'));
      $('#flip').textContent = showingBack ? 'Show front of card' : 'Show back of card';
    });
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------
  function startEdit(existing) {
    const c = existing ? JSON.parse(JSON.stringify(existing)) : blankContact();
    S.draft = {
      isNew: !existing,
      c,
      images: { cardFront: null, cardBack: null, eventPhoto: null }, // new {blob,url}
      removed: [],
      ocrLangs: (existing && existing.ocrLangs && existing.ocrLangs.length ? existing.ocrLangs : S.settings.ocrLangs).slice(),
      lines: [],
      assigned: new Set(),
      openLine: null,
      ocrBusy: false,
      keepEvent: !!S.sticky,
    };
    S.screen = 'edit';
    renderEditor();
    window.scrollTo(0, 0);
  }

  function editorSlot(key, label) {
    const d = S.draft;
    const img = d.images[key];
    const has = img || d.c[key];
    return `<div class="slot">
      <span class="xs muted" style="font-weight:600">${label}</span>
      <div class="slot-frame ${has ? 'filled' : ''}" id="frame-${key}">${img ? `<img src="${img.url}" alt="">` : has ? '<span class="spin"></span>' : `<span class="muted">${icon(key === 'eventPhoto' ? 'image' : 'camera').replace('<svg', '<svg width="28" height="28"')}</span>`}</div>
      <div class="slot-tools">
        <label class="btn btn-sm file-btn" title="Take a photo">${icon('camera')}${has ? '' : 'Camera'}<input type="file" accept="image/*" capture="environment" data-pick="${key}" aria-label="Take a photo for ${label}"></label>
        <label class="btn btn-sm file-btn" title="Choose from photos">${icon('image')}${has ? '' : 'Photos'}<input type="file" accept="image/*" data-pick="${key}" aria-label="Choose a photo for ${label}"></label>
        ${has ? `<button class="btn btn-sm" data-rot="${key}" aria-label="Rotate">${icon('rotate')}</button><button class="btn btn-sm" data-rm="${key}" aria-label="Remove photo">${icon('x')}</button>` : ''}
      </div></div>`;
  }

  function multiRows(kind) {
    const c = S.draft.c;
    if (kind === 'phones') {
      return c.phones.map((p, i) => `<div class="multi-row">
        <select class="select" data-plabel="${i}" aria-label="Phone type">${Object.entries(PHONE_LABELS).map(([k, v]) => `<option value="${k}" ${p.label === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input class="input mono" type="tel" dir="ltr" data-pval="${i}" value="${esc(p.value)}" aria-label="Phone number">
        <button class="icon-btn" type="button" data-prm="${i}" aria-label="Remove phone">${icon('x')}</button></div>`).join('');
    }
    return c.emails.map((e, i) => `<div class="multi-row no-label">
      <input class="input" type="email" dir="ltr" data-eval="${i}" value="${esc(e)}" aria-label="Email" autocapitalize="off">
      <button class="icon-btn" type="button" data-erm="${i}" aria-label="Remove email">${icon('x')}</button></div>`).join('');
  }

  function ocrSection() {
    const d = S.draft;
    const hasCard = d.images.cardFront || d.c.cardFront || d.images.cardBack || d.c.cardBack;
    const langChips = LANGS.map((l) => `<button type="button" class="chip" data-lang="${l.code}" aria-pressed="${d.ocrLangs.includes(l.code)}">${l.label}</button>`).join('');
    const lines = d.lines.length
      ? `<div class="field"><span>Text found on the card</span><p class="xs muted">Tap a line to put it in a field. Lines already used are faded.</p>
          <div class="ocr-lines">${d.lines.map((l, i) => `<button type="button" class="ocr-line ${d.assigned.has(l) ? 'used' : ''}" data-line="${i}" aria-expanded="${d.openLine === i}" dir="auto">${esc(l)}</button>`).join('')}</div>
          ${d.openLine !== null && d.lines[d.openLine] !== undefined ? `<div class="assign"><span class="lbl" dir="auto">“${esc(d.lines[d.openLine])}” goes to:</span>${ASSIGN_FIELDS.map(([k, v]) => `<button type="button" class="chip btn-sm" data-assign="${k}">${v}</button>`).join('')}</div>` : ''}
        </div>`
      : '';
    return `<div class="panel" id="ocrPanel">
      <div class="panel-h"><h2>Read the card</h2><span class="xs muted">On this phone</span></div>
      <div class="field"><span>Languages on the card</span><div class="chips wrap">${langChips}</div></div>
      <button type="button" class="btn btn-primary" id="runOcr" ${!hasCard || d.ocrBusy || !d.ocrLangs.length ? 'disabled' : ''}>${d.ocrBusy ? '<span class="spin"></span> Reading…' : icon('text') + (d.lines.length ? ' Read again' : ' Read card')}</button>
      <div class="progress" id="ocrProg" ${d.ocrBusy ? '' : 'hidden'}><div></div></div>
      <p class="xs muted" id="ocrStatus">${!hasCard ? 'Add a photo of the card first.' : d.ocrBusy ? 'Starting…' : 'Fills in empty fields only. Check the result before saving.'}</p>
      ${lines}
    </div>`;
  }

  function renderEditor() {
    const d = S.draft;
    const c = d.c;
    const events = allValues((x) => x.met && x.met.event);
    const places = allValues((x) => x.met && x.met.place);
    const tags = allTags().filter((t) => !c.tags.includes(t));
    const scrollY = window.scrollY;
    app().innerHTML = `<div class="shell" style="padding-bottom:calc(96px + env(safe-area-inset-bottom, 0px))">
      <header class="topbar"><div class="topbar-row">
        <button class="icon-btn" id="cancel" aria-label="Cancel">${icon('x')}</button>
        <h1 class="sm">${d.isNew ? 'New card' : 'Edit card'}</h1>
      </div></header>
      <form class="content" id="editForm" novalidate>
        <div class="panel">
          <div class="panel-h"><h2>Card photo</h2><span class="xs muted">Encrypted on save</span></div>
          <div class="slots">${editorSlot('cardFront', 'Front')}${editorSlot('cardBack', 'Back (optional)')}</div>
          <p class="xs muted">Lay the card flat on a dark surface, fill the frame, avoid glare.</p>
        </div>
        ${ocrSection()}
        <div class="panel">
          <div class="panel-h"><h2>Contact</h2></div>
          <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" data-f="name" value="${esc(c.name)}" dir="auto" autocomplete="off"></div>
          <div class="grid-2">
            <div class="field"><label for="f-title">Job title</label><input class="input" id="f-title" data-f="title" value="${esc(c.title)}" dir="auto" autocomplete="off"></div>
            <div class="field"><label for="f-company">Company</label><input class="input" id="f-company" data-f="company" value="${esc(c.company)}" dir="auto" autocomplete="off"></div>
          </div>
          <div class="field"><span>Phones</span><div id="phones" style="display:flex;flex-direction:column;gap:8px">${multiRows('phones')}</div>
            <button type="button" class="btn btn-sm" id="addPhone" style="align-self:flex-start">${icon('plus')} Add phone</button></div>
          <div class="field"><span>Emails</span><div id="emails" style="display:flex;flex-direction:column;gap:8px">${multiRows('emails')}</div>
            <button type="button" class="btn btn-sm" id="addEmail" style="align-self:flex-start">${icon('plus')} Add email</button></div>
          <div class="field"><label for="f-website">Website</label><input class="input" id="f-website" data-f="website" value="${esc(c.website)}" dir="ltr" inputmode="url" autocapitalize="off" autocomplete="off"></div>
          <div class="field"><label for="f-address">Address</label><textarea class="textarea" id="f-address" data-f="address" dir="auto" rows="2">${esc(c.address)}</textarea></div>
        </div>
        <div class="panel">
          <div class="panel-h"><h2>Where you met</h2></div>
          <div class="grid-2">
            <div class="field"><label for="f-metdate">Date</label><input class="input" type="date" id="f-metdate" data-m="date" value="${esc(c.met.date)}"></div>
            <div class="field"><label for="f-place">Place</label><input class="input" id="f-place" data-m="place" value="${esc(c.met.place)}" list="dl-places" dir="auto" placeholder="City or venue" autocomplete="off"></div>
          </div>
          <div class="field"><label for="f-event">Event</label><input class="input" id="f-event" data-m="event" value="${esc(c.met.event)}" list="dl-events" dir="auto" placeholder="e.g. Paris trade fair 2026" autocomplete="off"></div>
          <div class="field"><label for="f-tag">Tags</label>
            <div class="chips wrap" id="tagList">${c.tags.map((t, i) => `<button type="button" class="chip" aria-pressed="true" data-tagrm="${i}">${esc(t)} <span class="x" aria-label="Remove">×</span></button>`).join('')}</div>
            <div class="multi-row no-label"><input class="input" id="f-tag" list="dl-tags" placeholder="Add a tag, e.g. supplier, investor" dir="auto" autocomplete="off"><button type="button" class="btn" id="addTag">Add</button></div>
            ${tags.length ? `<div class="chips">${tags.slice(0, 12).map((t) => `<button type="button" class="chip btn-sm" data-tagadd="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="slots" style="grid-template-columns:1fr">${editorSlot('eventPhoto', 'Photo from the event (optional)')}</div>
          ${d.isNew ? `<label class="check"><input type="checkbox" id="keepEvent" ${d.keepEvent ? 'checked' : ''}><span>Use this date, place, event and tags for my next cards<br><span class="xs muted">Handy when you collect many cards at one event. Forgotten when the app locks.</span></span></label>` : ''}
        </div>
        <div class="panel">
          <div class="panel-h"><h2>Follow-up</h2></div>
          <div class="field"><label for="f-fudate">Remind me on</label><input class="input" type="date" id="f-fudate" value="${esc(c.followUp.date)}"></div>
          <div class="quick-dates">
            <button type="button" class="chip btn-sm" data-fu="1d">Tomorrow</button><button type="button" class="chip btn-sm" data-fu="3d">In 3 days</button>
            <button type="button" class="chip btn-sm" data-fu="7d">In 1 week</button><button type="button" class="chip btn-sm" data-fu="1m">In 1 month</button>
            ${c.followUp.date ? `<button type="button" class="chip btn-sm" data-fu="none">No follow-up</button>` : ''}
          </div>
          <div class="field"><label for="f-funote">What to do</label><input class="input" id="f-funote" value="${esc(c.followUp.note)}" dir="auto" placeholder="e.g. Send price list" autocomplete="off"></div>
        </div>
        <div class="panel">
          <div class="field"><label for="f-notes">Notes</label><textarea class="textarea" id="f-notes" data-f="notes" dir="auto" rows="4" placeholder="What you talked about, their needs, personal details to remember">${esc(c.notes)}</textarea></div>
        </div>
        <datalist id="dl-events">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
        <datalist id="dl-places">${places.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
        <datalist id="dl-tags">${allTags().map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
      </form>
    </div>
    <div class="save-bar"><div class="inner"><button class="btn" id="cancel2">Cancel</button><button class="btn btn-primary" id="save">${icon('check')} Save card</button></div></div>`;
    window.scrollTo(0, scrollY);
    bindEditor();
  }

  function syncDraftFromForm() {
    const d = S.draft;
    if (!d || !$('#editForm')) return;
    const c = d.c;
    $$('[data-f]').forEach((el) => (c[el.dataset.f] = el.value));
    $$('[data-m]').forEach((el) => (c.met[el.dataset.m] = el.value));
    $$('[data-pval]').forEach((el) => (c.phones[+el.dataset.pval].value = el.value));
    $$('[data-plabel]').forEach((el) => (c.phones[+el.dataset.plabel].label = el.value));
    $$('[data-eval]').forEach((el) => (c.emails[+el.dataset.eval] = el.value));
    c.followUp.date = $('#f-fudate').value;
    c.followUp.note = $('#f-funote').value;
    const k = $('#keepEvent');
    if (k) d.keepEvent = k.checked;
  }

  function rerenderEditor() { syncDraftFromForm(); renderEditor(); }

  function bindEditor() {
    const d = S.draft;
    const c = d.c;
    const cancel = () => {
      const n = S.draft;
      S.draft = null;
      Object.values(n.images).forEach((i) => i && URL.revokeObjectURL(i.url));
      S.screen = n.isNew ? 'list' : 'detail';
      renderApp();
    };
    $('#cancel').addEventListener('click', cancel);
    $('#cancel2').addEventListener('click', cancel);
    $('#editForm').addEventListener('submit', (e) => e.preventDefault());

    // Existing photos (encrypted) are decrypted for preview.
    ['cardFront', 'cardBack', 'eventPhoto'].forEach(async (k) => {
      if (!d.images[k] && c[k]) {
        try {
          const url = await imageUrl(c[k]);
          const f = $('#frame-' + k);
          if (f && url) f.innerHTML = `<img src="${url}" alt="">`;
        } catch (e) { /* ignore */ }
      }
    });

    $$('input[data-pick]').forEach((inp) => {
      inp.addEventListener('click', () => { S.picking = true; });
      inp.addEventListener('change', async () => {
        S.picking = false;
        markActive();
        const file = inp.files && inp.files[0];
        if (!file) return;
        const key = inp.dataset.pick;
        try {
          const blob = await normalizeImage(file, key === 'eventPhoto' ? 1400 : 1800);
          syncDraftFromForm();
          if (d.images[key]) URL.revokeObjectURL(d.images[key].url);
          d.images[key] = { blob, url: URL.createObjectURL(blob) };
          renderEditor();
          if (key === 'cardFront' && !d.lines.length && d.ocrLangs.length && typeof Tesseract !== 'undefined') runOcr();
        } catch (e) {
          console.error(e);
          toast('This photo could not be opened. Try another one.');
        }
      });
    });
    $$('[data-rot]').forEach((b) => b.addEventListener('click', async () => {
      const key = b.dataset.rot;
      let src = d.images[key] ? d.images[key].blob : null;
      if (!src && c[key]) {
        const url = await imageUrl(c[key]);
        src = await (await fetch(url)).blob();
      }
      if (!src) return;
      const blob = await rotateImage(src);
      syncDraftFromForm();
      if (d.images[key]) URL.revokeObjectURL(d.images[key].url);
      d.images[key] = { blob, url: URL.createObjectURL(blob) };
      renderEditor();
    }));
    $$('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.rm;
      syncDraftFromForm();
      if (d.images[key]) { URL.revokeObjectURL(d.images[key].url); d.images[key] = null; }
      if (c[key]) { d.removed.push(c[key]); c[key] = null; }
      renderEditor();
    }));

    // OCR controls
    $$('[data-lang]').forEach((b) => b.addEventListener('click', () => {
      const code = b.dataset.lang;
      d.ocrLangs = d.ocrLangs.includes(code) ? d.ocrLangs.filter((x) => x !== code) : d.ocrLangs.concat(code);
      rerenderEditor();
    }));
    $('#runOcr').addEventListener('click', runOcr);
    $$('[data-line]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.line;
      d.openLine = d.openLine === i ? null : i;
      rerenderEditor();
    }));
    $$('[data-assign]').forEach((b) => b.addEventListener('click', () => {
      syncDraftFromForm();
      const line = d.lines[d.openLine];
      assignLine(c, b.dataset.assign, line);
      d.assigned.add(line);
      d.openLine = null;
      renderEditor();
    }));

    // Multi-value fields
    $('#addPhone').addEventListener('click', () => { syncDraftFromForm(); c.phones.push({ label: 'mobile', value: '' }); renderEditor(); const l = $$('[data-pval]').pop(); if (l) l.focus(); });
    $('#addEmail').addEventListener('click', () => { syncDraftFromForm(); c.emails.push(''); renderEditor(); const l = $$('[data-eval]').pop(); if (l) l.focus(); });
    $$('[data-prm]').forEach((b) => b.addEventListener('click', () => { syncDraftFromForm(); c.phones.splice(+b.dataset.prm, 1); renderEditor(); }));
    $$('[data-erm]').forEach((b) => b.addEventListener('click', () => { syncDraftFromForm(); c.emails.splice(+b.dataset.erm, 1); renderEditor(); }));

    // Tags
    const addTag = (t) => {
      t = (t || '').trim();
      if (!t) return;
      syncDraftFromForm();
      if (!c.tags.some((x) => x.toLowerCase() === t.toLowerCase())) c.tags.push(t);
      renderEditor();
      $('#f-tag').focus();
    };
    $('#addTag').addEventListener('click', () => addTag($('#f-tag').value));
    $('#f-tag').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(e.target.value); } });
    $$('[data-tagadd]').forEach((b) => b.addEventListener('click', () => addTag(b.dataset.tagadd)));
    $$('[data-tagrm]').forEach((b) => b.addEventListener('click', () => { syncDraftFromForm(); c.tags.splice(+b.dataset.tagrm, 1); renderEditor(); }));

    // Follow-up quick dates
    $$('[data-fu]').forEach((b) => b.addEventListener('click', () => {
      syncDraftFromForm();
      const v = b.dataset.fu;
      const base = todayISO();
      c.followUp.date = v === 'none' ? '' : v === '1m' ? addMonths(base, 1) : addDays(base, parseInt(v, 10));
      if (v === 'none') c.followUp.note = '';
      c.followUp.done = false;
      renderEditor();
    }));

    $('#save').addEventListener('click', saveDraft);
  }

  function assignLine(c, field, line) {
    if (field === 'phone') {
      const v = line.replace(/^[^\d+(]*/, '').trim();
      if (!c.phones.some((p) => p.value.replace(/\D/g, '') === v.replace(/\D/g, ''))) c.phones.push({ label: /fax/i.test(line) ? 'fax' : 'mobile', value: v });
    } else if (field === 'email') {
      const m = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      const v = (m ? m[0] : line).replace(/\s+/g, '').toLowerCase();
      if (!c.emails.includes(v)) c.emails.push(v);
    } else if (field === 'address') {
      c.address = c.address ? c.address + ', ' + line : line;
    } else if (field === 'notes') {
      c.notes = c.notes ? c.notes + '\n' + line : line;
    } else {
      c[field] = line;
    }
  }

  async function saveDraft() {
    syncDraftFromForm();
    const d = S.draft;
    const c = d.c;
    c.phones = c.phones.filter((p) => p.value.trim());
    c.emails = c.emails.map((e) => e.trim()).filter(Boolean);
    c.name = c.name.trim(); c.title = c.title.trim(); c.company = c.company.trim(); c.website = c.website.trim();
    c.met.event = c.met.event.trim(); c.met.place = c.met.place.trim();
    if (!c.name && !c.company && !c.phones.length && !c.emails.length && !d.images.cardFront && !c.cardFront) {
      toast('Add at least a name, company, phone, email or card photo.');
      return;
    }
    const btn = $('#save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Saving…';
    try {
      for (const key of ['cardFront', 'cardBack', 'eventPhoto']) {
        const img = d.images[key];
        if (img) {
          if (c[key]) d.removed.push(c[key]);
          c[key] = await storeImage(img.blob);
          imageCache.set(c[key], img.url);
          trackUrl(img.url);
        }
      }
      for (const id of d.removed) { await idb.del('blobs', id); imageCache.delete(id); }
      if (d.lines.length) c.ocrLangs = d.ocrLangs.slice();
      await saveContact(c);
      if (d.isNew) {
        S.sticky = d.keepEvent ? { date: c.met.date, event: c.met.event, place: c.met.place, tags: c.tags.slice() } : null;
      }
      S.draft = null;
      S.detailId = c.id;
      S.screen = 'detail';
      renderApp();
      window.scrollTo(0, 0);
      afterSaveSheet(c, d.isNew);
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.innerHTML = `${icon('check')} Save card`;
      toast('Saving failed. Your phone may be out of storage.');
    }
  }

  // After saving: the card is in CardVault; offer the two other destinations.
  function afterSaveSheet(c, isNew) {
    openSheet(`<div class="panel-h"><h2>${isNew ? 'Card saved' : 'Changes saved'}</h2><span class="tag">${icon('lock').replace('<svg', '<svg width="12" height="12"')} In CardVault</span></div>
      <p class="muted small" dir="auto">${esc(c.name || c.company || 'This card')} is saved and encrypted in CardVault. Do you also want to:</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" id="asPhone">${icon('user')} Add to my phone contacts</button>
        <button class="btn" id="asExcel">${icon('sheet')} Export to Excel and send</button>
        ${isNew ? `<button class="btn btn-primary" id="asNext">${icon('camera')} Scan the next card</button>` : ''}
        <button class="btn btn-ghost" data-close>Done</button>
      </div>`);
    $('#asPhone').addEventListener('click', () => addToPhoneContacts(c));
    $('#asExcel').addEventListener('click', () => exportExcel([c], c.name || c.company));
    if ($('#asNext')) $('#asNext').addEventListener('click', () => { closeSheet(); startEdit(null); });
  }

  // ------------------------------------------------------------------
  // Images
  // ------------------------------------------------------------------
  async function loadBitmap(blob) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  function canvasToBlob(canvas, q = 0.85) {
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', q));
  }
  async function normalizeImage(file, maxDim) {
    const bmp = await loadBitmap(file);
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return canvasToBlob(cv, 0.85);
  }
  async function rotateImage(blob) {
    const bmp = await loadBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.height;
    cv.height = bmp.width;
    const ctx = cv.getContext('2d');
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    if (bmp.close) bmp.close();
    return canvasToBlob(cv, 0.88);
  }
  // Grayscale + contrast stretch + upscale small photos; helps Tesseract on glossy cards.
  async function ocrCanvas(blob) {
    const bmp = await loadBitmap(blob);
    const long = Math.max(bmp.width, bmp.height);
    const scale = long < 1400 ? 1400 / long : Math.min(1, 2200 / long);
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const px = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = g;
      hist[g]++;
    }
    const total = px.length / 4;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // ------------------------------------------------------------------
  // OCR (Tesseract, on device)
  // ------------------------------------------------------------------
  const ocr = { worker: null, langs: '', loading: null };
  function terminateOcr() {
    if (ocr.worker) { try { ocr.worker.terminate(); } catch (e) {} }
    ocr.worker = null;
    ocr.langs = '';
  }
  function setOcrProgress(frac, text) {
    const bar = $('#ocrProg > div');
    if (bar) bar.style.width = Math.round(frac * 100) + '%';
    const st = $('#ocrStatus');
    if (st && text) st.textContent = text;
  }
  let ocrPhase = 'Preparing';
  // Language files ship with the app: binary .gz, or base64 text where binary files can't be served.
  async function loadLangData(base, code) {
    try {
      const r = await fetch(base + code + '.traineddata.gz');
      if (r.ok) {
        const b = new Uint8Array(await r.arrayBuffer());
        if (b[0] === 31 && b[1] === 139) return b;
      }
    } catch (e) { /* try the text copy */ }
    const r2 = await fetch(base + code + '.traineddata.gz.b64.txt');
    if (!r2.ok) throw new Error('Missing language file: ' + code);
    return b64.to((await r2.text()).trim());
  }
  async function getWorker(langs) {
    const key = langs.slice().sort().join('+');
    if (ocr.worker && ocr.langs === key) return ocr.worker;
    terminateOcr();
    const base = new URL('vendor/tesseract/', location.href).href;
    setOcrProgress(0.05, 'Loading language files…');
    const langData = [];
    for (const code of langs) langData.push({ code, data: await loadLangData(base + 'lang/', code) });
    const w = await Tesseract.createWorker(langData, 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core',
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text') setOcrProgress(0.3 + m.progress * 0.7, `${ocrPhase}: ${Math.round(m.progress * 100)}%`);
        else if (m.status && /load|initializ/i.test(m.status)) setOcrProgress(Math.min(0.3, (m.progress || 0) * 0.3), 'Loading language files…');
      },
    });
        ocr.worker = w;
    ocr.langs = key;
    return w;
  }

  async function runOcr() {
    const d = S.draft;
    if (!d || d.ocrBusy) return;
    if (typeof Tesseract === 'undefined') { toast('Card reading is not available in this browser.'); return; }
    syncDraftFromForm();
    const sources = [];
    for (const key of ['cardFront', 'cardBack']) {
      if (d.images[key]) sources.push([key, d.images[key].blob]);
      else if (d.c[key]) {
        const url = await imageUrl(d.c[key]);
        if (url) sources.push([key, await (await fetch(url)).blob()]);
      }
    }
    if (!sources.length) return;
    d.ocrBusy = true;
    renderEditor();
    try {
      const langs = d.ocrLangs.slice();
      // Arabic should be listed first when present so right-to-left lines read better.
      langs.sort((a, b) => (a === 'ara' ? -1 : b === 'ara' ? 1 : 0));
      const w = await getWorker(langs);
      const texts = [];
      for (const [key, blob] of sources) {
        ocrPhase = key === 'cardFront' ? 'Reading front' : 'Reading back';
        const cv = await ocrCanvas(blob);
        // Pass 1: normal page layout. Keeps the reading order of the card.
        await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' });
        let t = (await w.recognize(cv)).data.text || '';
        // Pass 2 (front only, when no name was found): "sparse text" mode picks up
        // big or isolated lines, common with Arabic names and logos.
        if (key === 'cardFront' && !CardParser.parseCard(t).name) {
          ocrPhase = 'Second look';
          await w.setParameters({ tessedit_pageseg_mode: '11' });
          const t2 = (await w.recognize(cv)).data.text || '';
          const seen = new Set(t.split('\n').map((l) => norm(l).replace(/\s+/g, '')));
          t += '\n' + t2.split('\n').filter((l) => l.trim() && !seen.has(norm(l).replace(/\s+/g, ''))).join('\n');
        }
        texts.push(t);
      }
      const text = texts.join('\n').replace(/\n{2,}/g, '\n').trim();
      if (!S.draft || S.draft !== d) return;
      d.c.ocrText = text;
      const p = CardParser.parseCard(text);
      const c = d.c;
      const fillIfEmpty = (k, v) => { if (v && !String(c[k] || '').trim()) { c[k] = v; d.assigned.add(v); } };
      fillIfEmpty('name', p.name);
      fillIfEmpty('title', p.title);
      fillIfEmpty('company', p.company);
      fillIfEmpty('website', p.website);
      fillIfEmpty('address', p.address);
      p.phones.forEach((ph) => { if (!c.phones.some((x) => x.value.replace(/\D/g, '') === ph.value.replace(/\D/g, ''))) c.phones.push(ph); });
      p.emails.forEach((e) => { if (!c.emails.includes(e)) c.emails.push(e); });
      d.lines = p.lines;
      p.lines.forEach((l) => {
        if (p.emails.some((e) => l.toLowerCase().replace(/\s/g, '').includes(e))) d.assigned.add(l);
        if (p.phones.some((ph) => l.includes(ph.value))) d.assigned.add(l);
        if (p.address && p.address.includes(l)) d.assigned.add(l);
      });
      d.ocrBusy = false;
      renderEditor();
      toast(text ? 'Card read. Check the fields.' : 'No text found. Try a sharper photo.');
    } catch (e) {
      console.error(e);
      d.ocrBusy = false;
      terminateOcr();
      renderEditor();
      const st = $('#ocrStatus');
      if (st) st.textContent = 'Card reading failed on this device. You can still type the details.';
    }
  }

  // ------------------------------------------------------------------
  // Export: vCard, calendar, backup
  // ------------------------------------------------------------------
  const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  function fold(line) {
    // RFC 6350/5545 line folding at 75 octets (approximate by characters)
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }
  function contextNote(c) {
    const met = [c.met && c.met.event ? 'Met at ' + c.met.event : 'Met', c.met && c.met.place ? 'in ' + c.met.place : '', c.met && c.met.date ? 'on ' + c.met.date : ''].filter(Boolean).join(' ');
    return [
      c.met && (c.met.event || c.met.place || c.met.date) ? met : '',
      (c.tags || []).length ? 'Tags: ' + c.tags.join(', ') : '',
      c.followUp && c.followUp.date ? `Follow-up ${c.followUp.date}${c.followUp.note ? ': ' + c.followUp.note : ''}${c.followUp.done ? ' (done)' : ''}` : '',
      c.notes || '',
      'Saved with CardVault',
    ].filter(Boolean).join('\n');
  }
  // Small JPEG of the card front for the phone contact's picture.
  async function cardThumbBase64(c) {
    if (!c.cardFront) return '';
    try {
      const url = await imageUrl(c.cardFront);
      const blob = await (await fetch(url)).blob();
      const bmp = await loadBitmap(blob);
      const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      return b64.from(new Uint8Array(await (await canvasToBlob(cv, 0.75)).arrayBuffer()));
    } catch (e) { return ''; }
  }
  function vcardFor(c, photoB64) {
    const parts = (c.name || '').trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop() : '';
    const first = parts.join(' ');
    const typeMap = { mobile: 'CELL', work: 'WORK,VOICE', phone: 'VOICE', fax: 'WORK,FAX', home: 'HOME,VOICE' };
    const lines = [
      'BEGIN:VCARD', 'VERSION:3.0',
      `N:${vEsc(last)};${vEsc(first)};;;`,
      `FN:${vEsc(c.name || c.company || 'Contact')}`,
      c.company ? `ORG:${vEsc(c.company)}` : '',
      c.title ? `TITLE:${vEsc(c.title)}` : '',
      ...(c.phones || []).map((p) => `TEL;TYPE=${typeMap[p.label] || 'VOICE'}:${p.value}`),
      ...(c.emails || []).map((e) => `EMAIL;TYPE=INTERNET:${e}`),
      c.website ? `URL:${vEsc(c.website)}` : '',
      c.address ? `ADR;TYPE=WORK:;;${vEsc(c.address)};;;;` : '',
      (c.tags || []).length ? `CATEGORIES:${c.tags.map(vEsc).join(',')}` : '',
      `NOTE:${vEsc(contextNote(c))}`,
      photoB64 ? `PHOTO;ENCODING=b;TYPE=JPEG:${photoB64}` : '',
      'END:VCARD',
    ].filter(Boolean);
    return lines.map(fold).join('\r\n');
  }
  function safeName(s) { return (String(s || 'contact').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'contact').slice(0, 40); }
  async function addToPhoneContacts(c) {
    toast('Preparing contact…');
    const photo = await cardThumbBase64(c);
    const file = new File([vcardFor(c, photo) + '\r\n'], safeName(c.name || c.company) + '.vcf', { type: 'text/vcard' });
    const markDone = async () => {
      c.exportedToPhoneAt = Date.now();
      await saveContact(c);
      if (S.screen === 'detail') renderDetail();
    };
    offerFile(file, {
      title: 'Add to phone contacts',
      body: IS_IOS
        ? 'Tap <strong>Open in Contacts</strong>, choose <strong>Contacts</strong> in the list (swipe the row of apps if needed), then tap <strong>Create New Contact</strong>. If Contacts is not offered, use <strong>Download</strong>, open the file, and tap <strong>Create New Contact</strong>.'
        : 'Tap <strong>Open in Contacts</strong> and choose your <strong>Contacts</strong> app. Or use <strong>Download</strong>, then open the file from your notifications and tap <strong>Import</strong> or <strong>Save</strong>.',
      shareLabel: 'Open in Contacts',
      downloadLabel: 'Download contact card (.vcf)',
      downloadToast: 'Contact card downloaded. Open it to add it to your phone.',
      foot: 'Your phone keeps its own copy, outside CardVault’s encryption. Changes you make later in CardVault are not copied automatically: add the card again and choose “Add to Existing Contact”.',
      onDone: markDone,
    });
  }

  // ---------- Excel ----------
  const EXCEL_COLUMNS = [
    { header: 'Name', width: 24 }, { header: 'Job title', width: 24 }, { header: 'Company', width: 26 },
    { header: 'Mobile', width: 20 }, { header: 'Work phone', width: 20 }, { header: 'Other phones', width: 22 },
    { header: 'Email', width: 30 }, { header: 'Other emails', width: 26 }, { header: 'Website', width: 24 },
    { header: 'Address', width: 34 }, { header: 'Date met', width: 12 }, { header: 'Event', width: 26 },
    { header: 'Place', width: 22 }, { header: 'Tags', width: 22 }, { header: 'Follow-up date', width: 14 },
    { header: 'Follow-up', width: 28 }, { header: 'Follow-up done', width: 10 }, { header: 'Notes', width: 44 },
    { header: 'Added to CardVault', width: 18 },
  ];
  function excelRow(c) {
    const phones = (c.phones || []).slice();
    const take = (label) => { const i = phones.findIndex((p) => p.label === label); return i >= 0 ? phones.splice(i, 1)[0].value : ''; };
    const mobile = take('mobile');
    const work = take('work') || take('phone');
    const others = phones.map((p) => `${PHONE_LABELS[p.label] || 'Phone'}: ${p.value}`).join('; ');
    const emails = c.emails || [];
    return [
      c.name, c.title, c.company, mobile, work, others, emails[0] || '', emails.slice(1).join('; '), c.website, c.address,
      c.met && c.met.date, c.met && c.met.event, c.met && c.met.place, (c.tags || []).join(', '),
      c.followUp && c.followUp.date, c.followUp && c.followUp.note, c.followUp && c.followUp.date ? (c.followUp.done ? 'Yes' : 'No') : '',
      c.notes, c.createdAt ? isoDate(new Date(c.createdAt)) : '',
    ];
  }
  function exportExcel(list, label) {
    if (!list.length) { toast('No cards to export.'); return; }
    const sorted = list.slice().sort((a, b) => (a.name || a.company || '').localeCompare(b.name || b.company || ''));
    const bytes = CardXlsx.buildXlsx(EXCEL_COLUMNS, sorted.map(excelRow), 'Contacts');
    const name = (list.length === 1 ? safeName(label) : `CardVault-${safeName(label || 'contacts')}-${todayISO()}`) + '.xlsx';
    const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    offerFile(file, {
      title: list.length === 1 ? 'Excel file ready' : `Excel file ready: ${list.length} cards`,
      body: 'Tap <strong>Send or save…</strong> to choose WhatsApp, WeChat, Mail, ' + (IS_IOS ? 'AirDrop or <strong>Save to Files</strong>.' : 'Bluetooth, Drive or <strong>Save</strong>.'),
      downloadToast: 'Excel file downloaded',
      foot: 'The Excel file is not encrypted. Anyone who receives it can read it.',
    });
  }

  function exportVCard(list) {
    const data = list.map(vcardFor).join('\r\n') + '\r\n';
    const name = list.length === 1 ? safeName(list[0].name || list[0].company) + '.vcf' : `cardvault-contacts-${todayISO()}.vcf`;
    downloadFile(name, 'text/vcard', data);
    toast(list.length === 1 ? 'Contact file ready. Open it to add to your phone.' : `${list.length} contacts exported`);
  }
  function exportICS(c) {
    if (!c || !c.followUp || !c.followUp.date) return;
    const d = c.followUp.date.replace(/-/g, '');
    const next = addDays(c.followUp.date, 1).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const who = c.name || c.company || 'contact';
    const desc = [c.followUp.note, [c.title, c.company].filter(Boolean).join(', '), (c.phones || []).map((p) => p.value).join(' / '), (c.emails || []).join(' / '), c.met && c.met.event ? 'Met at ' + c.met.event : ''].filter(Boolean).join('\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CardVault//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${c.id}-followup@cardvault`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${vEsc('Follow up: ' + who + (c.followUp.note ? ' – ' + c.followUp.note : ''))}`,
      `DESCRIPTION:${vEsc(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${vEsc('Follow up: ' + who)}`, 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].map(fold).join('\r\n');
    downloadFile(`follow-up-${safeName(who)}.ics`, 'text/calendar', ics);
    toast('Calendar file ready. Open it to add the reminder.');
  }

  async function exportBackup() {
    const contacts = await idb.all('contacts');
    const blobs = await idb.all('blobs');
    const pack = (r) => ({ id: r.id, iv: b64.from(r.iv), ct: b64.from(r.ct) });
    const v = S.vault;
    const data = {
      format: 'cardvault-backup', version: 1, createdAt: new Date().toISOString(),
      kdf: { name: 'PBKDF2-SHA256', salt: b64.from(v.salt), iterations: v.iterations },
      check: { iv: b64.from(v.check.iv), ct: b64.from(v.check.ct) },
      contacts: contacts.map(pack), blobs: blobs.map(pack),
    };
    const file = new File([JSON.stringify(data)], `cardvault-backup-${todayISO()}.cardvault`, { type: 'application/octet-stream' });
    const done = async () => { S.settings.lastBackupAt = Date.now(); await saveSettings(); if (S.tab === 'settings' && S.screen === 'list') renderApp(); };
    offerFile(file, {
      title: `Backup of ${contacts.length} cards ready`,
      body: IS_IOS ? 'Tap <strong>Send or save…</strong>, then <strong>Save to Files</strong> and pick iCloud Drive.' : 'Tap <strong>Send or save…</strong> and pick Google Drive, or download it.',
      downloadToast: 'Backup downloaded',
      foot: 'The backup stays encrypted with your master password.',
      onDone: done,
    });
  }

  async function importBackup(data, password) {
    if (!data || data.format !== 'cardvault-backup') throw new Error('format');
    const unpack = (r) => ({ id: r.id, iv: b64.to(r.iv), ct: b64.to(r.ct) });
    const salt = b64.to(data.kdf.salt);
    const key = password == null ? S.key : await deriveKey(password, salt, data.kdf.iterations);
    if (!(await verifyKey(key, unpack(data.check)))) throw new Error('password');
    let added = 0, updated = 0, skipped = 0;
    const blobsById = new Map(data.blobs.map((b) => [b.id, b]));
    for (const r of data.contacts) {
      const c = await openContact(key, unpack(r));
      const existing = S.contacts.find((x) => x.id === c.id);
      if (existing && existing.updatedAt >= c.updatedAt) { skipped++; continue; }
      if (key !== S.key) {
        for (const id of imageIds(c)) {
          const b = blobsById.get(id);
          if (!b) continue;
          const bytes = await decryptBytes(key, unpack(b), 'blob:' + id);
          await idb.put('blobs', await sealBlob(S.key, id, bytes));
        }
      } else {
        for (const id of imageIds(c)) { const b = blobsById.get(id); if (b) await idb.put('blobs', unpack(b)); }
      }
      await idb.put('contacts', await sealContact(S.key, c));
      const i = S.contacts.findIndex((x) => x.id === c.id);
      if (i >= 0) S.contacts[i] = c; else S.contacts.push(c);
      existing ? updated++ : added++;
    }
    return { added, updated, skipped };
  }

  async function changePassword(current, next) {
    const oldKey = await deriveKey(current, S.vault.salt, S.vault.iterations);
    if (!(await verifyKey(oldKey, S.vault.check))) throw new Error('current');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(next, salt, KDF_ITERATIONS);
    const check = await makeCheck(key);
    const contacts = await idb.all('contacts');
    const blobs = await idb.all('blobs');
    const newContacts = [];
    for (const r of contacts) newContacts.push(await sealContact(key, await openContact(oldKey, r)));
    const newBlobs = [];
    for (const r of blobs) newBlobs.push(await sealBlob(key, r.id, await decryptBytes(oldKey, r, 'blob:' + r.id)));
    const vault = { v: 1, salt, iterations: KDF_ITERATIONS, check, createdAt: S.vault.createdAt, changedAt: Date.now() };
    await run(['contacts', 'blobs', 'meta'], 'readwrite', (t) => {
      const cs = t.objectStore('contacts'), bs = t.objectStore('blobs');
      newContacts.forEach((r) => cs.put(r));
      newBlobs.forEach((r) => bs.put(r));
      t.objectStore('meta').put(vault, 'vault');
    });
    S.vault = vault;
    S.key = key;
  }

  // ------------------------------------------------------------------
  // Settings tab
  // ------------------------------------------------------------------
  function viewSettings() {
    const p = S.settingsPanel;
    const withPhotos = S.contacts.filter((c) => c.cardFront).length;
    return `<header class="topbar"><div class="topbar-row"><h1>Settings</h1></div></header>
    <div class="content">
      <div class="panel">
        <div class="panel-h"><h2>Security</h2><span class="tag">${icon('lock').replace('<svg', '<svg width="12" height="12"')} AES-256</span></div>
        <div class="field"><label for="autoLock">Lock automatically after</label>
          <select class="select" id="autoLock">${[1, 2, 5, 10, 15].map((m) => `<option value="${m}" ${S.settings.autoLockMin === m ? 'selected' : ''}>${m} minute${m > 1 ? 's' : ''} without use</option>`).join('')}</select>
          <span class="xs muted">The app also locks when it stays in the background for more than 1 minute.</span></div>
        ${p === 'password' ? `<form id="pwForm" class="panel" style="background:var(--surface-2);border:0" novalidate>
            ${pwField('cur', 'Current password', 'current-password')}
            ${pwField('new1', 'New password', 'new-password')}
            <span class="xs muted">At least 12 characters, with three of: lowercase, capitals, numbers, symbols.</span>
            ${pwField('new2', 'New password again', 'new-password')}
            <p class="error" id="pwErr" hidden></p>
            <div class="btn-row"><button type="button" class="btn" id="pwCancel">Cancel</button><button type="submit" class="btn btn-primary" id="pwGo">Change password</button></div>
          </form>` : `<div class="btn-row"><button class="btn" id="pwOpen">Change master password</button><button class="btn" id="lockNow2">${icon('lock')} Lock now</button></div>`}
      </div>

      <div class="panel">
        <div class="panel-h"><h2>Card reading</h2></div>
        <div class="field"><span>Languages selected for new cards</span>
          <div class="chips wrap">${LANGS.map((l) => `<button class="chip" data-deflang="${l.code}" aria-pressed="${S.settings.ocrLangs.includes(l.code)}">${l.label}</button>`).join('')}</div>
          <span class="xs muted">Pick only the languages you usually see: each extra language makes reading slower. The language files are part of the app, so nothing is downloaded or sent.</span></div>
      </div>

      <div class="panel">
        <div class="panel-h"><h2>Backup</h2><span class="xs muted mono">${S.contacts.length} cards · ${withPhotos} with photos</span></div>
        <p class="small muted">Your cards exist only on this phone. Export a backup regularly and keep it in your files or cloud drive. The backup stays encrypted with your master password.</p>
        <div class="btn-row">
          <button class="btn" id="bkExport">${icon('download')} Export backup</button>
          <label class="btn file-btn">${icon('upload')} Import backup<input type="file" id="bkImport" accept=".cardvault,application/json,application/octet-stream"></label>
        </div>
        ${p === 'import' && S.importData ? `<form id="impForm" class="panel" style="background:var(--surface-2);border:0" novalidate>
            <p class="small">This backup was made with a different password. Enter the password used when it was created.</p>
            ${pwField('impPw', 'Backup password', 'off')}
            <p class="error" id="impErr" hidden></p>
            <div class="btn-row"><button type="button" class="btn" id="impCancel">Cancel</button><button type="submit" class="btn btn-primary" id="impGo">Import</button></div>
          </form>` : ''}
        <p class="xs muted">${S.settings.lastBackupAt ? `Last backup: ${esc(new Date(S.settings.lastBackupAt).toLocaleDateString())}.` : 'No backup made yet on this phone.'}</p>
      </div>

      <div class="panel">
        <div class="panel-h"><h2>Export</h2></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn" id="xlsAll" ${S.contacts.length ? '' : 'disabled'}>${icon('sheet')} Export all cards to Excel</button>
          <button class="btn" id="vcfAll" ${S.contacts.length ? '' : 'disabled'}>${icon('user')} Export all as contacts file (.vcf)</button>
        </div>
        <p class="xs muted">Excel and contacts files are not encrypted. Use them to share cards with a colleague or move them to another app.</p>
      </div>

      <div class="panel">
        <div class="panel-h"><h2>Privacy</h2></div>
        <ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          <li>No account, no server, no tracking. CardVault never sends your data anywhere.</li>
          <li>Cards, photos and notes are encrypted on this phone with AES-256. The key comes from your master password and is erased from memory when the app locks.</li>
          <li>Text on the cards is read by the phone itself.</li>
          <li>After 5 wrong passwords the app makes you wait, and the wait doubles each time.</li>
        </ul>
        <p class="xs muted" id="storageInfo">Checking storage…</p>
      </div>

      <div class="panel">
        <div class="panel-h"><h2>Erase</h2></div>
        <button class="btn btn-danger" id="wipe">${icon('trash')} Erase all cards on this device</button>
      </div>
      <div class="panel">
        <div class="panel-h"><h2>App version</h2><span class="mono small">${APP_VERSION}</span></div>
        <p class="small muted">Updates install by themselves when the phone is online. Your saved cards are never touched by an update.</p>
        <div class="btn-row"><button class="btn" id="checkUpd">${icon('refresh')} Check for updates</button><button class="btn" id="showNew">What’s new</button></div>
        <p class="xs muted" id="updStatus"></p>
      </div>
      <p class="xs muted mono" style="text-align:center">CardVault ${APP_VERSION} · personal edition</p>
    </div>`;
  }

  function bindSettings() {
    $('#autoLock').addEventListener('change', async (e) => { S.settings.autoLockMin = +e.target.value; await saveSettings(); toast('Saved'); });
    $$('[data-deflang]').forEach((b) => b.addEventListener('click', async () => {
      const code = b.dataset.deflang;
      const cur = S.settings.ocrLangs;
      S.settings.ocrLangs = cur.includes(code) ? cur.filter((x) => x !== code) : cur.concat(code);
      if (!S.settings.ocrLangs.length) S.settings.ocrLangs = ['eng'];
      await saveSettings();
      renderApp();
    }));
    if ($('#lockNow2')) $('#lockNow2').addEventListener('click', () => lock('Locked.'));
    if ($('#pwOpen')) $('#pwOpen').addEventListener('click', () => { S.settingsPanel = 'password'; renderApp(); $('#cur').focus(); });
    if ($('#pwCancel')) $('#pwCancel').addEventListener('click', () => { S.settingsPanel = null; renderApp(); });
    if ($('#pwForm')) $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#pwErr');
      err.hidden = true;
      const cur = $('#cur').value, a = $('#new1').value, b = $('#new2').value;
      if (!passwordScore(a).ok) { err.textContent = 'The new password is too weak.'; err.hidden = false; return; }
      if (a !== b) { err.textContent = 'The two new passwords are different.'; err.hidden = false; return; }
      const go = $('#pwGo');
      go.disabled = true;
      go.innerHTML = '<span class="spin"></span> Re-encrypting…';
      try {
        await changePassword(cur, a);
        S.settingsPanel = null;
        renderApp();
        toast('Password changed. Make a new backup.');
      } catch (ex) {
        go.disabled = false;
        go.textContent = 'Change password';
        err.textContent = ex.message === 'current' ? 'The current password is wrong.' : 'Something went wrong. Nothing was changed.';
        err.hidden = false;
      }
    });
    $('#bkExport').addEventListener('click', exportBackup);
    $('#bkImport').addEventListener('click', () => { S.picking = true; });
    $('#bkImport').addEventListener('change', async (e) => {
      S.picking = false;
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (ex) { toast('This file is not a CardVault backup.'); return; }
      if (!data || data.format !== 'cardvault-backup') { toast('This file is not a CardVault backup.'); return; }
      const sameVault = data.kdf && data.kdf.salt === b64.from(S.vault.salt);
      if (sameVault) {
        try { reportImport(await importBackup(data, null)); }
        catch (ex) { S.importData = data; S.settingsPanel = 'import'; renderApp(); }
      } else {
        S.importData = data;
        S.settingsPanel = 'import';
        renderApp();
        $('#impPw').focus();
      }
    });
    if ($('#impCancel')) $('#impCancel').addEventListener('click', () => { S.importData = null; S.settingsPanel = null; renderApp(); });
    if ($('#impForm')) $('#impForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const go = $('#impGo');
      go.disabled = true;
      go.innerHTML = '<span class="spin"></span> Importing…';
      try {
        const r = await importBackup(S.importData, $('#impPw').value);
        S.importData = null;
        S.settingsPanel = null;
        reportImport(r);
      } catch (ex) {
        go.disabled = false;
        go.textContent = 'Import';
        const err = $('#impErr');
        err.textContent = ex.message === 'password' ? 'Wrong password for this backup.' : 'The backup could not be read.';
        err.hidden = false;
      }
    });
    $('#vcfAll').addEventListener('click', () => exportVCard(S.contacts));
    $('#xlsAll').addEventListener('click', () => exportExcel(S.contacts, 'all-cards'));
    $('#showNew').addEventListener('click', showWhatsNew);
    $('#checkUpd').addEventListener('click', checkForUpdate);
    $('#wipe').addEventListener('click', () => {
      openSheet(`<h2>Erase all cards?</h2>
        <p class="muted">All ${S.contacts.length} cards, photos and the master password are deleted from this phone. This cannot be undone. Export a backup first if you may need them.</p>
        <div class="field"><label for="wipeConfirm">Type ERASE to confirm</label><input class="input" id="wipeConfirm" autocomplete="off" autocapitalize="characters"></div>
        <div class="btn-row"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="wipeGo" disabled>Erase everything</button></div>`);
      $('#wipeConfirm').addEventListener('input', (ev) => ($('#wipeGo').disabled = ev.target.value.trim().toUpperCase() !== 'ERASE'));
      $('#wipeGo').addEventListener('click', wipeAll);
    });
    (async () => {
      const el = $('#storageInfo');
      try {
        const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
        const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (el) el.textContent = `${est ? `Using ${(est.usage / 1048576).toFixed(1)} MB on this device. ` : ''}${persisted ? 'Storage is protected from automatic clean-up.' : 'The browser may clear storage if the phone runs low on space: keep backups, and add CardVault to your home screen.'}`;
      } catch (e) { if (el) el.textContent = ''; }
    })();
  }
  function reportImport(r) {
    renderApp();
    toast(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} already up to date`);
  }

  // ------------------------------------------------------------------
  // Example cards (clearly tagged so they are easy to delete)
  // ------------------------------------------------------------------
  async function addExamples() {
    const t = todayISO();
    const ex = [
      { name: 'Claire Moreau', title: 'Directrice Achats', company: 'Maison Verdier SAS', phones: [{ label: 'mobile', value: '+33 6 48 21 90 17' }], emails: ['c.moreau@maisonverdier.fr'], website: 'www.maisonverdier.fr', address: '18 rue Lafayette, 75009 Paris', met: { date: addDays(t, -9), event: 'Paris trade fair 2026', place: 'Paris Expo, Porte de Versailles' }, tags: ['Example', 'buyer'], notes: 'Looking for a new supplier for Q1. Prefers email. Asked for samples.', followUp: { date: addDays(t, -1), note: 'Send samples and price list', done: false } },
      { name: 'Youssef El Amrani', title: 'Head of Partnerships', company: 'Atlas Logistics', phones: [{ label: 'work', value: '+212 522 48 31 00' }, { label: 'mobile', value: '+212 661 23 45 67' }], emails: ['y.elamrani@atlaslogistics.ma'], website: 'atlaslogistics.ma', address: 'Bd Zerktouni, Casablanca', met: { date: addDays(t, -9), event: 'Paris trade fair 2026', place: 'Paris Expo, Porte de Versailles' }, tags: ['Example', 'partner'], notes: 'Warehousing in Tanger Med. Interested in a pilot. Speaks French and Arabic.', followUp: { date: addDays(t, 5), note: 'Call about the pilot', done: false } },
      { name: 'Hannah Becker', title: 'CFO', company: 'Nordlicht Ventures GmbH', phones: [{ label: 'mobile', value: '+49 170 555 0192' }], emails: ['hannah@nordlicht.vc'], website: 'nordlicht.vc', address: '', met: { date: addDays(t, -30), event: '', place: 'Berlin, dinner at the embassy' }, tags: ['Example', 'investor'], notes: 'Introduced by Marc. Follow Series A next spring.', followUp: { date: '', note: '', done: false } },
    ];
    for (const e of ex) {
      const c = Object.assign(blankContact(), e, { id: uid(), createdAt: Date.now(), ocrText: '' });
      await saveContact(c);
    }
    toast('3 example cards added. Delete them any time (tag: Example).');
    renderApp();
  }

  // ------------------------------------------------------------------
  // Updates
  // ------------------------------------------------------------------
  // The app's code is cached by the service worker. When a new version is published,
  // the phone downloads it in the background; the cards in IndexedDB are not touched.
  let swReg = null;
  let updateReady = false;
  function showUpdateBanner() {
    if ($('#updBanner')) return;
    const b = document.createElement('div');
    b.id = 'updBanner';
    b.className = 'update-banner';
    b.innerHTML = `<span>A new version of CardVault is ready.</span><button class="btn btn-sm btn-primary" id="updGo">Restart now</button>`;
    document.body.appendChild(b);
    $('#updGo').addEventListener('click', () => {
      if (S.screen === 'edit') { toast('Save or cancel the card first.'); return; }
      location.reload();
    });
  }
  async function checkForUpdate() {
    const st = $('#updStatus');
    if (!swReg) { if (st) st.textContent = 'Updates work once CardVault is installed from its web address.'; return; }
    if (st) st.textContent = 'Checking…';
    try {
      await swReg.update();
      setTimeout(() => {
        const s2 = $('#updStatus');
        if (!s2) return;
        s2.textContent = updateReady || swReg.installing || swReg.waiting ? 'Update found. Tap “Restart now” when you are ready.' : `You have the latest version (${APP_VERSION}).`;
      }, 2500);
    } catch (e) {
      if (st) st.textContent = 'Could not check. Connect to the internet and try again.';
    }
  }
  function registerSW() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
    try {
      let controller = navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then((reg) => {
        swReg = reg;
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && Date.now() - lastCheck > 3600000) { lastCheck = Date.now(); reg.update().catch(() => {}); }
        });
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const had = !!controller;
        controller = navigator.serviceWorker.controller;
        if (!had) return; // first install of the offline copy: nothing to restart
        updateReady = true;
        showUpdateBanner();
      });
    } catch (e) { /* not available */ }
  }
  function showWhatsNew() {
    openSheet(`<h2>What’s new in CardVault ${APP_VERSION}</h2>
      <ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${WHATS_NEW.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="xs muted">All your saved cards were kept.</p>
      <button class="btn btn-primary" data-close>OK</button>`);
  }
  async function afterUnlock() {
    if (S.settings.seenVersion !== APP_VERSION) {
      const first = !S.settings.seenVersion && !S.contacts.length;
      S.settings.seenVersion = APP_VERSION;
      await saveSettings();
      if (!first) showWhatsNew();
    }
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  async function boot() {
    try {
      if (!window.crypto || !crypto.subtle || !window.indexedDB) throw new Error('unsupported');
      await openDB();
      S.vault = (await idb.get('meta', 'vault')) || null;
      await loadSettings();
      renderLock();
    } catch (e) {
      console.error(e);
      app().innerHTML = `<main class="lock"><div class="lock-mark">${LOGO}</div><h1>CardVault</h1>
        <p class="note danger">This browser cannot store encrypted data here. Open CardVault in Safari (iPhone) or Chrome (Android), and not in a private window.</p></main>`;
    }
    registerSW();
  }
  boot();
})();
