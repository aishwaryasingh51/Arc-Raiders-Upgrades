# Arc Raiders Upgrade Tracker — Project Guide

## Live Website
https://aishwaryasingh51.github.io/Arc-Raiders-Upgrades/

**Always push directly to `main`.** The website is live and served from `main` via GitHub Pages. Never use feature branches for this project.

---

## Maintaining This File

**This file must be kept up to date.** Whenever a change is made to this project — new logic in `script.js`, new CSV columns, new content types, changes to search behaviour, new naming conventions, or anything else a future session would need to know — update the relevant section of this file in the same commit. This is not optional. CLAUDE.md is the memory of this project across sessions; if it goes stale, future sessions will make mistakes.

What always warrants an update:
- Any change to `script.js` that affects search, display, or data loading
- New CSV columns or changes to how existing columns are used
- New content types (new bench, new content category beyond quest/project/expedition)
- New ItemID prefix conventions
- Changes to the deployment setup or file structure
- Any non-obvious decision made during a session that future Claude should know

---

## What This App Does

A single-page web app that lets players search for any Arc Raiders item and instantly see:
- What it recycles into (with icons)
- Which bench upgrades, quests, projects, or expeditions require it, and in what quantity
- Rarity, value, weight, and where it's found

Searching by an item name (e.g. "tick pod") returns that specific item.
Searching by a station/project/quest name (e.g. "avian alarm", "weather monitor", "movie night") returns **all items required for that content**, each card showing which stage/tier it belongs to and how many are needed. This is the primary way players use the app to plan for new updates.

---

## Search Logic

Search is powered by a token index built at load time in `script.js → aggregateItems()`.

### Token sources per item entry
Every item in `items.json` is searchable. Items with no CSV row are indexed by name only
(`isSearchableJsonItem` skips weapon roll variants like "Amplified Burletta (Burst Fire)").
For every row in `items.csv`, four fields are tokenised and merged into the item's token set:
1. `Name` — the item name (e.g. "tick pod" → `["tick", "pod"]`)
2. `Station` — the bench/quest/project name (e.g. "Avian Alarm: Stage 2 – Preliminary Signal Birds" → `["avian", "alarm", "stage", "2", "preliminary", "signal", "birds"]`)
3. `questName` — derived label for quest entries (rarely adds extra tokens)
4. `Source` — "Item", "Quest", "Project", "Expedition" — all three blacklisted words are excluded

`SEARCH_BLACKLIST = ["item", "project", "quest"]` — these tokens are never indexed.

Tokenisation splits on anything that is not `[a-z0-9\-_]`, so colons, em dashes, spaces, and special characters all act as separators.

### Matching
The query is tokenised with the same `tokenizeName` as the index (so "doctor's orders" works).
`matchesQuery` requires **every query token** to prefix-match at least one token in the item's token set:
```
qTokens.every(q => itemTokens.some(t => t.startsWith(q)))
```
Results are ranked: exact name match → items whose own name matches → everything else
(e.g. the requirements of a searched project), alphabetical within each group.
Fuzzy/similarity scoring is used as a fallback for near-misses.

### Name joins
CSV names and `items.json` names are joined with `normKey()` (lowercase, curly quotes/apostrophes
normalised, double quotes stripped), so `Leviathan's Crown Ship Model` matches MetaForge's
`“Leviathan's Crown” Ship Model`. The same function exists in `sync_data.js`; keep them in sync.
`node sync_data.js --report` lists any CSV name that still doesn't join.

### Consequence for data entry
Because the `Station` column is tokenised, **any item whose Station contains the project/quest name is automatically searchable by that name**. This means:
- Adding a row `aa_p2_tick, Tick Pod, 7, Avian Alarm: Stage 2 – Preliminary Signal Birds, ...` makes Tick Pod appear when searching "avian alarm".
- No extra code or search index changes are ever needed when adding new content — just add rows to `items.csv`.

---

## Data Architecture

### `items.csv` — requirements (benches, quests, projects, expeditions)
The file has two kinds of section:
- **AUTO sections** (between `# --- AUTO: … ---` markers): bench upgrades and quest hand-ins,
  regenerated from MetaForge by `node sync_data.js --apply`. **Never hand-edit these.**
