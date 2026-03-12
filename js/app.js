// Fun-da App - De leukste manier om een huis te vinden!
// Features: Funda scraping, Familie sync, Swipe interface

// console.log / warn / debug suppressed in production; errors kept visible
console.log = () => {};
console.warn = () => {};
console.debug = () => {};

// Utility function
const $ = (id) => document.getElementById(id);

class FunDaApp {
    constructor() {
        // App state
        this.houses = [];
        this.currentIndex = 0;
        this.favorites = [];
        this.viewed = 0;
        this.filters = {
            minPrice: null,
            maxPrice: null,
            minBedrooms: null,
            neighborhood: null
        };
        
        // PWA install prompt
        this.deferredInstallPrompt = null;
        this.installPromptDismissedRecently = false;

        // Services
        this.scraper = new FundaScraper();
        this.familySync = new FamilySync();

        // Cache DOM elements
        this.elements = {
            splash: $('splash'),
            app: $('app'),
            cardStack: $('cardStack'),
            emptyState: $('emptyState'),
            // Stats
            housesViewed: $('housesViewed'),
            matchScore: $('matchScore'),
            housesLeft: $('housesLeft'),
            favCount: $('favCount'),
            familyMatchCount: $('familyMatchCount'),
            // Modals
            favoritesModal: $('favoritesModal'),
            detailModal: $('detailModal'),
            settingsModal: $('settingsModal'),
            familyModal: $('familyModal')
        };

        // Touch handling state
        this.touch = {
            startX: 0,
            startY: 0,
            currentX: 0,
            isDragging: false
        };

        // Family matches
        this.familyMatches = new Map();

        // Favorite meta (bid timeline, notes, etc.)
        this.favoriteMeta = {};

        // Firebase Auth current user
        this.currentUser = null;

        // Language (nl / en)
        this.lang = localStorage.getItem('funda-lang') || 'nl';

        // Browse view state
        this.browseOpen = false;
        this.currentView = localStorage.getItem('funda-view-mode') || 'browse';
        this.browseSort = 'default';
        this.browseLayout = 'list';
        this.daysBack = 3; // Configurable days back for auto-load
        this.searchArea = ''; // Configurable search area
        this._loadedArea = null; // Track what was last fetched
        this._loadedDaysBack = 3;
        this.browseFilters = {
            minPrice: null, maxPrice: null,
            minSize: null, maxSize: null,
            minBedrooms: null,
            minEnergyLabel: null,
            neighborhood: '',
            minYear: null,
            hasTuin: false, hasBalcony: false, hasParking: false, hasSolar: false,
            isMonument: false, isAuction: false, isFixer: false,
            excludedNeighborhoods: [],
            minDaysOnMarket: null,
            maxDaysOnMarket: null,
            propertyType: null,
            minRooms: null,
        };
        
        // Backward compatibility getters
        this.cardStack = this.elements.cardStack;
        this.emptyState = this.elements.emptyState;
        this.favoritesModal = this.elements.favoritesModal;
        this.detailModal = this.elements.detailModal;
        this.settingsModal = this.elements.settingsModal;
        this.familyModal = this.elements.familyModal;
        this.mapModal = document.getElementById('mapModal');

        // Bind drag handlers once to avoid re-creating on every card render
        this._onDragMove = (e) => this.onDragMove(e);
        this._onDragEnd = (e) => this.onDragEnd(e);
        document.addEventListener('mousemove', this._onDragMove);
        document.addEventListener('mouseup', this._onDragEnd);

        this.init();
    }

    async init() {
        // Load saved houses (no mock data anymore)
        this.loadFromStorage();
        
        // App starts empty until user imports from Funda
        if (this.houses.length === 0) {
            console.log('🏠 Geen opgeslagen woningen - automatisch laden van Funda Nieuw Vandaag...');
        }

        // Wait a bit for Firebase to initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        // Setup family sync callback
        this.familySync.onFamilyUpdate = (matches, members) => {
            this.onFamilyUpdate(matches, members);
        };

        // Setup event listeners
        this.setupEventListeners();

        // Restore filter UI from saved state (localStorage or Firebase will overwrite if signed in)
        this.restoreBrowseFilterUI();

        // Initialize Firebase Auth
        this.initFirebaseAuth();

        // Don't render old cards yet - wait for fresh data
        // Only update stats and family UI
        this.updateStats();
        this.updateFamilyUI();

        // Show Firebase status
        if (this.familySync.isFirebaseReady) {
            console.log('🔥 Firebase Realtime Database connected!');
        }

        // Start progress animation immediately
        this.startProgressAnimation();

        // Apply saved language preference to static HTML
        this.applyTranslations();
        
        if (this.hasConfiguredSearchArea()) {
            // Start loading immediately when an explicit area is already configured
            setTimeout(() => {
                this.autoLoadNewListings();
            }, 300);
        } else {
            this.updateSplashStatus('Kies eerst een zoekgebied om woningen op te halen.');
            this.hideSplashScreen();
        }

        // Register service worker
        this.registerServiceWorker();
    }

    hasConfiguredSearchArea() {
        return Boolean((this.searchArea || '').trim());
    }
    
    startProgressAnimation() {
        // Animate progress bar smoothly from 0 to ~30% over first few seconds
        // This gives visual feedback even when waiting for network
        let progress = 0;
        this.progressInterval = setInterval(() => {
            if (progress < 30) {
                progress += 1;
                this.updateSplashProgress(progress);
            }
        }, 100);
    }
    
