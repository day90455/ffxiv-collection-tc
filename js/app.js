/**
 * Main application logic for Collections website
 */

// Google Analytics 事件追蹤
function trackEvent(eventName, params = {}) {
    if (typeof gtag === 'function') {
        gtag('event', eventName, params);
    }
}

// URL 分享功能
function updateUrlWithItem(collectionName, itemName) {
    const url = new URL(window.location.href);
    url.searchParams.set('collection', collectionName);
    url.searchParams.set('item', itemName);
    history.replaceState(null, '', url.toString());
}

function clearUrlParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete('collection');
    url.searchParams.delete('item');
    history.replaceState(null, '', url.toString());
}

function findItemByName(itemName, collectionName) {
    if (!collectionsData) return null;
    const collection = collectionsData.Collections.find(c => c.CollectionName === collectionName);
    if (!collection) return null;
    return collection.Items.find(item => item.Name === itemName);
}

function checkUrlAndOpenItem() {
    const url = new URL(window.location.href);
    const collectionName = url.searchParams.get('collection');
    const itemName = url.searchParams.get('item');

    if (collectionName && itemName) {
        // 切換到指定收藏分類
        switchCollection(collectionName);

        // 延遲等資料載入後開啟項目
        setTimeout(() => {
            const item = findItemByName(itemName, collectionName);
            if (item) {
                showItemDetail(item);
            }
        }, 100);
    }
}

// Global state
let collectionsData = null;
let blueMageSources = null; // Blue Mage spell sources from thewakingsands
let huijiMapping = null; // Huiji Wiki ID to SC name mapping
let currentCollection = null;
let filterState = new FilterState();
let currentSort = 'name';
let searchDebounceTimer = null;

// Pagination state for performance
const ITEMS_PER_PAGE = 50;
let currentFilteredItems = [];
let currentRenderedCount = 0;
let isLoadingMore = false;
let infiniteScrollObserver = null;
let currentCollectionData = null;

// Owned items state
let ownedItems = new Set();

// Wishlist state (cross-collection)
let wishlist = new Set();

// Check if an item is owned
function isItemOwned(itemId) {
    return ownedItems.has(itemId);
}

// Toggle item owned status
function toggleItemOwned(itemId) {
    const wasOwned = ownedItems.has(itemId);
    if (wasOwned) {
        ownedItems.delete(itemId);
    } else {
        ownedItems.add(itemId);
        // 追蹤標記擁有
        const item = findItemById(itemId, currentCollection);
        if (item) {
            trackEvent('mark_owned', {
                item_name: item.Name,
                item_id: itemId,
                collection: currentCollection
            });
        }
    }
    saveOwnedItems(currentCollection, ownedItems);
    // Update collection progress (skip for Glamour)
    if (currentCollection !== 'Glamour') {
        updateCollectionProgress(currentCollection, currentCollectionData.Items, ownedItems, filterState.excludeCategories);
    }
}

// Check if an item is in wishlist
function isItemInWishlist(collectionName, itemId) {
    const key = getWishlistKey(collectionName, itemId);
    return wishlist.has(key);
}

// Toggle item wishlist status
function toggleItemWishlist(collectionName, itemId) {
    const key = getWishlistKey(collectionName, itemId);
    if (wishlist.has(key)) {
        wishlist.delete(key);
    } else {
        wishlist.add(key);
        // 追蹤加入願望清單
        const item = findItemById(itemId, collectionName);
        if (item) {
            trackEvent('add_to_wishlist', {
                item_name: item.Name,
                item_id: itemId,
                collection: collectionName
            });
        }
    }
    saveWishlist(wishlist);
}

// Update card UI after owned status change
function updateCardOwnedState(toggleBtn, itemId) {
    const isOwned = ownedItems.has(itemId);
    const card = toggleBtn.closest('.item-card');

    toggleBtn.classList.toggle('active', isOwned);
    toggleBtn.title = isOwned ? '取消擁有' : '標記為已擁有';
    card.classList.toggle('owned', isOwned);

    // If filtering by ownership, may need to hide/show this card
    if (filterState.ownershipFilter !== 'all') {
        renderItems();
    }
}

// Update card UI after wishlist status change
function updateCardWishlistState(toggleBtn, itemId) {
    const isWishlisted = isItemInWishlist(currentCollection, itemId);
    const card = toggleBtn.closest('.item-card');

    toggleBtn.classList.toggle('active', isWishlisted);
    toggleBtn.title = isWishlisted ? '從願望清單移除' : '加入願望清單';
    card.classList.toggle('wishlisted', isWishlisted);

    // Update the star icon fill
    const svg = toggleBtn.querySelector('svg');
    if (svg) {
        svg.setAttribute('fill', isWishlisted ? 'currentColor' : 'none');
    }
}

