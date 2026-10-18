/* Fibre-composition parser for garment care labels.
   Works in the browser (window.LabelParser) and in Node (module.exports).
   Input: raw OCR text.  Output: see parse() at the bottom. */
(function (root) {
  'use strict';

  // ---- Dictionaries (lowercase, accents stripped; Latin terms first, then CJK) ----
  const FIBRES = {
    cotton: ['cotton', 'cotto', 'coton', 'baumwolle', 'baumwol', 'algodon', 'algodao', 'cotone', 'katun', 'kapas',
             '纯棉', '全棉', '棉', '綿', 'コットン'],
    polyester: ['polyester', 'poliester', 'poliestere', 'polyesters', 'poly', '聚酯纤维', '聚酯', '涤纶', '涤', 'ポリエステル'],
    // polyurethane is treated as elastane (common on Japanese labels) and flagged
    elastane: ['elastane', 'elastan', 'elasthan', 'elasthane', 'elastano', 'elastodiene', 'spandex', 'lycra',
               '氨纶', '弹性纤维', 'ポリウレタン', 'polyurethane', 'poliuretano'],
    viscose: ['viscose', 'viskose', 'viscosa', 'viscosse', 'viskos', 'rayon', 'rayonne', '粘纤', '粘胶纤维', '黏胶', 'ビスコース', 'レーヨン'],
    modal: ['modal', '莫代尔'],
    lyocell: ['lyocell', 'tencel', '莱赛尔', '天丝', 'リヨセル'],
    cupro: ['cupro', 'cupra', 'キュプラ'],
    acetate: ['acetate', 'acetat', 'acetato', '醋酸纤维', 'アセテート'],
    polyamide: ['polyamide', 'polyamid', 'poliamida', 'poliammide', 'nylon', 'nilon', '锦纶', '尼龙', '聚酰胺', 'ナイロン'],
    acrylic: ['acrylic', 'acrylique', 'acryl', 'acrilico', 'akrilik', '腈纶', 'アクリル'],
    wool: ['wool', 'laine', 'wolle', 'lana', 'lambswool', 'merino', '羊毛', 'ウール'],
    cashmere: ['cashmere', 'kaschmir', 'cachemire', 'cachemira', '羊绒', 'カシミヤ'],
    silk: ['silk', 'soie', 'seide', 'seda', 'seta', 'sutra', '真丝', '桑蚕丝', '丝绸', 'シルク'],
    linen: ['linen', 'leinen', 'lino', '亚麻', 'リネン'],
    hemp: ['hemp', 'chanvre', 'hanf'],
    ramie: ['ramie', '苎麻', 'ラミー'],
    polypropylene: ['polypropylene', '丙纶'],
    metallic: ['metallic', 'metalized', 'metallized', 'lurex', '金属纤维'],
    down: ['down', 'duvet'],
    feather: ['feather', 'feathers', 'plumes']
  };
  const HEADERS = {
    main: ['shell', 'outer', 'main', 'self', 'body', 'face', 'exterior', 'upper', 'obermaterial', 'aussenmaterial',
           'oberstoff', 'exterieur', 'principal', 'esterno', '面料', '外层', '表布', '主料', '面布'],
    lining: ['lining', 'linings', 'lined', 'doublure', 'futter', 'innenfutter', 'forro', 'fodera', 'inner', 'interior',
             '里料', '里布', '衬里', '内里', '内衬'],
    filling: ['filling', 'fill', 'padding', 'wadding', 'stuffing', 'garnissage', 'fullung', 'relleno', 'imbottitura',
              '填充物', '填充'],
    other: ['contrast', 'trim', 'rib', 'ribbing', 'pocket', 'pocketing', 'sleeve', 'sleeves', 'collar', 'cuff', 'cuffs',
            'ornament', 'decoration', 'embroidery', 'applique', 'mesh', 'front', 'back', 'panel', 'insert', 'interlining',
            '配色', '罗纹']
  };

  const LATIN = {}, CJK = [];
  function reg(map, kind) {
    Object.keys(map).forEach(function (canon) {
      map[canon].forEach(function (term) {
        if (/^[a-z]+$/.test(term)) LATIN[term] = { kind: kind, canon: canon };
        else CJK.push({ term: term, kind: kind, canon: canon });
      });
    });
  }
  reg(FIBRES, 'fib');
  reg(HEADERS, 'hdr');
  CJK.sort(function (a, b) { return b.term.length - a.term.length; });
  const FUZZY_TERMS = Object.keys(LATIN).filter(function (t) { return t.length >= 6 && LATIN[t].kind === 'fib'; });

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function lookupWord(w) {
    if (LATIN[w]) return LATIN[w];
    let x = w;
    if (/\d/.test(w)) {                       // OCR digit-for-letter slips: C0TTON, P0LYESTER
      const letters = (w.match(/[a-z]/g) || []).length;
      if (letters / w.length < 0.6) return null;
      x = w.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/3/g, 'e').replace(/8/g, 'b').replace(/4/g, 'a');
      if (LATIN[x]) return LATIN[x];
    }
    if (x.length >= 6) {                      // typos: POLYESTEP, ELASTAME
      const max = x.length >= 9 ? 2 : 1;
      let best = null, bestD = max + 1;
      for (let i = 0; i < FUZZY_TERMS.length; i++) {
        const d = lev(x, FUZZY_TERMS[i], max);
        if (d < bestD) { bestD = d; best = FUZZY_TERMS[i]; }
      }
      if (best) return LATIN[best];
    }
    return null;
  }

  // ---- Normalisation ----
  function normalize(raw) {
    let s = String(raw || '');
    s = s.normalize('NFKC');                                  // full-width digits / % to ASCII
    s = s.replace(/[\r\n\t]+/g, ' ');
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');  // strip accents, keep kana intact
    s = s.toLowerCase();
    s = s.replace(/(\d)\s*(?:°\/o|º\/o|o\/o|°\/°|%o|‰)/g, '$1%');             // mangled percent signs
    s = s.replace(/(\d),(\d)/g, '$1.$2');                                      // 97,5% -> 97.5%
    s = s.replace(/(\d)o(?=\d|\s*%)/g, function (m, d) { return d + '0'; });   // 9O% -> 90%
    s = s.replace(/(\d)[li](?=\d|\s*%)/g, function (m, d) { return d + '1'; });
    s = s.replace(/(\d)s(?=\d|\s*%)/g, function (m, d) { return d + '5'; });
    s = s.replace(/(^|[^a-z0-9])[li](?=00\s*%)/g, function (m, p) { return p + '1'; }); // l00% -> 100%
    return s;
  }

  // ---- Tokeniser ----
  function tokenize(s) {
    const toks = [];
    const re = /(\d{1,3}(?:\.\d{1,2})?)\s*%|([\u3040-\u30ff\u3400-\u9fff]+)|([a-z][a-z0-9]*)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[1] !== undefined) {
        const v = parseFloat(m[1]);
        if (v > 0 && v <= 100) toks.push({ t: 'num', v: v, idx: m.index });
      } else if (m[2] !== undefined) {
        const run = m[2];
        let i = 0;
        while (i < run.length) {
          let hit = null;
          for (let k = 0; k < CJK.length; k++) {
            if (run.startsWith(CJK[k].term, i)) { hit = CJK[k]; break; }
          }
          if (hit) {
            toks.push({ t: hit.kind, c: hit.canon, idx: m.index + i, term: hit.term });
            i += hit.term.length;
          } else i++;
        }
      } else {
        const hit = lookupWord(m[3]);
        if (hit) {
          const before = s.slice(0, m.index).replace(/\s+$/, '');
          const paren = /[(\[]$/.test(before);
          toks.push({ t: hit.kind, c: hit.canon, idx: m.index, paren: paren, term: m[3] });
        }
      }
    }
    return toks;
  }

  // ---- Pairing numbers with fibres, splitting into parts ----
  function buildParts(toks, flags) {
    const parts = [];
    let cur = { label: null, hdr: null, f: {} };
    const numQ = [], fibQ = [];
    let lastIdx = -1;

    function flush() {
      if (Object.keys(cur.f).length) parts.push(cur);
      cur = { label: null, hdr: null, f: {} };
    }
    function add(c, v) {
      if (c in cur.f) flush();                // same fibre again => new block (other language or other part)
      cur.f[c] = v;
    }

    toks.forEach(function (tk) {
      if ((numQ.length || fibQ.length) && lastIdx >= 0 && tk.idx - lastIdx > 80) {
        numQ.length = 0; fibQ.length = 0; flags.add('unpaired_text');
      }
      lastIdx = tk.idx;

      if (tk.t === 'hdr') {
        numQ.length = 0; fibQ.length = 0;
        if (tk.paren) {                       // "80% cotton 20% polyester (shell)" labels the part just read
          if (Object.keys(cur.f).length && !cur.label) { cur.label = tk.term; cur.hdr = tk.c; }
          flush();
        } else {
          if (Object.keys(cur.f).length) flush();
          cur.label = tk.term; cur.hdr = tk.c;
        }
      } else if (tk.t === 'num') {
        if (fibQ.length) add(fibQ.shift(), tk.v); else numQ.push(tk.v);
      } else if (tk.t === 'fib') {
        if (tk.term === 'polyurethane' || tk.term === 'poliuretano' || tk.term === 'ポリウレタン') flags.add('polyurethane_as_elastane');
        if (numQ.length) add(tk.c, numQ.shift()); else fibQ.push(tk.c);
      }
    });
    flush();
    if (numQ.length || fibQ.length) flags.add('unpaired_tokens');
    return parts;
  }

  function sig(p) {
    return Object.keys(p.f).sort().map(function (k) { return k + ':' + p.f[k]; }).join('|');
  }

  function dedupe(parts, flags) {
    const out = [];
    parts.forEach(function (p) {
      const dup = out.some(function (q) {
        return sig(q) === sig(p) && (!p.label || p.label === q.label);
      });
      if (dup) flags.add('translation_duplicate_dropped'); else out.push(p);
    });
    return out;
  }

  // "Cotton/Polyester 60/40" and "60/40 cotton/polyester"
  function ratioFallback(s, toks, flags) {
    const fibs = [];
    toks.forEach(function (t) { if (t.t === 'fib' && fibs.indexOf(t.c) < 0) fibs.push(t.c); });
    const m = s.match(/(\d{1,3})\s*[\/\-]\s*(\d{1,3})(?:\s*[\/\-]\s*(\d{1,3}))?/);
    if (!m || !fibs.length) return null;
    const nums = [m[1], m[2], m[3]].filter(Boolean).map(Number);
    const sum = nums.reduce(function (a, b) { return a + b; }, 0);
    if (nums.length !== fibs.length || Math.abs(sum - 100) > 1) return null;
    const f = {};
    fibs.forEach(function (c, i) { f[c] = nums[i]; });
    flags.add('ratio_format');
    return [{ label: null, hdr: null, f: f }];
  }

  // ---- Public API ----
  function parse(raw) {
    const flags = new Set();
    const s = normalize(raw);
    const toks = tokenize(s);
    let parts = dedupe(buildParts(toks, flags), flags);
    if (!parts.length) parts = ratioFallback(s, toks, flags) || [];

    if (/excluding|excl\.|except|not including|\bohne\b|\bhors\b|\bsans\b|不含|除.{0,6}外|を除く/.test(s)) flags.add('excludes_trim');
    if (parts.length > 1) flags.add('multipart');

    const primaryPart = parts.filter(function (p) { return p.hdr === 'main'; })[0] || parts[0] || null;
    let primary = null;
    if (primaryPart) {
      const f = primaryPart.f;
      const other = {};
      let sum = 0;
      Object.keys(f).forEach(function (k) {
        sum += f[k];
        if (k !== 'cotton' && k !== 'polyester' && k !== 'elastane') other[k] = f[k];
      });
      primary = {
        cotton: f.cotton || 0,
        polyester: f.polyester || 0,
        elastane: f.elastane || 0,
        other: other,
        sum: Math.round(sum * 10) / 10
      };
      if (Math.abs(primary.sum - 100) > 2) flags.add('sum_not_100');
    }
    return {
      ok: !!primary,
      primary: primary,
      parts: parts.map(function (p) { return { label: p.label, fibres: p.f }; }),
      flags: Array.from(flags)
    };
  }

  function formatOther(other) {
    return Object.keys(other || {}).map(function (k) { return k + ' ' + other[k]; }).join('; ');
  }

  const api = { parse: parse, normalize: normalize, formatOther: formatOther };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabelParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
