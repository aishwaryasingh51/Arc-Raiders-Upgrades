# ARC Raiders Upgrade Tracker

Up-to-date reference for every crafting component, bench upgrade, and quest requirement in ARC Raiders. The web app lets you search by item name, filter by rarity or location, and quickly see what each resource is needed for before you sell or dismantle it.

## Live Web App

👉 https://aishwaryasingh51.github.io/Arc-Raiders-Upgrades/

## Features

- Fast, client-only fuzzy search across all upgrade materials.
- Rich item cards that surface rarity, value, drop locations, and dismantle results.
- Clear “Required” panels that list bench tiers, expeditions, and quests plus their quantities.
- Filter chips on every card so you can pivot searches by location, rarity, station tier, and more.

## Data Source

The app bundles a curated `items.csv` generated from in-game observations and community research. Each row captures the station, tier, quantity, and quest/expedition usage for an item. The front-end normalizes the CSV and merges duplicate entries so every card shows consolidated requirements.

## Local Development

1. Clone the repository and `cd Arc-Raiders-Upgrades`.
2. Use any static web server (or simply open `index.html` in your browser) to load the app.
3. Edits to `items.csv`, `index.html`, or `script.js` hot-reload when the page refreshes.

Because everything runs client-side, no build tooling is required. Update the CSV, refresh, and you’re done.

## Credits

- Data compiled from [Metaforge ARC Raiders Database](https://metaforge.app/arc-raiders/database/items/page/1) and the [ARC Raiders Wiki](https://arc-raiders.fandom.com/wiki/Items).
- Web app built and maintained by [Aishwarya Singh](https://github.com/aishwaryasingh51).