// Update modal wishlist button state
function updateModalWishlistState(itemId) {
    const isWishlisted = isItemInWishlist(currentCollection, itemId);
    elements.modalWishlistBtn.classList.toggle('active', isWishlisted);
    elements.modalWishlistBtn.querySelector('span').textContent = isWishlisted ? '已在願望清單' : '加入願望清單';

    // Update the star icon fill
    const svg = elements.modalWishlistBtn.querySelector('svg');
    if (svg) {
        svg.setAttribute('fill', isWishlisted ? 'currentColor' : 'none');
    }
}

// DOM Elements
const elements = {
    tabsContainer: null,
    sourceFilters: null,
    patchFilters: null,
    itemsGrid: null,
    itemsCount: null,
    sortSelect: null,
    searchInput: null,
    searchResults: null,
    clearFiltersBtn: null,
    showNoSourceToggle: null,
    modal: null,
    modalClose: null,
    modalIcon: null,
    modalName: null,
    modalPatch: null,
    modalDescription: null,
    modalSources: null,
    modalWikiLink: null,
    modalItemSearchLink: null,
    modalOwnedBtn: null,
    modalWishlistBtn: null,
    loadingIndicator: null,
    loadMoreBtn: null,
    loadMoreContainer: null,
    remainingSpan: null,
    // Settings modal elements
    settingsBtn: null,
    settingsModal: null,
    settingsModalClose: null,
    exportBtn: null,
    exportStats: null,
    exportTextarea: null,
    importTextarea: null,
    importBtn: null,
    modalCopyLinkBtn: null
};

// Initialize the application
async function init() {
    // Cache DOM elements
    cacheElements();

    // Load saved filter settings
    filterState.loadSettings();

    // Load wishlist (cross-collection)
    wishlist = loadWishlist();

    // Set up event listeners
    setupEventListeners();

    // Set up progress exclude category callback
    onProgressExcludeCategoryChange = function(category) {
        filterState.toggleExcludeCategory(category);
        if (currentCollection && currentCollection !== 'Glamour' && currentCollectionData) {
            updateCollectionProgress(currentCollection, currentCollectionData.Items, ownedItems, filterState.excludeCategories);
        }
    };

    // Load data
    await loadData();

    // Render initial UI
    renderUI();

    // Update ownership filter UI to match loaded settings
    updateOwnershipFilterUI();

    // 檢查 URL 參數，自動開啟指定項目
    checkUrlAndOpenItem();
}

// Update ownership filter radio buttons to match current state
function updateOwnershipFilterUI() {
    const radios = document.querySelectorAll('input[name="ownership"]');
    radios.forEach(radio => {
        radio.checked = radio.value === filterState.ownershipFilter;
    });
}

// Cache DOM elements
function cacheElements() {
    elements.tabsContainer = document.getElementById('collection-tabs');
    elements.sourceFilters = document.getElementById('source-filters');
    elements.patchFilters = document.getElementById('patch-filters');
    elements.itemsGrid = document.getElementById('items-grid');
    elements.itemsCount = document.getElementById('items-count');
    elements.sortSelect = document.getElementById('sort-select');
    elements.searchInput = document.getElementById('search-input');
    elements.searchResults = document.getElementById('search-results');
    elements.clearFiltersBtn = document.getElementById('clear-filters');
    elements.showNoSourceToggle = document.getElementById('show-no-source-toggle');
    elements.modal = document.getElementById('item-modal');
    elements.modalClose = document.getElementById('modal-close');
    elements.modalIcon = document.getElementById('modal-icon');
    elements.modalName = document.getElementById('modal-name');
    elements.modalPatch = document.getElementById('modal-patch');
    elements.modalDescription = document.getElementById('modal-description');
    elements.modalSources = document.getElementById('modal-sources');
    elements.modalWikiLink = document.getElementById('modal-wiki-link');
    elements.modalItemSearchLink = document.getElementById('modal-item-search-link');
    elements.modalOwnedBtn = document.getElementById('modal-owned-btn');
    elements.modalWishlistBtn = document.getElementById('modal-wishlist-btn');
    elements.modalOrchestrionCategory = document.getElementById('modal-orchestrion-category');
    elements.loadingIndicator = document.getElementById('loading-indicator');

    // Settings modal elements
    elements.settingsBtn = document.getElementById('settings-btn');
    elements.settingsModal = document.getElementById('settings-modal');
    elements.settingsModalClose = document.getElementById('settings-modal-close');
    elements.exportBtn = document.getElementById('export-btn');
    elements.exportStats = document.getElementById('export-stats');
    elements.exportTextarea = document.getElementById('export-textarea');
    elements.importTextarea = document.getElementById('import-textarea');
    elements.importBtn = document.getElementById('import-btn');
    elements.modalCopyLinkBtn = document.getElementById('modal-copy-link-btn');

    // Create load more container dynamically
    createLoadMoreButton();
}

