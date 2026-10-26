// Client-only CSV loader + fuzzy search

const SEARCH_BLACKLIST = new Set(["item", "project", "quest"]);

// Tiny CSV parser that handles quoted values and commas
function parseCSV(text) {
  const rows = [];
  let i = 0,
    field = "",
    row = [],
    inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } // escaped quote
        else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        pushField();
      } else if (c === "\n") {
        pushField();
        pushRow();
      } else if (c === "\r") {
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
  const s = String(q || "")
    .trim()
    .toLowerCase();
  if (!s) return 0;
  const k = s.match(/^(\d+(?:\.\d+)?)k$/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function splitLocations(loc) {
  const s = String(loc || "").trim();
  if (!s) return [""];
  return s
    .replace(/\|/g, ";")
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeFilterValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// Join key between items.csv names and items.json names, so that
// “Leviathan's Crown” Ship Model == Leviathan's Crown Ship Model (keep in sync with sync_data.js)
function normKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeName(name) {
  return String(name || "")
    .toLowerCase()
    .split(/[^a-z0-9-_]+/)
    .filter(Boolean);
}

function toObjects(rows) {
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    if (String(row[0] || "").startsWith("#")) continue; // section comments
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c] !== undefined ? row[c] : "";
    }
    obj.Quantity = normalizeQuantity(obj.Quantity);
    obj._normName = normKey(obj.Name);

    const locs = splitLocations(obj.LocationType);
    if (locs.length <= 1) {
      obj.LocationType = locs[0] || "";
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
    values.forEach((val) => {
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
        _tokenSet: new Set(),
      };
      map.set(key, entry);
    }
    pushUnique(entry.CategoryList, row.Category);
    pushUnique(entry.LocationList, row.LocationType);
    pushUnique(entry.VendorList, row.Vendor);
    pushUnique(entry.SourceList, row.Source);
    addFilterKey(entry, "category", row.Category);
    addFilterKey(entry, "location", row.LocationType);
    addFilterKey(entry, "vendor", row.Vendor);
    addFilterKey(entry, "source", row.Source);
    addFilterKey(entry, "station", `${row.Station || ""}|${row.Tier || ""}`);
    addFilterKey(entry, "rarity", row.ArcRarity || row.MetaRarity);
    addFilterKey(entry, "type", row.ArcType || row.MetaType || row.Category);
    addFilterKey(entry, "found", splitLocations(row.ArcFoundIn));
    addFilterKey(entry, "workbench", row.MetaWorkbench);
    addFilterKey(entry, "value", row.ArcValue);
    addFilterKey(entry, "stack", row.ArcStackSize);
    addFilterKey(entry, "weight", row.ArcWeightKg);

    // Fallback icon for CSV items MetaForge doesn't know (items.json icons win in finalizeEntry)
    if (!entry.IconURL) {
      const iconBase = "https://cdn.metaforge.app/arc-raiders/icons/";
      const fallbackId = (row.MetaID || row.ArcID || row.ItemID || "")
        .toLowerCase()
        .replace(/_/g, "-");
      if (fallbackId) {
        entry.IconURL = `${iconBase}${fallbackId}.webp`;
      }
    }

    const slugName = slugify(row.Name);
    let questName = "";
    if (
      row.Source === "Quest" &&
      row.Station &&
      row.Station.toLowerCase() !== "quest"
    ) {
      questName = row.Station.replace(/^Quest:\s*/i, "").trim();
    } else if (row.Station === "Quest" || row.Source === "Quest") {
      questName = deriveQuestName(row.ItemID, slugName, row.ArcID, row.MetaID);
    }
    if (row.Station && row.Station !== "Item") {
      const usageKey = [
        row.Station,
        row.Tier,
        row.Quantity,
        row.Source,
        questName,
        row.Note,
      ].join("|");
      if (!entry._usageSet.has(usageKey)) {
        entry._usageSet.add(usageKey);
        entry.UsageEntries.push({
          station: row.Station,
          tier: row.Tier,
          quantity: row.Quantity,
          source: row.Source,
          questName,
          note: row.Note || "",
        });
      }
    }

    const allTokens = [
      ...tokenizeName(row.Name),
      ...tokenizeName(row.Station),
      ...tokenizeName(questName),
      ...tokenizeName(row.Source),
    ];
    allTokens.forEach((token) => {
      if (!SEARCH_BLACKLIST.has(token)) {
        entry._tokenSet.add(token);
      }
    });

    if (!entry.ArcDescription && row.ArcDescription)
      entry.ArcDescription = row.ArcDescription;
    if (!entry.MetaDescription && row.MetaDescription)
      entry.MetaDescription = row.MetaDescription;
    if (!entry.ArcRarity && row.ArcRarity) entry.ArcRarity = row.ArcRarity;
    if (!entry.MetaRarity && row.MetaRarity) entry.MetaRarity = row.MetaRarity;
  }
  const entries = Array.from(map.values()).map(
    ({ _usageSet, _tokenSet, ...rest }) =>
      finalizeEntry({ ...rest, _tokens: Array.from(_tokenSet) })
  );

  // Every real item on MetaForge is searchable, even if nothing requires it
  const known = new Set(entries.map((e) => e._normName));
  for (const [key, meta] of JSON_DATA_MAP) {
    if (known.has(key) || !isSearchableJsonItem(meta)) continue;
    known.add(key);
    entries.push(
      finalizeEntry({
        Name: meta.name,
        _normName: key,
        Source: "Item",
        UsageEntries: [],
        CategoryList: [],
        LocationList: [],
        VendorList: [],
        SourceList: ["Item"],
        FilterKeys: new Set(),
        _tokens: tokenizeName(meta.name).filter((t) => !SEARCH_BLACKLIST.has(t)),
      })
    );
  }
  return entries;
}

// Descriptions MetaForge uses as placeholders; a hand-written CSV description beats these
const GENERIC_DESCRIPTIONS = new Set([
  "can be recycled into crafting materials.",
  "used in crafting.",
  "",
]);

// Weapon roll variants ("Amplified Burletta (Burst Fire)") would flood results
function isSearchableJsonItem(meta) {
  if (!meta?.name) return false;
  if (meta.item_type === "Weapon" && /\(.*\)\s*$/.test(meta.name)) return false;
  return true;
}

// items.json (synced from MetaForge) is authoritative for item metadata;
// CSV values are a fallback for items MetaForge doesn't cover.
function finalizeEntry(entry) {
  const meta = JSON_DATA_MAP.get(entry._normName);
  if (meta) {
    const pick = (apiValue, csvValue) =>
      apiValue !== null && apiValue !== undefined && apiValue !== ""
        ? apiValue
        : csvValue;
    if (meta.icon) entry.IconURL = meta.icon;
    entry.ArcRarity = pick(meta.rarity, entry.ArcRarity || entry.MetaRarity);
    entry.ArcValue = pick(meta.value, entry.ArcValue);
    entry.ArcType = pick(meta.item_type, entry.ArcType);
    entry.ArcWeightKg = pick(meta.stat_block?.weight, entry.ArcWeightKg);
    entry.ArcStackSize = pick(meta.stat_block?.stackSize, entry.ArcStackSize);
    entry.ArcFoundIn = pick(meta.loot_area, entry.ArcFoundIn);
    const apiDesc = String(meta.description || "").trim();
    const csvDesc = entry.ArcDescription || entry.MetaDescription || "";
    entry.ArcDescription =
      !GENERIC_DESCRIPTIONS.has(apiDesc.toLowerCase()) || !csvDesc
        ? apiDesc
        : csvDesc;
    if (meta.recycle?.length) {
      entry.Recycle = meta.recycle;
      // the recycle chips replace any (possibly outdated) prose about recycling
      entry.ArcDescription = entry.ArcDescription
        .replace(/\s*Can be recycled into[^.]*\.?/i, "")
        .trim();
    }
    if (meta.dropped_by?.length) entry.DroppedBy = meta.dropped_by;
    if (meta.created_at) entry.CreatedAt = meta.created_at;
  }
  // Filter keys must match the values the card displays
  const addKey = (type, value) => {
    const norm = normalizeFilterValue(value);
    if (norm) entry.FilterKeys.add(`${type}:${norm}`);
  };
  addKey("rarity", entry.ArcRarity || entry.MetaRarity);
  splitLocations(entry.ArcFoundIn).forEach((loc) => addKey("location", loc));
  addKey("value", entry.ArcValue);
  return entry;
}

function deriveQuestName(itemId, slugName, arcId, metaId) {
  if (!itemId) return "";
  const tokens = itemId.split("_").filter(Boolean);
  if (tokens.length <= 1) return "";
  const nameTokens = slugName ? slugName.split("_").filter(Boolean) : [];
  let dropCount = 0;
  if (
    arcId &&
    itemId.startsWith(arcId) &&
    tokens.length > arcId.split("_").length
  ) {
    dropCount = arcId.split("_").length;
  } else if (
    metaId &&
    itemId.startsWith(metaId) &&
    tokens.length > metaId.split("_").length
  ) {
    dropCount = metaId.split("_").length;
  } else if (nameTokens.length && tokens.length > nameTokens.length) {
    dropCount = nameTokens.length;
  }
  if (dropCount <= 0 || dropCount >= tokens.length) {
    dropCount = Math.max(1, tokens.length - 2);
  }
  const remainder = tokens.slice(dropCount);
  if (remainder.length === 0) return "";
  return titleCase(remainder.join(" "));
}

// Basic fuzzy scorer (Jaro-Winkler-like using edit distance ratio)
function similarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  // token-based: prefers same words
  const at = a.split(/\s+/),
    bt = b.split(/\s+/);
  const shared = at.filter((x) => bt.includes(x)).length;
  const tokenScore = shared / Math.max(at.length, bt.length);

  // character overlap
  const aset = new Set(a),
    bset = new Set(b);
  let inter = 0;
  aset.forEach((ch) => {
    if (bset.has(ch)) inter++;
  });
  const charScore = inter / Math.max(aset.size, bset.size);

  return 0.6 * tokenScore + 0.4 * charScore;
}

