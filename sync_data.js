#!/usr/bin/env node

/**
 * MetaForge API Sync
 *
 * Usage:
 *   node sync_data.js            Fetch items, quests and benches from the MetaForge API
 *                                and write items.json, items_pretty.json, quests.json, hideout.json
 *   node sync_data.js --report   Offline: diff the local JSON against items.csv and list
 *                                anything out of date (quest hand-ins, bench levels, name drift,
 *                                new items). Run this after every game patch.
 *   node sync_data.js --apply    Offline: regenerate the AUTO bench + quest sections of items.csv
 *                                from hideout.json / quests.json. Hand-written rows (projects,
 *                                expeditions, base items) are left untouched.
 *
 * Attribution: Data provided by MetaForge (https://metaforge.app/arc-raiders)
 */

const fs = require('fs');
const path = require('path');

const API = 'https://metaforge.app/api/arc-raiders';
const out = (f) => path.join(__dirname, f);
const FILES = {
    items: out('items.json'),
    itemsPretty: out('items_pretty.json'),
    quests: out('quests.json'),
    hideout: out('hideout.json'),
    csv: out('items.csv'),
};

// Item types the site never shows on their own (cosmetics, furniture, etc.)
const SKIP_TYPES = new Set(['Outfits', 'Cosmetic', 'Furniture', 'Design', 'Stencil']);

// CSV markers that bracket the generated sections
const AUTO = {
    benchStart: '# --- AUTO: bench upgrades (node sync_data.js --apply) ---',
    benchEnd: '# --- END AUTO: bench upgrades ---',
    questStart: '# --- AUTO: quest hand-ins (node sync_data.js --apply) ---',
    questEnd: '# --- END AUTO: quest hand-ins ---',
};

// Short ItemID suffixes per bench (see CLAUDE.md)
const BENCH_ABBREV = {
    'scrappy': 's',
    'weapon-bench': 'g',
    'equipment-bench': 'gb',
    'med-station': 'm',
    'explosives-bench': 'e',
    'utility-bench': 'u',
    'refiner': 'r',
    'research-station': 'rs',
    'outpost': 'o',
};