// Set up event listeners
function setupEventListeners() {
    // Tab clicks
    elements.tabsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            switchCollection(e.target.dataset.collection);
        }
    });

    // Source filter clicks
    elements.sourceFilters.addEventListener('click', (e) => {
        const filterItem = e.target.closest('.filter-item');
        if (filterItem) {
            const category = filterItem.dataset.category;
            filterState.toggleCategory(category);
            filterItem.classList.toggle('active');
            filterItem.querySelector('input').checked = filterState.activeCategories.has(category);
            renderItems();
        }
    });

    // Patch filter clicks
    elements.patchFilters.addEventListener('click', (e) => {
        if (e.target.classList.contains('patch-btn')) {
            const patchLabel = e.target.dataset.patch;
            filterState.togglePatch(patchLabel);
            e.target.classList.toggle('active');
            renderItems();
        }
    });

    // Clear filters
    elements.clearFiltersBtn.addEventListener('click', () => {
        filterState.clearAll();
        elements.searchInput.value = '';
        updateFilterUI();
        renderItems();
    });

    // Show no source toggle
    elements.showNoSourceToggle.addEventListener('change', (e) => {
        filterState.showNoSource = e.target.checked;
        renderItems();
    });

    // Sort change
    elements.sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderItems();
    });

    // Search input
    elements.searchInput.addEventListener('input', (e) => {
        const query = e.target.value;

        // Debounce search
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            if (query.length >= 2) {
                performSearch(query);
            } else {
                elements.searchResults.classList.remove('active');
                filterState.setSearchQuery('');
                renderItems();
            }
        }, 300);
    });

    // Search focus/blur
    elements.searchInput.addEventListener('focus', () => {
        if (elements.searchInput.value.length >= 2) {
            elements.searchResults.classList.add('active');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            elements.searchResults.classList.remove('active');
        }
    });

    // Search result clicks
    elements.searchResults.addEventListener('click', (e) => {
        const resultItem = e.target.closest('.search-result-item');
        if (resultItem) {
            const itemId = parseInt(resultItem.dataset.itemId);
            const collectionName = resultItem.dataset.collection;

            // Switch to collection and show item
            switchCollection(collectionName);
            elements.searchResults.classList.remove('active');

            // Find and show item detail
            setTimeout(() => {
                const item = findItemById(itemId, collectionName);
                if (item) {
                    showItemDetail(item);
                }
            }, 100);
        }
    });

    // Item card clicks
    elements.itemsGrid.addEventListener('click', (e) => {
        // Handle owned toggle click
        const ownedToggleBtn = e.target.closest('.owned-toggle');
        if (ownedToggleBtn) {
            e.stopPropagation();
            const itemId = parseInt(ownedToggleBtn.dataset.itemId);
            toggleItemOwned(itemId);
            updateCardOwnedState(ownedToggleBtn, itemId);
            return;
        }

        // Handle wishlist toggle click
        const wishlistToggleBtn = e.target.closest('.wishlist-toggle');
        if (wishlistToggleBtn) {
            e.stopPropagation();
            const itemId = parseInt(wishlistToggleBtn.dataset.itemId);
            toggleItemWishlist(currentCollection, itemId);
            updateCardWishlistState(wishlistToggleBtn, itemId);
            return;
        }

        // Handle wishlist remove button click (on wishlist page)
        const wishlistRemoveBtn = e.target.closest('.wishlist-remove-btn');
        if (wishlistRemoveBtn) {
            e.stopPropagation();
            const itemId = parseInt(wishlistRemoveBtn.dataset.itemId);
            const collectionName = wishlistRemoveBtn.dataset.collection;
            toggleItemWishlist(collectionName, itemId);
            // Refresh wishlist page
            showWishlistPage();
            return;
        }

        // Handle regular card click
        const card = e.target.closest('.item-card');
        if (card) {
            let item = null;
            let collectionName = currentCollection;

            // For wishlist items, use the stored collection name and find by ID
            if (card.dataset.collection) {
                collectionName = card.dataset.collection;
                const itemId = parseInt(card.dataset.itemId);
                item = findItemById(itemId, collectionName);
            } else if (card.dataset.itemIndex !== undefined) {
                // For regular items, use the index to get exact item
                const itemIndex = parseInt(card.dataset.itemIndex);
                item = currentFilteredItems[itemIndex];
            }

            if (item) {
                // Temporarily set currentCollection for modal functions
                const previousCollection = currentCollection;
                currentCollection = collectionName;
                ownedItems = loadOwnedItems(collectionName);
                showItemDetail(item);
                // Restore after modal is set up
                if (previousCollection === 'wishlist') {
                    currentCollection = 'wishlist';
                }
            }
        }
    });

    // Ownership filter change
    document.querySelectorAll('input[name="ownership"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            filterState.setOwnershipFilter(e.target.value);
            renderItems();
        });
    });

    // Modal close
    elements.modalClose.addEventListener('click', closeModal);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
            closeModal();
        }
    });

    // Modal owned button click
    elements.modalOwnedBtn.addEventListener('click', () => {
        const itemId = parseInt(elements.modalOwnedBtn.dataset.itemId);
        if (!isNaN(itemId)) {
            toggleItemOwned(itemId);
            updateModalOwnedState(itemId);
            // Also update the card in the grid if visible
            const cardToggle = document.querySelector(`.owned-toggle[data-item-id="${itemId}"]`);
            if (cardToggle) {
                updateCardOwnedState(cardToggle, itemId);
            }
        }
    });

    // Modal wishlist button click
    elements.modalWishlistBtn.addEventListener('click', () => {
        const itemId = parseInt(elements.modalWishlistBtn.dataset.itemId);
        if (!isNaN(itemId)) {
            toggleItemWishlist(currentCollection, itemId);
            updateModalWishlistState(itemId);
            // Also update the card in the grid if visible
            const cardToggle = document.querySelector(`.wishlist-toggle[data-item-id="${itemId}"]`);
            if (cardToggle) {
                updateCardWishlistState(cardToggle, itemId);
            }
        }
    });

    // Modal copy link button click
    elements.modalCopyLinkBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            const btn = elements.modalCopyLinkBtn;
            const span = btn.querySelector('span');
            const originalText = span.textContent;
            btn.classList.add('copied');
            span.textContent = '已複製！';
            setTimeout(() => {
                btn.classList.remove('copied');
                span.textContent = originalText;
            }, 2000);
        });
    });

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.modal.classList.contains('active')) {
            closeModal();
        }
        if (e.key === 'Escape' && elements.settingsModal.classList.contains('active')) {
            closeSettingsModal();
        }
    });

    // Settings button click
    elements.settingsBtn.addEventListener('click', openSettingsModal);

    // Settings modal close
    elements.settingsModalClose.addEventListener('click', closeSettingsModal);
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            closeSettingsModal();
        }
    });

    // Export button click - generate backup code and copy to clipboard
    elements.exportBtn.addEventListener('click', () => {
        const backupCode = exportAllData();
        elements.exportTextarea.value = backupCode;
        elements.exportTextarea.select();

        // Try to copy to clipboard
        navigator.clipboard.writeText(backupCode).then(() => {
            elements.exportBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                已複製！
            `;
            setTimeout(() => {
                elements.exportBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    產生備份碼
                `;
            }, 2000);
        }).catch(() => {
            // Fallback: just show the code for manual copy
            alert('備份碼已產生，請手動複製');
        });
    });

    // Import button click
    elements.importBtn.addEventListener('click', () => {
        const backupCode = elements.importTextarea.value.trim();
        if (!backupCode) {
            alert('請先貼上備份碼');
            return;
        }

        if (!confirm('確定要還原資料嗎？這會覆蓋現有的所有資料。')) {
            return;
        }

        try {
            importFromString(backupCode);
            alert('資料還原成功！頁面將重新載入。');
            location.reload();
        } catch (error) {
            alert('還原失敗：' + error.message);
        }
    });
}

