// Client-only CSV loader + fuzzy search

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

function tokenizeName(name) {
  return String(name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function toObjects(rows) {
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === "") continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c] !== undefined ? row[c] : "";
    }
    obj.Quantity = normalizeQuantity(obj.Quantity);
    obj._normName = String(obj.Name || "")
      .trim()
      .toLowerCase();

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

    // Merge metadata from items.json
    const metaData = JSON_DATA_MAP.get(entry._normName);
    if (metaData) {
      if (!entry.IconURL && metaData.icon) entry.IconURL = metaData.icon;
      if (
        (entry.ArcWeightKg === undefined || entry.ArcWeightKg === "") &&
        metaData.stat_block?.weight
      ) {
        entry.ArcWeightKg = metaData.stat_block.weight;
      }
      if (
        (entry.ArcStackSize === undefined || entry.ArcStackSize === "") &&
        metaData.stat_block?.stackSize
      ) {
        entry.ArcStackSize = metaData.stat_block.stackSize;
      }
    }

    // Fallback Icon Generation if still missing
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
    if (row.Station === "Quest" || row.Source === "Quest") {
      questName = deriveQuestName(row.ItemID, slugName, row.ArcID, row.MetaID);
    }
    const usageKey = [
      row.Station,
      row.Tier,
      row.Quantity,
      row.Source,
      questName,
    ].join("|");
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

    tokenizeName(row.Name).forEach((token) => entry._tokenSet.add(token));

    if (!entry.ArcDescription && row.ArcDescription)
      entry.ArcDescription = row.ArcDescription;
    if (!entry.MetaDescription && row.MetaDescription)
      entry.MetaDescription = row.MetaDescription;
    if (!entry.ArcRarity && row.ArcRarity) entry.ArcRarity = row.ArcRarity;
    if (!entry.MetaRarity && row.MetaRarity) entry.MetaRarity = row.MetaRarity;
  }
  return Array.from(map.values()).map(({ _usageSet, _tokenSet, ...rest }) => ({
    ...rest,
    _tokens: Array.from(_tokenSet),
  }));
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
let dataLoaded = false;
let loadFailed = false;
let activeFilterKey = "";
let lastQuery = "";
let triggerSearch = null;

async function loadData() {
  const [csvRes, jsonRes] = await Promise.all([
    fetch("items.csv"),
    fetch("items.json"),
  ]);

  if (!csvRes.ok) throw new Error(`Failed to load CSV (${csvRes.status})`);
  if (!jsonRes.ok) throw new Error(`Failed to load JSON (${jsonRes.status})`);

  const [csvText, jsonData] = await Promise.all([
    csvRes.text(),
    jsonRes.json(),
  ]);

  if (jsonData?.data) {
    jsonData.data.forEach((item) => {
      const name = String(item.name || "").trim().toLowerCase();
      if (name) JSON_DATA_MAP.set(name, item);
    });
  }

  const rows = parseCSV(csvText);
  ITEMS = toObjects(rows);
  GROUPED_ITEMS = aggregateItems(ITEMS);
}

function setResultsMessage(text, type = "") {
  const resultsEl = document.getElementById("results");
  if (!resultsEl) return;
  resultsEl.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `empty${type ? ` ${type}` : ""}`;
  div.textContent = text;
  resultsEl.appendChild(div);
}

