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

function splitList(str, pattern = /[|,;]+/) {
  const s = String(str || '').trim();
  if (!s) return [];
  return s.split(pattern).map(x => x.trim()).filter(Boolean);
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
    obj._normName = String(obj.Name || '').trim().toLowerCase();
    obj.FoundInList = splitList(obj.FoundIn);
    obj.EffectsList = splitList(obj.Effects, /\|/);
    obj.UsageList = splitList(obj.Usage, /\|/);
    obj.RecycleList = splitList(obj.RecycleOutputs, /\|/);
    obj.SalvageList = splitList(obj.SalvageOutputs, /\|/);
    obj.ValueNum = Number(obj.Value) || 0;
    out.push(obj);
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
const rarityClassMap = {
  common: 'tier-1',
  uncommon: 'tier-2',
  rare: 'tier-3',
  epic: 'tier-4',
  legendary: 'tier-5',
};

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
    const rarityClass = rarityClassMap[String(r.Rarity || '').toLowerCase()] || 'tier-0';
    div.classList.add(rarityClass);
    const content = document.createElement('div');
    content.className = 'result-body';

    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = r.Name || 'Unknown Item';
    title.appendChild(strong);
    content.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'badges';
    const badgeSet = new Set();
    const addBadge = (text) => {
      if (!text || badgeSet.has(text)) return;
      badgeSet.add(text);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      badges.appendChild(badge);
    };
    addBadge(r.Rarity);
    addBadge(r.Type);
    (r.FoundInList || []).forEach(loc => addBadge(loc));
    if (r.Value) addBadge(`Value: ${r.Value}`);
    if (r.StackSize) addBadge(`Stack: ${r.StackSize}`);
    if (r.WeightKg) addBadge(`${r.WeightKg} kg`);
    content.appendChild(badges);

    if (r.Description) {
      const desc = document.createElement('p');
      desc.className = 'description';
      desc.textContent = r.Description;
      content.appendChild(desc);
    }

    const advisory = document.createElement('div');
    const hasUsage = (r.UsageList || []).length > 0;
    advisory.className = `usage ${hasUsage ? 'required' : 'optional'}`;
    const usageTitle = document.createElement('div');
    usageTitle.className = 'usage-title';
    usageTitle.textContent = hasUsage ? 'Required for quests / upgrades' : 'Not required for quests or upgrades';
    advisory.appendChild(usageTitle);

    if (hasUsage) {
      const usageList = document.createElement('ul');
      usageList.className = 'usage-list';
      r.UsageList.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        usageList.appendChild(li);
      });
      advisory.appendChild(usageList);
    } else {
      const safeMsg = document.createElement('p');
      const valueText = r.ValueNum > 0 ? `₳${r.ValueNum.toLocaleString()}` : 'its listed value';
      safeMsg.textContent = `Safe to sell for ${valueText} or dismantle for materials.`;
      advisory.appendChild(safeMsg);

      const recycleDetails = [...(r.RecycleList || []), ...(r.SalvageList || [])];
      if (recycleDetails.length > 0) {
        const recycleHeader = document.createElement('div');
        recycleHeader.className = 'effects-header muted';
        recycleHeader.textContent = 'Dismantle yields';
        advisory.appendChild(recycleHeader);

        const recycleList = document.createElement('ul');
        recycleList.className = 'effects';
        recycleDetails.forEach(detail => {
          const li = document.createElement('li');
          li.textContent = detail;
          recycleList.appendChild(li);
        });
        advisory.appendChild(recycleList);
      }
    }

    content.appendChild(advisory);

    const meta = document.createElement('div');
    meta.className = 'stats muted';
    const details = [];
    if (r.UpdatedAt) details.push(`Updated: ${r.UpdatedAt}`);
    if (r.ItemID) details.push(`#${r.ItemID}`);
    meta.textContent = details.join(' · ');
    content.appendChild(meta);

    if (r.EffectsList && r.EffectsList.length > 0) {
      const effectsHeader = document.createElement('div');
      effectsHeader.className = 'effects-header muted';
      effectsHeader.textContent = 'Effects';
      content.appendChild(effectsHeader);

      const listEl = document.createElement('ul');
      listEl.className = 'effects';
      r.EffectsList.forEach(effect => {
        const li = document.createElement('li');
        li.textContent = effect;
        listEl.appendChild(li);
      });
      content.appendChild(listEl);
    }

    div.appendChild(content);
    resultsEl.appendChild(div);
  }
}

function itemKey(r) {
  return [r.Name, r.Rarity, r.Type, r.FoundIn, r.Value, r.StackSize].join('|');
}

function dedupeAndSort(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = itemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  out.sort((a, b) => {
    const nameCompare = a._normName.localeCompare(b._normName);
    if (nameCompare !== 0) return nameCompare;
    const rarityCompare = String(a.Rarity || '').localeCompare(String(b.Rarity || ''));
    if (rarityCompare !== 0) return rarityCompare;
    return String(a.Type || '').localeCompare(String(b.Type || ''));
  });
  return out;
}

function search(q, maxResults = 50) {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const prefixMatches = dedupeAndSort(
    ITEMS.filter(it => it._normName.startsWith(query))
  );

  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, maxResults);
  }

  // fuzzy matches
  const scored = ITEMS
    .map(it => ({ it, score: similarity(query, it._normName) }))
    .filter(x => x.score >= 0.6) // adjust threshold as needed
    .sort((a, b) => b.score - a.score);

  const results = [];
  const seen = new Set();
  for (const s of scored) {
    const k = itemKey(s.it);
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

  function doSearch() {
    const q = qEl.value;
    if (!q.trim()) {
      const resultsEl = document.getElementById('results');
      resultsEl.innerHTML = '';
      if (!loadFailed) {
        msg.textContent = 'Start typing to search for upgrade items.';
        msg.classList.remove('error');
      }
      return;
    }
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
  qEl.addEventListener('input', () => {
    if (dataLoaded) {
      doSearch();
    }
  });
}

main();