// Update modal owned button state
function updateModalOwnedState(itemId) {
    const isOwned = ownedItems.has(itemId);
    elements.modalOwnedBtn.classList.toggle('active', isOwned);
    elements.modalOwnedBtn.querySelector('span').textContent = isOwned ? '已擁有' : '標記為已擁有';
}

// Show/hide loading indicator
function showLoading(show) {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = show ? 'flex' : 'none';
    }
}

// Load JSON data
async function loadData() {
    showLoading(true);

    try {
        // Load main collections data, Blue Mage sources, and Huiji mapping in parallel
        const [collectionsResponse, blueMageResponse, huijiResponse] = await Promise.all([
            fetch('data/collections_data.json'),
            fetch('data/bluemage_sources.json').catch(() => null),
            fetch('data/huiji_mapping.json').catch(() => null)
        ]);

        if (!collectionsResponse.ok) {
            throw new Error(`HTTP ${collectionsResponse.status}`);
        }
        collectionsData = await collectionsResponse.json();
        console.log('Data loaded:', collectionsData.Collections.length, 'collections');

        // Load Blue Mage sources if available
        if (blueMageResponse && blueMageResponse.ok) {
            const blueMageData = await blueMageResponse.json();
            // Create a map by action ID for quick lookup
            blueMageSources = {};
            for (const spell of blueMageData) {
                blueMageSources[spell.action] = spell;
            }
            console.log('Blue Mage sources loaded:', Object.keys(blueMageSources).length, 'spells');
        }

        // Load Huiji Wiki mapping if available
        if (huijiResponse && huijiResponse.ok) {
            huijiMapping = await huijiResponse.json();
            console.log('Huiji mapping loaded');
        }
    } catch (error) {
        console.error('Failed to load data:', error);
        elements.itemsGrid.innerHTML = `
            <div class="no-results">
                <p>無法載入資料</p>
                <small>請確認 data/collections_data.json 檔案存在</small>
            </div>
        `;
    } finally {
        showLoading(false);
    }
}

