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
For every row in `items.csv`, four fields are tokenised and merged into the item's token set:
1. `Name` — the item name (e.g. "tick pod" → `["tick", "pod"]`)
2. `Station` — the bench/quest/project name (e.g. "Avian Alarm: Stage 2 – Preliminary Signal Birds" → `["avian", "alarm", "stage", "2", "preliminary", "signal", "birds"]`)
3. `questName` — derived label for quest entries (rarely adds extra tokens)
4. `Source` — "Item", "Quest", "Project", "Expedition" — all three blacklisted words are excluded

`SEARCH_BLACKLIST = ["item", "project", "quest"]` — these tokens are never indexed.

Tokenisation splits on anything that is not `[a-z0-9\-_]`, so colons, em dashes, spaces, and special characters all act as separators.

### Matching
`matchesQuery` requires **every query word** to prefix-match at least one token in the item's token set:
```
qTokens.every(q => itemTokens.some(t => t.startsWith(q)))
```
Fuzzy/similarity scoring is used as a fallback for near-misses.

### Consequence for data entry
Because the `Station` column is tokenised, **any item whose Station contains the project/quest name is automatically searchable by that name**. This means:
- Adding a row `aa_p2_tick, Tick Pod, 7, Avian Alarm: Stage 2 – Preliminary Signal Birds, ...` makes Tick Pod appear when searching "avian alarm".
- No extra code or search index changes are ever needed when adding new content — just add rows to `items.csv`.

---

## Data Architecture

### `items.csv` — source of truth for upgrade/quest/project requirements
This is the only file that needs to be edited when game content changes.

**Columns:**
```
ItemID, Name, Quantity, Station, Tier, Category, LocationType, Vendor, Source,
ArcID, ArcRarity, ArcType, ArcValue, ArcStackSize, ArcWeightKg, ArcFoundIn, ArcDescription, ArcUpdatedAt,
MetaID, MetaType, MetaRarity, MetaValue, MetaStackSize, MetaWeightKg, MetaWorkbench, MetaDescription
```

**Key columns:**
| Column | Purpose |
|--------|---------|
| `ItemID` | Unique row key (use prefix conventions below) |
| `Name` | Display name — items with the same Name are merged into one card |
| `Quantity` | How many are needed for this Station/Tier |
| `Station` | Bench name, project name, quest name, or "Item" for base entries |
| `Tier` | Bench tier (1–5), or 0 for projects/quests/expeditions, or 1–4 for base items (loosely tracks rarity) |
| `Source` | `Item`, `Quest`, `Project`, or `Expedition` — controls card display behaviour |
| `ArcID` | Lowercase hyphen-separated ID used to construct fallback icon URLs |

**Station is `"Item"` for base item entries** — these add metadata (description, rarity, recycle info, location) without creating a usage entry. Every new item introduced in an update should have a base item entry so it shows up in search and displays correctly even when looked up by name alone.

### `items.json` / `items_pretty.json` — auto-synced metadata
Fetched from the MetaForge API via `node sync_items.js`. Provides icons, stat blocks, and descriptions. Do not hand-edit. The CSV overrides or supplements this data.

### `script.js` — app logic (read-only for content updates)
Loads both files at runtime, merges them, builds the token index, and renders results. No changes needed when adding game content.

---

## ItemID Naming Conventions

| Content type | Prefix pattern | Example |
|---|---|---|
| Bench upgrade | `{bench_abbrev}{tier}` | `metal_parts_g1` (Gunsmith T1) |
| Project item | `{project_abbrev}_p{stage}_{item}` | `aa_p2_tick` (Avian Alarm Stage 2) |
| Quest item | `q_{quest_abbrev}_{item}` | `q_shore_alloy` |
| Expedition item | `{item}_{exp}` | `metal_parts_exp1` |
| Base item entry | `{arc_id}` | `tick_pod`, `canister` |

Bench abbreviations: `g` = Gunsmith, `u` = Gear Bench / Utility Station, `m` = Medical Lab, `e` = Explosives Bench, `r` = Refiner, `s` = Scrappy.

---

## Adding New Game Content (Standard Process)

When a patch introduces new projects, missions, or items:

1. **Add project entries** — one row per item per stage. Set `Source = Project`, `Tier = 0`, `Station = "ProjectName: Stage N – Stage Title"`. Follow the existing naming pattern (e.g. `Avian Alarm: Stage 2 – Preliminary Signal Birds`).

2. **Add quest entries** — one row per required item. Set `Source = Quest`, `Tier = 0`, `Station = "Quest: Quest Name"`. Only add entries for items the player must collect/submit — skip purely objective-based quests (visit locations, kill enemies, etc.) that have no item hand-in.

3. **Add base item entries** for every genuinely new item in the patch — set `Station = Item`, `Source = Item`. This ensures the item is searchable by name and shows rarity, description, and location even outside a project/quest context. Existing items (already in the CSV) do not need new base entries.

4. **Commit and push to `main`** — the live site updates automatically via GitHub Pages.

### What makes a search "work" for a project/quest
Searching "avian alarm" returns all items needed for Avian Alarm because each of those items has a row whose `Station` contains "Avian Alarm". No extra wiring needed — the token index handles it automatically.

---

## Existing Content Reference

### Bench stations
Scrappy (T1–5), Gunsmith (T1–5), Gear Bench (T1–5), Medical Lab (T1–5), Explosives Bench (T1–5), Utility Station (T1–5), Refiner (T1–3)

### Projects
- Flickering Flames (Phase 1–5)
- Trophy Display (Stage 1–5)
- Weather Monitor System (Phase 1–5: Atmospheric Pressure, Sunlight, Precipitation, Humidity, Temperature)
- Avian Alarm (Stage 1–5: Initial Flock Intake [no items], Preliminary Signal Birds, Secondary Validation Birds, Rough Weather, Final Flock)

### Quests
Starting Out, On The Hunt, Trash To Treasure, Mixed Signals, Unexpected Initiative, Out Of The Shadows, Doctor's Orders, Reveal The Ruins, A Prime Specimen, Movie Night, Shoring Up Defenses

### Expeditions
Part 1, Part 2, Part 3, Part 4

---

## Icon Fallback
If an item has no icon from `items.json`, the app constructs one automatically:
```
https://cdn.metaforge.app/arc-raiders/icons/{arcId or metaId}.webp
```
where the ID uses hyphens (not underscores). Set `ArcID` to the correct hyphenated slug whenever possible.
