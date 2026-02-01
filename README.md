# Arc Raiders Upgrade Tracker

Track bench upgrades, quests, and projects for Arc Raiders with detailed crafting and recycling information.

## Features

- 📊 Complete bench upgrade tracking (Gunsmith, Medical Lab, Explosives, etc.)
- 🎯 Quest and expedition item tracking
- ♻️ Detailed recycling information for all items
- 🔍 Search and filter functionality
- 📱 Responsive design

## Data Sources

- **Icons & Items**: [MetaForge Arc Raiders Database](https://metaforge.app/arc-raiders)
- **Recycling Data**: Arc Raiders Wiki + community research

## Syncing with MetaForge API

To update `items.json` with the latest game data:

```bash
node sync_items.js
```

This script:
- ✅ Fetches latest items from MetaForge API
- ✅ Creates automatic backups before updating
- ✅ Restores on failure
- ✅ Updates both `items.json` and `items_pretty.json`

**Note**: The sync script updates item metadata (icons, stats, descriptions) but does NOT modify your custom recycling data in `items.csv`.

## Project Structure

```
├── index.html              # Main application
├── script.js              # Application logic
├── items.csv              # Recycling data & upgrade requirements
├── items.json             # Item database (auto-synced)
├── items_pretty.json      # Readable JSON format
├── sync_items.js          # MetaForge API sync script
└── assets/
    ├── arclogo.png
    └── arcwallpaper.jpg
```

## Attribution

This project uses data from:
- [MetaForge Arc Raiders Database](https://metaforge.app/arc-raiders) - Item data, icons, and stats
- [Arc Raiders Wiki](https://arcraiders.wiki) - Recycling information

## License

MIT License - See LICENSE file for details