// Render initial UI
function renderUI() {
    if (!collectionsData) return;

    // Sort collections by OrderKey and filter out empty ones
    const sortedCollections = [...collectionsData.Collections]
        .filter(c => c.Items && c.Items.length > 0)
        .sort((a, b) => a.OrderKey - b.OrderKey);

    // Render tabs
    elements.tabsContainer.innerHTML = '';

    // Add Homepage tab first
    const homepageBtn = document.createElement('button');
    homepageBtn.className = 'tab-btn active';
    homepageBtn.dataset.collection = 'homepage';
    homepageBtn.textContent = '首頁';
    elements.tabsContainer.appendChild(homepageBtn);

    sortedCollections.forEach((collection, index) => {
        const btn = createTabButton(collection, false);
        elements.tabsContainer.appendChild(btn);
    });

    // Add "Wishlist" tab
    const wishlistBtn = document.createElement('button');
    wishlistBtn.className = 'tab-btn';
    wishlistBtn.dataset.collection = 'wishlist';
    wishlistBtn.textContent = '願望清單';
    elements.tabsContainer.appendChild(wishlistBtn);

    // Set initial collection to Homepage
    currentCollection = 'homepage';

    // Render source filters
    renderSourceFilters();

    // Render patch filters
    renderPatchFilters();

    // Show Homepage as default
    showHomepage();
}

// Render source category filters (only show categories that exist in current collection)
function renderSourceFilters() {
    elements.sourceFilters.innerHTML = '';

    // If no collection loaded yet (homepage), show all categories
    if (!currentCollectionData) {
        for (const [key, info] of Object.entries(SOURCE_CATEGORIES)) {
            const isActive = filterState.activeCategories.has(key);
            const filterItem = createSourceFilterItem(key, info, isActive);
            elements.sourceFilters.appendChild(filterItem);
        }
        return;
    }

    // Get categories that exist in current collection
    const existingCategories = new Set();

    // Special handling for Blue Mage - use blueMageSources
    if (currentCollection === 'Blue Mage' && blueMageSources) {
        for (const item of currentCollectionData.Items) {
            const spell = blueMageSources[item.Id];
            if (spell && spell.method) {
                for (const method of spell.method) {
                    const category = BLUEMAGE_TYPE_MAP[method.type];
                    if (category) existingCategories.add(category);
                }
            }
        }
    } else {
        // Normal collection - check Sources
        for (const item of currentCollectionData.Items) {
            if (item.Sources) {
                for (const source of item.Sources) {
                    if (source.Categories) {
                        for (const cat of source.Categories) {
                            if (cat) existingCategories.add(cat);
                        }
                    }
                }
            }
        }
    }

    // Remove active categories that don't exist in current collection
    for (const cat of filterState.activeCategories) {
        if (!existingCategories.has(cat)) {
            filterState.activeCategories.delete(cat);
        }
    }

    // Only show categories that exist
    for (const [key, info] of Object.entries(SOURCE_CATEGORIES)) {
        if (!existingCategories.has(key)) continue;

        const isActive = filterState.activeCategories.has(key);
        const filterItem = createSourceFilterItem(key, info, isActive);
        elements.sourceFilters.appendChild(filterItem);
    }
}

// Render patch version filters
function renderPatchFilters() {
    elements.patchFilters.innerHTML = '';

    for (const patchDef of PATCH_VERSIONS) {
        const isActive = filterState.activePatches.has(patchDef.label);
        const btn = createPatchFilterButton(patchDef, isActive);
        elements.patchFilters.appendChild(btn);
    }
}

// Update filter UI state
function updateFilterUI() {
    // Update source filters
    elements.sourceFilters.querySelectorAll('.filter-item').forEach(item => {
        const category = item.dataset.category;
        const isActive = filterState.activeCategories.has(category);
        item.classList.toggle('active', isActive);
        item.querySelector('input').checked = isActive;
    });

    // Update patch filters
    elements.patchFilters.querySelectorAll('.patch-btn').forEach(btn => {
        const patchLabel = btn.dataset.patch;
        btn.classList.toggle('active', filterState.activePatches.has(patchLabel));
    });

    // Update show no source toggle
    elements.showNoSourceToggle.checked = filterState.showNoSource;
}