const RARITY_ALIASES = {
  uncommon: "uncommon",
  common: "common",
  rare: "rare",
  epic: "epic",
  legendary: "legendary",
  exotic: "legendary",
  mythic: "legendary",
  "ultra rare": "legendary",
};

function getRarityClass(rarityText) {
  const key = String(rarityText || "")
    .trim()
    .toLowerCase();
  return RARITY_ALIASES[key] || key || "";
}

let ITEMS = [];
let GROUPED_ITEMS = [];
let JSON_DATA_MAP = new Map();
let DATA_SYNCED_AT = "";
let CONTENT_META = { patch: null, content: {} };
let dataLoaded = false;
let loadFailed = false;
let activeFilterKey = "";
let lastQuery = "";
let triggerSearch = null;
let searchFor = null;

async function loadData() {
  const [csvRes, jsonRes, contentMeta] = await Promise.all([
    fetch("items.csv"),
    fetch("items.json"),
    // optional: project status + current patch; the site works without it
    fetch("content.json")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null),
  ]);
  if (contentMeta) CONTENT_META = contentMeta;

  if (!csvRes.ok) throw new Error(`Failed to load CSV (${csvRes.status})`);
  if (!jsonRes.ok) throw new Error(`Failed to load JSON (${jsonRes.status})`);

  const [csvText, jsonData] = await Promise.all([
    csvRes.text(),
    jsonRes.json(),
  ]);

  DATA_SYNCED_AT = jsonData?.syncedAt || "";
  if (jsonData?.data) {
    jsonData.data.forEach((item) => {
      const name = normKey(item.name);
      // first entry wins (e.g. three "Colorful Shoes" rarities share a name)
      if (name && !JSON_DATA_MAP.has(name)) JSON_DATA_MAP.set(name, item);
    });
  }

  const rows = parseCSV(csvText);
  ITEMS = toObjects(rows);
  GROUPED_ITEMS = aggregateItems(ITEMS);
}

