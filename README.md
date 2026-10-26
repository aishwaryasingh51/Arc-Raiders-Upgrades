# Arc Raiders Upgrade Tracker

**Live site:** https://aishwaryasingh51.github.io/Arc-Raiders-Upgrades/

Track bench upgrades, quests, and projects for Arc Raiders with detailed crafting and recycling information.

## Features

- 🔍 Search any of 700+ items, or a bench / quest / project to see everything it needs
- 📊 Every bench upgrade, including the Frozen Trail Research Station and Outpost
- 🎯 Quest hand-ins synced from MetaForge, every Raider Project, and Expedition 5
- 🛒 Search a bench, quest or project to get its shopping list, with "still needed" totals
- ✅ Tick off finished stages; completed and ended content drops out of your results (saved per device)
- ♻️ Recycling output and which ARC drops each item; anything nothing needs is flagged "not needed"
- 🏷️ Click any badge (rarity, location, value) to filter results
- 📱 Responsive, keyboard-friendly, respects reduced-motion

## Data Sources

- **Icons & Items**: [MetaForge Arc Raiders Database](https://metaforge.app/arc-raiders)
- **Projects**: [ArcTracker](https://arctracker.io/projects), cross-checked with community guides

## Syncing with MetaForge API

After a game patch:

```bash
node sync_data.js            # fetch items, quests and benches from MetaForge
node sync_data.js --report   # what changed vs items.csv
node sync_data.js --apply    # regenerate the bench + quest sections of items.csv
node tools/search-snapshot.mjs > after.json   # optional search regression check
```

Raider Projects and Expeditions aren't in the MetaForge API and are maintained by hand in `items.csv`
(see `CLAUDE.md` for the process).

## Project Structure

```
├── index.html              # Main application
├── script.js              # Application logic
├── items.csv              # Bench / quest / project / expedition requirements
├── items.json             # Item database (auto-synced, loaded by the site)
├── items_pretty.json      # Readable copy of items.json
├── quests.json            # Quests (auto-synced)
├── hideout.json           # Bench levels (auto-synced)
├── content.json           # Project status + current patch
├── tools/search-snapshot.mjs  # Search regression check
├── sync_data.js           # MetaForge sync + CSV report/apply
└── assets/
    ├── arclogo.png / favicon-64.png
    └── arcwallpaper-1920.jpg (background; arcwallpaper.jpg is the 4K original)
```

## Attribution

This project uses data from:
- [MetaForge Arc Raiders Database](https://metaforge.app/arc-raiders) - Item data, icons, and stats
- [Arc Raiders Wiki](https://arcraiders.wiki) - Recycling information

## License

MIT License - See LICENSE file for details