// Switch to a different collection
function switchCollection(collectionName) {
    if (currentCollection === collectionName) return;

    // 追蹤分類切換
    trackEvent('select_collection', {
        collection: collectionName
    });

    // Handle Homepage specially
    if (collectionName === 'homepage') {
        currentCollection = 'homepage';
        showHomepage();
        // Update tab UI
        elements.tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.collection === 'homepage');
        });
        return;
    }

    // Handle "Wishlist" page specially
    if (collectionName === 'wishlist') {
        currentCollection = 'wishlist';
        showWishlistPage();
        // Update tab UI
        elements.tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.collection === 'wishlist');
        });
        return;
    }

    // Restore sidebar and sort options when switching to a regular collection
    document.querySelector('.sidebar').style.display = '';
    document.querySelector('.sort-options').style.display = '';

    currentCollection = collectionName;

    // Load owned items for this collection
    ownedItems = loadOwnedItems(collectionName);

    // Update tab UI
    elements.tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.collection === collectionName);
    });

    // Render items for new collection
    renderItems();
}

// Render items for current collection
function renderItems() {
    if (!collectionsData || !currentCollection) return;

    currentCollectionData = collectionsData.Collections.find(c => c.CollectionName === currentCollection);
    if (!currentCollectionData) return;

    // Update source filters for current collection
    renderSourceFilters();

    // Filter items
    currentFilteredItems = currentCollectionData.Items.filter(item => filterState.passesFilters(item, isItemOwned));

    // Sort items (Blue Mage defaults to spell number, Triple Triad to card number)
    let sortKey = currentSort;
    if (currentCollection === 'Blue Mage' && currentSort === 'name') {
        sortKey = 'spell-no';
    } else if (currentCollection === 'Triple Triad' && currentSort === 'name') {
        sortKey = 'card-no';
    } else if (currentCollection === 'Orchestrions' && currentSort === 'name') {
        sortKey = 'orchestrion-category';
    }
    const sortFn = SORT_FUNCTIONS[sortKey] || SORT_FUNCTIONS['name'];
    currentFilteredItems.sort(sortFn);

    // Reset pagination
    currentRenderedCount = 0;

    // Update items count (simple total)
    elements.itemsCount.textContent = `共 ${currentFilteredItems.length} 項`;

    // Update collection progress (skip for Glamour)
    if (currentCollection === 'Glamour') {
        document.getElementById('collection-progress').innerHTML = '';
    } else {
        updateCollectionProgress(currentCollection, currentCollectionData.Items, ownedItems, filterState.excludeCategories);
    }

    // Clear grid
    elements.itemsGrid.innerHTML = '';

    if (currentFilteredItems.length === 0) {
        renderNoResults(elements.itemsGrid);
        hideLoadMoreButton();
        return;
    }

    // Render first batch
    renderMoreItems();
}

// Render more items (pagination)
function renderMoreItems() {
    if (isLoadingMore || currentRenderedCount >= currentFilteredItems.length) return;

    isLoadingMore = true;
    updateLoadMoreButtonState(true);

    const startIndex = currentRenderedCount;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, currentFilteredItems.length);

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const card = createItemCard(currentFilteredItems[i], i);
        fragment.appendChild(card);
    }
    elements.itemsGrid.appendChild(fragment);

    currentRenderedCount = endIndex;

    // Show/hide load more button
    if (currentRenderedCount < currentFilteredItems.length) {
        showLoadMoreButton(currentFilteredItems.length - currentRenderedCount);
    } else {
        hideLoadMoreButton();
    }

    isLoadingMore = false;
    updateLoadMoreButtonState(false);
}

// Create load more button
function createLoadMoreButton() {
    const container = document.createElement('div');
    container.id = 'load-more-container';
    container.className = 'load-more-container hidden';
    container.innerHTML = `
        <button id="load-more-btn" class="load-more-btn">載入更多</button>
        <span id="remaining-count" class="remaining-count"></span>
    `;

    // Insert after items-grid
    elements.itemsGrid.parentNode.insertBefore(container, elements.itemsGrid.nextSibling);

    elements.loadMoreContainer = container;
    elements.loadMoreBtn = document.getElementById('load-more-btn');
    elements.remainingSpan = document.getElementById('remaining-count');

    // Event listener
    elements.loadMoreBtn.addEventListener('click', renderMoreItems);

    // Infinite scroll
    setupInfiniteScroll();
}

// Update load more button loading state
function updateLoadMoreButtonState(loading) {
    if (!elements.loadMoreBtn) return;

    if (loading) {
        elements.loadMoreBtn.textContent = '載入中...';
        elements.loadMoreBtn.disabled = true;
        elements.loadMoreBtn.classList.add('loading');
    } else {
        elements.loadMoreBtn.textContent = '載入更多';
        elements.loadMoreBtn.disabled = false;
        elements.loadMoreBtn.classList.remove('loading');
    }
}

// Show load more button
function showLoadMoreButton(remaining) {
    if (elements.loadMoreContainer) {
        elements.loadMoreContainer.classList.remove('hidden');
        if (elements.remainingSpan) {
            elements.remainingSpan.textContent = `（剩餘 ${remaining} 項）`;
        }
    }
}

// Hide load more button
function hideLoadMoreButton() {
    if (elements.loadMoreContainer) {
        elements.loadMoreContainer.classList.add('hidden');
    }
}