function setResultsMessage(text, type = "", detail = "") {
  const resultsEl = document.getElementById("results");
  if (!resultsEl) return;
  resultsEl.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `empty${type ? ` ${type}` : ""}`;
  div.textContent = text;
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    div.appendChild(small);
  }
  resultsEl.appendChild(div);
}

function formatValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `₳${n.toLocaleString()}` : value || "";
}

// "Avian Alarm: Stage 2 – Preliminary Signal Birds" → ["Avian Alarm", "Stage 2 – Preliminary Signal Birds"]
function splitStation(station) {
  const i = station.indexOf(":");
  return i < 0 ? [station, ""] : [station.slice(0, i).trim(), station.slice(i + 1).trim()];
}

// Classify a usage entry into the row the manifest shows
function describeUsage(entry) {
  const station = String(entry.station || "").trim().replace(/:$/, "");
  const stationLower = station.toLowerCase();
  const source = String(entry.source || "").toLowerCase();
  const tier = String(entry.tier || "").trim();
  if (stationLower === "quest" || source === "quest" || entry.questName) {
    return {
      type: "quest",
      label: entry.questName || station.replace(/^Quest:\s*/i, "") || "Unknown Quest",
      sub: "",
    };
  }
  if (stationLower.startsWith("expedition") || source === "expedition") {
    const [label, sub] = splitStation(station);
    return { type: "expedition", label, sub };
  }
  if (source === "project") {
    const [label, sub] = splitStation(station);
    return { type: "project", label, sub };
  }
  return {
    type: "bench",
    label: station || "Upgrade requirement",
    sub: tier && tier !== "0" ? `Tier ${tier}` : "",
  };
}

const TYPE_LABELS = { bench: "Bench", quest: "Quest", project: "Project", expedition: "Expedition" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function renderIcon(url, alt, className) {
  const wrap = el("span", className);
  const img = document.createElement("img");
  img.src = url.replace(/^http:/, "https:");
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = () => img.remove();
  wrap.appendChild(img);
  return wrap;
}

// ── Progress + view preferences (saved per device) ─────────────────────
const PROGRESS_KEY = "arc-raiders-progress-v1";
const PREFS_KEY = "arc-raiders-prefs-v1";
const DEFAULT_PREFS = {
  types: { bench: true, quest: true, project: true, expedition: true },
  showEnded: false,
  showDone: false,
};

function loadStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / storage blocked: progress just won't persist
  }
}

const DONE = new Set(loadStored(PROGRESS_KEY, []));
const storedPrefs = loadStored(PREFS_KEY, {});
const PREFS = {
  ...DEFAULT_PREFS,
  ...storedPrefs,
  types: { ...DEFAULT_PREFS.types, ...(storedPrefs.types || {}) },
};

// A "stage" is one bench tier, one quest, or one project/expedition phase
function stationKey(entry) {
  return `${entry.station}|${entry.tier}`;
}

function toggleDone(key) {
  if (DONE.has(key)) DONE.delete(key);
  else DONE.add(key);
  saveStored(PROGRESS_KEY, [...DONE]);
  if (typeof triggerSearch === "function") triggerSearch();
}