function renderResults(list, q) {
  const resultsEl = document.getElementById("results");
  resultsEl.innerHTML = "";
  document.body.classList.toggle("search-active", Boolean(q.trim()));

  if (list.length === 0) {
    setResultsMessage(`No matches found for "${q}".`, "error");
    return;
  }

  for (const r of list) {
    const div = document.createElement("div");
    div.className = "result";
    const rarityKey = String(r.ArcRarity || r.MetaRarity || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (rarityKey) {
      div.classList.add(`rarity-${rarityKey}`);
    } else {
      const tierValue = Number.parseInt(r.Tier, 10);
      div.classList.add(
        Number.isFinite(tierValue) ? `tier-${tierValue}` : "tier-0"
      );
    }
    const content = document.createElement("div");
    content.className = "result-body";

    // New Header Layout
    const header = document.createElement("div");
    header.className = "result-header";

    if (r.IconURL) {
      const iconContainer = document.createElement("div");
      iconContainer.className = "result-icon";
      const icon = document.createElement("img");
      const cleanUrl = r.IconURL.replace(/^http:/, "https:");
      icon.src = cleanUrl;
      icon.alt = r.Name;
      iconContainer.appendChild(icon);
      header.appendChild(iconContainer);
    }

    const headerContent = document.createElement("div");
    headerContent.className = "result-header-content";

    const title = document.createElement("strong");
    title.textContent = r.Name || "Unknown Item";
    headerContent.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "badges";
    const badgeSet = new Set();
    const addBadge = (text, keyType, rawValue = text) => {
      if (!text) return;
      const key = keyType
        ? `${keyType}:${normalizeFilterValue(rawValue ?? text)}`
        : "";
      const dedupeKey = text.trim().toLowerCase();
      if (badgeSet.has(dedupeKey)) return;
      badgeSet.add(dedupeKey);
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "badge";
      badge.textContent = text;
      if (key) {
        badge.dataset.filterKey = key;
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
    if (rarityLabel) {
      const rarityBadge = addBadge(rarityLabel, "rarity", rarityLabel);
      const rarityClass = getRarityClass(rarityLabel);
      if (rarityBadge && rarityClass) {
        rarityBadge.classList.add(
          "badge-rarity",
          `badge-rarity-${rarityClass}`
        );
      }
    }
    const locations = r.ArcFoundIn
      ? splitLocations(r.ArcFoundIn)
      : r.LocationList?.length
      ? r.LocationList
      : [r.LocationType];
    locations.forEach((loc) => addBadge(loc, "location", loc));
    const arcValueNum = Number(r.ArcValue);
    if (Number.isFinite(arcValueNum) && arcValueNum > 0) {
      addBadge(`₳${arcValueNum.toLocaleString()}`, "value", arcValueNum);
    } else if (r.ArcValue) {
      addBadge(r.ArcValue, "value", r.ArcValue);
    }
    headerContent.appendChild(badges);
    header.appendChild(headerContent);
    content.appendChild(header);

    const description = r.ArcDescription || r.MetaDescription;
    if (description) {
      const desc = document.createElement("p");
      desc.className = "description";
      desc.textContent = description;
      content.appendChild(desc);

      const recycleMatch = description.match(
        /Can be recycled into ([^.]+)\.?/i
      );
      if (recycleMatch) {
        const recycle = document.createElement("div");
        recycle.className = "description";
        recycle.textContent = `Dismantle yields: ${recycleMatch[1].trim()}.`;
        content.appendChild(recycle);
      }
    }

    const hasUsage = (r.UsageEntries?.length || 0) > 0;
    const advisory = document.createElement("div");
    advisory.className = `usage ${hasUsage ? "required" : "optional"}`;
    const usageTitle = document.createElement("div");
    usageTitle.className = "usage-title";

    if (hasUsage) {
      const usageEntries = r.UsageEntries || [];
      usageTitle.textContent = "Required";
      advisory.appendChild(usageTitle);

      const usageList = document.createElement("ul");
      usageList.className = "usage-list";
      usageEntries.forEach((entry) => {
        const li = document.createElement("li");
        const stationLower = String(entry.station || "").toLowerCase();
        const sourceLower = String(entry.source || "").toLowerCase();
        const isQuestRequirement =
          stationLower === "quest" ||
          sourceLower === "quest" ||
          Boolean(entry.questName);
        const isExpeditionRequirement = stationLower.startsWith("expedition");
        const rawTier = String(entry.tier || "").trim();
        const hideTier = !rawTier || rawTier === "0";
        const tierText = hideTier ? "" : `Tier ${rawTier}`;
        const baseStationLabel = String(entry.station || "")
          .trim()
          .replace(/:$/, "");
        const heading = isQuestRequirement
          ? `Quest: ${entry.questName || "Unknown Quest"}`
          : baseStationLabel && tierText
          ? `${baseStationLabel}: ${tierText}`
          : baseStationLabel || tierText || "Upgrade requirement";
        const headingEl = document.createElement("div");
        headingEl.textContent = heading;
        li.appendChild(headingEl);

        const hasNumericQuantity = Number.isFinite(entry.quantity);
        let showQuantity = null;
        if (hasNumericQuantity && entry.quantity > 0) {
          showQuantity = entry.quantity;
        } else if (isQuestRequirement || isExpeditionRequirement) {
          showQuantity = hasNumericQuantity ? entry.quantity : 0;
        }
        if (showQuantity !== null) {
          const qtyLine = document.createElement("div");
          qtyLine.textContent = `Quantity: ${showQuantity}`;
          li.appendChild(qtyLine);
        }
        const shouldShowSource =
          !isQuestRequirement &&
          !isExpeditionRequirement &&
          entry.source &&
          entry.source !== "Item";
        if (shouldShowSource) {
          const srcLine = document.createElement("div");
          srcLine.textContent = `Source: ${entry.source}`;
          li.appendChild(srcLine);
        }
        usageList.appendChild(li);
      });
      advisory.appendChild(usageList);
    } else {
      usageTitle.textContent = "Not listed for quests / upgrades";
      advisory.appendChild(usageTitle);
      const safeMsg = document.createElement("p");
      const saleValue = Number(r.ArcValue);
      const saleText =
        Number.isFinite(saleValue) && saleValue > 0
          ? `₳${saleValue.toLocaleString()}`
          : r.ArcValue || "its listed value";
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
  if (item._normName.startsWith(query)) return true;
  return item._tokens?.some((token) => token.startsWith(query));
}

function applyActiveFilter(list) {
  if (!activeFilterKey) return list;
  return list.filter((item) => item.FilterKeys?.has(activeFilterKey));
}

function toggleFilter(key) {
  activeFilterKey = activeFilterKey === key ? "" : key;
  if (typeof triggerSearch === "function") triggerSearch();
}

function search(q, maxResults = 50) {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const prefixMatches = dedupeAndSort(
    GROUPED_ITEMS.filter((it) => matchesQuery(it, query))
  );

  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, maxResults);
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

async function main() {
  const qEl = document.getElementById("q");
  qEl.disabled = true;

  try {
    await loadData();
    dataLoaded = true;
    qEl.disabled = false;
    qEl.focus();
    setResultsMessage("");
  } catch (e) {
    setResultsMessage(e.message, "error");
    loadFailed = true;
  }

  function doSearch() {
    const q = qEl.value;
    lastQuery = q;
    document.body.classList.toggle("search-active", Boolean(q.trim()));
    const resultsEl = document.getElementById("results");
    if (!q.trim()) {
      if (resultsEl) resultsEl.innerHTML = "";
      return;
    }
    if (!dataLoaded) {
      if (!loadFailed) {
        setResultsMessage("Still loading data…");
      }
      return;
    }
    const res = search(q);
    renderResults(applyActiveFilter(res), q);
    syncUI();
  }

  qEl.addEventListener("input", () => {
    if (dataLoaded) {
      doSearch();
    }
  });
  document.addEventListener("click", () => {
    if (!qEl.disabled) qEl.focus();
  });
  triggerSearch = doSearch;
  syncUI();
}

main();
