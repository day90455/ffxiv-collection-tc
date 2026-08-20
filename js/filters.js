/**
 * Source category definitions and filtering logic
 * Based on Collections plugin's ContentFiltersWidget
 */

// Source categories with icons (from Collections plugin)
const SOURCE_CATEGORIES = {
    Gil: { name: '金幣', iconId: 65002 },
    Scrips: { name: '工票', iconId: 65028 },
    MGP: { name: '金碟幣', iconId: 65025 },
    PvP: { name: 'PvP', iconId: 61806 },
    Duty: { name: '副本', iconId: 60414 },
    Quest: { name: '任務', iconId: 61419 },
    Event: { name: '活動', iconId: 61757 },
    Tomestones: { name: '神典石', iconId: 65086 },
    DeepDungeon: { name: '深層迷宮', iconId: 61824 },
    BeastTribes: { name: '蠻族', iconId: 65016 },
    MogStation: { name: '商城', iconId: 61831 },
    Achievement: { name: '成就', iconId: 6 },
    AchievementCertificate: { name: '成就幣', iconId: 65059 },
    CompanySeals: { name: '軍票', iconId: 65005 },
    IslandSanctuary: { name: '無人島', iconId: 65096 },
    HuntSeals: { name: '狩獵', iconId: 65034 },
    TreasureHunts: { name: '挖寶', iconId: 115 },
    Crafting: { name: '製作', iconId: 62202 },
    Voyages: { name: '遠航探索', iconId: 65035 },
    Venture: { name: '雇員探索', iconId: 65049 },
    FirmamentFete: { name: '蒼天街', iconId: 65073 },
    FATE: { name: 'FATE', iconId: 60722 },
    Mob: { name: '野怪', iconId: 60004 },
    Special: { name: '特殊', iconId: 60073 },
    Npc: { name: 'NPC', iconId: 61104 },
    採集: { name: '採集', iconId: 60318 }
};

// Blue Mage method type to filter category mapping
const BLUEMAGE_TYPE_MAP = {
    'dungeon': 'Duty',
    'trail': 'Duty',      // trial (typo in data)
    'raid': 'Duty',
    'fate': 'FATE',
    'mob': 'Mob',
    'special': 'Special'
};

// Major patch versions for filtering with expansion icons
const PATCH_VERSIONS = [
    { label: '7.x', minPatch: 7.0, maxPatch: 7.99, iconId: 61880 }, // Dawntrail
    { label: '6.x', minPatch: 6.0, maxPatch: 6.99, iconId: 61879 }, // Endwalker
    { label: '5.x', minPatch: 5.0, maxPatch: 5.99, iconId: 61878 }, // Shadowbringers
    { label: '4.x', minPatch: 4.0, maxPatch: 4.99, iconId: 61877 }, // Stormblood
    { label: '3.x', minPatch: 3.0, maxPatch: 3.99, iconId: 61876 }, // Heavensward
    { label: '2.x', minPatch: 2.0, maxPatch: 2.99, iconId: 61875 }, // A Realm Reborn
    { label: '未知', minPatch: 999, maxPatch: 9999, iconId: 60074 }  // Unknown/question mark
];

// Helper to get icon URL
function getIconUrl(iconId) {
    const folder = Math.floor(iconId / 1000) * 1000;
    const folderStr = folder.toString().padStart(6, '0');
    const iconStr = iconId.toString().padStart(6, '0');
    return `https://v2.xivapi.com/api/asset?path=ui%2Ficon%2F${folderStr}%2F${iconStr}_hr1.tex&format=png`;
}

// Owned items localStorage management
function loadOwnedItems(collectionName) {
    const key = `ffxiv-owned-${collectionName}`;
    const data = localStorage.getItem(key);
    return data ? new Set(JSON.parse(data)) : new Set();
}

function saveOwnedItems(collectionName, ownedSet) {
    const key = `ffxiv-owned-${collectionName}`;
    localStorage.setItem(key, JSON.stringify([...ownedSet]));
}

// Wishlist localStorage management (cross-collection)
// Format: { "Mounts:123": true, "Minions:45": true, ... }
function loadWishlist() {
    const data = localStorage.getItem('ffxiv-wishlist');
    return data ? new Set(JSON.parse(data)) : new Set();
}

