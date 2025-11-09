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

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCase(text) {
  return text.replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
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
    obj.Quantity = normalizeQuantity(obj.Quantity);
    obj._normName = String(obj.Name || '').trim().toLowerCase();

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

function aggregateItems(rows) {
  const map = new Map();
  const pushUnique = (list, value) => {
    if (!value) return;
    if (!list.includes(value)) list.push(value);
  };
  const addFilterKey = (entry, type, value) => {
    if (!value) return;
    const values = Array.isArray(value) ? value : [value];
    values.forEach(val => {
      const norm = normalizeFilterValue(val);
      if (norm) entry.FilterKeys.add(`${type}:${norm}`);
    });
  };
  for (const row of rows) {
    const key = row._normName;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        ...row,
        CategoryList: [],
        LocationList: [],
        VendorList: [],
        SourceList: [],
        UsageEntries: [],
        _usageSet: new Set(),
        FilterKeys: new Set(),
      };
      map.set(key, entry);
    }
    pushUnique(entry.CategoryList, row.Category);
    pushUnique(entry.LocationList, row.LocationType);
    pushUnique(entry.VendorList, row.Vendor);
    pushUnique(entry.SourceList, row.Source);
    addFilterKey(entry, 'category', row.Category);
    addFilterKey(entry, 'location', row.LocationType);
    addFilterKey(entry, 'vendor', row.Vendor);
    addFilterKey(entry, 'source', row.Source);
    addFilterKey(entry, 'station', `${row.Station || ''}|${row.Tier || ''}`);
    addFilterKey(entry, 'rarity', row.ArcRarity || row.MetaRarity);
    addFilterKey(entry, 'type', row.ArcType || row.MetaType || row.Category);
    addFilterKey(entry, 'found', splitLocations(row.ArcFoundIn));
    addFilterKey(entry, 'workbench', row.MetaWorkbench);
    addFilterKey(entry, 'value', row.ArcValue);
    addFilterKey(entry, 'stack', row.ArcStackSize);
    addFilterKey(entry, 'weight', row.ArcWeightKg);
    const slugName = slugify(row.Name);
    let questName = '';
    if (row.Station === 'Quest' || row.Source === 'Quest') {
      questName = deriveQuestName(row.ItemID, slugName, row.ArcID, row.MetaID);
    }
    const usageKey = [row.Station, row.Tier, row.Quantity, row.Source, questName].join('|');
    if (!entry._usageSet.has(usageKey)) {
      entry._usageSet.add(usageKey);
      entry.UsageEntries.push({
        station: row.Station,
        tier: row.Tier,
        quantity: row.Quantity,
        source: row.Source,
        questName,
      });
    }

    if (!entry.ArcDescription && row.ArcDescription) entry.ArcDescription = row.ArcDescription;
    if (!entry.MetaDescription && row.MetaDescription) entry.MetaDescription = row.MetaDescription;
    if (!entry.ArcRarity && row.ArcRarity) entry.ArcRarity = row.ArcRarity;
    if (!entry.MetaRarity && row.MetaRarity) entry.MetaRarity = row.MetaRarity;
  }
  return Array.from(map.values()).map(({ _usageSet, ...rest }) => rest);
}