// Setup infinite scroll
function setupInfiniteScroll() {
    // Clean up old observer if exists (prevent memory leak)
    if (infiniteScrollObserver) {
        infiniteScrollObserver.disconnect();
        infiniteScrollObserver = null;
    }

    infiniteScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoadingMore) {
                renderMoreItems();
            }
        });
    }, {
        rootMargin: '200px'
    });

    // Observe the load more container
    if (elements.loadMoreContainer) {
        infiniteScrollObserver.observe(elements.loadMoreContainer);
    }
}

// Perform search across all collections
function performSearch(query) {
    if (!collectionsData) return;

    // 追蹤搜尋
    trackEvent('search', {
        search_term: query
    });

    const searchLower = query.toLowerCase();
    const results = [];

    for (const collection of collectionsData.Collections) {
        for (const item of collection.Items) {
            if (item.Name && item.Name.toLowerCase().includes(searchLower)) {
                results.push({ item, collectionName: collection.CollectionName });
                if (results.length >= 20) break; // Limit results
            }
        }
        if (results.length >= 20) break;
    }

    // Render search results
    elements.searchResults.innerHTML = '';

    if (results.length === 0) {
        elements.searchResults.innerHTML = '<div class="search-result-item"><span class="result-name">找不到結果</span></div>';
    } else {
        for (const { item, collectionName } of results) {
            const resultItem = createSearchResultItem(item, collectionName);
            elements.searchResults.appendChild(resultItem);
        }
    }

    elements.searchResults.classList.add('active');

    // Also filter current collection
    filterState.setSearchQuery(query);
    renderItems();
}

// Find item by ID in a collection
function findItemById(itemId, collectionName) {
    if (!collectionsData) return null;

    const collection = collectionsData.Collections.find(c => c.CollectionName === collectionName);
    if (!collection) return null;

    return collection.Items.find(item => item.Id === itemId);
}

