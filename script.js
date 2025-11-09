// Client-only CSV loader + fuzzy search

// Tiny CSV parser that handles quoted values and commas
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  function pushField() { row.push(field); field = ''; }
  function pushRow() { rows.push(row); row = []; }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        pushField();
      } else if (c === '\n') {
        pushField();
        pushRow();
      } else if (c === '\r') {
        // ignore CR
      } else {
        field += c;
      }
    }
    i++;
  }
  // last field/row
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

function normalizeQuantity(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return 0;
  const k = s.match(/^(\d+(?:\.\d+)?)k$/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function splitLocations(loc) {
  const s = String(loc || '').trim();
  if (!s) return [''];
  return s.replace(/\|/g, ';').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
}

function toObjects(rows) {
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c] !== undefined ? row[c] : '';
    }
    // normalize
    obj.Quantity = normalizeQuantity(obj.Quantity);
    obj._normName = String(obj.Name || '').trim().toLowerCase();

    // expand multi-locations into multiple entries
    const locs = splitLocations(obj.LocationType);
    if (locs.length <= 1) {
      obj.LocationType = locs[0] || '';
      out.push(obj);
    } else {
      for (const l of locs) {
        const dup = { ...obj, LocationType: l };
        out.push(dup);
      }
    }
  }
  return out;
}

// Basic fuzzy scorer (Jaro-Winkler-like using edit distance ratio)
function similarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  // token-based: prefers same words
  const at = a.split(/\s+/), bt = b.split(/\s+/);
  const shared = at.filter(x => bt.includes(x)).length;
  const tokenScore = shared / Math.max(at.length, bt.length);

  // character overlap
  const aset = new Set(a), bset = new Set(b);
  let inter = 0;
  aset.forEach(ch => { if (bset.has(ch)) inter++; });
  const charScore = inter / Math.max(aset.size, bset.size);

  return 0.6 * tokenScore + 0.4 * charScore;
}

let ITEMS = [];
let dataLoaded = false;
let loadFailed = false;

async function loadData() {
  const res = await fetch('items.csv');
  if (!res.ok) throw new Error(`Failed to load CSV (${res.status})`);
  const text = await res.text();
  const rows = parseCSV(text);
  ITEMS = toObjects(rows);
}

function renderResults(list, q) {
  const msg = document.getElementById('msg');
  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';

  if (list.length === 0) {
    msg.textContent = `No matches found for "${q}".`;
    msg.classList.add('error');
    return;
  }

  msg.textContent = `Found ${list.length} match${list.length > 1 ? 'es' : ''} for "${q}".`;
  msg.classList.remove('error');

  for (const r of list) {
    const div = document.createElement('div');
    div.className = 'result';
    const tier = r.Source === 'Item' && r.Tier ? ` ${r.Tier}` : (r.Source?.startsWith('Expedition') ? '' : '');
    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = r.Name || 'Unknown Item';
    title.appendChild(strong);
    div.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'badges';
    const addBadge = (text) => {
      if (!text) return;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      badges.appendChild(badge);
    };
    addBadge(r.Source);
    if (r.Station) addBadge(`${r.Station}${tier}`);
    addBadge(r.Category);
    addBadge(r.LocationType);
    if (r.Vendor) addBadge(`Vendor: ${r.Vendor}`);
    div.appendChild(badges);

    const qty = document.createElement('div');
    qty.className = 'muted';
    qty.textContent = `Quantity: ${r.Quantity}`;
    div.appendChild(qty);

    resultsEl.appendChild(div);
  }
}

function search(q, maxResults = 50) {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  // exact matches first
  const exact = ITEMS.filter(it => it._normName === query);

  if (exact.length > 0) {
    // group by (Name, Station, Tier, LocationType, Source) to avoid duplicates
    const key = r => [r.Name, r.Station, r.Tier, r.LocationType, r.Source].join('|');
    const seen = new Set();
    const unique = [];
    for (const r of exact) {
      const k = key(r);
      if (!seen.has(k)) { unique.push(r); seen.add(k); }
    }
    return unique.slice(0, maxResults);
  }

  // fuzzy matches
  const scored = ITEMS
    .map(it => ({ it, score: similarity(query, it._normName) }))
    .filter(x => x.score >= 0.6) // adjust threshold as needed
    .sort((a, b) => b.score - a.score);

  const results = [];
  const seen = new Set();
  for (const s of scored) {
    const k = [s.it._normName, s.it.Station, s.it.Tier, s.it.LocationType, s.it.Source].join('|');
    if (!seen.has(k)) {
      results.push(s.it);
      seen.add(k);
    }
    if (results.length >= maxResults) break;
  }
  return results;
}

async function main() {
  const msg = document.getElementById('msg');
  const qEl = document.getElementById('q');
  const goEl = document.getElementById('go');
  qEl.disabled = true;
  goEl.disabled = true;

  try {
    await loadData();
    msg.textContent = `Loaded ${ITEMS.length} entries.`;
    msg.classList.remove('error');
    dataLoaded = true;
    qEl.disabled = false;
    goEl.disabled = false;
  } catch (e) {
    msg.textContent = e.message;
    msg.classList.add('error');
    loadFailed = true;
  }

  async function doSearch() {
    const q = qEl.value;
    if (!dataLoaded) {
      if (!loadFailed) {
        msg.textContent = 'Still loading data…';
        msg.classList.remove('error');
      }
      return;
    }
    const res = search(q);
    renderResults(res, q);
  }

  goEl.addEventListener('click', doSearch);
  qEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
}

main();