function deriveQuestName(itemId, slugName, arcId, metaId) {
  if (!itemId) return '';
  const tokens = itemId.split('_').filter(Boolean);
  if (tokens.length <= 1) return '';
  const nameTokens = slugName ? slugName.split('_').filter(Boolean) : [];
  let dropCount = 0;
  if (arcId && itemId.startsWith(arcId) && tokens.length > arcId.split('_').length) {
    dropCount = arcId.split('_').length;
  } else if (metaId && itemId.startsWith(metaId) && tokens.length > metaId.split('_').length) {
    dropCount = metaId.split('_').length;
  } else if (nameTokens.length && tokens.length > nameTokens.length) {
    dropCount = nameTokens.length;
  }
  if (dropCount <= 0 || dropCount >= tokens.length) {
    dropCount = Math.max(1, tokens.length - 2);
  }
  const remainder = tokens.slice(dropCount);
  if (remainder.length === 0) return '';
  return titleCase(remainder.join(' '));
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
let GROUPED_ITEMS = [];
let dataLoaded = false;
let loadFailed = false;
let activeFilterKey = '';
let lastQuery = '';
let triggerSearch = null;

async function loadData() {
  const res = await fetch('items.csv');
  if (!res.ok) throw new Error(`Failed to load CSV (${res.status})`);
  const text = await res.text();
  const rows = parseCSV(text);
  ITEMS = toObjects(rows);
  GROUPED_ITEMS = aggregateItems(ITEMS);
}

function setResultsMessage(text, type = '') {
  const resultsEl = document.getElementById('results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  if (!text) return;
  const div = document.createElement('div');
  div.className = `empty${type ? ` ${type}` : ''}`;
  div.textContent = text;
  resultsEl.appendChild(div);
}

function renderResults(list, q) {
  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';
  document.body.classList.toggle('search-active', Boolean(q.trim()));

  if (list.length === 0) {
    setResultsMessage(`No matches found for "${q}".`, 'error');
    return;
  }

  for (const r of list) {
    const div = document.createElement('div');
    div.className = 'result';
    const rarityKey = String(r.ArcRarity || r.MetaRarity || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (rarityKey) {
      div.classList.add(`rarity-${rarityKey}`);
    } else {
      const tierValue = Number.parseInt(r.Tier, 10);
      div.classList.add(Number.isFinite(tierValue) ? `tier-${tierValue}` : 'tier-0');
    }
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
    const addBadge = (text, keyType, rawValue = text) => {
      if (!text) return;
      const key = keyType ? `${keyType}:${normalizeFilterValue(rawValue ?? text)}` : '';
      const dedupeKey = text.trim().toLowerCase();
      if (badgeSet.has(dedupeKey)) return;
      badgeSet.add(dedupeKey);
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'badge';
      badge.textContent = text;
      if (key) {
        badge.dataset.filterKey = key;
        if (activeFilterKey === key) badge.classList.add('badge-active');
        badge.addEventListener('click', e => {
          e.stopPropagation();
          toggleFilter(key);
        });
      }
      badges.appendChild(badge);
    };
    addBadge(r.Source, 'source', r.Source);
    if (r.Station) addBadge(`${r.Station}${r.Tier ? ` Tier ${r.Tier}` : ''}`, 'station', `${r.Station || ''}|${r.Tier || ''}`);
    (r.CategoryList?.length ? r.CategoryList : [r.Category]).forEach(cat => addBadge(cat, 'category', cat));
    (r.LocationList?.length ? r.LocationList : [r.LocationType]).forEach(loc => addBadge(loc, 'location', loc));
    (r.VendorList || []).forEach(v => addBadge(`Vendor: ${v}`, 'vendor', v));
    if (r.ArcRarity) addBadge(r.ArcRarity, 'rarity', r.ArcRarity);
    if (r.ArcType) addBadge(r.ArcType, 'type', r.ArcType);
    if (r.ArcFoundIn) {
      splitLocations(r.ArcFoundIn).forEach(loc => addBadge(loc, 'found', loc));
    }
    if (r.MetaWorkbench) addBadge(`Workbench: ${r.MetaWorkbench}`, 'workbench', r.MetaWorkbench);
    const arcValueNum = Number(r.ArcValue);
    if (Number.isFinite(arcValueNum) && arcValueNum > 0) {
      addBadge(`Value ₳${arcValueNum.toLocaleString()}`, 'value', arcValueNum);
    } else if (r.ArcValue) {
      addBadge(`Value ${r.ArcValue}`, 'value', r.ArcValue);
    }
    if (r.ArcStackSize) addBadge(`Stack ${r.ArcStackSize}`, 'stack', r.ArcStackSize);
    if (r.ArcWeightKg) addBadge(`${r.ArcWeightKg} kg`, 'weight', r.ArcWeightKg);
    content.appendChild(badges);

    const description = r.ArcDescription || r.MetaDescription;
    if (description) {
      const desc = document.createElement('p');
      desc.className = 'description';
      desc.textContent = description;
      content.appendChild(desc);
    }

    const hasUsage = (r.UsageEntries?.length || 0) > 0;
    const advisory = document.createElement('div');
    advisory.className = `usage ${hasUsage ? 'required' : 'optional'}`;
    const usageTitle = document.createElement('div');
    usageTitle.className = 'usage-title';

    if (hasUsage) {
      const usageEntries = r.UsageEntries || [];
      usageTitle.textContent = 'Required';
      advisory.appendChild(usageTitle);

      const usageList = document.createElement('ul');
      usageList.className = 'usage-list';
      usageEntries.forEach(entry => {
        const li = document.createElement('li');
        const hideTier =
          entry.station?.startsWith('Expedition') && String(entry.tier || '0') === '0';
        const tierText = entry.tier && !hideTier ? `Tier ${entry.tier}` : '';
        const heading = entry.questName || [entry.station, tierText].filter(Boolean).join(' ').trim() || 'Upgrade requirement';
        const headingEl = document.createElement('div');
        headingEl.textContent = heading;
        li.appendChild(headingEl);

        if (entry.quantity) {
          const qtyLine = document.createElement('div');
          qtyLine.textContent = `Quantity: ${entry.quantity}`;
          li.appendChild(qtyLine);
        }
        if (entry.source && entry.source !== 'Item') {
          const srcLine = document.createElement('div');
          srcLine.textContent = `Source: ${entry.source}`;
          li.appendChild(srcLine);
        }
        usageList.appendChild(li);
      });
      advisory.appendChild(usageList);
    } else {
      usageTitle.textContent = 'Not listed for quests / upgrades';
      advisory.appendChild(usageTitle);
      const safeMsg = document.createElement('p');
      const saleValue = Number(r.ArcValue);
      const saleText = Number.isFinite(saleValue) && saleValue > 0
        ? `₳${saleValue.toLocaleString()}`
        : (r.ArcValue || 'its listed value');
      safeMsg.textContent = `This item does not appear in the upgrade data set and can be sold for ${saleText} or dismantled safely.`;
      advisory.appendChild(safeMsg);
    }

    content.appendChild(advisory);

    div.appendChild(content);
    resultsEl.appendChild(div);
  }
}

function itemKey(r) {
  return r._normName;
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
    const stationCompare = String(a.Station || '').localeCompare(String(b.Station || ''));
    if (stationCompare !== 0) return stationCompare;
    return String(a.Tier || '').localeCompare(String(b.Tier || ''));
  });
  return out;
}

function applyActiveFilter(list) {
  if (!activeFilterKey) return list;
  return list.filter(item => item.FilterKeys?.has(activeFilterKey));
}

function toggleFilter(key) {
  activeFilterKey = activeFilterKey === key ? '' : key;
  if (typeof triggerSearch === 'function') triggerSearch();
}

function search(q, maxResults = 50) {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const prefixMatches = dedupeAndSort(
    GROUPED_ITEMS.filter(it => it._normName.startsWith(query))
  );

  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, maxResults);
  }

  // fuzzy matches
  const scored = GROUPED_ITEMS
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
  const qEl = document.getElementById('q');
  qEl.disabled = true;

  try {
    await loadData();
    dataLoaded = true;
    qEl.disabled = false;
    qEl.focus();
    setResultsMessage('');
  } catch (e) {
    setResultsMessage(e.message, 'error');
    loadFailed = true;
  }

  function doSearch() {
    const q = qEl.value;
    lastQuery = q;
    document.body.classList.toggle('search-active', Boolean(q.trim()));
    const resultsEl = document.getElementById('results');
    if (!q.trim()) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }
    if (!dataLoaded) {
      if (!loadFailed) {
        setResultsMessage('Still loading data…');
      }
      return;
    }
    const res = search(q);
    renderResults(applyActiveFilter(res), q);
  }

  qEl.addEventListener('input', () => {
    if (dataLoaded) {
      doSearch();
    }
  });
  document.addEventListener('click', () => {
    if (!qEl.disabled) qEl.focus();
  });
  triggerSearch = doSearch;
}

main();