- **Hand-written sections**: projects, expeditions and a few legacy base-item rows. MetaForge has no
  project API, so these are researched by hand (see "Adding New Game Content").

Lines starting with `#` are section comments and are skipped by the loader.
**Requirements only:** item metadata (rarity, value, icon, description, weight, found-in, recycle
output) comes from `items.json` at runtime. New rows only need ItemID, Name, Quantity, Station,
Tier, Category, Source, ArcID (and Note if applicable); leave the Arc*/Meta* columns blank.

**Columns:**
```
ItemID, Name, Quantity, Station, Tier, Category, LocationType, Vendor, Source,
ArcID, ArcRarity, ArcType, ArcValue, ArcStackSize, ArcWeightKg, ArcFoundIn, ArcDescription, ArcUpdatedAt,
MetaID, MetaType, MetaRarity, MetaValue, MetaStackSize, MetaWeightKg, MetaWorkbench, MetaDescription, Note
```

**Key columns:**
| Column | Purpose |
|--------|---------|
| `ItemID` | Unique row key (use prefix conventions below) |
| `Name` | Display name — items with the same Name are merged into one card |
| `Quantity` | How many are needed for this Station/Tier |
| `Station` | Bench name, project name, quest name, or "Item" for base entries |
| `Tier` | Bench level (1–6), or 0 for projects/quests/expeditions, or 1–4 for base items (loosely tracks rarity) |
| `Source` | `Bench`, `Quest`, `Project`, `Expedition` or `Item` — controls card display behaviour |
| `ArcID` | MetaForge item id (hyphenated), also used to construct fallback icon URLs |
| `Note` | Optional caveat shown with a ⚠ on the requirement, e.g. "Sources disagree: 8 or 10" or "Red (Rare) variant" |

**Station is `"Item"` for base item entries.** These are legacy: every MetaForge item is searchable
now, so new base-item rows are only needed for items MetaForge doesn't have.

### MetaForge data (auto-synced, never hand-edit)
`node sync_data.js` fetches from `https://metaforge.app/api/arc-raiders/`:
| File | Endpoint | Used for |
|---|---|---|
| `items.json` | `/items?includeComponents=true` | Compact item metadata the site loads: icon, rarity, value, type, loot area, weight/stack, `recycle` [{name, quantity}], `dropped_by`, `used_in`, `created_at`. Cosmetics/furniture/designs/stencils are dropped to keep it small. Has a top-level `syncedAt`. |
| `items_pretty.json` | — | Pretty-printed copy of `items.json` for humans |
| `quests.json` | `/quests` | Objectives + `required_items` per quest (input to `--apply`) |
| `hideout.json` | `/hideout` | Bench levels and required items (input to `--apply`) |

Metadata precedence (`script.js → finalizeEntry`): **`items.json` wins**, CSV is the fallback. The one
exception is descriptions: MetaForge's placeholder descriptions ("Can be recycled into crafting
materials.") lose to a hand-written CSV description. When MetaForge has structured recycle data, the
"Can be recycled into…" sentence is stripped from the description and the recycle chips are shown instead.