function saveWishlist(wishlistSet) {
    localStorage.setItem('ffxiv-wishlist', JSON.stringify([...wishlistSet]));
}

function getWishlistKey(collectionName, itemId) {
    return `${collectionName}:${itemId}`;
}

function parseWishlistKey(key) {
    const [collectionName, itemId] = key.split(':');
    return { collectionName, itemId: parseInt(itemId) };
}

// Filter state management
class FilterState {
    constructor() {
        this.activeCategories = new Set();
        this.activePatches = new Set();
        this.searchQuery = '';
        this.showNoSource = true; // 預設隱藏無來源項目
        this.ownershipFilter = 'all'; // 'all' | 'owned' | 'not-owned'
        this.excludeCategories = new Set(); // 進度計算排除的分類
    }

    toggleShowNoSource() {
        this.showNoSource = !this.showNoSource;
        return this.showNoSource;
    }

    setOwnershipFilter(value) {
        this.ownershipFilter = value;
        this.saveSettings();
    }

    saveSettings() {
        localStorage.setItem('ffxiv-filter-settings', JSON.stringify({
            ownershipFilter: this.ownershipFilter,
            excludeCategories: [...this.excludeCategories]
        }));
    }

    loadSettings() {
        const data = localStorage.getItem('ffxiv-filter-settings');
        if (data) {
            try {
                const settings = JSON.parse(data);
                this.ownershipFilter = settings.ownershipFilter || 'all';
                if (Array.isArray(settings.excludeCategories)) {
                    this.excludeCategories = new Set(settings.excludeCategories);
                }
            } catch (e) {
                // Ignore invalid data
            }
        }
    }

    toggleExcludeCategory(category) {
        if (this.excludeCategories.has(category)) {
            this.excludeCategories.delete(category);
        } else {
            this.excludeCategories.add(category);
        }
        this.saveSettings();
    }

    toggleCategory(category) {
        if (this.activeCategories.has(category)) {
            this.activeCategories.delete(category);
        } else {
            this.activeCategories.add(category);
        }
    }

    togglePatch(patchLabel) {
        if (this.activePatches.has(patchLabel)) {
            this.activePatches.delete(patchLabel);
        } else {
            this.activePatches.add(patchLabel);
        }
    }

    setSearchQuery(query) {
        this.searchQuery = query.toLowerCase().trim();
    }

    clearAll() {
        this.activeCategories.clear();
        this.activePatches.clear();
        this.searchQuery = '';
        // 不重置 showNoSource，保持使用者的選擇
    }

    hasActiveFilters() {
        return this.activeCategories.size > 0 ||
               this.activePatches.size > 0 ||
               this.searchQuery.length > 0;
    }