// Show item detail modal
function showItemDetail(item) {
    // 追蹤項目點擊
    trackEvent('view_item', {
        item_name: item.Name,
        item_id: item.Id,
        collection: currentCollection
    });

    // 更新 URL 以支援分享
    updateUrlWithItem(currentCollection, item.Name);

    elements.modalIcon.src = item.IconUrl;
    elements.modalIcon.onerror = function() {
        this.src = 'https://xivapi.com/i/000000/000000.png';
    };

    // Check if this is a Blue Mage spell and get source data
    const blueMageSpell = blueMageSources ? blueMageSources[item.Id] : null;

    // Show spell number for Blue Mage
    let displayName = item.Name || '???';
    if (blueMageSpell) {
        displayName = `No.${blueMageSpell.no} ${displayName}`;
    }
    elements.modalName.textContent = displayName;

    const patchDisplay = item.DisplayPatch || (item.PatchAdded >= 999 ? '未知' : item.PatchAdded.toString());
    elements.modalPatch.textContent = `Patch ${patchDisplay}`;

    // Show orchestrion category for Orchestrions
    if (currentCollection === 'Orchestrions' && item.Category) {
        if (item.CategoryOrder !== undefined && item.CategoryOrder < 65535) {
            const orderStr = String(item.CategoryOrder).padStart(3, '0');
            elements.modalOrchestrionCategory.innerHTML = `${item.Category} <span style="opacity:0.7">${orderStr}</span>`;
        } else {
            elements.modalOrchestrionCategory.textContent = item.Category;
        }
        elements.modalOrchestrionCategory.style.display = '';
    } else {
        elements.modalOrchestrionCategory.style.display = 'none';
    }

    // Clean FFXIV formatting tags and convert <br> to newlines
    let description = (item.Description || '').replace(/<br\s*\/?>/gi, '\n');
    description = cleanFFXIVText(description);
    elements.modalDescription.textContent = description;

    // Render sources
    elements.modalSources.innerHTML = '';

    // Use Blue Mage sources if available
    if (blueMageSpell && blueMageSpell.method && blueMageSpell.method.length > 0) {
        for (const method of blueMageSpell.method) {
            const sourceItem = renderBlueMageSource(method);
            elements.modalSources.appendChild(sourceItem);
        }
    } else if (item.Sources && item.Sources.length > 0) {
        for (const source of item.Sources) {
            const sourceItem = renderSourceItem(source);
            elements.modalSources.appendChild(sourceItem);
        }
    } else {
        elements.modalSources.innerHTML = '<p class="no-results">無來源資料</p>';
    }

    // Set wiki link
    const wikiUrl = getHuijiWikiUrl(item, currentCollection);
    if (wikiUrl && elements.modalWikiLink) {
        elements.modalWikiLink.href = wikiUrl;
        elements.modalWikiLink.style.display = '';
    } else if (elements.modalWikiLink) {
        elements.modalWikiLink.style.display = 'none';
    }

    // Render hairstyle race previews
    const hairstylePreviewsEl = document.getElementById('hairstyle-previews');
    if (currentCollection === 'Hairstyles' && item.SpriteUrl) {
        const grid = hairstylePreviewsEl.querySelector('.hairstyle-grid');
        grid.innerHTML = '';

        // Frame count varies by hairstyle (8, 14, 16, 17, or 18 frames)
        const frameCount = item.SpriteFrames || 18;
        const sizePercent = frameCount * 100;

        for (let i = 0; i < frameCount; i++) {
            const preview = document.createElement('div');
            preview.className = 'hairstyle-preview';
            preview.style.backgroundImage = `url('${item.SpriteUrl}')`;
            preview.style.backgroundSize = `${sizePercent}% 100%`;
            // position as percentage (0% = first frame, 100% = last frame)
            const posPercent = frameCount > 1 ? (i / (frameCount - 1)) * 100 : 0;
            preview.style.backgroundPosition = `${posPercent}% 0`;
            grid.appendChild(preview);
        }

        hairstylePreviewsEl.style.display = '';
    } else {
        hairstylePreviewsEl.style.display = 'none';
    }

    // Render frame previews
    const framePreviewsEl = document.getElementById('frame-previews');
    if (currentCollection === 'Framer Kits' && item.FrameImage) {
        const container = framePreviewsEl.querySelector('.frame-images');
        container.innerHTML = '';

        // Add main image
        const img1 = document.createElement('img');
        img1.src = item.FrameImage;
        img1.alt = item.Name;
        img1.onerror = function() { this.style.display = 'none'; };
        img1.onclick = function() { openLightbox(this.src, this.alt); };
        container.appendChild(img1);

        // Add flipped image if available
        if (item.FrameImageFlipped) {
            const img2 = document.createElement('img');
            img2.src = item.FrameImageFlipped;
            img2.alt = item.Name + ' (反轉)';
            img2.onerror = function() { this.style.display = 'none'; };
            img2.onclick = function() { openLightbox(this.src, this.alt); };
            container.appendChild(img2);
        }

        framePreviewsEl.style.display = '';
    } else {
        framePreviewsEl.style.display = 'none';
    }

    // Render mount screenshots
    const mountScreenshotsEl = document.getElementById('mount-screenshots');
    if (currentCollection === 'Mounts' && mountScreenshotsEl) {
        const groundImg = document.getElementById('mount-ground-img');
        const flyingImg = document.getElementById('mount-flying-img');
        const groundContainer = document.getElementById('mount-ground-container');
        const flyingContainer = document.getElementById('mount-flying-container');

        const groundSrc = `images/mounts/${encodeURIComponent(item.Name + '_地面')}.png`;
        const flyingSrc = `images/mounts/${encodeURIComponent(item.Name + '_飛行')}.png`;

        groundContainer.style.display = '';
        flyingContainer.style.display = '';

        groundImg.src = groundSrc;
        groundImg.onerror = function() { groundContainer.style.display = 'none'; };
        groundImg.onclick = function() { openLightbox(this.src, item.Name + ' (地面)'); };

        flyingImg.src = flyingSrc;
        flyingImg.onerror = function() { flyingContainer.style.display = 'none'; };
        flyingImg.onclick = function() { openLightbox(this.src, item.Name + ' (飛行)'); };

        mountScreenshotsEl.style.display = '';
    } else if (mountScreenshotsEl) {
        mountScreenshotsEl.style.display = 'none';
    }


    // Set owned button state
    elements.modalOwnedBtn.dataset.itemId = item.Id;
    updateModalOwnedState(item.Id);

    // Set wishlist button state
    elements.modalWishlistBtn.dataset.itemId = item.Id;
    updateModalWishlistState(item.Id);

    elements.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close modal
function closeModal() {
    elements.modal.classList.remove('active');
    document.body.style.overflow = '';
    // 清除 URL 參數
    clearUrlParams();
}

// Settings modal functions
function openSettingsModal() {
    // Update export stats before showing
    const stats = getExportStats();
    elements.exportStats.textContent = `已擁有 ${stats.totalOwned} 件，願望清單 ${stats.wishlistCount} 件`;

    elements.settingsModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
    document.body.style.overflow = '';
}

// Lightbox functions
function openLightbox(src, alt) {
    const lightbox = document.getElementById('image-lightbox');
    const lightboxImg = lightbox.querySelector('.lightbox-image');
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.classList.add('active');
}

function closeLightbox() {
    const lightbox = document.getElementById('image-lightbox');
    lightbox.classList.remove('active');
}

// Initialize lightbox event listeners
function initLightbox() {
    const lightbox = document.getElementById('image-lightbox');
    if (!lightbox) return;

    // Close on clicking close button
    const closeBtn = lightbox.querySelector('.lightbox-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeLightbox);
    }

    // Close on clicking background
    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    // Close on ESC key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    init();
    initLightbox();
});
