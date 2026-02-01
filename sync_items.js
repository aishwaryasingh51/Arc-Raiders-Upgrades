#!/usr/bin/env node

/**
 * MetaForge API Sync Script
 * Fetches the latest items data from MetaForge API and updates items.json
 * 
 * Usage: node sync_items.js
 * 
 * Attribution: Data provided by MetaForge (https://metaforge.app/arc-raiders)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://metaforge.app/api/arc-raiders/items';
const ITEMS_JSON = path.join(__dirname, 'items.json');
const ITEMS_PRETTY_JSON = path.join(__dirname, 'items_pretty.json');
const BACKUP_JSON = path.join(__dirname, 'items.backup.json');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function fetchFromAPI(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON: ${e.message}`));
                    }
                } else {
                    reject(new Error(`API returned status ${res.statusCode}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function fetchAllItems() {
    let allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const url = `${API_URL}?page=${page}`;
        log(`📄 Fetching page ${page}...`, 'cyan');

        const response = await fetchFromAPI(url);

        if (!response || !response.data) {
            throw new Error('Invalid API response structure');
        }

        allItems = allItems.concat(response.data);

        // Check pagination info
        if (response.pagination && response.pagination.hasNextPage) {
            log(`   ✓ Got ${response.data.length} items (Total so far: ${allItems.length})`, 'green');
            page++;
        } else {
            log(`   ✓ Got ${response.data.length} items (Total: ${allItems.length})`, 'green');
            hasMore = false;
        }
    }

    return {
        data: allItems,
        maxValue: Math.max(...allItems.map(i => i.value || 0)),
        pagination: {
            page: 1,
            limit: allItems.length,
            total: allItems.length,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false
        }
    };
}

async function syncItems() {
    log('\n🔄 MetaForge API Sync Started\n', 'cyan');

    try {
        // Create backup of existing items.json
        if (fs.existsSync(ITEMS_JSON)) {
            log('📦 Creating backup...', 'yellow');
            fs.copyFileSync(ITEMS_JSON, BACKUP_JSON);
            log('✅ Backup created: items.backup.json\n', 'green');
        }

        // Fetch all items from API (with pagination)
        log('🌐 Fetching items from MetaForge API...', 'cyan');
        const apiData = await fetchAllItems();

        const itemCount = apiData.data.length;
        log(`\n✅ Fetched ${itemCount} total items from API\n`, 'green');

        // Write to items.json (minified)
        log('💾 Writing to items.json...', 'cyan');
        fs.writeFileSync(ITEMS_JSON, JSON.stringify(apiData));
        log('✅ items.json updated\n', 'green');

        // Write to items_pretty.json (formatted)
        log('💾 Writing to items_pretty.json...', 'cyan');
        fs.writeFileSync(ITEMS_PRETTY_JSON, JSON.stringify(apiData, null, 2));
        log('✅ items_pretty.json updated\n', 'green');

        // Summary
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bright');
        log('✨ Sync completed successfully!', 'green');
        log(`📊 Total items: ${itemCount}`, 'bright');
        log('🔗 Data source: https://metaforge.app/arc-raiders', 'cyan');
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'bright');

        // Cleanup old backup if sync was successful
        if (fs.existsSync(BACKUP_JSON)) {
            log('🧹 Removing old backup...', 'yellow');
            fs.unlinkSync(BACKUP_JSON);
            log('✅ Cleanup complete\n', 'green');
        }

    } catch (error) {
        log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red');
        log('❌ Sync failed!', 'red');
        log(`Error: ${error.message}`, 'red');
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'red');

        // Restore from backup if it exists
        if (fs.existsSync(BACKUP_JSON)) {
            log('🔄 Restoring from backup...', 'yellow');
            fs.copyFileSync(BACKUP_JSON, ITEMS_JSON);
            fs.unlinkSync(BACKUP_JSON);
            log('✅ Restored previous version\n', 'green');
        }

        process.exit(1);
    }
}

// Run the sync
syncItems();