Quest hand-ins are derived in `sync_data.js → questHandIns`: objectives like "Deliver 3 Comet Igniters",
"Obtain 6 Wires" are parsed; `required_items` is only trusted when the objectives mention the item
(the API's `required_items` is sometimes stale). "Deliver **the** X" items are one-off quest props and are skipped.

### `script.js` — app logic (read-only for content updates)
Loads `items.csv` + `items.json`, merges them, builds the token index, and renders results.

---

## ItemID Naming Conventions

| Content type | Prefix pattern | Example |
|---|---|---|
| Bench upgrade | `{bench_abbrev}{tier}` | `metal_parts_g1` (Gunsmith T1) |
| Project item | `{project_abbrev}_p{stage}_{item}` | `aa_p2_tick` (Avian Alarm Stage 2) |
| Quest item | `q_{quest_abbrev}_{item}` | `q_shore_alloy` |
| Expedition item | `{item}_{exp}` | `metal_parts_exp1` |
| Base item entry | `{arc_id}` | `tick_pod`, `canister` |

Bench abbreviations (generated rows): `s` Scrappy, `g` Gunsmith, `gb` Gear Bench, `m` Medical Lab,
`e` Explosives Station, `u` Utility Station, `r` Refiner, `rs` Research Station, `o` Outpost.
Generated quest rows use `q_{quest_slug}_{item_slug}`. Expedition rows use `{item}_exp{N}_p{phase}`.

---

## Adding New Game Content (Standard Process)

When a patch lands:

1. **`node sync_data.js`**: refresh items/quests/benches from MetaForge. New items become searchable automatically.
2. **`node sync_data.js --report`**: shows bench/quest differences, CSV names that no longer join, and new items.
3. **`node sync_data.js --apply`**: regenerates the AUTO bench + quest sections. Re-run `--report`; it should say "matches".
4. **Projects / expeditions (by hand)**: one row per item per phase. `Source = Project` (or `Expedition`), `Tier = 0`,
   `Station = "Project Name: Phase N – Phase Title"`. Only phases with item hand-ins get rows (damage/photo
   objectives have none). **Use at least two sources.** [ArcTracker](https://arctracker.io/projects) has
   structured phase lists and has matched in-game names exactly; allthings.how and insider-gaming.com are good
   second sources. Check every item name exists in `items.json`. Put any disagreement in `Note`.
5. **Regression check**: `node tools/search-snapshot.mjs` before and after, then diff. Only intended changes should appear.
6. Update `content.json` (project status/dates, current patch) and the "Existing Content Reference" below.
7. **Commit and push to `main`**. The live site updates automatically via GitHub Pages.

### What makes a search "work" for a project/quest
Searching "avian alarm" returns all items needed for Avian Alarm because each of those items has a row whose `Station` contains "Avian Alarm". No extra wiring needed — the token index handles it automatically.

---

## Existing Content Reference

Last synced against **Frozen Trail 2.0** (game update 2026-10-08), data sync 2026-10-26.

### Bench stations (generated from `hideout.json`)
Scrappy (L2–5 have items), Gunsmith (L1–4), Gear Bench (L1–3), Medical Lab (L1–3), Explosives Station (L1–3),
Utility Station (L1–3), Refiner (L1–3), Research Station (L1–4, new in Frozen Trail), Outpost (L2–4, new in Frozen Trail)

### Projects (hand-written; verified against ArcTracker + one other source on 2026-10-26)
- Flickering Flames (Phase 1–5)
- Trophy Display (Stage 1–5)
- Weather Monitor System (Phase 1–5)
- High-Gain Antenna (Phase 1–3, Flashpoint, Mar 2026)
- Avian Alarm (Stage 2–5; Stage 1 has no items). Riven Tides, Apr 28 – May 26 2026
- Converging Paths (Phase 2–5; 1 and 6 are damage objectives). Jun 16 – Jul 27 2026
- Phantom Targets Part 2 (Phase 1–2; Part 1 had no item hand-ins). Aug 18 – Sep 6 2026
- Ascending the Mountain (Phase 1–4). Sep 8 – Oct 5 2026
- Sheltered Retreat (Phase 2 only; unlocks the Outpost, permanent). Frozen Trail

### Quests
Generated: every quest with an item hand-in (44 rows). The pre-2026-10 hand-entered quest rows were
mostly wrong (invented quantities, non-existent "Shoring Up Defenses") and were replaced.

### Expeditions
Expedition 5 (Phase 1–4; Phase 5 is coin value, Phase 6 is ARC damage, so no rows). The old
"Expedition: Part 1–4" rows were an earlier expedition's caravan and were replaced.

---

## Icon Fallback
If an item has no icon from `items.json`, the app constructs one automatically:
```
https://cdn.metaforge.app/arc-raiders/icons/{arcId or metaId}.webp
```
where the ID uses hyphens (not underscores). Set `ArcID` to the correct hyphenated slug whenever possible.