    /**
     * Check if an item passes all active filters
     * @param {Object} item - The item to check
     * @param {Function} isOwnedFn - Optional function to check if item is owned
     */
    passesFilters(item, isOwnedFn) {
        // Ownership filter
        if (this.ownershipFilter !== 'all' && isOwnedFn) {
            const isOwned = isOwnedFn(item.Id);
            if (this.ownershipFilter === 'owned' && !isOwned) {
                return false;
            }
            if (this.ownershipFilter === 'not-owned' && isOwned) {
                return false;
            }
        }

        // No source filter - hide items without sources by default
        // Special handling for Blue Mage - they have sources in blueMageSources
        if (!this.showNoSource) {
            const hasRegularSources = item.Sources && item.Sources.length > 0;
            const hasBlueMageSources = typeof currentCollection !== 'undefined' &&
                currentCollection === 'Blue Mage' &&
                typeof blueMageSources !== 'undefined' &&
                blueMageSources &&
                blueMageSources[item.Id]?.method?.length > 0;

            if (!hasRegularSources && !hasBlueMageSources) {
                return false;
            }
        }

        // Search filter
        if (this.searchQuery) {
            const nameMatch = item.Name?.toLowerCase().includes(this.searchQuery);
            const descMatch = item.Description?.toLowerCase().includes(this.searchQuery);
            if (!nameMatch && !descMatch) {
                return false;
            }
        }

        // Patch filter
        if (this.activePatches.size > 0) {
            const patchValue = item.PatchAdded;
            let patchMatch = false;

            for (const patchLabel of this.activePatches) {
                const patchDef = PATCH_VERSIONS.find(p => p.label === patchLabel);
                if (patchDef && patchValue >= patchDef.minPatch && patchValue <= patchDef.maxPatch) {
                    patchMatch = true;
                    break;
                }
            }

            if (!patchMatch) {
                return false;
            }
        }

        // Source category filter
        if (this.activeCategories.size > 0) {
            let categoryMatch = false;

            // Special handling for Blue Mage - check blueMageSources
            if (typeof currentCollection !== 'undefined' && currentCollection === 'Blue Mage' &&
                typeof blueMageSources !== 'undefined' && blueMageSources) {
                const spell = blueMageSources[item.Id];
                if (spell && spell.method) {
                    for (const method of spell.method) {
                        const category = BLUEMAGE_TYPE_MAP[method.type];
                        if (category && this.activeCategories.has(category)) {
                            categoryMatch = true;
                            break;
                        }
                    }
                }
            } else {
                // Normal collection - check Sources
                if (!item.Sources || item.Sources.length === 0) {
                    return false;
                }

                for (const source of item.Sources) {
                    // Check explicit categories
                    if (source.Categories) {
                        for (const cat of source.Categories) {
                            if (this.activeCategories.has(cat)) {
                                categoryMatch = true;
                                break;
                            }
                        }
                    }
                    // Check for Achievement Certificate in costs (special case - not in Categories)
                    if (!categoryMatch && this.activeCategories.has('AchievementCertificate') && source.Costs) {
                        for (const cost of source.Costs) {
                            if (cost.ItemName === '成就幣') {
                                categoryMatch = true;
                                break;
                            }
                        }
                    }
                    if (categoryMatch) break;
                }
            }

            if (!categoryMatch) {
                return false;
            }
        }

        return true;
    }
}

// Check if an item should be excluded from progress calculation
function shouldExcludeFromProgress(item, excludeCategories) {
    // No sources = exclude
    if (!filterState.showNoSource) {
        if (!item.Sources || item.Sources.length === 0) return true;
    }
    // No exclusions = include all
    if (!excludeCategories || excludeCategories.size === 0) return false;

    // Check if ALL sources belong to excluded categories
    // If any source has a non-excluded category, include the item
    for (const source of item.Sources) {
        // Source has no categories = include
        if (!source.Categories || source.Categories.length === 0) return false;
        // Check if any category is not excluded
        for (const cat of source.Categories) {
            if (!excludeCategories.has(cat)) return false;
        }
    }
    // All sources are in excluded categories
    return true;
}

// Orchestrion category order (from OrchestrionCategory.csv Order column)
const ORCHESTRION_CATEGORY_ORDER = {
    '區域場景1': 1,
    '區域場景2': 2,
    '迷宮挑戰': 11,
    '迷宮挑戰2': 12,
    '討伐殲滅戰': 21,
    '大型任務1': 31,
    '大型任務2': 32,
    '環境音': 41,
    '任務相關': 51,
    '其他': 52,
    '季節活動': 61,
    '商城與特典': 71
};

// Sort functions
const SORT_FUNCTIONS = {
    'name': (a, b) => (a.Name || '').localeCompare(b.Name || '', 'zh-TW'),
    'patch-desc': (a, b) => b.PatchAdded - a.PatchAdded,
    'patch-asc': (a, b) => a.PatchAdded - b.PatchAdded,
    'id': (a, b) => a.Id - b.Id,
    'spell-no': (a, b) => {
        // Sort by Blue Mage spell number
        if (!blueMageSources) return 0;
        const noA = blueMageSources[a.Id] ? parseInt(blueMageSources[a.Id].no) : 999;
        const noB = blueMageSources[b.Id] ? parseInt(blueMageSources[b.Id].no) : 999;
        return noA - noB;
    },
    'card-no': (a, b) => {
        // Sort by Triple Triad card number
        const noA = a.CardNumber ?? 9999;
        const noB = b.CardNumber ?? 9999;
        return noA - noB;
    },
    'orchestrion-category': (a, b) => {
        // Sort by orchestrion category then order number
        const catOrderA = ORCHESTRION_CATEGORY_ORDER[a.Category] ?? 999;
        const catOrderB = ORCHESTRION_CATEGORY_ORDER[b.Category] ?? 999;
        if (catOrderA !== catOrderB) return catOrderA - catOrderB;
        const orderA = a.CategoryOrder ?? 99999;
        const orderB = b.CategoryOrder ?? 99999;
        return orderA - orderB;
    }
};