function setPref(update) {
  Object.assign(PREFS, update);
  saveStored(PREFS_KEY, PREFS);
  if (typeof triggerSearch === "function") triggerSearch();
}

function usageRows(item) {
  return (item.UsageEntries || []).map((entry) => {
    const info = describeUsage(entry);
    const status = CONTENT_META.content?.[info.label] || null;
    const key = stationKey(entry);
    return { entry, info, status, key, ended: status?.status === "ended", done: DONE.has(key) };
  });
}

function rowVisible(row) {
  return (
    PREFS.types[row.info.type] !== false &&
    (PREFS.showEnded || !row.ended) &&
    (PREFS.showDone || !row.done)
  );
}

// Why a matching item has no visible requirements
function hiddenReason(rows) {
  if (!rows.length) return "";
  if (rows.every((r) => r.ended)) return "ended projects only";
  if (rows.every((r) => r.done || r.ended)) return "your stages are done";
  return "hidden by filters";
}

// ── Shopping lists: everything one bench / quest / project needs ───────
let GROUPS = [];

function stageOrder(entry, info) {
  const tier = Number.parseInt(entry.tier, 10);
  if (tier > 0) return tier;
  const n = String(info.sub).match(/\d+/);
  return n ? Number(n[0]) : 0;
}

function buildGroups() {
  const map = new Map();
  for (const item of GROUPED_ITEMS) {
    for (const entry of item.UsageEntries || []) {
      const info = describeUsage(entry);
      const groupKey = `${info.type}|${info.label}`;
      let group = map.get(groupKey);
      if (!group) {
        group = { type: info.type, label: info.label, tokens: tokenizeName(info.label), stages: new Map() };
        map.set(groupKey, group);
      }
      const key = stationKey(entry);
      let stage = group.stages.get(key);
      if (!stage) {
        stage = { key, sub: info.sub, order: stageOrder(entry, info), items: [] };
        group.stages.set(key, stage);
      }
      stage.items.push({ item, quantity: Number(entry.quantity) || 0, note: entry.note || "" });
    }
  }
  GROUPS = [...map.values()].map((g) => ({
    ...g,
    stages: [...g.stages.values()].sort((a, b) => a.order - b.order),
  }));
}

// Searching a bench/quest/project name shows its shopping list
// Returns { shown, hiddenEnded } so a search for an ended project can explain itself
function matchGroups(query) {
  const none = { shown: [], hiddenEnded: [] };
  const qTokens = tokenizeName(query);
  if (!qTokens.length || query.trim().length < 3) return none;
  const matches = GROUPS.filter(
    (g) =>
      PREFS.types[g.type] !== false &&
      qTokens.every((q) => g.tokens.some((t) => t.startsWith(q)))
  );
  if (matches.length > 4) return none;
  const isHidden = (g) =>
    CONTENT_META.content?.[g.label]?.status === "ended" && !PREFS.showEnded;
  return { shown: matches.filter((g) => !isHidden(g)), hiddenEnded: matches.filter(isHidden) };
}

function renderEndedNotice(groups) {
  const notice = el("div", "ended-notice");
  const names = groups.map((g) => {
    const label = CONTENT_META.content?.[g.label]?.label || "Ended";
    return `${g.label} (${label.replace(/^Ended\s*/i, "ended ").trim()})`;
  });
  notice.appendChild(
    el("span", "", `${names.join(", ")} can't be progressed any more, so it's hidden.`)
  );
  const btn = el("button", "view-chip on", "Show ended");
  btn.type = "button";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setPref({ showEnded: true });
  });
  notice.appendChild(btn);
  return notice;
}

function stageTitle(group, stage) {
  if (group.type === "quest") return "Hand-in";
  return stage.sub || "Requirements";
}

function renderShopItem(item, quantity, note) {
  const tile = el("button", "shop-item");
  tile.type = "button";
  tile.title = `Search ${item.Name}`;
  const rarity = getRarityClass(item.ArcRarity || item.MetaRarity);
  if (rarity) tile.classList.add(`rarity-${rarity.replace(/\s+/g, "-")}`);
  if (item.IconURL) tile.appendChild(renderIcon(item.IconURL, "", "shop-icon"));
  const name = el("span", "shop-name", item.Name);
  if (note) name.appendChild(el("span", "note", ` ⚠ ${note}`));
  tile.appendChild(name);
  tile.appendChild(el("span", "qty", quantity));
  tile.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof searchFor === "function") searchFor(item.Name);
  });
  return tile;
}

