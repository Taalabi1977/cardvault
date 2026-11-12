/*
 * CardVault – business card text parser.
 * Turns raw OCR text into structured fields. Pure functions, no I/O,
 * so it runs the same in the browser and in Node tests.
 * Handles Latin scripts (EN/FR/ES/DE) and Arabic.
 */
(function (root) {
  'use strict';

  const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
  const toWesternDigits = (s) =>
    s.replace(ARABIC_DIGITS, (d) => {
      const c = d.charCodeAt(0);
      return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
    });

  const EMAIL_RE = /[A-Z0-9._%+-]+\s?@\s?[A-Z0-9-]+(?:\s?\.\s?[A-Z0-9-]+)*\s?\.\s?[A-Z]{2,}/gi;
  const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|io|co|ai|app|dev|fr|ma|dz|tn|de|es|it|be|ch|nl|uk|eu|ae|sa|qa|kw|eg|ca|us|pt|lu)(?:\/[^\s]*)?)(?![a-z0-9])/i;
  const PHONE_RE = /\+?\s?\(?\d[\d\s().\/–-]{6,}\d/g;

  const TITLE_RE = new RegExp(
    '\\b(ceo|cto|cfo|coo|cmo|cio|md|founder|co-founder|cofounder|president|vice[- ]president|vp|director|manager|head of|lead|engineer|consultant|partner|officer|executive|specialist|analyst|advisor|adviser|associate|assistant|representative|coordinator|architect|developer|designer|owner|chairman|attorney|lawyer|doctor|professor|' +
      'directeur|directrice|responsable|ingénieur|ingenieur|gérant|gérante|gerant|chef de|chargé|chargée|conseiller|conseillère|commercial|commerciale|fondateur|fondatrice|président|présidente|associé|associée|avocat|avocate|' +
      'gerente|jefe|ingeniero|ingeniera|asesor|asesora|socio|presidente|' +
      'geschäftsführer|geschäftsführerin|leiter|leiterin|berater|beraterin|vertrieb)\\b' +
      '|مدير|مديرة|رئيس|رئيسة|مهندس|مهندسة|مستشار|مستشارة|مسؤول|مسؤولة|مؤسس|شريك|محامي',
    'i'
  );

  const COMPANY_RE = new RegExp(
    '\\b(inc|ltd|llc|llp|plc|gmbh|ag|kg|s\\.?a\\.?r\\.?l|sarl|sas|sasu|srl|s\\.l|s\\.a|sa|spa|bv|nv|' +
      'group|groupe|grupo|gruppe|company|compagnie|corp|corporation|holding|industries|international|technologies|technology|solutions|systems|consulting|services|' +
      'bank|banque|banco|université|university|universidad|associates|partners|labs?|studio|agency|agence|agencia|cabinet|société|societe|' +
      'hotel|hôtel|clinic|clinique|hospital|foundation|fondation|institute|institut)\\b' +
      '|شركة|مجموعة|مؤسسة|بنك|جامعة|مكتب',
    'i'
  );

  const ADDRESS_RE = new RegExp(
    '\\b(rue|avenue|av\\.|bd|blvd|boulevard|street|st\\.|road|rd\\.|lane|ln\\.|drive|place|plaza|square|allée|route|chemin|quai|impasse|résidence|residence|immeuble|imm\\.|' +
      'calle|avda|paseo|straße|strasse|str\\.|weg|platz|suite|floor|étage|etage|bp|b\\.p\\.|cedex|po box|p\\.o\\. box|zip|building|tower|tour|zone industrielle|z\\.i)\\b' +
      '|شارع|زنقة|حي|طريق|عمارة|الطابق|ص\\.ب',
    'i'
  );

  const GENERIC_DOMAINS = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|orange|wanadoo|free|laposte|menara|web|mail)$/i;

  const ARABIC_LETTER = /[؀-ۿ]/;
  const LATIN_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;

  function phoneLabel(line) {
    if (/\bfax\b|فاكس/i.test(line)) return 'fax';
    if (/\b(mob|mobile|cell|gsm|portable|port\.?|móvil|movil|handy)\b|جوال|محمول/i.test(line)) return 'mobile';
    if (/\b(tel|tél|téléphone|phone|office|direct|fixe|bureau|teléfono|telefon)\b|هاتف/i.test(line)) return 'work';
    return 'phone';
  }

  function cleanPhone(raw) {
    let p = raw.replace(/[–]/g, '-').replace(/\s+/g, ' ').trim();
    p = p.replace(/^[(\s]+(?=\+)/, '');
    return p;
  }

  function digitCount(s) {
    return (s.match(/\d/g) || []).length;
  }

  function isTitleCaseOrCaps(line) {
    const words = line.split(/\s+/).filter((w) => LATIN_LETTER.test(w));
    if (!words.length) return false;
    return words.every((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w));
  }

  function lineLooksLikeName(line) {
    if (/\d/.test(line)) return false;
    if (/[@:|/\\]/.test(line)) return false;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    if (line.length < 4 || line.length > 42) return false;
    // mostly letters
    const letters = (line.match(/[A-Za-zÀ-ÖØ-öø-ÿ؀-ۿ]/g) || []).length;
    return letters / line.replace(/\s/g, '').length > 0.85;
  }

  function parseCard(rawText) {
    const text = toWesternDigits(String(rawText || ''))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      // Right-to-left OCR can output a phone number backwards: "67 45 23 661 212+"
      .replace(/(^|\s)((?:\d{1,4} ){2,6}\d{1,4})\+(?=\s|$)/gm, (m, pre, num) => pre + '+' + num.split(' ').reverse().join(' '));
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/[|_~«»•·]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 1 && /[\p{L}\p{N}]/u.test(l));

    const result = {
      name: '',
      title: '',
      company: '',
      phones: [],
      emails: [],
      website: '',
      address: '',
      lines: lines.slice(),
    };
    const used = new Set();

    // 1. Emails, websites, phones — the patterns we can recognise with confidence.
    lines.forEach((line, i) => {
      let rest = line;
      const emails = line.match(EMAIL_RE);
      if (emails) {
        emails.forEach((e) => {
          const clean = e.replace(/\s+/g, '').toLowerCase();
          if (!result.emails.includes(clean)) result.emails.push(clean);
          rest = rest.replace(e, ' ');
        });
      }

      if (!result.website) {
        const m = rest.match(URL_RE);
        if (m && !/@/.test(m[1])) {
          result.website = m[1].replace(/[.,;]+$/, '');
          rest = rest.replace(m[0], ' ');
        }
      }

      const phones = rest.match(PHONE_RE);
      if (phones) {
        let cursor = 0;
        phones.forEach((p) => {
          // Label = words just before this number ("Tél : … Mob. …" holds two numbers).
          const at = rest.indexOf(p, cursor);
          const before = rest.slice(cursor, at);
          cursor = at + p.length;
          const n = digitCount(p);
          if (n < 8 || n > 16) return;
          // Skip things that look like dates or postal-code + number combos without separators
          if (/^\d{4}[-/.]\d{2}[-/.]\d{2}$/.test(p.trim())) return;
          const value = cleanPhone(p);
          if (!result.phones.some((x) => x.value.replace(/\D/g, '') === value.replace(/\D/g, ''))) {
            const own = phoneLabel(before);
            result.phones.push({ label: own !== 'phone' ? own : phoneLabel(line), value });
          }
          rest = rest.slice(0, at) + ' ' + rest.slice(at + p.length);
          cursor = at + 1;
        });
      }

      const leftover = rest
        .replace(/\b(tel|tél|t|m|f|p|e|w|fax|mob|mobile|cell|gsm|phone|email|e-mail|mail|web|site|www|portable|direct|office|bureau)\b\.?\s*:?/gi, ' ')
        .replace(/هاتف|جوال|فاكس|البريد/g, ' ')
        .replace(/[\s:.,;()\-–/+]+/g, '');
      if (rest !== line && leftover.length < 4) used.add(i);
    });

    // 2. Title, company and address by keyword.
    const addressParts = [];
    lines.forEach((line, i) => {
      if (used.has(i)) return;
      if (!result.title && TITLE_RE.test(line) && line.length < 70 && digitCount(line) === 0) {
        result.title = line;
        used.add(i);
        return;
      }
      if (ADDRESS_RE.test(line) || (/\b\d{4,5}\b/.test(line) && /\p{L}{3,}/u.test(line) && digitCount(line) <= 7 && !COMPANY_RE.test(line))) {
        addressParts.push(line);
        used.add(i);
        return;
      }
      if (!result.company && COMPANY_RE.test(line) && line.length < 70) {
        result.company = line;
        used.add(i);
      }
    });
    result.address = addressParts.join(', ');

    // 3. Company from the email domain when no keyword matched.
    const domains = result.emails
      .map((e) => e.split('@')[1] || '')
      .concat(result.website ? [result.website.replace(/^https?:\/\//, '').replace(/^www\./, '')] : [])
      .map((d) => d.split('.')[0])
      .filter((d) => d && d.length >= 2 && !GENERIC_DOMAINS.test(d));
    if (!result.company && domains.length) {
      const key = domains[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = lines.findIndex(
        (l, i) => !used.has(i) && key.length >= 3 && l.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key)
      );
      if (idx >= 0) {
        result.company = lines[idx];
        used.add(idx);
      }
    }

    // 4. Name: score the remaining lines.
    const localTokens = result.emails
      .map((e) => e.split('@')[0].toLowerCase())
      .join(' ')
      .split(/[._\-+\d\s]+/)
      .filter((t) => t.length >= 3);

    let best = null;
    lines.forEach((line, i) => {
      if (used.has(i) || !lineLooksLikeName(line)) return;
      let score = 0;
      const lower = line.toLowerCase();
      if (localTokens.some((t) => lower.includes(t))) score += 4;
      if (isTitleCaseOrCaps(line)) score += 2;
      if (ARABIC_LETTER.test(line)) score += 1;
      if (i < 3) score += 1;
      if (COMPANY_RE.test(line)) score -= 3;
      const nextIsTitle = lines[i + 1] && lines[i + 1] === result.title;
      if (nextIsTitle) score += 2;
      if (!best || score > best.score) best = { i, score };
    });
    if (best) {
      result.name = lines[best.i];
      used.add(best.i);
    }

    // 5. Company fallback: first unused, letter-heavy line near the top.
    if (!result.company) {
      const idx = lines.findIndex(
        (l, i) => !used.has(i) && digitCount(l) === 0 && l.length >= 2 && l.length < 50 && !/@/.test(l)
      );
      if (idx >= 0) {
        result.company = lines[idx];
        used.add(idx);
      }
    }

    result.unusedLines = lines.filter((_, i) => !used.has(i));
    return result;
  }

  const api = { parseCard, toWesternDigits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardParser = api;
})(typeof self !== 'undefined' ? self : this);