// Data export/import functions
const DATA_EXPORT_VERSION = 1;

// Collection keys for export (must match the keys used in localStorage)
const EXPORT_COLLECTION_KEYS = [
    'Mounts', 'Minions', 'Orchestrions', 'Emotes', 'Bardings',
    'Hairstyles', 'Fashion Accessories', 'Triple Triad', 'Blue Mage',
    'Framer Kits', 'Glamour', 'Glasses', 'Survey Records'
];

function exportAllData() {
    const exportData = {
        version: DATA_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
            owned: {},
            wishlist: [],
            settings: {}
        }
    };

    // Export owned items for each collection
    for (const collectionName of EXPORT_COLLECTION_KEYS) {
        const ownedItems = loadOwnedItems(collectionName);
        if (ownedItems.size > 0) {
            exportData.data.owned[collectionName] = [...ownedItems];
        }
    }

    // Export wishlist
    const wishlist = loadWishlist();
    if (wishlist.size > 0) {
        exportData.data.wishlist = [...wishlist];
    }

    // Export settings
    const settingsData = localStorage.getItem('ffxiv-filter-settings');
    if (settingsData) {
        try {
            exportData.data.settings = JSON.parse(settingsData);
        } catch (e) {
            // Ignore invalid settings
        }
    }

    // Return Base64 encoded string
    const jsonString = JSON.stringify(exportData);
    return btoa(unescape(encodeURIComponent(jsonString)));
}

function importFromString(base64String) {
    try {
        // Decode Base64 to JSON
        const jsonString = decodeURIComponent(escape(atob(base64String.trim())));
        const jsonData = JSON.parse(jsonString);
        return importAllData(jsonData);
    } catch (e) {
        if (e.message.includes('無效') || e.message.includes('缺少') || e.message.includes('版本')) {
            throw e;
        }
        throw new Error('無效的備份碼，請確認複製完整');
    }
}

function importAllData(jsonData) {
    // Validate data structure
    if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('無效的資料格式');
    }

    if (!jsonData.version || !jsonData.data) {
        throw new Error('缺少必要的資料欄位');
    }

    if (jsonData.version > DATA_EXPORT_VERSION) {
        throw new Error('資料版本過新，請更新網站後再試');
    }

    const { owned, wishlist, settings } = jsonData.data;

    // Clear existing data first
    for (const collectionName of EXPORT_COLLECTION_KEYS) {
        localStorage.removeItem(`ffxiv-owned-${collectionName}`);
    }
    localStorage.removeItem('ffxiv-wishlist');
    localStorage.removeItem('ffxiv-filter-settings');

    // Import owned items
    if (owned && typeof owned === 'object') {
        for (const [collectionName, items] of Object.entries(owned)) {
            if (Array.isArray(items) && items.length > 0) {
                saveOwnedItems(collectionName, new Set(items));
            }
        }
    }

    // Import wishlist
    if (Array.isArray(wishlist) && wishlist.length > 0) {
        saveWishlist(new Set(wishlist));
    }

    // Import settings
    if (settings && typeof settings === 'object') {
        localStorage.setItem('ffxiv-filter-settings', JSON.stringify(settings));
    }

    return true;
}

function getExportStats() {
    let totalOwned = 0;
    for (const collectionName of EXPORT_COLLECTION_KEYS) {
        totalOwned += loadOwnedItems(collectionName).size;
    }
    const wishlistCount = loadWishlist().size;
    return { totalOwned, wishlistCount };
}