function renderShoppingList(group) {
  const status = CONTENT_META.content?.[group.label] || null;
  const panel = el("section", `shop type-${group.type}`);
  const head = el("header", "shop-head");
  head.appendChild(el("span", "type-chip", TYPE_LABELS[group.type]));
  head.appendChild(el("h2", "shop-title", group.label));
  if (status) head.appendChild(el("span", `status-tag status-${status.status}`, status.label || status.status));
  const doneCount = group.stages.filter((s) => DONE.has(s.key)).length;
  head.appendChild(
    el("span", "shop-progress", `${doneCount}/${group.stages.length} ${group.stages.length === 1 ? "stage" : "stages"} done`)
  );
  panel.appendChild(head);

  const bar = el("div", "shop-bar");
  bar.style.setProperty("--p", group.stages.length ? doneCount / group.stages.length : 0);
  panel.appendChild(bar);

  const stages = el("ol", "shop-stages");
  const remaining = new Map();
  for (const stage of group.stages) {
    const done = DONE.has(stage.key);
    const li = el("li", `shop-stage${done ? " done" : ""}`);
    const check = el("button", "stage-check", done ? "✓" : "");
    check.type = "button";
    check.setAttribute("aria-pressed", String(done));
    check.title = done ? "Mark as not done" : "Mark stage as done";
    check.setAttribute("aria-label", `${group.label}: ${stageTitle(group, stage)}, ${done ? "done" : "not done"}`);
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDone(stage.key);
    });
    const title = el("div", "stage-title");
    title.appendChild(check);
    title.appendChild(el("span", "", stageTitle(group, stage)));
    li.appendChild(title);
    const items = el("div", "shop-items");
    for (const { item, quantity, note } of stage.items) {
      items.appendChild(renderShopItem(item, quantity, note));
      if (!done) {
        const prev = remaining.get(item._normName);
        remaining.set(item._normName, { item, quantity: (prev?.quantity || 0) + quantity });
      }
    }
    li.appendChild(items);
    stages.appendChild(li);
  }
  panel.appendChild(stages);

  const total = el("footer", "shop-total");
  if (remaining.size) {
    const sum = [...remaining.values()].reduce((n, r) => n + r.quantity, 0);
    const label = el("div", "shop-total-label", "Still needed ");
    label.appendChild(el("b", "", `${sum.toLocaleString()} items`));
    total.appendChild(label);
    const items = el("div", "shop-items");
    [...remaining.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .forEach(({ item, quantity }) => items.appendChild(renderShopItem(item, quantity)));
    total.appendChild(items);
  } else {
    total.appendChild(el("div", "shop-total-label complete", "All stages done ✓"));
  }
  panel.appendChild(total);
  return panel;
}