    stopProgressAnimation() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }
    
    updateSplashStatus(message) {
        const statusEl = document.getElementById('splashStatus');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }
    
    updateSplashProgress(progress) {
        const progressEl = document.getElementById('splashProgress');
        if (progressEl) {
            progressEl.style.width = `${progress}%`;
        }
    }
    
    hideSplashScreen() {
        // Stop progress animation and set to 100%
        this.stopProgressAnimation();
        this.updateSplashProgress(100);
        
        // Small delay to show completed progress
        setTimeout(() => {
            this.elements.splash.classList.add('hidden');
            this.elements.app.classList.remove('hidden');
            if (!this.hasConfiguredSearchArea()) {
                this.openBrowseView();
                return;
            }
            if (this.currentView === 'swipe') {
                this.openSwipeView();
                return;
            }
            this.openBrowseView();
        }, 200);
    }

    async autoLoadNewListings() {
        if (!this.hasConfiguredSearchArea()) {
            this.updateEmptyStates();
            this.hideSplashScreen();
            return;
        }

        // Determine if splash is still visible or this is a refetch
        const isSplashVisible = !this.elements.splash.classList.contains('hidden');
        const updateProgress = (message, progress) => {
            if (isSplashVisible) {
                this.stopProgressAnimation();
                this.updateSplashStatus(message);
                if (progress) this.updateSplashProgress(progress);
            } else {
                this.updateBrowseLoading(message, progress);
            }
        };

        if (!isSplashVisible) {
            this.showBrowseLoading('Verbinden met Funda...');
        }

        console.error('🚀 Auto-loading nieuwe woningen van vandaag...');
        
        try {
            this.updateSplashStatus('Verbinden met Funda...');
            
            // Tell scraper whether to fetch English descriptions
            this.scraper._wantEnglishDesc = (this.lang === 'en');
            
            // Use the scraper directly for splash screen updates
            const houses = await this.scraper.scrapeAllSources({ 
                area: this.searchArea,
                days: String(this.daysBack),
                onProgress: (message, progress) => {
                    updateProgress(message, progress);
                }
            });
            
            if (houses.length > 0) {
                this.updateSplashStatus('Woningen opslaan...');
                this.updateSplashProgress(90);
                
                // Add import timestamp
                houses.forEach(h => {
                    h.importedAt = Date.now();
                });

                // Merge with Firebase houses (previously found, not yet discarded)
                // Only merge houses that belong to the same search area
                let allHouses = [...houses];
                if (this.familySync.isInFamily()) {
                    try {
                        const firebaseHouses = await this.familySync.loadHousesFromDB();
                        const freshIds = new Set(houses.map(h => String(h.id)));
                        const currentArea = (this.searchArea || '').toLowerCase();
                        const extraFromFirebase = firebaseHouses.filter(h => {
                            if (freshIds.has(String(h.id))) return false;
                            // Only include houses from the same area
                            const houseCity = (h.city || '').toLowerCase();
                            return !currentArea || houseCity === currentArea || !houseCity;
                        });
                        allHouses = [...houses, ...extraFromFirebase];
                    } catch (e) { /* ignore if Firebase unavailable */ }
                }

                // Replace all houses with merged data
                this.houses = allHouses;
                this.currentIndex = 0;
                this.viewed = 0;
                this._loadedArea = this.searchArea;
                this._loadedDaysBack = this.daysBack;
                
                this.saveToStorage();
                this.renderCards();
                this.updateStats();

                // Save fresh houses to Firebase for cross-device persistence
                if (this.familySync.isInFamily()) {
                    this.familySync.saveHousesToDB(houses).catch(() => {});
                    // Also load favoriteMeta from Firebase
                    this.familySync.loadAllFavoriteMetaFromDB().then(meta => {
                        if (meta && Object.keys(meta).length > 0) {
                            this.favoriteMeta = { ...meta, ...this.favoriteMeta };
                            this.saveToStorage();
                        }
                    }).catch(() => {});
                }
                
                this.updateSplashStatus(`${allHouses.length} woningen geladen`);
                this.updateSplashProgress(100);
                
                // Small delay to show success message
                await new Promise(r => setTimeout(r, 500));
            } else {
                this.updateSplashStatus('Geen woningen gevonden');
                this.updateSplashProgress(100);
                // Fallback to cached data if available
                if (this.houses.length > 0) {
                    this.renderCards();
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (error) {
            console.error('Auto-load error:', error);
            this.updateSplashStatus('Cache laden...');
            this.updateSplashProgress(100);
            // Fallback to cached data
            if (this.houses.length > 0) {
                this.renderCards();
            }
            await new Promise(r => setTimeout(r, 800));
        }
        
        // Hide splash screen now that we're done
        this.hideSplashScreen();
        this.hideBrowseLoading();
        if (this.browseOpen) this.renderBrowseGrid();
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
                .then((registration) => {
                    console.error('🏠 Fun-da SW registered:', registration.scope);
                    
                    // Force update check on every page load
                    registration.update().catch(() => {});
                    
                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.error('🔄 New service worker installing...');
                        
                        newWorker.addEventListener('statechange', () => {
                            // Only show update toast if there's an existing controller
                            // This means it's an update, not a first install
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.error('🆕 New version available!');
                                this.showUpdateToast(registration);
                            }
                        });
                    });
                    
                    // Check if there's already a waiting worker (page was refreshed while update pending)
                    if (registration.waiting && navigator.serviceWorker.controller) {
                        this.showUpdateToast(registration);
                    }
                })
                .catch((error) => {
                    console.error('❌ Fun-da SW registration failed:', error);
                });
                
            // Listen for controller change (new SW activated)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.error('🔄 New service worker activated, reloading...');
                window.location.reload();
            });
        }
        
        // Setup PWA install prompt
        this.setupInstallPrompt();
    }
    
    showUpdateToast(registration) {
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = 'toast toast-action';
        toast.innerHTML = `
            <span>Nieuwe versie beschikbaar!</span>
            <button class="toast-btn" id="updateNowBtn">Updaten</button>
        `;
        container.appendChild(toast);
        
        toast.querySelector('#updateNowBtn').addEventListener('click', () => {
            if (registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            toast.remove();
        });
        
        // Don't auto-remove update toast - user must interact
    }
    
    setupInstallPrompt() {
        // Check if already running as installed PWA
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                            window.navigator.standalone === true;
        
        if (isStandalone) {
            console.log('📱 Already running as installed PWA');
            return;
        }
        
        // Check if user dismissed recently (expires after 7 days)
        const dismissedAt = localStorage.getItem('pwa-install-dismissed');
        this.installPromptDismissedRecently = Boolean(
            dismissedAt && (Date.now() - parseInt(dismissedAt, 10)) < 7 * 24 * 60 * 60 * 1000
        );
        if (this.installPromptDismissedRecently) {
            console.log('📱 Install prompt recently dismissed');
        }
        
        // Capture the install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredInstallPrompt = e;
            console.log('📲 PWA install prompt captured');
            this.updateInstallUi();
            
            if (!this.installPromptDismissedRecently) {
                // Show install toast after splash screen
                setTimeout(() => this.showInstallToast(), 2000);
            }
        });
        
        // Track when app is installed
        window.addEventListener('appinstalled', () => {
            console.log('✅ PWA installed successfully!');
            this.deferredInstallPrompt = null;
            this.installPromptDismissedRecently = false;
            localStorage.removeItem('pwa-install-dismissed');
            this.updateInstallUi();
            this.showToast('Fun-da is geïnstalleerd!');
        });

        this.updateInstallUi();
    }

    getManualInstallInstructions() {
        const userAgent = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(userAgent);
        const isAndroid = /Android/.test(userAgent);
        const isEdge = /Edg\//.test(userAgent);
        const isChrome = /Chrome\//.test(userAgent) && !isEdge;

        if (isIOS) {
            return 'Gebruik Safari en kies Deel > Zet op beginscherm.';
        }
        if (isAndroid && (isChrome || isEdge)) {
            return 'Open het browsermenu en kies Installeer app of Toevoegen aan startscherm.';
        }
        if (isChrome || isEdge) {
            return 'Gebruik het install-icoon in de adresbalk of kies Installeer app in het browsermenu.';
        }

        return 'Gebruik de browseroptie Installeer app of Toevoegen aan startscherm.';
    }

    updateInstallUi() {
        const section = document.getElementById('installSection');
        const status = document.getElementById('installStatus');
        const button = document.getElementById('installAppBtn');
        if (!section || !status || !button) return;

        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                            window.navigator.standalone === true;

        if (isStandalone) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');

        if (this.deferredInstallPrompt) {
            status.textContent = 'Fun-da kan op dit apparaat als app worden geïnstalleerd.';
            button.textContent = 'Installeer app';
        } else {
            status.textContent = this.getManualInstallInstructions();
            button.textContent = 'Installatie-hulp';
        }
    }

    async promptInstall() {
        if (this.deferredInstallPrompt) {
            this.deferredInstallPrompt.prompt();
            const { outcome } = await this.deferredInstallPrompt.userChoice;
            console.log('Install prompt outcome:', outcome);
            this.deferredInstallPrompt = null;
            this.updateInstallUi();
            return;
        }

        this.showToast(`${this.getManualInstallInstructions()}`);
    }
    
    showInstallToast() {
        if (!this.deferredInstallPrompt) return;
        
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = 'toast toast-action';
        toast.innerHTML = `
            <span>Installeer Fun-da</span>
            <button class="toast-btn" id="installBtn">Installeer</button>
            <button class="toast-dismiss" id="installDismiss">✕</button>
        `;
        container.appendChild(toast);
        
        toast.querySelector('#installBtn').addEventListener('click', async () => {
            await this.promptInstall();
            toast.remove();
        });
        
        toast.querySelector('#installDismiss').addEventListener('click', () => {
            localStorage.setItem('pwa-install-dismissed', Date.now().toString());
            this.installPromptDismissedRecently = true;
            toast.remove();
        });
        
        // Don't auto-remove install toast - user must interact
    }

    loadFromStorage() {
        try {
            const savedFavorites = localStorage.getItem('funda-favorites');
            const savedViewed = localStorage.getItem('funda-viewed');
            const savedIndex = localStorage.getItem('funda-index');
            const savedHouses = localStorage.getItem('funda-houses');

            if (savedFavorites) {
                this.favorites = JSON.parse(savedFavorites);
            }
            if (savedViewed) {
                this.viewed = parseInt(savedViewed, 10);
            }
            if (savedIndex) {
                this.currentIndex = parseInt(savedIndex, 10);
            }
            if (savedHouses) {
                const houses = JSON.parse(savedHouses);
                if (houses.length > 0) {
                    this.houses = houses;
                }
            }
            
            // Load saved favorite meta
            const savedMeta = localStorage.getItem('funda-favorite-meta');
            if (savedMeta) {
                this.favoriteMeta = JSON.parse(savedMeta);
            }

            // Load saved daysBack setting
            const savedDaysBack = localStorage.getItem('funda-days-back');
            if (savedDaysBack) this.daysBack = parseInt(savedDaysBack, 10);

            // Load saved search area
            const savedArea = localStorage.getItem('funda-search-area');
            if (savedArea !== null) {
                this.searchArea = savedArea;
                this._loadedArea = savedArea || null;
                this._loadedDaysBack = this.daysBack;
            }

            const savedViewMode = localStorage.getItem('funda-view-mode');
            if (savedViewMode === 'swipe' || savedViewMode === 'browse') {
                this.currentView = savedViewMode;
            }

            // Load saved browse filters (for users not signed in)
            const savedFilters = localStorage.getItem('funda-browse-filters');
            if (savedFilters) {
                this.browseFilters = { ...this.browseFilters, ...JSON.parse(savedFilters) };
            }
        } catch (e) {
            console.error('Error loading from storage:', e);
        }
    }
    
    saveToStorage() {
        try {
            localStorage.setItem('funda-favorites', JSON.stringify(this.favorites));
            localStorage.setItem('funda-viewed', this.viewed.toString());
            localStorage.setItem('funda-index', this.currentIndex.toString());
            localStorage.setItem('funda-houses', JSON.stringify(this.houses));
            localStorage.setItem('funda-favorite-meta', JSON.stringify(this.favoriteMeta));
            localStorage.setItem('funda-days-back', this.daysBack.toString());
            localStorage.setItem('funda-search-area', this.searchArea || '');
            localStorage.setItem('funda-view-mode', this.currentView);
        } catch (e) {
            console.error('Error saving to storage:', e);
        }
    }

    // ==========================================
    // I18N
    // ==========================================

    /** Look up a translation key for the current language. Supports function values. */
    t(key, ...args) {
        const dict = TRANSLATIONS[this.lang] || TRANSLATIONS.nl;
        const val = dict[key] ?? TRANSLATIONS.nl[key] ?? key;
        if (typeof val === 'function') return val(...args);
        return val;
    }

    setLang(lang) {
        if (lang !== 'nl' && lang !== 'en') return;
        this.lang = lang;
        localStorage.setItem('funda-lang', lang);
        document.documentElement.lang = lang;
        this.applyTranslations();
        if (this.browseOpen) this.renderBrowseGrid();
        this.renderCards();
    }

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const text = this.t(key);
            if (text && text !== key) el.textContent = text;
        });
        const langNl = document.getElementById('langNl');
        const langEn = document.getElementById('langEn');
        if (langNl) langNl.classList.toggle('active', this.lang === 'nl');
        if (langEn) langEn.classList.toggle('active', this.lang === 'en');
    }

    setupEventListeners() {
        document.getElementById('likeBtn').addEventListener('click', () => this.swipe('right'));
        document.getElementById('nopeBtn').addEventListener('click', () => this.swipe('left'));
        document.getElementById('infoBtn').addEventListener('click', () => this.showDetail());
        document.getElementById('resetBtn').addEventListener('click', () => this.reset());

        // Header buttons
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettingsModal());
        document.getElementById('favoritesBtn').addEventListener('click', () => this.openFavorites());
        document.getElementById('familyBtn').addEventListener('click', () => this.openFamilyModal());

        // Modal close buttons
        document.getElementById('closeSettingsModal').addEventListener('click', () => this.closeSettingsModal());
        document.getElementById('closeFavModal').addEventListener('click', () => this.closeModal(this.favoritesModal));
        document.getElementById('closeDetailModal').addEventListener('click', () => this.closeModal(this.detailModal));
        document.getElementById('closeFamilyModal').addEventListener('click', () => this.closeModal(this.familyModal));

        // Settings: clear data
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearAllData());
        document.getElementById('installAppBtn')?.addEventListener('click', () => this.promptInstall());
        document.getElementById('settingsViewBrowse')?.addEventListener('click', () => {
            this.openBrowseView();
            this.saveSettingsToFirebase();
        });
        document.getElementById('settingsViewSwipe')?.addEventListener('click', () => {
            this.openSwipeView();
            this.saveSettingsToFirebase();
        });

        // Settings: Google login / logout
        document.getElementById('googleLoginBtn').addEventListener('click', () => this.loginWithGoogle());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // Settings: language toggle
        document.getElementById('langNl')?.addEventListener('click', () => this.setLang('nl'));
        document.getElementById('langEn')?.addEventListener('click', () => this.setLang('en'));

        // Family controls
        document.getElementById('createFamilyBtn').addEventListener('click', () => this.createFamily());
        document.getElementById('joinFamilyBtn').addEventListener('click', () => this.joinFamily());
        document.getElementById('leaveFamilyBtn').addEventListener('click', () => this.leaveFamily());
        document.getElementById('copyFamilyCode').addEventListener('click', () => this.copyFamilyCode());
        document.getElementById('showQRCode')?.addEventListener('click', () => this.showQRCode());
        document.getElementById('scanQRBtn').addEventListener('click', () => this.startQRScanner());
        document.getElementById('closeQRModal').addEventListener('click', () => this.closeModal(document.getElementById('qrModal')));
        document.getElementById('closeQRScannerModal').addEventListener('click', () => this.stopQRScanner());
        document.getElementById('closeMapModal').addEventListener('click', () => this.closeMapModal());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Close modals on backdrop click
        [this.settingsModal, this.favoritesModal, this.detailModal, this.familyModal].forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal);
            });
        });
        this.mapModal.addEventListener('click', (e) => {
            if (e.target === this.mapModal) this.closeMapModal();
        });

        // Logo click - easter egg
        document.querySelector('.logo').addEventListener('click', () => {
            this.showToast('Fun-da - Huizenjacht was nog nooit zo leuk!');
        });

        // Online / offline indicator
        window.addEventListener('offline', () => {
            document.getElementById('offlineBanner').classList.remove('hidden');
        });
        window.addEventListener('online', () => {
            document.getElementById('offlineBanner').classList.add('hidden');
            this.showToast('Internetverbinding hersteld');
        });
        // Show banner immediately if already offline on load
        if (!navigator.onLine) {
            document.getElementById('offlineBanner').classList.remove('hidden');
        }

        // Replace inline img.onerror handlers so image fallback still works under CSP.
        document.addEventListener('error', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLImageElement)) return;
            if (target.dataset.fallbackApplied === 'true') return;
            target.dataset.fallbackApplied = 'true';
            target.src = PLACEHOLDER_IMAGE;
        }, true);

        // Delegated click handler for dynamic elements.
        // Replaces inline onclick attributes, which are blocked by a strict CSP.
        document.body.addEventListener('click', (e) => {
            // Toggle btn-option within its parent btn-group (single-select toggle)
            const optBtn = e.target.closest('.btn-option');
            if (optBtn) {
                const group = optBtn.closest('.btn-group');
                if (group) {
                    const wasActive = optBtn.classList.contains('active');
                    group.querySelectorAll('.btn-option').forEach(b => b.classList.remove('active'));
                    if (!wasActive) optBtn.classList.add('active');
                    return;
                }
            }

            const target = e.target.closest('[data-action]');
            if (!target) return;
            const { action, id } = target.dataset;
            switch (action) {
                case 'showFavoriteDetail':     this.showFavoriteDetail(id); break;
                case 'removeFavorite':          e.stopPropagation(); this.removeFromFavorites(id); break;
                case 'showMatchDetail':         this.showMatchDetail(id); break;
                case 'removeFavoriteAndClose':  this.removeFromFavorites(id); this.closeModal(this.detailModal); break;
                case 'showBrowseDetail':        this.showHouseDetail(id); break;
                case 'browseAddFavorite':       e.stopPropagation(); this.browseToggleFavorite(id, target); break;
                case 'switchDetailPhoto': {
                    const idx = parseInt(target.dataset.index, 10);
                    if (!isNaN(idx)) this._switchDetailPhotoByIndex(idx);
                    break;
                }
                case 'detailNavPrev':
                    this._switchDetailPhotoByIndex(this.detailGalleryIndex - 1);
                    break;
                case 'detailNavNext':
                    this._switchDetailPhotoByIndex(this.detailGalleryIndex + 1);
                    break;
                case 'openLightbox': {
                    const startIdx = parseInt(target.dataset.index, 10);
                    this.openLightbox(isNaN(startIdx) ? this.detailGalleryIndex : startIdx);
                    break;
                }
                case 'lightboxPrev':
                    this._lightboxNav(-1); break;
                case 'lightboxNext':
                    this._lightboxNav(1); break;
                case 'closeLightbox':
                    this.closeLightbox(); break;
                case 'closeMediaViewer':
                    this.closeMediaViewer(); break;
                case 'openFloorplan': {
                    const fpIdx = parseInt(target.dataset.index, 10);
                    this.openFloorplanLightbox(isNaN(fpIdx) ? 0 : fpIdx);
                    break;
                }
                case 'openMediaViewer': {
                    const mediaUrl = target.dataset.url;
                    if (mediaUrl) this.openMediaViewer(mediaUrl);
                    break;
                }
                case 'openMapModal':
                    this.openMapModal();
                    break;
                case 'expandDesc': {
                    const desc = target.closest('.detail-section')?.querySelector('.detail-description');
                    if (desc) desc.classList.remove('desc-collapsed');
                    target.remove();
                    break;
                }
                case 'addViewingToCalendar': this.addViewingToCalendar(id); break;
                case 'shareHouse': this.shareHouse(); break;
                case 'excludeNeighborhood': {
                    const neigh = target.dataset.neighborhood;
                    if (neigh) this.excludeNeighborhoodFromDetail(neigh);
                    break;
                }
                case 'hideHouse': {
                    this.hideHouseFromDetail(id);
                    break;
                }
            }
        });

        // Browse view controls
        document.getElementById('browseFilterToggleBtn').addEventListener('click', () => this.openBrowseSidebarPanel());
        document.getElementById('browseRefreshBtn')?.addEventListener('click', () => this.refreshListings());
        document.getElementById('closeBrowseSidebar').addEventListener('click', () => this.closeBrowseSidebarPanel());
        document.getElementById('browseSidebarOverlay').addEventListener('click', () => this.closeBrowseSidebarPanel());
        document.getElementById('browseSortBy').addEventListener('change', (e) => {
            this.browseSort = e.target.value;
            this.renderBrowseGrid();
        });
        document.getElementById('browseLayoutList').addEventListener('click', () => this.setBrowseLayout('list'));
        document.getElementById('browseLayoutGrid').addEventListener('click', () => this.setBrowseLayout('grid'));

        document.getElementById('applyBrowseFilters')?.addEventListener('click', () => this.applyBrowseFilters());
        document.getElementById('resetBrowseFilters')?.addEventListener('click', () => this.resetBrowseFilters());
        document.getElementById('clearBrowseFiltersBtn')?.addEventListener('click', () => {
            if (!this.hasConfiguredSearchArea()) {
                this.openBrowseSidebarPanel();
                return;
            }
            this.resetBrowseFilters();
        });

        // Auto-apply on desktop (sidebar always visible)
        this._setupDesktopAutoApply();

        // Area autocomplete
        this._setupAreaAutocomplete();
        document.getElementById('neighMsTrigger').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('neighMultiselect').classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            const ms = document.getElementById('neighMultiselect');
            if (ms && !ms.contains(e.target)) ms.classList.remove('open');
        });
    }

    // ==========================================
    // FUNDA IMPORT
    // ==========================================

    clearAllData() {
        const btn = document.getElementById('clearDataBtn');
        if (!this._clearDataPending) {
            this._clearDataPending = true;
            if (btn) {
                btn.dataset.origText = btn.textContent;
                btn.textContent = 'Klik nogmaals om te bevestigen';
                btn.style.background = 'var(--danger)';
                btn.style.color = '#fff';
            }
            setTimeout(() => {
                this._clearDataPending = false;
                if (btn) {
                    btn.textContent = btn.dataset.origText || 'Alle data wissen';
                    btn.style.background = '';
                    btn.style.color = '';
                    delete btn.dataset.origText;
                }
            }, 4000);
            return;
        }
        this._clearDataPending = false;
        if (btn) {
            btn.textContent = btn.dataset.origText || 'Alle data wissen';
            btn.style.background = '';
            btn.style.color = '';
            delete btn.dataset.origText;
        }
        {
            // Clear localStorage (keep filters!)
            localStorage.removeItem('funda-favorites');
            localStorage.removeItem('funda-viewed');
            localStorage.removeItem('funda-index');
            localStorage.removeItem('funda-houses');
            // Note: We keep funda-filters so user doesn't have to re-enter them
            
            // Reset app state (keep filters!)
            this.houses = [];
            this.favorites = [];
            this.currentIndex = 0;
            this.viewed = 0;
            // Filters are intentionally kept
            
            // Clear scraper cache
            this.scraper.cache.clear();
            
            // Re-render
            this.renderCards();
            this.updateStats();
            
            this.showToast('Alle data gewist!');
        }
    }

    // ==========================================
    // SETTINGS MODAL
    // ==========================================

    openSettingsModal() {
        this.applyTranslations();
        this.openModal(this.settingsModal);
    }

    closeSettingsModal() {
        this.closeModal(this.settingsModal);
    }

    // ==========================================
    // FIREBASE AUTH
    // ==========================================

    initFirebaseAuth() {
        try {
            if (typeof firebase === 'undefined' || !firebase.auth) return;
            firebase.auth().onAuthStateChanged((user) => this.onAuthStateChanged(user));
        } catch (e) {
            console.error('Firebase Auth init error:', e);
        }
    }

    onAuthStateChanged(user) {
        this.currentUser = user;
        const loggedOutEl = document.getElementById('settingsLoggedOut');
        const loggedInEl = document.getElementById('settingsLoggedIn');
        const headerAvatar = document.getElementById('headerUserAvatar');

        if (user) {
            if (loggedOutEl) loggedOutEl.classList.add('hidden');
            if (loggedInEl) loggedInEl.classList.remove('hidden');
            // Show avatar in header
            if (headerAvatar) {
                if (user.photoURL) {
                    headerAvatar.src = user.photoURL;
                    headerAvatar.classList.remove('hidden');
                } else {
                    headerAvatar.classList.add('hidden');
                }
            }
            // Load settings from Firebase for this user
            this.loadSettingsFromFirebase();
        } else {
            if (loggedOutEl) loggedOutEl.classList.remove('hidden');
            if (loggedInEl) loggedInEl.classList.add('hidden');
            if (headerAvatar) headerAvatar.classList.add('hidden');
        }
    }

    async loginWithGoogle() {
        try {
            if (typeof firebase === 'undefined' || !firebase.auth) {
                this.showToast('❌ Firebase Auth niet beschikbaar');
                return;
            }
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebase.auth().signInWithPopup(provider);
            this.showToast('✅ Ingelogd!');
        } catch (e) {
            console.error('Google login error:', e);
            this.showToast('❌ Inloggen mislukt: ' + (e.message || 'onbekende fout'));
        }
    }

    async logout() {
        try {
            if (typeof firebase !== 'undefined' && firebase.auth) {
                await firebase.auth().signOut();
            }
            this.showToast('Uitgelogd');
        } catch (e) {
            console.error('Logout error:', e);
        }
    }

    async saveSettingsToFirebase() {
        // Always persist to localStorage so non-signed-in users keep their filters
        try {
            localStorage.setItem('funda-browse-filters', JSON.stringify(this.browseFilters));
            localStorage.setItem('funda-search-area', this.searchArea || '');
            localStorage.setItem('funda-view-mode', this.currentView);
            // Save filters per area
            this._saveFiltersForArea(this.searchArea);
        } catch (e) { /* storage full */ }

        if (!this.currentUser) return;
        try {
            const db = firebase.database();
            const uid = this.currentUser.uid;
            await db.ref(`users/${uid}/settings`).set({
                daysBack: this.daysBack,
                searchArea: this.searchArea || '',
                viewMode: this.currentView,
                browseFilters: this.browseFilters
            });
        } catch (e) {
            console.error('Save settings error:', e);
        }
    }

    async loadSettingsFromFirebase() {
        if (!this.currentUser) return;
        try {
            const db = firebase.database();
            const uid = this.currentUser.uid;
            const snap = await db.ref(`users/${uid}/settings`).get();
            if (!snap.exists()) return;
            const data = snap.val();
            if (data.daysBack) {
                this.daysBack = data.daysBack;
                localStorage.setItem('funda-days-back', this.daysBack.toString());
                const sel = document.getElementById('bfDaysBack');
                if (sel) sel.value = String(this.daysBack);
            }
            if (typeof data.searchArea === 'string') {
                this.searchArea = data.searchArea;
                localStorage.setItem('funda-search-area', this.searchArea);
                const inp = document.getElementById('bfSearchArea');
                if (inp) inp.value = this.searchArea;
            }
            if (data.viewMode === 'swipe' || data.viewMode === 'browse') {
                this.currentView = data.viewMode;
                localStorage.setItem('funda-view-mode', this.currentView);
            }
            if (data.browseFilters) {
                this.browseFilters = { ...this.browseFilters, ...data.browseFilters };
                this.restoreBrowseFilterUI();
            }
            this.updateViewModeUi();
            if (!this.elements.app.classList.contains('hidden')) {
                if (this.currentView === 'swipe') this.openSwipeView();
                else this.openBrowseView();
            }
        } catch (e) {
            console.error('Load settings error:', e);
        }
    }

    restoreBrowseFilterUI() {
        const f = this.browseFilters;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        setVal('bfSearchArea', this.searchArea || '');
        setVal('bfDaysBack', this.daysBack || 3);
        setVal('bfMinPrice', f.minPrice || '');
        setVal('bfMaxPrice', f.maxPrice || '');
        setVal('bfMinSize',  f.minSize  || '');
        setVal('bfMaxSize',  f.maxSize  || '');
        setVal('bfMinYear',  f.minYear  || '');
        // Restore days preset buttons
        if (f.minDaysOnMarket) {
            const presets = [14, 30, 60, 90];
            const isPreset = presets.includes(f.minDaysOnMarket);
            document.querySelectorAll('#bfDaysOnMarketGroup .btn-option').forEach(b => {
                b.classList.toggle('active', isPreset && parseInt(b.dataset.value, 10) === f.minDaysOnMarket);
            });
            setVal('bfMinDaysOnMarket', isPreset ? '' : f.minDaysOnMarket);
        } else {
            setVal('bfMinDaysOnMarket', '');
        }
        setVal('bfMaxDaysOnMarket', f.maxDaysOnMarket || '');
        setVal('bfNeighborhood', f.neighborhood || '');
        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
        setChk('bfHasTuin', f.hasTuin);
        setChk('bfHasBalcony', f.hasBalcony);
        setChk('bfHasParking', f.hasParking);
        setChk('bfHasSolar', f.hasSolar);
        setChk('bfIsMonument', f.isMonument);
        setChk('bfIsAuction', f.isAuction);
        setChk('bfIsFixer', f.isFixer);
        if (f.minBedrooms) {
            document.querySelectorAll('#bfBedroomsGroup .btn-option').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.value, 10) === f.minBedrooms);
            });
        }
        if (f.minEnergyLabel) {
            document.querySelectorAll('#bfEnergyGroup .btn-option').forEach(b => {
                b.classList.toggle('active', b.dataset.value === f.minEnergyLabel);
            });
        }
        if (f.propertyType) {
            document.querySelectorAll('#bfPropertyTypeGroup .btn-option').forEach(b => {
                b.classList.toggle('active', b.dataset.value === f.propertyType);
            });
        }
        if (f.minRooms) {
            document.querySelectorAll('#bfRoomsGroup .btn-option').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.value, 10) === f.minRooms);
            });
        }
        this._restoreExcludeNeighCheckboxes();
        this.updateViewModeUi();
    }

    updateViewModeUi() {
        document.getElementById('settingsViewBrowse')?.classList.toggle('active', this.currentView === 'browse');
        document.getElementById('settingsViewSwipe')?.classList.toggle('active', this.currentView === 'swipe');
    }

    updateEmptyStates() {
        const noAreaSelected = !this.hasConfiguredSearchArea() && this.houses.length === 0;
        const emptyTitle = document.getElementById('emptyStateTitle');
        const emptyText = document.getElementById('emptyStateText');
        const emptyButton = document.getElementById('resetBtn');
        const browseText = document.getElementById('browseEmptyText');
        const browseButton = document.getElementById('clearBrowseFiltersBtn');

        if (emptyTitle) {
            emptyTitle.textContent = noAreaSelected ? 'Kies eerst een zoekgebied' : 'Alle huizen bekeken!';
        }
        if (emptyText) {
            emptyText.textContent = noAreaSelected
                ? 'Open filters en kies een stad of regio voordat woningen worden opgehaald.'
                : 'Je hebt alle beschikbare woningen gezien.';
        }
        if (emptyButton) {
            emptyButton.textContent = noAreaSelected ? 'Open filters' : 'Opnieuw beginnen';
        }
        if (browseText) {
            browseText.textContent = noAreaSelected
                ? 'Kies eerst een zoekgebied in de filters voordat woningen worden opgehaald.'
                : 'Geen woningen gevonden met deze filters.';
        }
        if (browseButton) {
            browseButton.textContent = noAreaSelected ? 'Open filters' : 'Wis filters';
        }
    }

    // ==========================================
    // FAMILY SYNC
    // ==========================================

    async createFamily() {
        const nameInput = document.getElementById('familyUserName');
        const name = nameInput.value.trim();

        if (!name) {
            this.showToast('❌ Vul eerst je naam in');
            return;
        }

        try {
            const code = await this.familySync.createFamily(name);
            if (!code) {
                this.showToast('❌ Familie aanmaken mislukt. Probeer het opnieuw.');
                return;
            }
            this.showToast(`Familie aangemaakt! Code: ${code}`);
            this.updateFamilyUI();
        } catch (e) {
            console.error('createFamily error:', e);
            this.showToast('❌ Familie aanmaken mislukt. Controleer je internetverbinding.');
        }
    }

    async joinFamily() {
        const nameInput = document.getElementById('familyUserName');
        const codeInput = document.getElementById('joinFamilyCode');
        const name = nameInput.value.trim();
        const code = codeInput.value.trim();

        if (!name) {
            this.showToast('❌ Vul eerst je naam in');
            return;
        }

        if (!code) {
            this.showToast('❌ Vul de familie code in');
            return;
        }

        try {
            const joined = await this.familySync.joinFamily(code, name);
            if (!joined) {
                this.showToast('❌ Familie niet gevonden. Controleer de code.');
                return;
            }
            this.showToast(`Je bent nu lid van familie ${code}!`);
            this.updateFamilyUI();
        } catch (e) {
            console.error('joinFamily error:', e);
            this.showToast('❌ Familie joinen mislukt. Controleer de code en je internetverbinding.');
        }
    }

    leaveFamily() {
        const btn = document.getElementById('leaveFamilyBtn');
        if (!this._leaveFamilyPending) {
            this._leaveFamilyPending = true;
            if (btn) {
                btn.dataset.origText = btn.textContent;
                btn.textContent = 'Klik nogmaals om te bevestigen';
                btn.style.background = 'var(--danger)';
                btn.style.color = '#fff';
            }
            setTimeout(() => {
                this._leaveFamilyPending = false;
                if (btn) {
                    btn.textContent = btn.dataset.origText || 'Familie verlaten';
                    btn.style.background = '';
                    btn.style.color = '';
                    delete btn.dataset.origText;
                }
            }, 4000);
            return;
        }
        this._leaveFamilyPending = false;
        if (btn) {
            btn.textContent = btn.dataset.origText || 'Familie verlaten';
            btn.style.background = '';
            btn.style.color = '';
            delete btn.dataset.origText;
        }
        {
            this.familySync.leaveFamily();
            this.familyMatches.clear();
            this.showToast('Je hebt de familie verlaten');
            this.updateFamilyUI();
        }
    }

    copyFamilyCode() {
        const code = this.familySync.getFamilyCode();
        if (code) {
            navigator.clipboard.writeText(code).then(() => {
                this.showToast('Code gekopieerd!');
            }).catch(() => {
                this.showToast(`Code: ${code}`);
            });
        }
    }

    showQRCode() {
        const code = this.familySync.getFamilyCode();
        if (!code) {
            this.showToast('Geen familie code gevonden');
            return;
        }
        
        const qrModal = document.getElementById('qrModal');
        const qrDisplay = document.getElementById('qrCodeDisplay');
        
        // Show loading state
        qrDisplay.innerHTML = '<p>QR code laden...</p>';
        
        // Open modal first
        this.openModal(qrModal);
        
        // Generate QR code URL that will be parsed when scanned
        const qrData = `funda-family:${code}`;
        const encoded = encodeURIComponent(qrData);

        const tryLoad = (src, next) => {
            const img = document.createElement('img');
            img.alt = 'QR Code';
            img.style.cssText = 'width:200px;height:200px;display:block;margin:0 auto;';
            img.onload = () => {
                qrDisplay.innerHTML = '';
                qrDisplay.appendChild(img);
            };
            img.onerror = () => {
                if (next) next();
                else qrDisplay.innerHTML = `<p style="text-align:center">QR code kon niet laden.<br><strong>${escapeHtml(code)}</strong></p>`;
            };
            img.src = src;
        };

        tryLoad(
            `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`,
            () => tryLoad(
                `https://quickchart.io/qr?size=200&text=${encoded}`,
                () => {
                    qrDisplay.innerHTML = `<p style="text-align:center;padding:1rem;">Deel deze code:<br><br><strong style="font-size:1.1rem;letter-spacing:0.05em;">${escapeHtml(code)}</strong></p>`;
                }
            )
        );
    }
    
    async startQRScanner() {
        const scannerModal = document.getElementById('qrScannerModal');
        const video = document.getElementById('qrVideo');
        const status = document.getElementById('qrScanStatus');
        
        this.openModal(scannerModal);
        status.textContent = 'Camera starten...';
        
        try {
            // Request camera access
            this.qrStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            
            video.srcObject = this.qrStream;
            await video.play();
            
            status.textContent = 'Richt de camera op de QR code...';
            
            // Start scanning
            this.scanQRCode(video, status);
        } catch (error) {
            console.error('Camera error:', error);
            status.textContent = 'Camera niet beschikbaar. Voer de code handmatig in.';
        }
    }
    
    scanQRCode(video, status) {
        // Create BarcodeDetector once (not per frame)
        const detector = ('BarcodeDetector' in window) 
            ? new BarcodeDetector({ formats: ['qr_code'] }) 
            : null;
        
        const scan = () => {
            if (!this.qrStream) return;
            
            if (detector) {
                detector.detect(video).then(barcodes => {
                    if (barcodes.length > 0) {
                        const data = barcodes[0].rawValue;
                        if (data.startsWith('funda-family:')) {
                            const code = data.replace('funda-family:', '');
                            this.stopQRScanner();
                            document.getElementById('joinFamilyCode').value = code;
                            this.showToast('QR code herkend!');
                            this.joinFamily();
                        }
                    }
                }).catch(() => {});
            }
            
            // Continue scanning
            if (this.qrStream) {
                requestAnimationFrame(scan);
            }
        };
        
        scan();
    }
    
    stopQRScanner() {
        if (this.qrStream) {
            this.qrStream.getTracks().forEach(track => track.stop());
            this.qrStream = null;
        }
        const scannerModal = document.getElementById('qrScannerModal');
        this.closeModal(scannerModal);
    }

    onFamilyUpdate(matches, members) {
        const previousMatchCount = this.familyMatches.size;
        this.familyMatches = matches;

        // Check for new matches
        if (matches.size > previousMatchCount) {
            this.celebrateFamilyMatch();
        }

        this.updateFamilyUI();
        this.updateStats();
        
        // Re-render cards to show match indicators
        this.renderCards();
    }

    updateFamilyUI() {
        const setup = document.getElementById('familySetup');
        const dashboard = document.getElementById('familyDashboard');
        const codeDisplay = document.getElementById('displayFamilyCode');
        const membersList = document.getElementById('familyMembersList');
        const matchesList = document.getElementById('familyMatchesList');
        const noMatches = document.getElementById('noFamilyMatches');

        if (this.familySync.isInFamily()) {
            setup.classList.add('hidden');
            dashboard.classList.remove('hidden');

            // Show family code
            codeDisplay.textContent = this.familySync.getFamilyCode();

            // Render QR code inline so family members can scan directly
            const inlineQR = document.getElementById('inlineQRContainer');
            if (inlineQR) {
                const qrData = encodeURIComponent(`funda-family:${this.familySync.getFamilyCode()}`);
                inlineQR.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${qrData}" class="inline-qr-img" width="180" height="180" alt="QR Code" loading="lazy">`;
            }

            // Show members
            const members = this.familySync.getMembersList();
            membersList.innerHTML = members.map(m => `
                <div class="member-item ${m.isCurrentUser ? 'current-user' : ''}">
                    <div class="member-avatar">${this.getAvatarEmoji(m.name)}</div>
                    <div class="member-info">
                        <div class="member-name">${escapeHtml(m.name)} ${m.isCurrentUser ? '<span class="member-badge">Jij</span>' : ''}</div>
                        <div class="member-stats">${escapeHtml(String(m.favoriteCount))} favorieten</div>
                    </div>
                </div>
            `).join('');

            // Show family matches
            if (this.familyMatches.size > 0) {
                matchesList.classList.remove('hidden');
                noMatches.classList.add('hidden');

                const matchHtml = [];
                for (const [houseId, memberNames] of this.familyMatches) {
                    const house = this.findHouseById(houseId);
                    if (house) {
                        const safeMatchImage = escapeHtml(safeImageUrl(house.image));
                        const safeMatchAddress = escapeHtml(cleanAddress(house.address));
                        matchHtml.push(`
                            <div class="match-item" data-action="showMatchDetail" data-id="${escapeHtml(String(houseId))}">
                                <img class="match-image" src="${safeMatchImage}" alt="${safeMatchAddress}">
                                <div class="match-info">
                                    <div class="match-price">${formatPrice(house.price)}</div>
                                    <div class="match-address">${safeMatchAddress}</div>
                                    <div class="match-members">
                                        ${memberNames.map(n => `<span class="match-member-badge">${escapeHtml(n)}</span>`).join('')}
                                    </div>
                                </div>
                            </div>
                        `);
                    }
                }
                matchesList.innerHTML = matchHtml.join('');
            } else {
                matchesList.classList.add('hidden');
                noMatches.classList.remove('hidden');
            }

            // Update badge
            if (this.familyMatches.size > 0) {
                this.elements.familyMatchCount.textContent = this.familyMatches.size;
                this.elements.familyMatchCount.classList.add('show');
            } else {
                this.elements.familyMatchCount.classList.remove('show');
            }
        } else {
            setup.classList.remove('hidden');
            dashboard.classList.add('hidden');
            this.elements.familyMatchCount.classList.remove('show');
        }
    }

    getAvatarEmoji(name) {
        const emojis = ['👨', '👩', '👦', '👧', '🧑', '👴', '👵', '🐕', '🐱'];
        const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        return emojis[hash % emojis.length];
    }

    findHouseById(houseId) {
        // Check in houses
        let house = this.houses.find(h => h.id == houseId);
        if (house) return house;

        // Check in favorites
        house = this.favorites.find(h => h.id == houseId);
        return house;
    }

    celebrateFamilyMatch() {
        // Show celebration overlay
        const overlay = document.createElement('div');
        overlay.className = 'family-match-celebration';
        overlay.innerHTML = `
            <div class="celebration-content">
                <div class="celebration-emoji">Familie Match!</div>
                <div class="celebration-title">FAMILIE MATCH!</div>
                <div class="celebration-subtitle">Jullie hebben dezelfde woning geliked!</div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        this.triggerConfetti();

        // Remove after animation
        setTimeout(() => {
            overlay.remove();
        }, 3000);

        // Vibrate if supported
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
        }
    }

    openFamilyModal() {
        this.updateFamilyUI();
        this.openModal(this.familyModal);
    }

    showMatchDetail(houseId) {
        const house = this.findHouseById(houseId);
        if (!house) return;

        this.closeModal(this.familyModal);
        
        const memberNames = this.familyMatches.get(houseId) || this.familyMatches.get(parseInt(houseId));
        const safeAddress = escapeHtml(cleanAddress(house.address));
        const safeLocation = escapeHtml(`${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city || ''}`);
        const safeImage = escapeHtml(safeImageUrl(house.image));
        const safeFundaUrl = safeExternalUrl(house.url);
        
        document.getElementById('detailTitle').textContent = 'Familie Match!';
        document.getElementById('detailContent').innerHTML = `
            <div style="background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(78, 205, 196, 0.2)); 
                        padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem; text-align: center;">
                <p style="font-weight: 600; margin-bottom: 0.5rem;">Deze woning is geliked door:</p>
                <div style="display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
                    ${memberNames ? memberNames.map(n => `<span class="match-member-badge">${escapeHtml(n)}</span>`).join('') : ''}
                </div>
            </div>
            
            <img class="detail-image" src="${safeImage}" alt="${safeAddress}">
            
            <div class="detail-section">
                <div class="card-price" style="font-size: 2rem;">${formatPrice(house.price)}</div>
                <div class="card-neighborhood" style="margin-top: 0.5rem;">${safeLocation}</div>
            </div>

            <div class="detail-section">
                <h3>Kenmerken</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">Oppervlakte</div>
                        <div class="detail-item-value">${house.size} m²</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Slaapkamers</div>
                        <div class="detail-item-value">${house.bedrooms}</div>
                    </div>
                </div>
            </div>

            ${safeFundaUrl !== '#' ? `
                <a href="${escapeHtml(safeFundaUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary btn-full" style="display: block; text-align: center; text-decoration: none;">
                    Bekijk op Funda
                </a>
            ` : ''}
        `;

        setTimeout(() => this.openModal(this.detailModal), 300);
    }

    // ==========================================
    // CARD RENDERING
    // ==========================================

    getFilteredHouses() {
        return this.houses.filter(house => {
            const { minPrice, maxPrice, minBedrooms, neighborhood } = this.filters;
            if (minPrice && house.price < minPrice) return false;
            if (maxPrice && house.price > maxPrice) return false;
            if (minBedrooms && house.bedrooms < minBedrooms) return false;
            if (neighborhood && house.neighborhood !== neighborhood) return false;
            return true;
        });
    }

    renderCards() {
        const { cardStack, emptyState } = this.elements;
        cardStack.innerHTML = '';
        this.updateEmptyStates();
        
        const houses = this.getFilteredHouses();
        const remaining = houses.slice(this.currentIndex);

        if (remaining.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        // Render top 3 cards (reversed for z-index stacking)
        const cardsToShow = remaining.slice(0, 3).reverse();
        
        cardsToShow.forEach((house, index) => {
            const isTop = index === cardsToShow.length - 1;
            const card = this.createCard(house, isTop);
            
            // Scale and offset for stack effect
            const depth = cardsToShow.length - 1 - index;
            card.style.transform = `translateY(${depth * 8}px) scale(${1 - depth * 0.05})`;
            card.style.zIndex = index;
            
            cardStack.appendChild(card);
        });
    }

    createCard(house, isTop) {
        const card = document.createElement('div');
        card.className = 'house-card';
        card.dataset.id = house.id;

        const priceLabel = getPriceLabel(house.price);
        const isFamilyMatch = this.familyMatches.has(house.id) || this.familyMatches.has(house.id?.toString());
        const matchMembers = this.familyMatches.get(house.id) || this.familyMatches.get(house.id?.toString());
        const safeAddress = escapeHtml(cleanAddress(house.address));
        const safeNeighborhood = escapeHtml(`${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city || 'Amsterdam'}`);
        const safeEnergyLabel = escapeHtml(house.energyLabel || '');

        // Build image gallery HTML
        // Helper to normalize Funda image URLs (remove size params to compare)
        const normalizeImageUrl = (url) => {
            if (!url) return '';
            // Extract the unique image ID from Funda URLs
            // e.g., "https://cloud.funda.nl/valentina_media/178/869/520_groot.jpg" -> "178/869/520"
            const fundaMatch = url.match(/valentina_media\/(\d+\/\d+\/\d+)/);
            if (fundaMatch) return fundaMatch[1];
            // For other URLs, remove query params and size suffixes
            return url.replace(/[?#].*$/, '').replace(/_(?:klein|middel|groot|xlarge|\d+x\d+)\./i, '.');
        };
        
        // Collect and deduplicate images
        const placeholderImage = PLACEHOLDER_IMAGE;
        let images = house.images && house.images.length > 0 ? [...house.images] : [];
        const mainImage = house.image || images[0] || placeholderImage;
        
        // Add main image if not already present
        if (mainImage && !images.includes(mainImage)) {
            images.unshift(mainImage);
        }
        
        // Deduplicate by normalized URL
        const seenNormalized = new Set();
        images = images.filter(img => {
            const normalized = normalizeImageUrl(img);
            if (seenNormalized.has(normalized)) return false;
            seenNormalized.add(normalized);
            return true;
        });
        
        // If we don't have enough unique images, just show what we have
        // Don't duplicate images to fill slots
        
        let imageGalleryHtml;
        if (images.length >= 4) {
            // Show 4 images in a 2x2 grid
            const img1 = safeImageUrl(images[0] || mainImage);
            const img2 = safeImageUrl(images[1] || mainImage);
            const img3 = safeImageUrl(images[2] || mainImage);
            const img4 = safeImageUrl(images[3] || mainImage);
            
            imageGalleryHtml = `
                <div class="card-image-gallery">
                    <div>
                            <img class="gallery-thumb" src="${escapeHtml(img1)}" alt="${safeAddress}" loading="lazy">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${escapeHtml(img2)}" alt="${safeAddress}" loading="lazy">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${escapeHtml(img3)}" alt="${safeAddress}" loading="lazy">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${escapeHtml(img4)}" alt="${safeAddress}" loading="lazy">
                    </div>
                </div>
            `;
        } else {
            // Fallback to single image
            imageGalleryHtml = `
                 <img class="card-image" src="${escapeHtml(safeImageUrl(mainImage))}" alt="${safeAddress}" loading="lazy">
            `;
        }

        card.innerHTML = `
            ${imageGalleryHtml}
            <div class="card-overlay"></div>
            ${isFamilyMatch ? `
                <div class="card-family-match">
                    ${matchMembers?.length || 0} matches
                </div>
            ` : ''}
            <div class="swipe-indicator like">Ja!</div>
            <div class="swipe-indicator nope">✕ Nee</div>
            <div class="card-content">
                <div class="card-price">${formatPrice(house.price)}</div>
                <div class="card-address">${safeAddress}</div>
                <div class="card-neighborhood">${safeNeighborhood}</div>
                <div class="card-features">
                    <span class="feature">${house.size || '?'}m²</span>
                    <span class="feature">${house.bedrooms || '?'} slpk</span>
                    ${house.yearBuilt ? `<span class="feature">${house.yearBuilt}</span>` : ''}
                    ${house.energyLabel ? `<span class="feature feature-energy" data-label="${safeEnergyLabel}">${safeEnergyLabel}</span>` : ''}
                </div>
                ${(house.hasGarden || house.hasBalcony || house.hasSolarPanels || house.hasHeatPump || house.hasRoofTerrace || house.hasParking) ? `
                <div class="card-icons">
                    ${house.hasGarden ? '<span class="card-icon-tag" title="Tuin">Tuin</span>' : ''}
                    ${house.hasBalcony ? '<span class="card-icon-tag" title="Balkon">Balkon</span>' : ''}
                    ${house.hasRoofTerrace ? '<span class="card-icon-tag" title="Dakterras">Dakterras</span>' : ''}
                    ${house.hasSolarPanels ? '<span class="card-icon-tag" title="Zonnepanelen">Zon</span>' : ''}
                    ${house.hasHeatPump ? '<span class="card-icon-tag" title="Warmtepomp">WP</span>' : ''}
                    ${house.hasParking ? '<span class="card-icon-tag" title="Parkeren">P</span>' : ''}
                </div>` : ''}
            </div>
        `;

        if (isTop) {
            this.setupCardInteraction(card);
        }

        return card;
    }

    setupCardInteraction(card) {
        // Touch events
        card.addEventListener('touchstart', (e) => this.onDragStart(e), { passive: true });
        card.addEventListener('touchmove', (e) => this.onDragMove(e), { passive: false });
        card.addEventListener('touchend', (e) => this.onDragEnd(e));

        // Mouse events (only mousedown on card; move/up are on document, bound once in constructor)
        card.addEventListener('mousedown', (e) => this.onDragStart(e));

        // Double click for details
        card.addEventListener('dblclick', () => this.showDetail());
    }

    onDragStart(e) {
        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        this.touch.isDragging = true;
        this.touch.startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        this.touch.startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        card.style.transition = 'none';
    }

    onDragMove(e) {
        if (!this.touch.isDragging) return;

        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        this.touch.currentX = clientX - this.touch.startX;
        const currentY = clientY - this.touch.startY;

        // Prevent scrolling while swiping horizontally
        if (Math.abs(this.touch.currentX) > Math.abs(currentY) && e.cancelable) {
            e.preventDefault();
        }

        const rotate = this.touch.currentX * 0.1;
        card.style.transform = `translateX(${this.touch.currentX}px) translateY(${currentY * 0.3}px) rotate(${rotate}deg)`;

        // Show indicators
        const likeIndicator = card.querySelector('.swipe-indicator.like');
        const nopeIndicator = card.querySelector('.swipe-indicator.nope');

        const threshold = 50;
        if (this.touch.currentX > threshold) {
            likeIndicator.style.opacity = Math.min((this.touch.currentX - threshold) / 100, 1);
            nopeIndicator.style.opacity = 0;
        } else if (this.touch.currentX < -threshold) {
            nopeIndicator.style.opacity = Math.min((-this.touch.currentX - threshold) / 100, 1);
            likeIndicator.style.opacity = 0;
        } else {
            likeIndicator.style.opacity = 0;
            nopeIndicator.style.opacity = 0;
        }
    }

    onDragEnd(e) {
        if (!this.touch.isDragging) return;
        this.touch.isDragging = false;

        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        const threshold = 100;

        if (this.touch.currentX > threshold) {
            this.swipe('right');
        } else if (this.touch.currentX < -threshold) {
            this.swipe('left');
        } else {
            // Reset card position
            card.classList.add('animating');
            card.style.transform = 'translateX(0) translateY(0) rotate(0deg)';
            
            const likeIndicator = card.querySelector('.swipe-indicator.like');
            const nopeIndicator = card.querySelector('.swipe-indicator.nope');
            likeIndicator.style.opacity = 0;
            nopeIndicator.style.opacity = 0;

            setTimeout(() => {
                card.classList.remove('animating');
            }, 300);
        }

        this.touch.currentX = 0;
    }

    swipe(direction) {
        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        const houses = this.getFilteredHouses();
        const house = houses[this.currentIndex];

        card.classList.add('animating');
        
        if (direction === 'right') {
            card.style.transform = 'translateX(150%) rotate(30deg)';
            this.addToFavorites(house);
        } else {
            card.style.transform = 'translateX(-150%) rotate(-30deg)';
            // Remove from Firebase house pool (discard)
            if (house && this.familySync.isInFamily()) {
                this.familySync.discardHouseInDB(house.id);
            }
        }

        this.viewed++;
        this.currentIndex++;

        setTimeout(() => {
            this.renderCards();
            this.updateStats();
            this.saveToStorage();
        }, 400);
    }

    addToFavorites(house) {
        if (!this.favorites.find(h => h.id === house.id)) {
            this.favorites.push(house);
            
            // Sync to family
            if (this.familySync.isInFamily()) {
                this.familySync.addFavorite(house.id);
                // Immediate local match check (familyMatches is kept up-to-date by realtime listener)
                const matchMembers = this.familyMatches.get(String(house.id));
                if (matchMembers && matchMembers.size > 0) {
                    const names = [...matchMembers.values()].map(m => (typeof m === 'object' ? m.name : m)).filter(Boolean).join(', ');
                    this.showFamilyMatchNotification(house, names);
                }
            }
        }
    }

    showFamilyMatchNotification(house, memberNames) {
        const addr = cleanAddress(house.address) || 'dit huis';
        const banner = document.createElement('div');
        banner.className = 'family-match-banner';
        banner.innerHTML = `
            <div class="fmb-inner">
                <span class="fmb-icon"></span>
                <div class="fmb-text">
                    <strong>Familie match!</strong>
                    <span>${escapeHtml(memberNames)} vond <em>${escapeHtml(addr)}</em> ook leuk!</span>
                </div>
                <button class="fmb-close" aria-label="Sluiten">✕</button>
            </div>`;
        banner.querySelector('.fmb-close').addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 6000);
    }

    saveFavoriteMeta(houseId, meta) {
        this.favoriteMeta[String(houseId)] = { ...meta, updatedAt: Date.now() };
        this.saveToStorage();
        if (this.familySync.isInFamily()) {
            this.familySync.saveFavoriteMetaInDB(houseId, meta);
        }
        this.showToast('✅ Notities opgeslagen');
    }

    addViewingToCalendar(houseId) {
        const house = this.favorites.find(h => String(h.id) === String(houseId)) || this.findHouseById(houseId);
        const viewingDate = document.getElementById('metaViewingDate')?.value || this.favoriteMeta[String(houseId)]?.viewingDate;
        if (!viewingDate) { this.showToast('Vul eerst een bezichtigingsdatum in'); return; }
        const addr = cleanAddress(house?.address || '');
        const dateStr = viewingDate.replace(/-/g, '');
        const locationStr = `${house?.address || ''}, ${house?.postalCode || ''} Amsterdam`;
        const calUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
            '&text=' + encodeURIComponent('Bezichtiging ' + addr) +
            '&dates=' + dateStr + '/' + dateStr +
            '&details=' + encodeURIComponent(locationStr + (house?.url ? '\n' + house.url : '')) +
            '&location=' + encodeURIComponent(locationStr);
        window.open(calUrl, '_blank', 'noopener,noreferrer');
    }

    removeFromFavorites(houseId) {
        console.log('🗑️ Removing favorite:', houseId);
        const beforeCount = this.favorites.length;
        this.favorites = this.favorites.filter(h => String(h.id) !== String(houseId));
        // Clean up meta too
        delete this.favoriteMeta[String(houseId)];
        const afterCount = this.favorites.length;
        console.log(`📊 Favorites: ${beforeCount} -> ${afterCount}`);
        
        this.updateStats();
        this.saveToStorage();
        
        // Sync to family
        if (this.familySync.isInFamily()) {
            this.familySync.removeFavorite(houseId);
        }
        
        // Refresh the favorites list UI
        const list = document.getElementById('favoritesList');
        const noFavorites = document.getElementById('noFavorites');
        
        if (this.favorites.length === 0) {
            list.classList.add('hidden');
            list.innerHTML = '';
            noFavorites.classList.remove('hidden');
        } else {
            // Only refresh list if favorites modal is currently open
            if (this.favoritesModal && !this.favoritesModal.classList.contains('hidden')) {
                this.openFavorites();
            }
        }
    }

    updateStats() {
        const houses = this.getFilteredHouses();
        const remaining = houses.length - this.currentIndex;
        const { housesViewed, housesLeft, matchScore, favCount, familyMatchCount } = this.elements;

        housesViewed.textContent = this.viewed;
        housesLeft.textContent = Math.max(0, remaining);

        // Calculate match score (percentage of likes)
        const score = this.viewed > 0 
            ? Math.round((this.favorites.length / this.viewed) * 100) 
            : 0;
        matchScore.textContent = `${score}%`;

        // Update favorites badge
        favCount.textContent = this.favorites.length;
        favCount.classList.toggle('show', this.favorites.length > 0);

        // Update family match count
        familyMatchCount.textContent = this.familyMatches.size;
        familyMatchCount.classList.toggle('show', this.familyMatches.size > 0);

        this.updateAppBadge();
    }

    updateAppBadge() {
        const count = this.favorites.length + this.familyMatches.size;
        if ('setAppBadge' in navigator) {
            if (count > 0) {
                navigator.setAppBadge(count).catch(() => {});
            } else {
                navigator.clearAppBadge?.().catch(() => {});
            }
        }
    }

    async shareHouse() {
        const house = this._detailHouse;
        if (!house) return;
        const title = cleanAddress(house.address) || 'Woning op Funda';
        const url = house.url || window.location.href;
        const price = house.price ? formatPrice(house.price) + ' · ' : '';
        const size = house.size ? house.size + 'm² · ' : '';
        const beds = house.bedrooms ? house.bedrooms + ' slpk. · ' : '';
        const neigh = house.neighborhood || house.city || '';
        const text = `${price}${size}${beds}${neigh}`.replace(/ · $/, '');
        if (navigator.share) {
            try {
                await navigator.share({ title, text, url });
            } catch (e) {
                if (e.name !== 'AbortError') this.showToast('❌ Delen mislukt');
            }
        } else {
            try {
                await navigator.clipboard.writeText(url);
                this.showToast('Link gekopieerd!');
            } catch {
                this.showToast(`${url}`);
            }
        }
    }

    handleKeydown(e) {
        // Don't handle shortcuts if user is typing in an input/select/textarea
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
            return;
        }

        // Don't handle if modal is open
        const modals = [this.settingsModal, this.favoritesModal, this.detailModal, this.familyModal, this.mapModal];
        const anyModalOpen = modals.some(m => !m.classList.contains('hidden'));
        
        if (anyModalOpen) {
            if (e.key === 'Escape') {
                modals.forEach(m => {
                    if (m === this.mapModal) this.closeMapModal();
                    else if (m === this.settingsModal) this.closeSettingsModal();
                    else this.closeModal(m);
                });
            }
            return;
        }

        switch (e.key) {
            case 'ArrowLeft':
                this.swipe('left');
                break;
            case 'ArrowRight':
                this.swipe('right');
                break;
            case 'ArrowUp':
            case ' ':
                e.preventDefault();
                this.showDetail();
                break;
        }
    }

    showDetail(houseArg = null) {
        const house = houseArg || (() => {
            const houses = this.getFilteredHouses();
            return houses[this.currentIndex];
        })();
        if (!house) return;
        this._detailHouse = house;

        this.detailGalleryImages = house.images?.length > 0 ? house.images : (house.image ? [house.image] : []);
        this.detailGalleryIndex = 0;

        const fact = NEIGHBORHOOD_FACTS[house.neighborhood] || '';
        
        // Build extra details section
        const extraDetails = [];
        if (house.houseType) extraDetails.push(`<span>${escapeHtml(house.houseType)}</span>`);
        else if (house.propertyType) extraDetails.push(`<span>${escapeHtml(house.propertyType)}</span>`);
        if (house.plotArea) extraDetails.push(`<span>${this.t('label.plot')}: ${house.plotArea}m²</span>`);
        if (house.plotSize) extraDetails.push(`<span>${this.t('label.plot')}: ${house.plotSize}m²</span>`);
        if (house.hasGarden) extraDetails.push(`<span>${house.gardenType || this.t('feat.garden')}</span>`);
        if (house.hasBalcony) extraDetails.push(`<span>${this.t('feat.balcony')}</span>`);
        if (house.hasRoofTerrace) extraDetails.push(`<span>${this.t('feat.roofterrace')}</span>`);
        if (house.hasSolarPanels) extraDetails.push(`<span>${this.t('feat.solar')}</span>`);
        if (house.hasHeatPump) extraDetails.push(`<span>${this.t('feat.heatpump')}</span>`);
        if (house.hasParking) extraDetails.push(`<span>${this.t('feat.parking')}</span>`);
        if (house.isMonument) extraDetails.push(`<span>${this.t('feat.monument')}</span>`);
        if (house.isFixerUpper) extraDetails.push(`<span>${this.t('feat.fixer')}</span>`);
        if (house.isAuction) extraDetails.push(`<span>${this.t('feat.auction')}</span>`);
        if (house.parking) extraDetails.push(`<span>${escapeHtml(house.parking)}</span>`);
        if (house.vveCosts) extraDetails.push(`<span>VvE: €${house.vveCosts}/mnd</span>`);
        if (house.status) extraDetails.push(`<span>${escapeHtml(house.status)}</span>`);
        if (house.acceptance) extraDetails.push(`<span>${escapeHtml(house.acceptance)}</span>`);
        
        // Build data source badge
        const sourceBadges = [];
        if (house.enrichedFromMobileAPI) sourceBadges.push('<span class="source-badge source-funda">API ✓</span>');
        else {
            if (house.enrichedFromBag) sourceBadges.push('<span class="source-badge source-bag">BAG ✓</span>');
            if (house.enrichedFromFunda) sourceBadges.push('<span class="source-badge source-funda">Details ✓</span>');
        }

        // Build popularity row
        const popularityHtml = (house.views != null || house.saves != null) ? `
            <div style="display:flex; gap:1rem; font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">
                ${house.views != null ? `<span>${this.t('detail.viewed', house.views)}</span>` : ''}
                ${house.saves != null ? `<span>${this.t('detail.saved', house.saves)}</span>` : ''}
            </div>` : '';

        const safeAddress = escapeHtml(cleanAddress(house.address));
        const safeImage = escapeHtml(safeImageUrl(house.image));
        const safeLocation = escapeHtml(`${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city || ''}`);
        const safeMunicipality = escapeHtml(house.municipality || '');
        const safePricePerM2 = escapeHtml(house.pricePerM2 || '');
        const safeFact = escapeHtml(fact);
        const safeMapsUrl = house.googleMapsUrl
            ? safeExternalUrl(house.googleMapsUrl)
            : (house.latitude && house.longitude ? safeExternalUrl(`https://www.google.com/maps?q=${house.latitude},${house.longitude}`) : '#');

        // Map button (in-app popup)
        this._mapHouse = { latitude: house.latitude, longitude: house.longitude, address: house.address, postalCode: house.postalCode };
        const hasMapData = house.latitude && house.longitude;
        const mapAddressQuery = `${house.address || ''} ${house.postalCode || ''} Amsterdam`.trim();
        const mapsLinkHtml = (hasMapData || mapAddressQuery) ? `
            <button data-action="openMapModal" class="btn-secondary detail-action-btn">
                ${this.t('detail.maps')}
            </button>` : '';

        // Broker & contact section
        const contactUrl = house.contactUrl ? safeExternalUrl(house.contactUrl) : '';
        const brokerHtml = (() => {
            const parts = [];
            // Broker name
            if (house.brokerName) {
                parts.push(`<p style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">${escapeHtml(house.brokerName)}</p>`);
            }
            // Open house badge
            if (house.hasOpenHouse) {
                parts.push(`<p class="open-house-badge">${this.lang === 'en' ? 'Open house scheduled' : 'Open huis gepland'}</p>`);
            }
            // Action buttons
            const btns = [];
            if (contactUrl) {
                btns.push(`<a href="${contactUrl}" target="_blank" rel="noopener" class="btn-primary detail-action-btn">${this.lang === 'en' ? 'Request viewing' : 'Bezichtiging aanvragen'}</a>`);
            }
            if (house.brokerPhone) {
                btns.push(`<a href="tel:${escapeHtml(house.brokerPhone.replace(/\s/g,''))}" class="btn-secondary detail-action-btn">${this.lang === 'en' ? 'Call' : 'Bellen'}</a>`);
            }
            if (house.brokerEmail) {
                btns.push(`<a href="mailto:${escapeHtml(house.brokerEmail)}" class="btn-secondary detail-action-btn">${this.lang === 'en' ? 'Email' : 'E-mail'}</a>`);
            }
            if (house.url && house.url !== '#') {
                btns.push(`<a href="${safeExternalUrl(house.url)}" target="_blank" rel="noopener" class="btn-secondary detail-action-btn">${this.lang === 'en' ? 'View on Funda' : 'Bekijk op Funda'}</a>`);
            }
            if (btns.length > 0) {
                parts.push(`<div class="detail-actions">${btns.join('')}</div>`);
            }
            return parts.length > 0 ? `<div class="detail-section"><h3>${this.lang === 'en' ? 'Contact agent' : 'Contact makelaar'}</h3>${parts.join('')}</div>` : '';
        })();

        // Floorplans section — show as zoomable images in lightbox
        let floorplanHtml = '';
        const allFloorplanImages = [];
        if (house.interactiveFloorplans?.length > 0) {
            house.interactiveFloorplans.forEach(fp => {
                if (fp.thumbnailUrl) allFloorplanImages.push(fp.thumbnailUrl);
            });
        }
        if (house.floorplanUrls?.length > 0) {
            house.floorplanUrls.forEach(u => {
                if (!allFloorplanImages.includes(u)) allFloorplanImages.push(u);
            });
        }
        if (allFloorplanImages.length > 0) {
            const fpItems = allFloorplanImages.map((url, i) => {
                const name = house.interactiveFloorplans?.[i]?.name || `Plattegrond ${i + 1}`;
                return `<div class="media-card">
                    <div class="media-card-link" data-action="openFloorplan" data-index="${i}" style="cursor:pointer">
                        <img src="${escapeHtml(safeImageUrl(url))}" alt="${escapeHtml(name)}" loading="lazy" class="media-card-img">
                        <span class="media-card-label">${escapeHtml(name)}</span>
                    </div>
                </div>`;
            }).join('');
            floorplanHtml = `<div class="detail-section"><h3>${this.t('detail.floorplan')}</h3><div class="media-grid">${fpItems}</div></div>`;
            this._floorplanImages = allFloorplanImages;
        }

        // Video section — opens in-app iframe overlay
        const videoHtml = house.videoItems?.length > 0 ? `
            <div class="detail-section">
                <h3>Video</h3>
                <div class="media-grid">
                    ${house.videoItems.map((v, i) => `
                        <div class="media-card">
                            <div class="media-card-link" data-action="openMediaViewer" data-url="${escapeHtml(v.watchUrl || v.streamUrl)}" data-type="video" style="cursor:pointer">
                                ${v.thumbnailUrl ? `<img src="${escapeHtml(safeImageUrl(v.thumbnailUrl))}" alt="Video" loading="lazy" class="media-card-img">` : '<div class="media-card-placeholder">Video</div>'}
                                <span class="media-card-label">Video</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : '';

        // 360° photos section — opens in-app iframe overlay
        const photos360Html = house.photos360?.length > 0 ? `
            <div class="detail-section">
                <h3>360° Rondleiding</h3>
                <div class="media-grid">
                    ${house.photos360.map(p => `
                        <div class="media-card">
                            <div class="media-card-link" data-action="openMediaViewer" data-url="${escapeHtml(p.embedUrl)}" data-type="360" style="cursor:pointer">
                                ${p.thumbnailUrl ? `<img src="${escapeHtml(safeImageUrl(p.thumbnailUrl))}" alt="${escapeHtml(p.name)}" loading="lazy" class="media-card-img">` : '<div class="media-card-placeholder">360°</div>'}
                                <span class="media-card-label">${escapeHtml(p.name || '360°')}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : '';

        // Description — show only the active language, fall back only when that language is empty
        const descNL = house.description || '';
        const descEN = house.descriptionEN || '';
        const primaryDesc = this.lang === 'en' ? (descEN || descNL) : descNL;
        const descHtml = primaryDesc ? `
            <div class="detail-section">
                <h3>${this.t('detail.desc')}</h3>
                <p class="detail-description${primaryDesc.length > 400 ? ' desc-collapsed' : ''}" style="font-size:0.875rem;line-height:1.5;color:var(--text-secondary);">${escapeHtml(primaryDesc)}</p>
                ${primaryDesc.length > 400 ? `<button class="desc-expand-btn" data-action="expandDesc">▾ ${this.lang === 'en' ? 'Read more' : 'Meer lezen'}</button>` : ''}
            </div>` : '';

        // Kenmerken (characteristics) sections
        const kenmerkHtml = house.kenmerkSections?.length > 0 ? `
            <div class="detail-section">
                <h3>${this.lang === 'en' ? 'Characteristics' : 'Kenmerken'}</h3>
                ${house.kenmerkSections.map(section => `
                    <div class="kenmerk-section">
                        <h4 class="kenmerk-title">${escapeHtml(section.title)}</h4>
                        <table class="kenmerk-table">
                            ${section.items.map(item => `
                                <tr>
                                    <td class="kenmerk-label">${escapeHtml(item.label)}</td>
                                    <td class="kenmerk-value">${escapeHtml(item.value)}</td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>
                `).join('')}
            </div>` : '';

        // Build photo gallery thumbnails
        const hasMultiplePhotos = this.detailGalleryImages.length > 1;
        const galleryThumbsHtml = hasMultiplePhotos ? `
            <div class="detail-thumbs">
                ${house.images.slice(0, 20).map((img, i) => `
                    <img class="detail-thumb${i === 0 ? ' active' : ''}"
                         src="${escapeHtml(safeImageUrl(img))}"
                         data-action="switchDetailPhoto"
                         data-src="${escapeHtml(safeImageUrl(img))}"
                         data-index="${i}"
                         loading="lazy" alt="Foto ${i + 1}">
                `).join('')}
            </div>` : '';

        document.getElementById('detailTitle').textContent = cleanAddress(house.address);
        document.getElementById('detailContent').innerHTML = `
            <div class="detail-layout">
            <div class="detail-gallery-col">
                <div class="detail-gallery">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-prev" data-action="detailNavPrev" aria-label="Vorige foto">&#8249;</button>` : ''}
                    <img id="detailMainImg" class="detail-main-image" src="${safeImage}" alt="${safeAddress}" data-action="openLightbox" data-index="0" style="cursor:zoom-in" title="Vergroot foto">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-next" data-action="detailNavNext" aria-label="Volgende foto">&#8250;</button>` : ''}
                    ${hasMultiplePhotos ? `<button class="detail-lightbox-btn" data-action="openLightbox" data-index="0" aria-label="Volledig scherm">⛶</button>` : ''}
                    ${galleryThumbsHtml}
                </div>
            </div>
            <div class="detail-info-col">
            <div class="detail-section" style="margin-bottom: 0.75rem;">
                <div class="card-price" style="font-size: 1.75rem;">${formatPrice(house.price)}</div>
                ${house.pricePerM2 ? `<div style="font-size:0.8rem;color:var(--text-muted);">${safePricePerM2} per m²</div>` : ''}
                <div class="card-neighborhood" style="margin-top: 0.25rem; font-size: 0.85rem;">${safeLocation}</div>
                ${house.municipality ? `<div style="font-size:0.8rem;color:var(--text-muted);">Gemeente ${safeMunicipality}</div>` : ''}
                ${popularityHtml}
                ${sourceBadges.length > 0 ? `<div style="margin-top:0.4rem;">${sourceBadges.join('')}</div>` : ''}
            </div>

            <div class="detail-section">
                <h3>${this.t('detail.features')}</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">m²</div>
                        <div class="detail-item-value">${house.size || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.beds')}</div>
                        <div class="detail-item-value">${house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.rooms')}</div>
                        <div class="detail-item-value">${house.rooms || house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.yearbuilt')}</div>
                        <div class="detail-item-value">${house.yearBuilt || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.energy')}</div>
                        <div class="detail-item-value">${escapeHtml(house.energyLabel || '?')}</div>
                    </div>
                </div>
                ${extraDetails.length > 0 ? `<div style="margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">${extraDetails.join('')}</div>` : ''}
                ${fact ? `<p style="margin-top:0.75rem;font-style:italic;font-size:0.85rem;color:var(--secondary);">${safeFact}</p>` : ''}
            </div>

            ${descHtml}
            ${kenmerkHtml}
            ${floorplanHtml}
            ${videoHtml}
            ${photos360Html}
            ${brokerHtml}
            ${mapsLinkHtml}

            <div class="detail-actions detail-exclude-section">
                ${house.neighborhood ? `<button class="btn-secondary detail-action-btn detail-action-muted" data-action="excludeNeighborhood" data-neighborhood="${escapeHtml(house.neighborhood)}">${this.lang === 'en' ? 'Exclude' : 'Verberg'} ${escapeHtml(house.neighborhood)}</button>` : ''}
                <button class="btn-secondary detail-action-btn detail-action-danger" data-action="hideHouse" data-id="${escapeHtml(String(house.id))}">${this.lang === 'en' ? 'Hide this house' : 'Verberg dit huis'}</button>
            </div>
            </div>
            </div>
        `;

        this._bindDetailGallerySwipe();
        this.openModal(this.detailModal);
    }

    addToFavoritesAndClose(houseId) {
        const house = this.houses.find(h => String(h.id) === String(houseId)) || this.favorites.find(h => String(h.id) === String(houseId));
        if (house) {
            this.addToFavorites(house);
            this.updateStats();
            this.saveToStorage();
        }
        this.closeModal(this.detailModal);
    }

    openFavorites() {
        const list = document.getElementById('favoritesList');
        const noFavorites = document.getElementById('noFavorites');

        if (this.favorites.length === 0) {
            list.classList.add('hidden');
            noFavorites.classList.remove('hidden');
        } else {
            list.classList.remove('hidden');
            noFavorites.classList.add('hidden');

            list.innerHTML = this.favorites.map(house => {
                const escapedId = escapeHtml(String(house.id));
                const safeImage = escapeHtml(safeImageUrl(house.image));
                const safeAddress = escapeHtml(cleanAddress(house.address));
                const safeFeatures = escapeHtml(`${house.bedrooms || '?'} slpk · ${house.size || '?'}m² · ${house.neighborhood || house.city || ''}`);
                const meta = this.favoriteMeta[String(house.id)] || {};
                const statusLabels = { interested: 'Interessant', viewing: 'Bezichtiging', bid: 'Bod uitgebracht', accepted: 'Geaccepteerd', rejected: 'Afgewezen' };
                const statusBadge = meta.status ? `<span class="fav-meta-badge">${escapeHtml(statusLabels[meta.status] || meta.status)}</span>` : '';
                const deadlineBadge = meta.bidDeadline ? `<span class="fav-meta-badge fav-meta-bid">${escapeHtml(meta.bidDeadline.split('T')[0])}</span>` : '';
                const daysStr = house.daysOnMarket != null ? (house.daysOnMarket === 0 ? ' · Nieuw' : ` · ${house.daysOnMarket}d`) : '';
                return `
                <div class="favorite-item" data-action="showFavoriteDetail" data-id="${escapedId}">
                    <img class="favorite-image" src="${safeImage}" alt="${safeAddress}">
                    <div class="favorite-info">
                        <div class="favorite-price">${formatPrice(house.price)}<span class="fav-days">${daysStr}</span></div>
                        <div class="favorite-address">${safeAddress}</div>
                        <div class="favorite-features">${safeFeatures}</div>
                        ${statusBadge || deadlineBadge ? `<div class="fav-meta-badges">${statusBadge}${deadlineBadge}</div>` : ''}
                    </div>
                    <button class="favorite-remove" data-action="removeFavorite" data-id="${escapedId}">
                        ✕
                    </button>
                </div>
            `}).join('');
        }

        this.openModal(this.favoritesModal);
    }

    showFavoriteDetail(houseId) {
        const house = this.favorites.find(h => String(h.id) === String(houseId));
        if (!house) return;

        this.detailGalleryImages = house.images?.length > 0 ? house.images : (house.image ? [house.image] : []);
        this.detailGalleryIndex = 0;

        this.closeModal(this.favoritesModal);

        const fact = NEIGHBORHOOD_FACTS[house.neighborhood] || '';
        const meta = this.favoriteMeta[String(houseId)] || {};

        // Extra features
        const extraDetails = [];
        if (house.houseType) extraDetails.push(`<span>${escapeHtml(house.houseType)}</span>`);
        else if (house.propertyType) extraDetails.push(`<span>${escapeHtml(house.propertyType)}</span>`);
        if (house.plotArea || house.plotSize) extraDetails.push(`<span>${this.t('label.plot')}: ${house.plotArea || house.plotSize}m²</span>`);
        if (house.hasGarden) extraDetails.push(`<span>${this.t('feat.garden')}</span>`);
        if (house.hasBalcony) extraDetails.push(`<span>${this.t('feat.balcony')}</span>`);
        if (house.hasRoofTerrace) extraDetails.push(`<span>${this.t('feat.roofterrace')}</span>`);
        if (house.hasSolarPanels) extraDetails.push(`<span>${this.t('feat.solar')}</span>`);
        if (house.hasHeatPump) extraDetails.push(`<span>${this.t('feat.heatpump')}</span>`);
        if (house.hasParking) extraDetails.push(`<span>${this.t('feat.parking')}</span>`);
        if (house.isMonument) extraDetails.push(`<span>${this.t('feat.monument')}</span>`);
        if (house.isFixerUpper) extraDetails.push(`<span>${this.t('feat.fixer')}</span>`);
        if (house.isAuction) extraDetails.push(`<span>${this.t('feat.auction')}</span>`);

        const safeAddress = escapeHtml(cleanAddress(house.address));
        const safeImage = escapeHtml(safeImageUrl(house.image));
        const safeLocation = escapeHtml(`${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city || ''}`);
        const safeFact = escapeHtml(fact);
        const safeMapsUrl = house.googleMapsUrl
            ? safeExternalUrl(house.googleMapsUrl)
            : (house.latitude && house.longitude ? safeExternalUrl(`https://www.google.com/maps?q=${house.latitude},${house.longitude}`) : '#');

        // Map button (in-app popup)
        this._mapHouse = { latitude: house.latitude, longitude: house.longitude, address: house.address, postalCode: house.postalCode };
        const hasMapData = house.latitude && house.longitude;
        const mapAddressQuery = `${house.address || ''} ${house.postalCode || ''} Amsterdam`.trim();
        const mapsLinkHtml = (hasMapData || mapAddressQuery) ? `
            <button data-action="openMapModal" class="btn-secondary detail-action-btn">
                ${this.t('detail.maps')}
            </button>` : '';

        // Broker contact
        const brokerHtml = (house.brokerName || house.brokerPhone) ? `
            <div class="detail-section">
                <h3>${this.t('detail.broker_title')}</h3>
                ${house.brokerName ? `<p style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">${escapeHtml(house.brokerName)}</p>` : ''}
                ${house.brokerPhone ? `<a href="tel:${escapeHtml(house.brokerPhone.replace(/\s/g,''))}" class="btn-secondary detail-action-btn">${escapeHtml(house.brokerPhone)}</a>` : ''}
                ${house.brokerEmail ? `<a href="mailto:${escapeHtml(house.brokerEmail)}" class="btn-secondary detail-action-btn">${this.t('detail.email')}</a>` : ''}
            </div>` : '';

        // Photo gallery
        const hasMultiplePhotos = this.detailGalleryImages.length > 1;
        const galleryThumbsHtml = hasMultiplePhotos ? `
            <div class="detail-thumbs">
                ${house.images.slice(0, 20).map((img, i) => `
                    <img class="detail-thumb${i === 0 ? ' active' : ''}"
                         src="${escapeHtml(safeImageUrl(img))}"
                         data-action="switchDetailPhoto"
                         data-src="${escapeHtml(safeImageUrl(img))}"
                         data-index="${i}"
                         loading="lazy" alt="Foto ${i + 1}">
                `).join('')}
            </div>` : '';

        // Bid status options
        const statusOptions = [
            { key: 'interested', label: 'Interessant' },
            { key: 'viewing', label: 'Bezichtiging' },
            { key: 'bid', label: 'Bod' },
            { key: 'accepted', label: 'Geaccepteerd' },
            { key: 'rejected', label: 'Afgewezen' },
        ];

        document.getElementById('detailTitle').textContent = cleanAddress(house.address);
        document.getElementById('detailContent').innerHTML = `
            <div class="detail-layout">
            <div class="detail-gallery-col">
                <div class="detail-gallery">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-prev" data-action="detailNavPrev" aria-label="Vorige foto">&#8249;</button>` : ''}
                    <img id="detailMainImg" class="detail-main-image" src="${safeImage}" alt="${safeAddress}" data-action="openLightbox" data-index="0" style="cursor:zoom-in" title="Vergroot foto">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-next" data-action="detailNavNext" aria-label="Volgende foto">&#8250;</button>` : ''}
                    ${hasMultiplePhotos ? `<button class="detail-lightbox-btn" data-action="openLightbox" data-index="0" aria-label="Volledig scherm">⛶</button>` : ''}
                    ${galleryThumbsHtml}
                </div>
            </div>
            <div class="detail-info-col">
            <div class="detail-section" style="margin-bottom: 0.75rem;">
                <div class="card-price" style="font-size: 1.75rem;">${formatPrice(house.price)}</div>
                <div class="card-neighborhood" style="margin-top: 0.25rem; font-size: 0.85rem;">${safeLocation}</div>
                ${fact ? `<p style="margin-top:0.5rem;font-style:italic;font-size:0.85rem;color:var(--secondary);">${safeFact}</p>` : ''}
            </div>

            <div class="detail-section">
                <h3>${this.t('detail.features')}</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">m²</div>
                        <div class="detail-item-value">${house.size || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.beds')}</div>
                        <div class="detail-item-value">${house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.yearbuilt')}</div>
                        <div class="detail-item-value">${house.yearBuilt || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">${this.t('detail.energy')}</div>
                        <div class="detail-item-value">${escapeHtml(house.energyLabel || '?')}</div>
                    </div>
                </div>
                ${extraDetails.length > 0 ? `<div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem;font-size:0.85rem;color:var(--text-muted);">${extraDetails.join('')}</div>` : ''}
            </div>

            ${house.description ? `
                <div class="detail-section">
                    <h3>${this.t('detail.desc_alt')}</h3>
                    <p class="detail-description${house.description.length > 400 ? ' desc-collapsed' : ''}" style="font-size:0.875rem;line-height:1.5;color:var(--text-secondary);">${escapeHtml(house.description)}</p>
                    ${house.description.length > 400 ? `<button class="desc-expand-btn" data-action="expandDesc">▾ Meer lezen</button>` : ''}
                </div>
            ` : ''}

            <div class="detail-section bid-panel" id="bidPanel" data-house-id="${escapeHtml(String(houseId))}">
                <h3>Notities &amp; Bieding</h3>
                <div class="bid-fields">
                    <div class="bid-field">
                        <label class="bid-label">Status</label>
                        <div class="bid-status-group">
                            ${statusOptions.map(s => `
                                <button class="bid-status-btn${meta.status === s.key ? ' active' : ''}" data-status="${escapeHtml(s.key)}">${escapeHtml(s.label)}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="bid-row">
                        <div class="bid-field">
                            <label class="bid-label" for="metaViewingDate">Bezichtigingsdatum</label>
                            <input type="date" class="bid-input" id="metaViewingDate" value="${escapeHtml(meta.viewingDate || '')}">
                            <button class="btn-secondary btn-full" data-action="addViewingToCalendar" data-id="${escapeHtml(String(houseId))}" style="margin-top:0.3rem;font-size:0.75rem;padding:0.3rem;cursor:pointer;">Agenda</button>
                        </div>
                        <div class="bid-field">
                            <label class="bid-label" for="metaBidDeadline">Bieddeadline makelaar</label>
                            <input type="datetime-local" class="bid-input" id="metaBidDeadline" value="${escapeHtml(meta.bidDeadline || '')}">
                        </div>
                    </div>
                    <div class="bid-field">
                        <label class="bid-label" for="metaNotes">Notities</label>
                        <textarea class="bid-input" id="metaNotes" rows="3" placeholder="Aantekeningen over dit huis...">${escapeHtml(meta.notes || '')}</textarea>
                    </div>
                </div>
                <button class="btn-primary btn-full" id="saveBidMetaBtn" style="margin-top:0.75rem;">Notities opslaan</button>
            </div>

            ${brokerHtml}
            ${mapsLinkHtml}

            <button class="btn-primary btn-full" style="background: var(--danger); margin-top: 0.5rem;" data-action="removeFavoriteAndClose" data-id="${escapeHtml(String(houseId))}">
                Verwijderen uit favorieten
            </button>
            </div>
            </div>
        `;

        // Wire up the bid panel interactions after inserting HTML
        let selectedStatus = meta.status || null;
        const bidPanel = document.getElementById('bidPanel');

        // Status buttons toggle
        bidPanel.querySelectorAll('.bid-status-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bidPanel.querySelectorAll('.bid-status-btn').forEach(b => b.classList.remove('active'));
                if (selectedStatus === btn.dataset.status) {
                    selectedStatus = null; // toggle off
                } else {
                    selectedStatus = btn.dataset.status;
                    btn.classList.add('active');
                }
            });
        });

        // Save button
        document.getElementById('saveBidMetaBtn').addEventListener('click', () => {
            const newMeta = {
                status: selectedStatus || null,
                viewingDate: document.getElementById('metaViewingDate').value || null,
                bidDeadline: document.getElementById('metaBidDeadline').value || null,
                notes: document.getElementById('metaNotes').value.trim() || null,
            };
            this.saveFavoriteMeta(houseId, newMeta);
        });

        this._bindDetailGallerySwipe();
        setTimeout(() => this.openModal(this.detailModal), 300);
    }

    _switchDetailPhotoByIndex(idx) {
        const imgs = this.detailGalleryImages;
        if (!imgs || imgs.length === 0) return;
        this.detailGalleryIndex = ((idx % imgs.length) + imgs.length) % imgs.length;
        const mainImg = document.getElementById('detailMainImg');
        if (mainImg) mainImg.src = safeImageUrl(imgs[this.detailGalleryIndex]);
        document.querySelectorAll('#detailContent .detail-thumb').forEach((t, i) => {
            t.classList.toggle('active', i === this.detailGalleryIndex);
            if (i === this.detailGalleryIndex) {
                t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        });
    }

    _bindDetailGallerySwipe() {
        const gallery = document.querySelector('#detailContent .detail-gallery');
        if (!gallery) return;
        let startX = 0;
        gallery.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
        gallery.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 40) {
                if (dx < 0) this._switchDetailPhotoByIndex(this.detailGalleryIndex + 1);
                else        this._switchDetailPhotoByIndex(this.detailGalleryIndex - 1);
            }
        });
    }

    openLightbox(startIndex = 0) {
        const imgs = this.detailGalleryImages;
        if (!imgs || imgs.length === 0) return;

        this.lightboxIndex = ((startIndex % imgs.length) + imgs.length) % imgs.length;

        // Remove any stale instance
        document.getElementById('lightboxOverlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lightboxOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <button class="lb-close" data-action="closeLightbox" aria-label="Sluiten">✕</button>
            <button class="lb-nav lb-prev" data-action="lightboxPrev" aria-label="Vorige">&#8249;</button>
            <div class="lb-img-wrap">
                <img class="lb-img" id="lightboxImg" src="" alt="Foto">
                <div class="lb-counter" id="lightboxCounter"></div>
            </div>
            <button class="lb-nav lb-next" data-action="lightboxNext" aria-label="Volgende">&#8250;</button>`;

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeLightbox();
        });

        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        this._updateLightboxImage();

        // Keyboard nav while lightbox is open
        this._lightboxKeyHandler = (e) => {
            if (e.key === 'Escape') this.closeLightbox();
            else if (e.key === 'ArrowLeft') this._lightboxNav(-1);
            else if (e.key === 'ArrowRight') this._lightboxNav(1);
        };
        document.addEventListener('keydown', this._lightboxKeyHandler);

        // Touch / swipe support
        let lbSwipeStartX = 0;
        let lbSwipeStartY = 0;
        overlay.addEventListener('touchstart', (e) => {
            lbSwipeStartX = e.touches[0].clientX;
            lbSwipeStartY = e.touches[0].clientY;
        }, { passive: true });
        overlay.addEventListener('touchend', (e) => {
            const img = document.getElementById('lightboxImg');
            if (img && img.classList.contains('zoomed')) return; // Don't swipe when zoomed
            const dx = e.changedTouches[0].clientX - lbSwipeStartX;
            const dy = e.changedTouches[0].clientY - lbSwipeStartY;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                dx < 0 ? this._lightboxNav(1) : this._lightboxNav(-1);
            }
        });

        // Double-tap or click to zoom
        const imgEl = document.getElementById('lightboxImg');
        if (imgEl) {
            imgEl.addEventListener('click', () => {
                imgEl.classList.toggle('zoomed');
                // Scroll to center when zooming in
                if (imgEl.classList.contains('zoomed')) {
                    const wrap = imgEl.closest('.lb-img-wrap');
                    if (wrap) {
                        setTimeout(() => {
                            wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
                            wrap.scrollTop = (wrap.scrollHeight - wrap.clientHeight) / 2;
                        }, 50);
                    }
                }
            });
        }
    }

    _updateLightboxImage() {
        const imgs = this.detailGalleryImages;
        const img = document.getElementById('lightboxImg');
        const counter = document.getElementById('lightboxCounter');
        if (img) {
            img.src = safeImageUrl(imgs[this.lightboxIndex]);
            img.classList.remove('zoomed'); // Reset zoom on nav
        }
        if (counter) counter.textContent = `${this.lightboxIndex + 1} / ${imgs.length}`;
        // Hide nav buttons if only one image
        document.querySelectorAll('#lightboxOverlay .lb-nav').forEach(btn => {
            btn.style.display = imgs.length > 1 ? '' : 'none';
        });
    }

    _lightboxNav(dir) {
        const imgs = this.detailGalleryImages;
        if (!imgs || imgs.length === 0) return;
        this.lightboxIndex = ((this.lightboxIndex + dir + imgs.length) % imgs.length);
        this._updateLightboxImage();
        // Also sync detail gallery
        this._switchDetailPhotoByIndex(this.lightboxIndex);
    }

    closeLightbox() {
        document.getElementById('lightboxOverlay')?.remove();
        document.body.style.overflow = '';
        if (this._lightboxKeyHandler) {
            document.removeEventListener('keydown', this._lightboxKeyHandler);
            this._lightboxKeyHandler = null;
        }
    }

    // Floorplan lightbox — reuses lightbox UI with floorplan images (pinch-zoomable)
    openFloorplanLightbox(startIndex = 0) {
        const imgs = this._floorplanImages;
        if (!imgs || imgs.length === 0) return;
        // Temporarily swap gallery images to floorplans
        const origImages = this.detailGalleryImages;
        this.detailGalleryImages = imgs;
        this.openLightbox(startIndex);
        // Restore original images when lightbox closes
        const origClose = this.closeLightbox.bind(this);
        this.closeLightbox = () => {
            this.detailGalleryImages = origImages;
            this.closeLightbox = origClose;
            origClose();
        };
    }

    // In-app media viewer for video and 360° content
    openMediaViewer(url) {
        document.getElementById('mediaViewerOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'mediaViewerOverlay';
        overlay.className = 'media-viewer-overlay';
        overlay.innerHTML = `
            <div class="media-viewer-topbar">
                <button class="mv-close" data-action="closeMediaViewer" aria-label="Sluiten">✕</button>
            </div>
            <iframe class="media-viewer-iframe" src="${escapeHtml(url)}" allowfullscreen allow="autoplay; fullscreen; xr-spatial-tracking"></iframe>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        this._mediaViewerKeyHandler = (e) => {
            if (e.key === 'Escape') this.closeMediaViewer();
        };
        document.addEventListener('keydown', this._mediaViewerKeyHandler);
    }

    closeMediaViewer() {
        document.getElementById('mediaViewerOverlay')?.remove();
        document.body.style.overflow = '';
        if (this._mediaViewerKeyHandler) {
            document.removeEventListener('keydown', this._mediaViewerKeyHandler);
            this._mediaViewerKeyHandler = null;
        }
    }

    openModal(modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (modal === this.detailModal) {
            this._detailKeyHandler = (e) => {
                if (e.key === 'ArrowLeft')  this._switchDetailPhotoByIndex(this.detailGalleryIndex - 1);
                else if (e.key === 'ArrowRight') this._switchDetailPhotoByIndex(this.detailGalleryIndex + 1);
            };
            document.addEventListener('keydown', this._detailKeyHandler);
        }
    }

    closeModal(modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        // Close lightbox if open when closing detail modal
        this.closeLightbox();
        if (this._detailKeyHandler) {
            document.removeEventListener('keydown', this._detailKeyHandler);
            this._detailKeyHandler = null;
        }
    }

    reset() {
        if (!this.hasConfiguredSearchArea() && this.houses.length === 0) {
            this.openBrowseView();
            this.openBrowseSidebarPanel();
            return;
        }

        this.currentIndex = 0;
        this.viewed = 0;

        // Reshuffle houses so swiping starts fresh
        this.houses = shuffleArray([...this.houses]);

        this.renderCards();
        this.updateStats();
        this.saveToStorage();
    }

    showToast(message) {
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    triggerConfetti() {
        const container = document.getElementById('confetti');
        const colors = ['#FF6B35', '#4ECDC4', '#2ECC71', '#F1C40F', '#E74C3C', '#9B59B6'];

        for (let i = 0; i < 30; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti-piece';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.top = '-10px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = `${Math.random() * 0.5}s`;
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            container.appendChild(confetti);

            setTimeout(() => confetti.remove(), 3000);
        }
    }

    // ==========================================
    // BROWSE VIEW
    // ==========================================

    showHouseDetail(houseId) {
        const house = [...this.houses, ...this.favorites].find(h => String(h.id) === String(houseId));
        if (house) this.showDetail(house);
    }

    openSwipeView() {
        this.browseOpen = false;
        this.currentView = 'swipe';
        localStorage.setItem('funda-view-mode', this.currentView);
        this.updateViewModeUi();
        document.getElementById('swipeView').classList.remove('hidden');
        document.getElementById('swipeActions').classList.remove('hidden');
        document.getElementById('browseView').classList.add('hidden');
        document.querySelector('.stats-bar').classList.remove('hidden');
        this.elements.app.classList.remove('app--browse');
        this.updateEmptyStates();
    }

    openBrowseView() {
        this.browseOpen = true;
        this.currentView = 'browse';
        localStorage.setItem('funda-view-mode', this.currentView);
        this.updateViewModeUi();
        document.getElementById('swipeView').classList.add('hidden');
        document.getElementById('swipeActions').classList.add('hidden');
        document.getElementById('browseView').classList.remove('hidden');
        document.querySelector('.stats-bar').classList.add('hidden');
        this.elements.app.classList.add('app--browse');
        this._populateBrowseNeighborhoods();
        this.updateEmptyStates();
        this.renderBrowseGrid();
    }

    openMapModal() {
        const h = this._mapHouse;
        if (!h) return;
        const query = h.latitude && h.longitude
            ? `${h.latitude},${h.longitude}`
            : encodeURIComponent(`${h.address || ''} ${h.postalCode || ''} Amsterdam`.trim());
        const src = `https://maps.google.com/maps?q=${query}&output=embed&hl=nl`;
        document.getElementById('mapFrame').src = src;
        const title = h.address ? cleanAddress(h.address) : 'Locatie';
        document.getElementById('mapModalTitle').textContent = title;
        this.openModal(this.mapModal);
    }

    closeMapModal() {
        document.getElementById('mapFrame').src = '';
        this.closeModal(this.mapModal);
    }

    excludeNeighborhoodFromDetail(neighborhood) {
        if (!neighborhood) return;
        if (!this.browseFilters.excludedNeighborhoods.includes(neighborhood)) {
            this.browseFilters.excludedNeighborhoods.push(neighborhood);
        }
        this._restoreExcludeNeighCheckboxes();
        this.saveSettingsToFirebase();
        this.closeModal(this.detailModal);
        if (this.browseOpen) this.renderBrowseGrid();
        this.showToast(this.lang === 'en'
            ? `${neighborhood} excluded from results`
            : `${neighborhood} uitgesloten van resultaten`);
    }

    hideHouseFromDetail(houseId) {
        if (!houseId) return;
        // Remove from houses array
        this.houses = this.houses.filter(h => String(h.id) !== String(houseId));
        this.saveToStorage();
        this.closeModal(this.detailModal);
        this.renderCards();
        if (this.browseOpen) this.renderBrowseGrid();
        this.updateStats();
        this.showToast(this.lang === 'en' ? 'House hidden' : 'Woning verborgen');
    }

    refreshListings() {
        if (!this.hasConfiguredSearchArea()) {
            this.openBrowseSidebarPanel();
            return;
        }
        this._loadedArea = null; // Force refetch
        this._loadedDaysBack = null;
        this.houses = [];
        this.currentIndex = 0;
        this.viewed = 0;
        this.autoLoadNewListings();
    }

    openBrowseSidebarPanel() {
        document.getElementById('browseSidebar').classList.add('open');
        document.getElementById('browseSidebarOverlay').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeBrowseSidebarPanel() {
        document.getElementById('browseSidebar').classList.remove('open');
        document.getElementById('browseSidebarOverlay').classList.add('hidden');
        document.body.style.overflow = '';
    }

    setBrowseLayout(layout) {
        this.browseLayout = layout;
        const grid = document.getElementById('browseGrid');
        grid.classList.toggle('browse-layout-list', layout === 'list');
        grid.classList.toggle('browse-layout-grid', layout === 'grid');
        document.getElementById('browseLayoutList').classList.toggle('active', layout === 'list');
        document.getElementById('browseLayoutGrid').classList.toggle('active', layout === 'grid');
    }

    _populateBrowseNeighborhoods() {
        const select = document.getElementById('bfNeighborhood');
        const dropdown = document.getElementById('neighMsDropdown');

        // Clear old options (keep the "Alle buurten" default)
        while (select.options.length > 1) select.remove(1);
        dropdown.innerHTML = '';

        const neighborhoods = [...new Set(
            this.houses.map(h => h.neighborhood || h.city || '').filter(Boolean)
        )].sort();

        // Remove excluded neighborhoods that no longer exist
        this.browseFilters.excludedNeighborhoods = this.browseFilters.excludedNeighborhoods.filter(
            n => neighborhoods.includes(n)
        );

        neighborhoods.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.textContent = n;
            select.appendChild(opt);

            const lbl = document.createElement('label');
            lbl.className = 'neigh-ms-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = n;
            cb.checked = this.browseFilters.excludedNeighborhoods.includes(n);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!this.browseFilters.excludedNeighborhoods.includes(n))
                        this.browseFilters.excludedNeighborhoods.push(n);
                } else {
                    this.browseFilters.excludedNeighborhoods =
                        this.browseFilters.excludedNeighborhoods.filter(x => x !== n);
                }
                this._updateExcludeNeighLabel();
                this.renderBrowseGrid();
            });
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(` ${n}`));
            dropdown.appendChild(lbl);
        });
        this._updateExcludeNeighLabel();
    }

    _updateExcludeNeighLabel() {
        const n = this.browseFilters.excludedNeighborhoods.length;
        const lbl = document.getElementById('neighMsLabel');
        if (lbl) lbl.textContent = n === 0 ? 'Alle buurten' : `${n} buurt${n === 1 ? '' : 'en'} uitgesloten`;
    }

    _restoreExcludeNeighCheckboxes() {
        const dropdown = document.getElementById('neighMsDropdown');
        if (!dropdown) return;
        dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.checked = this.browseFilters.excludedNeighborhoods.includes(cb.value);
        });
        this._updateExcludeNeighLabel();
    }

    // Per-area filter persistence
    _normalizeAreaKey(area) {
        return (area || '').trim().toLowerCase();
    }

    _saveFiltersForArea(area) {
        const key = this._normalizeAreaKey(area);
        if (!key) return;
        try {
            const allAreaFilters = JSON.parse(localStorage.getItem('funda-area-filters') || '{}');
            allAreaFilters[key] = { ...this.browseFilters };
            localStorage.setItem('funda-area-filters', JSON.stringify(allAreaFilters));
        } catch (e) { /* storage full */ }
    }

    _loadFiltersForArea(area) {
        const key = this._normalizeAreaKey(area);
        if (!key) return null;
        try {
            const allAreaFilters = JSON.parse(localStorage.getItem('funda-area-filters') || '{}');
            return allAreaFilters[key] || null;
        } catch (e) { return null; }
    }

    // Energy label ranks: lower = better
    _energyRank(label) {
        const ranks = { 'A+++': 0, 'A++': 1, 'A+': 2, 'A': 3, 'B': 4, 'C': 5, 'D': 6, 'E': 7, 'F': 8, 'G': 9 };
        return ranks[String(label || '').toUpperCase()] ?? 99;
    }

    getBrowseHouses() {
        const f = this.browseFilters;
        let houses = this.houses.filter(house => {
            if (f.minPrice && house.price < f.minPrice) return false;
            if (f.maxPrice && house.price > f.maxPrice) return false;
            if (f.minBedrooms && house.bedrooms < f.minBedrooms) return false;
            if (f.minSize && house.size < f.minSize) return false;
            if (f.maxSize && house.size > f.maxSize) return false;
            if (f.neighborhood && house.neighborhood !== f.neighborhood && house.city !== f.neighborhood) return false;
            if (f.minYear && house.yearBuilt && house.yearBuilt < f.minYear) return false;
            if (f.minEnergyLabel) {
                const maxRank = this._energyRank(f.minEnergyLabel);
                if (this._energyRank(house.energyLabel) > maxRank) return false;
            }
            if (f.hasTuin && !house.hasGarden) return false;
            if (f.hasBalcony && !house.hasBalcony && !house.hasRoofTerrace) return false;
            if (f.hasParking && !house.hasParking) return false;
            if (f.hasSolar && !house.hasSolarPanels) return false;
            if (f.excludedNeighborhoods && f.excludedNeighborhoods.length > 0) {
                const neigh = house.neighborhood || house.city || '';
                if (f.excludedNeighborhoods.includes(neigh)) return false;
            }
            if (f.minDaysOnMarket && (house.daysOnMarket || 0) < f.minDaysOnMarket) return false;
            if (f.maxDaysOnMarket && house.daysOnMarket != null && house.daysOnMarket > f.maxDaysOnMarket) return false;
            if (f.propertyType) {
                const pt = (house.propertyType || house.houseType || '').toLowerCase();
                if (!pt.includes(f.propertyType.toLowerCase())) return false;
            }
            if (f.minRooms && (house.rooms || house.bedrooms || 0) < f.minRooms) return false;
            if (f.isMonument && !house.isMonument) return false;
            if (f.isAuction && !house.isAuction) return false;
            if (f.isFixer && !house.isFixerUpper && !house.isFixer) return false;
            return true;
        });

        // Sort
        switch (this.browseSort) {
            case 'price-asc':      houses.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
            case 'price-desc':     houses.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
            case 'size-desc':      houses.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
            case 'bedrooms-desc':  houses.sort((a, b) => (b.bedrooms || 0) - (a.bedrooms || 0)); break;
            case 'newest':         houses.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0)); break;
            case 'oldest':         houses.sort((a, b) => (b.daysOnMarket ?? -1) - (a.daysOnMarket ?? -1)); break;
        }
        return houses;
    }

    applyBrowseFilters() {
        const f = this.browseFilters;

        // Search area: prefer the value set by autocomplete (this.searchArea),
        // only read from input if user cleared the field
        const inputEl = document.getElementById('bfSearchArea');
        const inputRaw = (inputEl?.value || '').trim();
        // If input is empty, user cleared it — reset searchArea
        if (!inputRaw) {
            this.searchArea = '';
        }
        const newArea = this.searchArea || '';
        const daysBackEl = document.getElementById('bfDaysBack');
        const newDaysBack = parseInt(daysBackEl?.value, 10) || 3;

        const needsRefetch = Boolean(newArea) && (
            newArea !== this._loadedArea ||
            newDaysBack !== this._loadedDaysBack ||
            this.houses.length === 0
        );

        // Save current filters for the old area before switching
        if (needsRefetch && this._loadedArea && this._loadedArea !== newArea) {
            this._saveFiltersForArea(this._loadedArea);
        }

        this.searchArea = newArea;
        this.daysBack = newDaysBack;
        console.error('🔍 applyBrowseFilters:', { newArea, newDaysBack, needsRefetch, loadedArea: this._loadedArea });
        localStorage.setItem('funda-search-area', this.searchArea);
        localStorage.setItem('funda-days-back', this.daysBack.toString());

        f.minPrice    = parseInt(document.getElementById('bfMinPrice').value, 10) || null;
        f.maxPrice    = parseInt(document.getElementById('bfMaxPrice').value, 10) || null;
        f.minSize     = parseInt(document.getElementById('bfMinSize').value, 10) || null;
        f.maxSize     = parseInt(document.getElementById('bfMaxSize').value, 10) || null;
        f.minYear     = parseInt(document.getElementById('bfMinYear').value, 10) || null;
        f.neighborhood = document.getElementById('bfNeighborhood').value;

        const activeBedroomBtn = document.querySelector('#bfBedroomsGroup .btn-option.active');
        f.minBedrooms = activeBedroomBtn ? parseInt(activeBedroomBtn.dataset.value, 10) : null;

        const activeEnergyBtn = document.querySelector('#bfEnergyGroup .btn-option.active');
        f.minEnergyLabel = activeEnergyBtn ? activeEnergyBtn.dataset.value : null;

        f.hasTuin    = document.getElementById('bfHasTuin').checked;
        f.hasBalcony = document.getElementById('bfHasBalcony').checked;
        f.hasParking = document.getElementById('bfHasParking').checked;
        f.hasSolar   = document.getElementById('bfHasSolar').checked;
        f.isMonument = document.getElementById('bfIsMonument').checked;
        f.isAuction  = document.getElementById('bfIsAuction').checked;
        f.isFixer    = document.getElementById('bfIsFixer').checked;
        // Min days: prefer preset button, fall back to typed value
        const activeDaysBtn = document.querySelector('#bfDaysOnMarketGroup .btn-option.active');
        const typedDays = parseInt(document.getElementById('bfMinDaysOnMarket').value, 10) || null;
        f.minDaysOnMarket = activeDaysBtn ? parseInt(activeDaysBtn.dataset.value, 10) : typedDays;
        // Keep the text input in sync when a preset is active
        if (activeDaysBtn) document.getElementById('bfMinDaysOnMarket').value = '';
        f.maxDaysOnMarket = parseInt(document.getElementById('bfMaxDaysOnMarket').value, 10) || null;

        const activePropTypeBtn = document.querySelector('#bfPropertyTypeGroup .btn-option.active');
        f.propertyType = activePropTypeBtn ? activePropTypeBtn.dataset.value : null;

        const activeRoomsBtn = document.querySelector('#bfRoomsGroup .btn-option.active');
        f.minRooms = activeRoomsBtn ? parseInt(activeRoomsBtn.dataset.value, 10) : null;

        this.closeBrowseSidebarPanel();
        this._syncTypePills(f.propertyType);
        this.saveSettingsToFirebase();
        this.updateEmptyStates();

        if (needsRefetch) {
            // Restore saved filters for the new area (if we've been there before)
            const savedAreaFilters = this._loadFiltersForArea(newArea);
            if (savedAreaFilters && this._loadedArea && this._loadedArea !== newArea) {
                this.browseFilters = { ...this.browseFilters, ...savedAreaFilters };
                this.restoreBrowseFilterUI();
            }
            // Area or period changed — fetch fresh listings
            this._loadedArea = this.searchArea;
            this._loadedDaysBack = this.daysBack;
            this.houses = [];
            this.currentIndex = 0;
            this.viewed = 0;
            if (this.currentView === 'swipe') this.openSwipeView();
            else this.openBrowseView();
            this.autoLoadNewListings();
        } else if (!this.searchArea) {
            this._loadedArea = null;
            this.houses = [];
            this.currentIndex = 0;
            this.viewed = 0;
            this.saveToStorage();
            this.renderCards();
            this.renderBrowseGrid();
            this.updateStats();
        } else {
            this.renderBrowseGrid();
        }
    }

    resetBrowseFilters() {
        this.browseFilters = {
            minPrice: null, maxPrice: null,
            minSize: null, maxSize: null,
            minBedrooms: null, minEnergyLabel: null,
            neighborhood: '', minYear: null,
            hasTuin: false, hasBalcony: false, hasParking: false, hasSolar: false,
            isMonument: false, isAuction: false, isFixer: false,
            excludedNeighborhoods: [],
            minDaysOnMarket: null, maxDaysOnMarket: null,
            propertyType: null, minRooms: null,
        };

        // Reset form controls
        const setField = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
        setField('bfDaysBack', '3');
        ['bfMinPrice','bfMaxPrice','bfMinSize','bfMaxSize','bfMinYear','bfMinDaysOnMarket','bfMaxDaysOnMarket'].forEach(id => setField(id, ''));
        setField('bfNeighborhood', '');
        this._restoreExcludeNeighCheckboxes();
        ['bfHasTuin','bfHasBalcony','bfHasParking','bfHasSolar','bfIsMonument','bfIsAuction','bfIsFixer'].forEach(id => setCheck(id, false));
        document.querySelectorAll('#browseSidebar .btn-option').forEach(b => b.classList.remove('active'));

        this.closeBrowseSidebarPanel();
        this._syncTypePills(null);
        this.renderBrowseGrid();
    }

    _syncTypePills() {
        // Type pills removed from toolbar; no-op
    }

    _debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    // Auto-apply filters on desktop where sidebar is always visible
    _setupDesktopAutoApply() {
        const sidebar = document.getElementById('browseSidebar');
        if (!sidebar) return;
        const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;
        const debouncedApply = this._debounce(() => {
            if (isDesktop()) this.applyBrowseFilters();
        }, 500);

        sidebar.querySelectorAll('input[type=text]:not(#bfSearchArea), input[type=number]').forEach(el => {
            el.addEventListener('input', debouncedApply);
        });
        sidebar.querySelectorAll('select').forEach(el => {
            el.addEventListener('change', () => { if (isDesktop()) this.applyBrowseFilters(); });
        });
        sidebar.querySelectorAll('input[type=checkbox]').forEach(el => {
            el.addEventListener('change', () => { if (isDesktop()) this.applyBrowseFilters(); });
        });
        sidebar.addEventListener('click', (e) => {
            if (e.target.closest('.btn-option') && isDesktop()) {
                setTimeout(() => this.applyBrowseFilters(), 50);
            }
        });
    }

    // Browse loading bar
    showBrowseLoading(text) {
        const el = document.getElementById('browseLoading');
        const fill = document.getElementById('browseLoadingFill');
        const textEl = document.getElementById('browseLoadingText');
        const grid = document.getElementById('browseGrid');
        const empty = document.getElementById('browseEmpty');
        if (el) el.classList.remove('hidden');
        if (fill) { fill.style.width = '0%'; fill.classList.add('indeterminate'); }
        if (textEl) textEl.textContent = text || 'Woningen ophalen...';
        if (grid) grid.classList.add('hidden');
        if (empty) empty.classList.add('hidden');
    }

    updateBrowseLoading(text, pct) {
        const fill = document.getElementById('browseLoadingFill');
        const textEl = document.getElementById('browseLoadingText');
        if (fill && pct != null) { fill.classList.remove('indeterminate'); fill.style.width = `${pct}%`; }
        if (textEl && text) textEl.textContent = text;
    }

    hideBrowseLoading() {
        const el = document.getElementById('browseLoading');
        if (el) el.classList.add('hidden');
    }

    // ------------------------------------------
    // Area autocomplete (PDOK Locatieserver)
    // ------------------------------------------

    _setupAreaAutocomplete() {
        const input = document.getElementById('bfSearchArea');
        const list = document.getElementById('areaSuggestions');
        if (!input || !list) return;

        this._areaActiveIdx = -1;
        const debouncedSearch = this._debounce((q) => this._fetchAreaSuggestions(q), 250);

        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (q.length < 2) {
                list.classList.add('hidden');
                return;
            }
            debouncedSearch(q);
        });

        input.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.area-suggestion');
            if (!items.length || list.classList.contains('hidden')) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._areaActiveIdx = Math.min(this._areaActiveIdx + 1, items.length - 1);
                items.forEach((li, i) => li.classList.toggle('active', i === this._areaActiveIdx));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._areaActiveIdx = Math.max(this._areaActiveIdx - 1, 0);
                items.forEach((li, i) => li.classList.toggle('active', i === this._areaActiveIdx));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this._areaActiveIdx >= 0 && items[this._areaActiveIdx]) {
                    items[this._areaActiveIdx].click();
                }
            } else if (e.key === 'Escape') {
                list.classList.add('hidden');
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#areaAutocomplete')) {
                list.classList.add('hidden');
            }
        });
    }

    async _fetchAreaSuggestions(query) {
        const list = document.getElementById('areaSuggestions');
        if (!list) return;

        try {
            // Search cities, streets, and postcodes
            const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(query)}&fq=type:(gemeente OR woonplaats OR weg OR postcode)&rows=10`;
            const resp = await fetch(url);
            if (!resp.ok) return;
            const data = await resp.json();
            const docs = data?.response?.docs || [];

            if (docs.length === 0) {
                list.classList.add('hidden');
                return;
            }

            // Deduplicate and build suggestions
            const seen = new Set();
            const suggestions = [];
            for (const doc of docs) {
                const name = doc.weergavenaam || '';
                let fundaArea = '';
                let displayName = '';
                let typeLabel = '';

                if (doc.type === 'gemeente') {
                    displayName = doc.gemeentenaam || name;
                    fundaArea = (doc.gemeentenaam || '').toLowerCase();
                    typeLabel = 'Gemeente';
                } else if (doc.type === 'woonplaats') {
                    displayName = doc.woonplaatsnaam || name;
                    fundaArea = (doc.woonplaatsnaam || '').toLowerCase();
                    typeLabel = 'Stad';
                } else if (doc.type === 'weg') {
                    // Street: use postcode prefix (first 4 digits) for Funda search
                    displayName = name;
                    const pc = doc.postcode || '';
                    fundaArea = pc ? pc.substring(0, 4) : (doc.woonplaatsnaam || doc.gemeentenaam || '').toLowerCase();
                    typeLabel = 'Straat';
                } else if (doc.type === 'postcode') {
                    displayName = name;
                    const pc = doc.postcode || '';
                    fundaArea = pc ? pc.substring(0, 4) : '';
                    typeLabel = 'Postcode';
                }

                if (!fundaArea || seen.has(fundaArea + typeLabel)) continue;
                seen.add(fundaArea + typeLabel);
                suggestions.push({ name, displayName, fundaArea, typeLabel });
                if (suggestions.length >= 8) break;
            }

            this._areaActiveIdx = -1;
            list.innerHTML = suggestions.map(s =>
                `<li class="area-suggestion" data-area="${escapeHtml(s.fundaArea)}" data-display="${escapeHtml(s.displayName)}">${escapeHtml(s.name)} <span class="area-type">${s.typeLabel}</span></li>`
            ).join('');

            list.classList.remove('hidden');

            list.querySelectorAll('.area-suggestion').forEach(li => {
                li.addEventListener('click', () => {
                    const input = document.getElementById('bfSearchArea');
                    input.value = li.dataset.display;
                    this.searchArea = li.dataset.area;
                    list.classList.add('hidden');
                    if (window.matchMedia('(min-width: 768px)').matches) {
                        this.applyBrowseFilters();
                    }
                });
            });
        } catch (e) {
            // Silently fail — user can still type manually
        }
    }

    renderBrowseGrid() {
        const houses = this.getBrowseHouses();
        const grid   = document.getElementById('browseGrid');
        const empty  = document.getElementById('browseEmpty');
        const count  = document.getElementById('browseCount');
        this.updateEmptyStates();

        // Active filter badge
        const f = this.browseFilters;
        const activeCount = [
            f.minPrice, f.maxPrice, f.minSize, f.maxSize, f.minBedrooms,
            f.minEnergyLabel, f.neighborhood || null, f.minYear,
            f.hasTuin || null, f.hasBalcony || null, f.hasParking || null, f.hasSolar || null,
            f.isMonument || null, f.isAuction || null, f.isFixer || null,
            f.minDaysOnMarket, f.maxDaysOnMarket,
            f.propertyType, f.minRooms,
            ...(f.excludedNeighborhoods || [])
        ].filter(Boolean).length;
        const badge = document.getElementById('browseFilterBadge');
        if (activeCount > 0) {
            badge.textContent = activeCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        count.textContent = `${houses.length} woning${houses.length !== 1 ? 'en' : ''}`;

        // Keep layout class in sync
        grid.classList.toggle('browse-layout-list', this.browseLayout === 'list');
        grid.classList.toggle('browse-layout-grid', this.browseLayout === 'grid');

        if (houses.length === 0) {
            grid.innerHTML = '';
            grid.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        grid.classList.remove('hidden');
        empty.classList.add('hidden');

        grid.innerHTML = houses.map(house => this._browseTile(house)).join('');
    }

    _browseTile(house) {
        const escapedId  = escapeHtml(String(house.id));
        const safeImage  = escapeHtml(safeImageUrl(house.image));
        const safeAddr   = escapeHtml(cleanAddress(house.address));
        const safeNeigh  = escapeHtml(house.neighborhood || '');
        const safeCity   = escapeHtml(house.city || 'Amsterdam');
        const safePostal = escapeHtml(house.postalCode || '');
        const safeType   = escapeHtml(house.houseType || house.propertyType || '');
        const isFav      = this.favorites.some(f => String(f.id) === String(house.id));
        const favIcon    = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        const favClass   = isFav ? 'bt-fav active' : 'bt-fav';

        // Badges
        const badges = [];
        if (house.isNew || house.daysOnMarket === 0)
            badges.push(`<span class="bt-badge bt-badge-new">${this.t('badge.new')}</span>`);
        if (house.status && /onderhandeling/i.test(house.status))
            badges.push(`<span class="bt-badge bt-badge-nego">${this.t('badge.nego')}</span>`);
        if (house.daysOnMarket >= 90)
            badges.push('<span class="bt-badge bt-badge-stale bt-badge-stale-long" title="Al meer dan 90 dagen te koop">90+ dagen</span>');
        else if (house.daysOnMarket >= 30)
            badges.push(`<span class="bt-badge bt-badge-stale" title="Al ${house.daysOnMarket} dagen te koop">${house.daysOnMarket}d</span>`);

        // Price per m²
        const ppm2 = (house.price && house.size)
            ? `<span class="bt-price-m2">€\u202f${Math.round(house.price / house.size).toLocaleString('nl-NL')}\u00a0/\u00a0m²</span>`
            : '';

        // Energy label (Funda-style colour)
        const energyClass = house.energyLabel
            ? `el-${escapeHtml(house.energyLabel.replace(/[^A-Za-z+]/g, '').toUpperCase())}`
            : '';
        const energyHtml = house.energyLabel
            ? `<span class="energy-label ${energyClass}">${escapeHtml(house.energyLabel)}</span>`
            : '';

        // Spec icons (text-only, single-color)
        const specs = [];
        if (house.size)      specs.push(`<span class="bt-spec">${house.size}\u00a0m²</span>`);
        if (house.plotArea && house.plotArea > house.size)
                             specs.push(`<span class="bt-spec">${house.plotArea}\u00a0m² perceel</span>`);
        if (house.bedrooms)  specs.push(`<span class="bt-spec">${house.bedrooms} slpk</span>`);
        if (house.bathrooms && house.bathrooms > 0)
                             specs.push(`<span class="bt-spec">${house.bathrooms} badk</span>`);
        if (house.yearBuilt) specs.push(`<span class="bt-spec">${house.yearBuilt}</span>`);

        // Feature pills (text-only)
        const feats = [];
        if (house.hasGarden)      feats.push(this.t('feat.garden'));
        if (house.hasBalcony)     feats.push(this.t('feat.balcony'));
        if (house.hasRoofTerrace) feats.push(this.t('feat.roofterrace'));
        if (house.hasParking)     feats.push(this.t('feat.parking'));
        if (house.hasSolarPanels) feats.push(this.t('feat.solar'));
        if (house.hasHeatPump)    feats.push(this.t('feat.heatpump'));
        if (house.isMonument)     feats.push(this.t('feat.monument'));
        if (house.isFixerUpper)   feats.push(this.t('feat.fixer'));
        if (house.isAuction)      feats.push(this.t('feat.auction'));

        // Days on market
        const daysHtml = (house.daysOnMarket != null && house.daysOnMarket > 0)
            ? `<span class="bt-days">${this.t('label.days_ago', house.daysOnMarket)}</span>`
            : '';

        // Photo count
        const photoCount = house.images?.length > 1
            ? `<span class="bt-photo-count">${house.images.length}</span>`
            : '';

        // Location line
        const locParts = [safePostal, safeNeigh || safeCity].filter(Boolean);
        const locHtml = locParts.length ? `<div class="bt-location">${locParts.join('\u00a0·\u00a0')}</div>` : '';

        return `
        <div class="browse-tile" data-action="showBrowseDetail" data-id="${escapedId}">
            <div class="bt-photo">
                <img class="bt-img" src="${safeImage}" alt="${safeAddr}" loading="lazy">
                ${badges.length ? `<div class="bt-badges">${badges.join('')}</div>` : ''}
                ${photoCount ? `<div class="bt-photo-count-wrap">${photoCount}</div>` : ''}
                <button class="${favClass}" data-action="browseAddFavorite" data-id="${escapedId}"
                    title="${isFav ? 'Verwijder favoriet' : 'Voeg toe aan favorieten'}">${favIcon}</button>
            </div>
            <div class="bt-info">
                ${safeType ? `<div class="bt-type">${safeType}</div>` : ''}
                <div class="bt-address">${safeAddr}</div>
                ${locHtml}
                <div class="bt-price-row">
                    <span class="bt-price">${formatPrice(house.price)}</span>
                    ${ppm2}
                </div>
                ${specs.length ? `<div class="bt-specs">${specs.join('')}</div>` : ''}
                ${feats.length ? `<div class="bt-feats">${feats.map(f => `<span class="bt-feat">${f}</span>`).join('')}</div>` : ''}
                <div class="bt-footer">
                    ${energyHtml}
                    ${daysHtml}
                </div>
            </div>
        </div>`;
    }

    browseToggleFavorite(houseId, btn) {
        const house = this.houses.find(h => String(h.id) === String(houseId));
        if (!house) return;
        const isFav = this.favorites.some(f => String(f.id) === String(houseId));
        if (isFav) {
            this.removeFromFavorites(houseId);
            btn.classList.remove('active');
            btn.title = 'Voeg toe aan favorieten';
        } else {
            this.addToFavorites(house);
            btn.classList.add('active');
            btn.title = 'Verwijder favoriet';
        }
        this.updateStats();
        this.saveToStorage();
        btn.blur();
    }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new FunDaApp();
});