const colors = {
    reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`);

// Shared with script.js: names are joined on this key so that
// “Leviathan's Crown” Ship Model == Leviathan's Crown Ship Model
function normKey(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[‘’ʼ`]/g, "'")
        .replace(/["“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const slug = (s) => normKey(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ─── Fetching ──────────────────────────────────────────────────────────────

async function getJSON(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Arc-Raiders-Upgrades sync' } });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
}

async function fetchPaged(endpoint, extra = '') {
    const all = [];
    for (let page = 1; ; page++) {
        const res = await getJSON(`${API}/${endpoint}?page=${page}${extra}`);
        if (!Array.isArray(res?.data)) throw new Error(`Invalid ${endpoint} response`);
        all.push(...res.data);
        log(`   ${endpoint} page ${page}: ${res.data.length} (total ${all.length})`, 'dim');
        if (!res.pagination?.hasNextPage) break;
        await new Promise((r) => setTimeout(r, 150)); // be polite
    }
    return all;
}

// The browser only needs a slice of each item; keeping items.json small keeps the site fast.
function compactItem(i) {
    const recycle = (i.recycle_components || [])
        .filter((c) => c?.component?.name)
        .map((c) => ({ name: c.component.name, quantity: c.quantity }));
    const droppedBy = [...new Set((i.dropped_by || []).map((d) => d?.arc?.name).filter(Boolean))];
    const usedIn = (i.used_in || [])
        .filter((u) => u?.item?.name)
        .map((u) => ({ name: u.item.name, quantity: u.quantity }));
    return {
        id: i.id,
        name: i.name,
        description: i.description || '',
        item_type: i.item_type || '',
        icon: i.icon || '',
        rarity: i.rarity || '',
        value: i.value ?? null,
        workbench: i.workbench || '',
        loot_area: i.loot_area || '',
        stat_block: { weight: i.stat_block?.weight ?? null, stackSize: i.stat_block?.stackSize ?? null },
        created_at: (i.created_at || '').slice(0, 10),
        ...(recycle.length && { recycle }),
        ...(droppedBy.length && { dropped_by: droppedBy }),
        ...(usedIn.length && { used_in: usedIn }),
    };
}

function compactQuest(q) {
    return {
        id: q.id,
        name: q.name,
        trader: q.trader_name || '',
        objectives: (q.objectives || []).map(String),
        required_items: (q.required_items || [])
            .filter((r) => r?.item?.name)
            .map((r) => ({ name: r.item.name, quantity: r.quantity })),
        created_at: (q.created_at || '').slice(0, 10),
    };
}

async function sync() {
    log('\n🔄 MetaForge sync started\n', 'cyan');
    const backups = [];
    try {
        log('🌐 Items (with recycle/drop data)…', 'cyan');
        const items = await fetchPaged('items', '&includeComponents=true');
        log('🌐 Quests…', 'cyan');
        const quests = await fetchPaged('quests');
        log('🌐 Benches…', 'cyan');
        const hideout = await getJSON(`${API}/hideout`);
        if (!Array.isArray(hideout)) throw new Error('Invalid hideout response');

        for (const f of Object.values(FILES)) {
            if (f !== FILES.csv && fs.existsSync(f)) {
                fs.copyFileSync(f, `${f}.bak`);
                backups.push(f);
            }
        }

        const syncedAt = new Date().toISOString().slice(0, 10);
        const siteItems = items.filter((i) => !i.cosmetic && !SKIP_TYPES.has(i.item_type)).map(compactItem);
        fs.writeFileSync(FILES.items, JSON.stringify({ syncedAt, data: siteItems }));
        fs.writeFileSync(FILES.itemsPretty, JSON.stringify({ syncedAt, data: siteItems }, null, 2));
        fs.writeFileSync(FILES.quests, JSON.stringify({ syncedAt, data: quests.map(compactQuest) }, null, 1));
        fs.writeFileSync(FILES.hideout, JSON.stringify({ syncedAt, data: hideout }, null, 1));
        backups.forEach((f) => fs.unlinkSync(`${f}.bak`));

        log('\n✨ Sync complete', 'green');
        log(`   ${items.length} items (${siteItems.length} shipped to the site), ${quests.length} quests, ${hideout.length} benches`, 'bright');
        log('   Next: node sync_data.js --report\n', 'cyan');
    } catch (err) {
        log(`\n❌ Sync failed: ${err.message}`, 'red');
        for (const f of backups) {
            fs.copyFileSync(`${f}.bak`, f);
            fs.unlinkSync(`${f}.bak`);
        }
        if (backups.length) log('   Restored previous files', 'yellow');
        process.exit(1);
    }
}

// ─── Local data helpers (report / apply) ───────────────────────────────────

function readLocal() {
    const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const items = read(FILES.items).data;
    const quests = read(FILES.quests).data;
    const hideout = read(FILES.hideout).data;
    const byId = new Map(items.map((i) => [i.id, i]));
    const byKey = new Map(items.map((i) => [normKey(i.name), i]));
    return { items, quests, hideout, byId, byKey };
}

// Resolve "Comet Igniters" / "Industrial Batteries" / "a Portable TV" to an item
function resolveItem(raw, byKey) {
    const name = normKey(raw).replace(/^(a|an|the)\s+/, '');
    const candidates = [
        name,
        name.replace(/ies$/, 'y'),
        name.replace(/es$/, ''),
        name.replace(/s$/, ''),
        name.replace(/s(\s|$)/, '$1'),
    ];
    for (const c of candidates) if (byKey.has(c)) return byKey.get(c);
    return null;
}

// Items a quest makes you hand in. Objectives are the most up-to-date field on the API;
// required_items is only trusted when the objectives mention the same item.
// "Deliver the X" items are one-off quest props, so they're skipped.
function questHandIns(quest, byKey) {
    const found = new Map();
    const add = (item, qty) => {
        if (!item || SKIP_TYPES.has(item.item_type) || item.item_type === 'Quest Item') return;
        const prev = found.get(item.name) || 0;
        found.set(item.name, Math.max(prev, qty));
    };
    const verb = /^(?:deliver|obtain|get|bring)\s+(a|an|\d+)\s+(.+?)(?:\s+(?:to|for)\s+.*)?$/i;
    for (const obj of quest.objectives) {
        const m = obj.trim().match(verb);
        if (!m) continue;
        const qty = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
        add(resolveItem(m[2], byKey), qty);
    }
    const objText = normKey(quest.objectives.join(' / '));
    for (const r of quest.required_items) {
        const item = byKey.get(normKey(r.name));
        if (!item) continue;
        const stem = normKey(item.name).replace(/s$/, '');
        if (objText.includes(stem)) add(item, r.quantity);
    }
    return [...found].map(([name, quantity]) => ({ name, quantity }));
}

function benchRequirements(hideout, byId) {
    const rows = [];
    for (const bench of hideout) {
        for (const [level, data] of Object.entries(bench.levels || {})) {
            for (const req of data.requiredItems || []) {
                const item = byId.get(req.id);
                rows.push({
                    benchId: bench.id,
                    bench: bench.name,
                    level: Number(level),
                    name: item ? item.name : req.id,
                    resolved: Boolean(item),
                    quantity: req.quantity,
                });
            }
        }
    }
    return rows;
}

const questName = (q) => q.name.replace(/[‘’]/g, "'");

function parseCsvLines(text) {
    // Light parser: enough to read ItemID/Name/Quantity/Station/Tier/Source
    const rows = [];
    for (const line of text.split('\n')) {
        if (!line.trim() || line.startsWith('#')) continue;
        const cells = [];
        let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) {
                if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (c === '"') q = false;
                else cur += c;
            } else if (c === '"') q = true;
            else if (c === ',') { cells.push(cur); cur = ''; }
            else cur += c;
        }
        cells.push(cur.replace(/\r$/, ''));
        rows.push(cells);
    }
    const [header, ...body] = rows;
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// ─── Report ────────────────────────────────────────────────────────────────

function report() {
    const { items, quests, hideout, byId, byKey } = readLocal();
    const csv = parseCsvLines(fs.readFileSync(FILES.csv, 'utf8'));
    const key = (station, name) => `${station}|${normKey(name)}`;
    let issues = 0;

    log('\n━━ Bench upgrades ━━', 'bright');
    const csvBench = new Map(csv.filter((r) => r.Source === 'Bench')
        .map((r) => [`${r.Station}|${r.Tier}|${normKey(r.Name)}`, Number(r.Quantity)]));
    for (const b of benchRequirements(hideout, byId)) {
        const k = `${b.bench}|${b.level}|${normKey(b.name)}`;
        if (!b.resolved) { log(`  ? ${b.bench} L${b.level}: unknown item id "${b.name}"`, 'yellow'); issues++; }
        if (!csvBench.has(k)) { log(`  + ${b.bench} L${b.level}: ${b.quantity}x ${b.name}`, 'green'); issues++; }
        else if (csvBench.get(k) !== b.quantity) { log(`  ~ ${b.bench} L${b.level}: ${b.name} ${csvBench.get(k)} → ${b.quantity}`, 'yellow'); issues++; }
        csvBench.delete(k);
    }
    for (const k of csvBench.keys()) { log(`  - stale CSV bench row: ${k}`, 'red'); issues++; }

    log('\n━━ Quest hand-ins ━━', 'bright');
    const csvQuest = new Map(csv.filter((r) => r.Source === 'Quest')
        .map((r) => [key(r.Station, r.Name), Number(r.Quantity)]));
    for (const q of quests) {
        for (const h of questHandIns(q, byKey)) {
            const k = key(`Quest: ${questName(q)}`, h.name);
            if (!csvQuest.has(k)) { log(`  + ${questName(q)}: ${h.quantity}x ${h.name}`, 'green'); issues++; }
            else if (csvQuest.get(k) !== h.quantity) { log(`  ~ ${questName(q)}: ${h.name} ${csvQuest.get(k)} → ${h.quantity}`, 'yellow'); issues++; }
            csvQuest.delete(k);
        }
    }
    for (const k of csvQuest.keys()) { log(`  - stale CSV quest row: ${k}`, 'red'); issues++; }

    log('\n━━ CSV names with no MetaForge match (icons/metadata won\'t attach) ━━', 'bright');
    for (const name of new Set(csv.map((r) => r.Name))) {
        if (name && !byKey.has(normKey(name))) { log(`  ? ${name}`, 'yellow'); issues++; }
    }

    log('\n━━ Newest items on MetaForge (last 60 days) ━━', 'bright');
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const fresh = items.filter((i) => i.created_at >= cutoff);
    const byType = {};
    fresh.forEach((i) => (byType[i.item_type] ||= []).push(i.name));
    for (const [t, names] of Object.entries(byType)) log(`  ${t} (${names.length}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? '…' : ''}`, 'dim');
    log('  (These are searchable automatically; only add CSV rows for project/expedition requirements.)', 'dim');

    log(`\n${issues ? `⚠️  ${issues} difference(s). Run: node sync_data.js --apply` : '✅ items.csv matches MetaForge'}\n`, issues ? 'yellow' : 'green');
}

// ─── Apply ─────────────────────────────────────────────────────────────────

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function apply() {
    const { quests, hideout, byId, byKey } = readLocal();
    const text = fs.readFileSync(FILES.csv, 'utf8').replace(/\r/g, '');
    const lines = text.split('\n');
    const header = lines[0].split(',');
    const row = (fields) => header.map((h) => csvCell(fields[h] ?? '')).join(',');

    // Metadata comes from items.json at runtime, so generated rows only carry requirements.
    const benchRows = benchRequirements(hideout, byId).map((b) => {
        const item = byId.get(b.name) || byKey.get(normKey(b.name));
        return row({
            ItemID: `${slug(b.name)}_${BENCH_ABBREV[b.benchId] || slug(b.bench)}${b.level}`,
            Name: b.name, Quantity: b.quantity, Station: b.bench, Tier: b.level,
            Category: item?.item_type, Source: 'Bench', ArcID: item?.id,
        });
    });

    const questRows = [];
    for (const q of [...quests].sort((a, b) => questName(a).localeCompare(questName(b)))) {
        for (const h of questHandIns(q, byKey)) {
            const item = byKey.get(normKey(h.name));
            questRows.push(row({
                ItemID: `q_${slug(questName(q))}_${slug(h.name)}`,
                Name: h.name, Quantity: h.quantity, Station: `Quest: ${questName(q)}`, Tier: 0,
                Category: item?.item_type, Source: 'Quest', ArcID: item?.id,
            }));
        }
    }

    // Drop the old generated sections (and any hand-entered bench/quest rows they replace)
    const benchNames = new Set([...hideout.map((b) => b.name), 'Explosives Bench']);
    const isGenerated = (r) =>
        r.Source === 'Bench' || r.Source === 'Quest' ||
        benchNames.has(r.Station) || /^Quest:/i.test(r.Station);
    const kept = [];
    let skipping = false;
    for (const line of lines.slice(1)) {
        if (line === AUTO.benchStart || line === AUTO.questStart) { skipping = true; continue; }
        if (line === AUTO.benchEnd || line === AUTO.questEnd) { skipping = false; continue; }
        if (skipping) continue;
        const cols = parseCsvLines(`${lines[0]}\n${line}`)[0];
        if (cols && isGenerated(cols)) continue;
        kept.push(line);
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();

    const result = [
        lines[0],
        AUTO.benchStart, ...benchRows, AUTO.benchEnd,
        AUTO.questStart, ...questRows, AUTO.questEnd,
        ...kept,
        '',
    ].join('\n');
    fs.writeFileSync(FILES.csv, result);
    log(`✅ items.csv: ${benchRows.length} bench rows, ${questRows.length} quest rows regenerated`, 'green');
}

const mode = process.argv[2];
if (mode === '--report') report();
else if (mode === '--apply') apply();
else sync();