// ── Item cards ──────────────────────────────────────────────────────────
function renderCard(r, rows, index) {
  const card = el("article", "result");
  card.style.setProperty("--i", index);
  const rarityClass = getRarityClass(r.ArcRarity || r.MetaRarity);
  if (rarityClass) card.classList.add(`rarity-${rarityClass.replace(/\s+/g, "-")}`);
  const content = el("div", "result-body");

  // Header: icon, type, name, badges
  const header = el("header", "result-header");
  if (r.IconURL) header.appendChild(renderIcon(r.IconURL, r.Name, "result-icon"));
  const headerContent = el("div", "result-header-content");
  if (r.ArcType) headerContent.appendChild(el("div", "result-kicker", r.ArcType));
  headerContent.appendChild(el("strong", "", r.Name || "Unknown Item"));

  const badges = el("div", "badges");
  const badgeSet = new Set();
  const addBadge = (text, keyType, rawValue = text) => {
    if (!text) return null;
    const key = keyType ? `${keyType}:${normalizeFilterValue(rawValue ?? text)}` : "";
    const dedupeKey = String(text).trim().toLowerCase();
    if (badgeSet.has(dedupeKey)) return null;
    badgeSet.add(dedupeKey);
    const badge = el("button", "badge", text);
    badge.type = "button";
    if (key) {
      badge.dataset.filterKey = key;
      badge.title = activeFilterKey === key ? "Remove filter" : "Filter results by this";
      if (activeFilterKey === key) badge.classList.add("badge-active");
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFilter(key);
      });
    }
    badges.appendChild(badge);
    return badge;
  };
  const rarityLabel = r.ArcRarity || r.MetaRarity;
  if (rarityLabel) addBadge(rarityLabel, "rarity", rarityLabel)?.classList.add("badge-rarity");
  const locations = r.ArcFoundIn
    ? splitLocations(r.ArcFoundIn)
    : r.LocationList?.length
      ? r.LocationList
      : [r.LocationType];
  locations.forEach((loc) => addBadge(loc, "location", loc));
  const arcValueNum = Number(r.ArcValue);
  if (Number.isFinite(arcValueNum) && arcValueNum > 0) {
    addBadge(formatValue(arcValueNum), "value", arcValueNum)?.classList.add("badge-value");
  } else if (r.ArcValue) {
    addBadge(r.ArcValue, "value", r.ArcValue);
  }
  if (badges.children.length) headerContent.appendChild(badges);
  header.appendChild(headerContent);
  content.appendChild(header);

  const description = r.ArcDescription || r.MetaDescription;
  if (description) content.appendChild(el("p", "description", description));

  // Recycling: structured MetaForge data first, description text as fallback
  let materials = r.Recycle?.length ? r.Recycle : null;
  if (!materials && description) {
    const recyclePatterns = [
      /Can be recycled into ([^.]+)\.?/i,
      /Dismantle(?:s)? (?:into|yields):?\s*([^.]+)\.?/i,
      /(?:Breaks down|Converts) (?:into|to):?\s*([^.]+)\.?/i,
    ];
    for (const pattern of recyclePatterns) {
      const match = description.match(pattern);
      if (match && !/^crafting materials$/i.test(match[1].trim())) {
        materials = parseRecyclingMaterials(match[1].trim());
        break;
      }
    }
  }
  if (materials?.length) {
    const strip = el("div", "dismantle-info");
    strip.appendChild(el("strong", "", "Recycles into"));
    const list = el("span", "recycle-materials");
    for (const material of materials) {
      const item = findItemByName(material.name);
      const chip = el("span", "recycle-material");
      if (item?.IconURL) {
        const icon = renderIcon(item.IconURL, material.name, "recycle-material-icon");
        if (material.quantity !== null && material.quantity !== undefined) {
          icon.appendChild(el("span", "recycle-quantity-badge", material.quantity));
        }
        chip.appendChild(icon);
      }
      chip.appendChild(
        el(
          "span",
          "recycle-material-name",
          item?.IconURL || material.quantity === null || material.quantity === undefined
            ? material.name
            : `${material.quantity} ${material.name}`
        )
      );
      list.appendChild(chip);
    }
    strip.appendChild(list);
    content.appendChild(strip);
  }

  // Which ARC to farm
  if (r.DroppedBy?.length) {
    const drops = el("div", "dropped-by");
    drops.appendChild(el("strong", "", "Dropped by"));
    const list = el("span", "drop-list");
    r.DroppedBy.forEach((name) => list.appendChild(el("span", "drop-chip", name)));
    drops.appendChild(list);
    content.appendChild(drops);
  }

  // Requirement manifest: current content first, ended at the bottom
  const usage = el("section", "usage required");
  const title = el("div", "usage-title", "Needed for ");
  title.appendChild(el("span", "usage-count", rows.filter((row) => !row.done).length));
  usage.appendChild(title);
  const sorted = [...rows].sort((a, b) => Number(a.ended) - Number(b.ended) || Number(a.done) - Number(b.done));
  const ul = el("ul", "usage-list");
  for (const { entry, info, status, ended, done, key } of sorted) {
    const li = el("li", `usage-row type-${info.type}${ended ? " ended" : ""}${done ? " done" : ""}`);
    li.appendChild(el("span", "type-chip", TYPE_LABELS[info.type]));
    const name = el("span", "usage-name");
    name.appendChild(el("span", "usage-label", info.label));
    if (info.sub) name.appendChild(el("span", "usage-sub", info.sub));
    li.appendChild(name);
    const qty = Number(entry.quantity);
    li.appendChild(el("span", "qty", Number.isFinite(qty) && qty > 0 ? qty : "?"));
    const check = el("button", "stage-check", done ? "✓" : "");
    check.type = "button";
    check.setAttribute("aria-pressed", String(done));
    check.title = done ? "Mark as not done" : "Mark this stage done";
    check.setAttribute("aria-label", `${info.label}${info.sub ? ` ${info.sub}` : ""}: ${done ? "done" : "not done"}`);
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDone(key);
    });
    li.appendChild(check);
    if (entry.note || status) {
      const extra = el("div", "usage-extra");
      if (status) {
        extra.appendChild(el("span", `status-tag status-${status.status}`, status.label || status.status));
      }
      if (entry.note) extra.appendChild(el("span", "note", `⚠ ${entry.note}`));
      li.appendChild(extra);
    }
    ul.appendChild(li);
  }
  usage.appendChild(ul);
  content.appendChild(usage);

  card.appendChild(content);
  return card;
}

// Matching items nothing (currently) needs: one compact note, not a card each
function renderNotNeeded(items) {
  const panel = el("section", "not-needed");
  panel.appendChild(el("div", "safe-stamp", "Not needed"));
  const body = el("div", "not-needed-body");
  body.appendChild(
    el("p", "", "Nothing you're tracking needs these. Safe to sell or recycle:")
  );
  const list = el("ul", "nn-list");
  const shown = items.slice(0, 12);
  for (const { item, reason } of shown) {
    const li = el("li", "nn-item");
    if (item.IconURL) li.appendChild(renderIcon(item.IconURL, "", "nn-icon"));
    li.appendChild(el("span", "nn-name", item.Name));
    const value = formatValue(item.ArcValue);
    if (value) li.appendChild(el("span", "nn-value", value));
    if (reason) li.appendChild(el("span", "nn-reason", reason));
    list.appendChild(li);
  }
  body.appendChild(list);
  if (items.length > shown.length) {
    body.appendChild(el("p", "nn-more", `…and ${items.length - shown.length} more`));
  }
  panel.appendChild(body);
  return panel;
}

function renderResults(views, q, notNeeded = [], groupMatch = { shown: [], hiddenEnded: [] }) {
  const groups = groupMatch.shown;
  const resultsEl = document.getElementById("results");
  resultsEl.innerHTML = "";
  document.body.classList.toggle("search-active", Boolean(q.trim()));

  if (!views.length && !notNeeded.length && !groups.length && !groupMatch.hiddenEnded.length) {
    setResultsMessage(
      `No signal for “${q.trim()}”`,
      "error",
      activeFilterKey
        ? "A badge filter is active. Clear it to widen the search."
        : "Try part of a name, a bench (gunsmith), a quest or a project."
    );
    return;
  }

  if (groupMatch.hiddenEnded.length) resultsEl.appendChild(renderEndedNotice(groupMatch.hiddenEnded));
  groups.forEach((group) => resultsEl.appendChild(renderShoppingList(group)));
  views.forEach(({ item, rows }, index) => resultsEl.appendChild(renderCard(item, rows, index)));
  if (notNeeded.length) resultsEl.appendChild(renderNotNeeded(notNeeded));
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
    const stationCompare = String(a.Station || "").localeCompare(
      String(b.Station || "")
    );
    if (stationCompare !== 0) return stationCompare;
    return String(a.Tier || "").localeCompare(String(b.Tier || ""));
  });
  return out;
}

function syncUI() {
  const container = document.querySelector(".container");
  const input = document.getElementById("q");
  if (!container || !input) return;
  const active = input.value.trim().length > 0;
  container.classList.toggle("compact", active);
  document.body.classList.toggle("top-align", active);
}

function matchesQuery(item, query) {
  if (!query) return false;
  const qTokens = tokenizeName(query);
  if (qTokens.length === 0) return false;

  const itemTokens = item._tokens || [];

  // All query tokens must match at least one item token
  return qTokens.every((q) => itemTokens.some((t) => t.startsWith(q)));
}

function applyActiveFilter(list) {
  if (!activeFilterKey) return list;
  return list.filter((item) => item.FilterKeys?.has(activeFilterKey));
}

function toggleFilter(key) {
  activeFilterKey = activeFilterKey === key ? "" : key;
  if (typeof triggerSearch === "function") triggerSearch();
}

function findItemByName(name) {
  const normalized = normKey(name);

  // First, try to find in CSV data (GROUPED_ITEMS)
  let item = GROUPED_ITEMS.find(item => item._normName === normalized);

  // If not found, fallback to JSON data and construct a minimal item object
  if (!item) {
    const jsonItem = JSON_DATA_MAP.get(normalized);
    if (jsonItem) {
      item = {
        _normName: normalized,
        Name: jsonItem.name,
        IconURL: jsonItem.icon
      };
    }
  }

  return item;
}

function parseRecyclingMaterials(recycleText) {
  if (!recycleText) return [];

  const materials = [];
  // Pattern: "14 Plastic Parts and 4 Wires" or just "ARC Alloy"
  // Split by "and" or "," to separate multiple materials
  const parts = recycleText.split(/\s+and\s+|,\s*/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Try to match: "<number>x? <material name>"
    // Matches "1 Metal Parts" and "1x Metal Parts"
    const match = trimmed.match(/^(\d+)x?\s+(.+)$/i);
    if (match) {
      materials.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim()
      });
    } else {
      // Just a material name without quantity
      materials.push({
        quantity: null,
        name: trimmed
      });
    }
  }

  return materials;
}

function search(q, maxResults = 50) {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const prefixMatches = dedupeAndSort(
    GROUPED_ITEMS.filter((it) => matchesQuery(it, query))
  );

  if (prefixMatches.length > 0) {
    // Exact name first, then items whose own name matches, then everything
    // else (e.g. requirements of a searched project); alphabetical within each.
    const qKey = normKey(query);
    const qTokens = tokenizeName(query);
    const rank = (it) => {
      if (it._normName === qKey) return 0;
      const nameTokens = tokenizeName(it._normName);
      return qTokens.every((q) => nameTokens.some((t) => t.startsWith(q))) ? 1 : 2;
    };
    return prefixMatches
      .map((it, i) => ({ it, i, r: rank(it) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.it)
      .slice(0, maxResults);
  }

  // fuzzy matches
  const scored = GROUPED_ITEMS.map((it) => ({
    it,
    score: similarity(query, it._normName),
  }))
    .filter((x) => x.score >= 0.6) // adjust threshold as needed
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

const SEARCH_HINTS = [
  "Search items, benches, quests…",
  "Try “tick pod”",
  "Try a bench: “gunsmith”",
  "Try “ascending the mountain”",
  "Try a quest: “movie night”",
  "Try “research station”",
];

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function renderHud(state, message = "") {
  const hud = document.getElementById("hud");
  if (!hud) return;
  hud.innerHTML = "";
  const item = (children) => {
    const span = el("span", "hud-item");
    children.forEach((c) => span.appendChild(c));
    hud.appendChild(span);
  };
  const withBold = (before, bold, after = "") => {
    const frag = document.createDocumentFragment();
    if (before) frag.append(before);
    frag.appendChild(el("b", "", bold));
    if (after) frag.append(after);
    return frag;
  };
  item([el("span", `hud-dot${state === "ready" ? "" : ` ${state}`}`), document.createTextNode(message)]);
  if (state !== "ready") return;
  item([withBold("", GROUPED_ITEMS.length.toLocaleString(), " items tracked")]);
  if (CONTENT_META.patch?.name) item([withBold("Patch ", CONTENT_META.patch.name)]);
  if (DATA_SYNCED_AT) item([withBold("Synced ", formatDate(DATA_SYNCED_AT))]);
}

function describeFilter(key) {
  const [type, ...rest] = key.split(":");
  const value = rest.join(":");
  const label = type === "value" && Number(value) ? formatValue(value) : titleCase(value);
  return `${type === "location" ? "Found in" : titleCase(type)}: ${label}`;
}

async function main() {
  const qEl = document.getElementById("q");
  const searchEl = document.getElementById("search");
  const clearEl = document.getElementById("clear");
  const countEl = document.getElementById("result-count");
  const pillEl = document.getElementById("filter-pill");
  const viewFiltersEl = document.getElementById("view-filters");
  qEl.disabled = true;

  try {
    await loadData();
    buildGroups();
    dataLoaded = true;
    qEl.disabled = false;
    qEl.placeholder = SEARCH_HINTS[0];
    qEl.focus();
    setResultsMessage("");
    renderHud("ready", "Data link online");
  } catch (e) {
    setResultsMessage("Data link failed", "error", e.message);
    renderHud("error", "Data link offline");
    qEl.placeholder = "Couldn't load the item database";
    loadFailed = true;
  }
  searchEl.classList.remove("loading");

  function updateMeta(count, notNeededCount = 0) {
    const hasQuery = Boolean(qEl.value.trim());
    countEl.textContent = "";
    if (hasQuery && dataLoaded) {
      countEl.appendChild(el("b", "", count));
      countEl.append(" needed");
      if (notNeededCount) countEl.append(` · ${notNeededCount} not needed`);
    }
    pillEl.classList.toggle("on", Boolean(activeFilterKey) && hasQuery);
    pillEl.textContent = activeFilterKey ? `${describeFilter(activeFilterKey)} ✕` : "";
    pillEl.title = "Remove filter";
  }

  function doSearch() {
    const q = qEl.value;
    lastQuery = q;
    document.body.classList.toggle("search-active", Boolean(q.trim()));
    searchEl.classList.toggle("has-value", q.length > 0);
    const resultsEl = document.getElementById("results");
    if (!q.trim()) {
      if (resultsEl) resultsEl.innerHTML = "";
      updateMeta(0);
      syncUI();
      return;
    }
    if (!dataLoaded) {
      if (!loadFailed) {
        setResultsMessage("Still loading data…");
      }
      return;
    }
    // Only items something still needs get a card; other matches are listed as "not needed"
    const views = [];
    const notNeeded = [];
    for (const item of applyActiveFilter(search(q, 250))) {
      const rows = usageRows(item);
      const visible = rows.filter(rowVisible);
      if (visible.length) views.push({ item, rows: visible });
      else notNeeded.push({ item, reason: hiddenReason(rows) });
    }
    renderResults(views.slice(0, 60), q, notNeeded, matchGroups(q));
    updateMeta(views.length, notNeeded.length);
    syncUI();
  }

  // View filters: requirement types, ended content, completed stages
  function renderViewFilters() {
    viewFiltersEl.innerHTML = "";
    const chip = (label, on, onClick, extraClass = "") => {
      const b = el("button", `view-chip${on ? " on" : ""}${extraClass ? ` ${extraClass}` : ""}`, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
        renderViewFilters();
      });
      viewFiltersEl.appendChild(b);
    };
    for (const type of Object.keys(TYPE_LABELS)) {
      chip(TYPE_LABELS[type], PREFS.types[type] !== false, () =>
        setPref({ types: { ...PREFS.types, [type]: PREFS.types[type] === false } }), `type-${type}`);
    }
    viewFiltersEl.appendChild(el("span", "view-sep"));
    chip("Ended", PREFS.showEnded, () => setPref({ showEnded: !PREFS.showEnded }));
    chip(`Done${DONE.size ? ` (${DONE.size})` : ""}`, PREFS.showDone, () => setPref({ showDone: !PREFS.showDone }));
  }

  // Clicking an item in a shopping list searches for it
  searchFor = (name) => {
    qEl.value = name;
    doSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
    qEl.focus();
  };

  qEl.addEventListener("input", () => {
    if (dataLoaded) {
      doSearch();
    }
  });
  clearEl.addEventListener("click", (e) => {
    e.stopPropagation();
    qEl.value = "";
    doSearch();
    qEl.focus();
  });
  pillEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeFilterKey) toggleFilter(activeFilterKey);
  });
  document.addEventListener("click", () => {
    if (!qEl.disabled) qEl.focus();
  });
  triggerSearch = () => {
    doSearch();
    if (dataLoaded) renderViewFilters();
  };
  if (dataLoaded) renderViewFilters();
  syncUI();

  // Cycle example searches in the placeholder while the box is empty
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (dataLoaded && !reduceMotion) {
    let hint = 0;
    setInterval(() => {
      if (qEl.value) return;
      qEl.classList.add("hint-fade");
      setTimeout(() => {
        hint = (hint + 1) % SEARCH_HINTS.length;
        qEl.placeholder = SEARCH_HINTS[hint];
        qEl.classList.remove("hint-fade");
      }, 300);
    }, 3800);
  }
}

main();
