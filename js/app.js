// Fun-da App - De leukste manier om een huis te vinden!
// Features: Funda scraping, Familie sync, Swipe interface

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

        // Browse view state
        this.browseOpen = false;
        this.browseSort = 'default';
        this.browseLayout = 'list';
        this.daysBack = 3; // Configurable days back for auto-load
        this.browseFilters = {
            minPrice: null, maxPrice: null,
            minSize: null, maxSize: null,
            minBedrooms: null,
            minEnergyLabel: null,
            neighborhood: '',
            minYear: null,
            hasTuin: false, hasBalcony: false, hasParking: false, hasSolar: false,
            excludedNeighborhoods: [],
            minDaysOnMarket: null
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
        // Default Funda URL - Nieuw vandaag Amsterdam
        this.defaultFundaUrl = 'https://www.funda.nl/zoeken/koop?selected_area=[%22amsterdam%22]&publication_date=%221%22';
        
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
        
        // Start loading immediately, splash stays visible until done
        setTimeout(() => {
            this.autoLoadNewListings();
        }, 300);

        // Register service worker
        this.registerServiceWorker();
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
            this.openBrowseView();
        }, 200);
    }

    async autoLoadNewListings() {
        console.log('🚀 Auto-loading nieuwe woningen van vandaag...');
        
        try {
            this.updateSplashStatus('Verbinden met Funda...');
            
            // Use the scraper directly for splash screen updates
            const houses = await this.scraper.scrapeAllSources({ 
                area: 'amsterdam', 
                days: String(this.daysBack),
                onProgress: (message, progress) => {
                    this.stopProgressAnimation(); // Stop auto-animation once we have real progress
                    this.updateSplashStatus(message);
                    if (progress) this.updateSplashProgress(progress);
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
                let allHouses = [...houses];
                if (this.familySync.isInFamily()) {
                    try {
                        const firebaseHouses = await this.familySync.loadHousesFromDB();
                        const freshIds = new Set(houses.map(h => String(h.id)));
                        const extraFromFirebase = firebaseHouses.filter(h => !freshIds.has(String(h.id)));
                        allHouses = [...houses, ...extraFromFirebase];
                    } catch (e) { /* ignore if Firebase unavailable */ }
                }

                // Replace all houses with merged data
                this.houses = allHouses;
                this.currentIndex = 0;
                this.viewed = 0;
                
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
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then((registration) => {
                    console.log('🏠 Fun-da SW registered:', registration.scope);
                    
                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.log('🔄 New service worker installing...');
                        
                        newWorker.addEventListener('statechange', () => {
                            // Only show update toast if there's an existing controller
                            // This means it's an update, not a first install
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('🆕 New version available!');
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
                console.log('🔄 New service worker activated, reloading...');
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
            <span>🆕 Nieuwe versie beschikbaar!</span>
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
        
        // Check if user dismissed before
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (dismissed) {
            console.log('📱 Install prompt previously dismissed');
            return;
        }
        
        // Capture the install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredInstallPrompt = e;
            console.log('📲 PWA install prompt captured');
            
            // Show install toast after splash screen
            setTimeout(() => this.showInstallToast(), 2000);
        });
        
        // Track when app is installed
        window.addEventListener('appinstalled', () => {
            console.log('✅ PWA installed successfully!');
            this.deferredInstallPrompt = null;
            this.showToast('🎉 Fun-da is geïnstalleerd!');
        });
    }
    
    showInstallToast() {
        if (!this.deferredInstallPrompt) return;
        
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = 'toast toast-action';
        toast.innerHTML = `
            <span>📲 Installeer Fun-da</span>
            <button class="toast-btn" id="installBtn">Installeer</button>
            <button class="toast-dismiss" id="installDismiss">✕</button>
        `;
        container.appendChild(toast);
        
        toast.querySelector('#installBtn').addEventListener('click', async () => {
            if (this.deferredInstallPrompt) {
                this.deferredInstallPrompt.prompt();
                const { outcome } = await this.deferredInstallPrompt.userChoice;
                console.log('Install prompt outcome:', outcome);
                this.deferredInstallPrompt = null;
            }
            toast.remove();
        });
        
        toast.querySelector('#installDismiss').addEventListener('click', () => {
            localStorage.setItem('pwa-install-dismissed', 'true');
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
        } catch (e) {
            console.error('Error saving to storage:', e);
        }
    }

    setupEventListeners() {
        // Action buttons
        document.getElementById('nopeBtn').addEventListener('click', () => this.swipe('left'));
        document.getElementById('likeBtn').addEventListener('click', () => this.swipe('right'));
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

        // Settings: daysBack
        document.getElementById('settingsDaysBack').addEventListener('change', (e) => {
            this.daysBack = parseInt(e.target.value, 10);
            localStorage.setItem('funda-days-back', this.daysBack.toString());
            this.saveSettingsToFirebase();
        });

        // Settings: clear data
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearAllData());

        // Settings: Google login / logout
        document.getElementById('googleLoginBtn').addEventListener('click', () => this.loginWithGoogle());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

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
            this.showToast('🎉 Fun-da - Huizenjacht was nog nooit zo leuk!');
        });

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
                case 'openMapModal':
                    this.openMapModal();
                    break;
                case 'addViewingToCalendar': this.addViewingToCalendar(id); break;
            }
        });

        // View tab toggle
        document.getElementById('tabSwipe').addEventListener('click', () => this.openSwipeView());
        document.getElementById('tabBrowse').addEventListener('click', () => this.openBrowseView());

        // Browse view controls
        document.getElementById('browseFilterToggleBtn').addEventListener('click', () => this.openBrowseSidebarPanel());
        document.getElementById('closeBrowseSidebar').addEventListener('click', () => this.closeBrowseSidebarPanel());
        document.getElementById('browseSidebarOverlay').addEventListener('click', () => this.closeBrowseSidebarPanel());
        document.getElementById('browseSortBy').addEventListener('change', (e) => {
            this.browseSort = e.target.value;
            this.renderBrowseGrid();
        });
        document.getElementById('browseLayoutList').addEventListener('click', () => this.setBrowseLayout('list'));
        document.getElementById('browseLayoutGrid').addEventListener('click', () => this.setBrowseLayout('grid'));
        document.getElementById('applyBrowseFilters').addEventListener('click', () => this.applyBrowseFilters());
        document.getElementById('resetBrowseFilters').addEventListener('click', () => this.resetBrowseFilters());
        document.getElementById('clearBrowseFiltersBtn').addEventListener('click', () => this.resetBrowseFilters());
        document.getElementById('bfExcludeNeighAdd').addEventListener('change', (e) => {
            this._addExcludedNeighborhood(e.target.value);
        });
    }

    // ==========================================
    // FUNDA IMPORT
    // ==========================================

    clearAllData() {
        if (confirm('Weet je zeker dat je alle data wilt wissen? Dit verwijdert alle opgeslagen huizen en favorieten.')) {
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
            
            this.showToast('🗑️ Alle data gewist!');
        }
    }

    // ==========================================
    // SETTINGS MODAL
    // ==========================================

    openSettingsModal() {
        const sel = document.getElementById('settingsDaysBack');
        if (sel) sel.value = String(this.daysBack);
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
        if (!loggedOutEl || !loggedInEl) return;

        if (user) {
            loggedOutEl.classList.add('hidden');
            loggedInEl.classList.remove('hidden');
            const photo = document.getElementById('settingsUserPhoto');
            if (photo) {
                photo.src = user.photoURL || '';
                photo.style.display = user.photoURL ? '' : 'none';
            }
            const nameEl = document.getElementById('settingsUserName');
            const emailEl = document.getElementById('settingsUserEmail');
            if (nameEl) nameEl.textContent = user.displayName || 'Gebruiker';
            if (emailEl) emailEl.textContent = user.email || '';
            // Load settings from Firebase for this user
            this.loadSettingsFromFirebase();
        } else {
            loggedOutEl.classList.remove('hidden');
            loggedInEl.classList.add('hidden');
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
            this.showToast('👋 Uitgelogd');
        } catch (e) {
            console.error('Logout error:', e);
        }
    }

    async saveSettingsToFirebase() {
        if (!this.currentUser) return;
        try {
            const db = firebase.database();
            const uid = this.currentUser.uid;
            await db.ref(`users/${uid}/settings`).set({
                daysBack: this.daysBack,
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
                const sel = document.getElementById('settingsDaysBack');
                if (sel) sel.value = String(this.daysBack);
            }
            if (data.browseFilters) {
                this.browseFilters = { ...this.browseFilters, ...data.browseFilters };
                this.restoreBrowseFilterUI();
            }
        } catch (e) {
            console.error('Load settings error:', e);
        }
    }

    restoreBrowseFilterUI() {
        const f = this.browseFilters;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        setVal('bfMinPrice', f.minPrice || '');
        setVal('bfMaxPrice', f.maxPrice || '');
        setVal('bfMinSize',  f.minSize  || '');
        setVal('bfMaxSize',  f.maxSize  || '');
        setVal('bfMinYear',  f.minYear  || '');
        setVal('bfMinDaysOnMarket', f.minDaysOnMarket || '');
        setVal('bfNeighborhood', f.neighborhood || '');
        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
        setChk('bfHasTuin', f.hasTuin);
        setChk('bfHasBalcony', f.hasBalcony);
        setChk('bfHasParking', f.hasParking);
        setChk('bfHasSolar', f.hasSolar);
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
            this.showToast(`🎉 Familie aangemaakt! Code: ${code}`);
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
            this.showToast(`👨‍👩‍👧‍👦 Je bent nu lid van familie ${code}!`);
            this.updateFamilyUI();
        } catch (e) {
            console.error('joinFamily error:', e);
            this.showToast('❌ Familie joinen mislukt. Controleer de code en je internetverbinding.');
        }
    }

    leaveFamily() {
        if (confirm('Weet je zeker dat je de familie wilt verlaten?')) {
            this.familySync.leaveFamily();
            this.familyMatches.clear();
            this.showToast('👋 Je hebt de familie verlaten');
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
                        <div class="member-stats">❤️ ${escapeHtml(String(m.favoriteCount))} favorieten</div>
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
                <div class="celebration-emoji">🎉👨‍👩‍👧‍👦🏠</div>
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
        
        document.getElementById('detailTitle').textContent = '🎉 Familie Match!';
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
                    🔗 Bekijk op Funda
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
                    👨‍👩‍👧‍👦 ${matchMembers?.length || 0} matches
                </div>
            ` : ''}
            <div class="swipe-indicator like">❤️ Ja!</div>
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
                    ${house.hasGarden ? '<span title="Tuin">🌿</span>' : ''}
                    ${house.hasBalcony ? '<span title="Balkon">🌅</span>' : ''}
                    ${house.hasRoofTerrace ? '<span title="Dakterras">🏙️</span>' : ''}
                    ${house.hasSolarPanels ? '<span title="Zonnepanelen">☀️</span>' : ''}
                    ${house.hasHeatPump ? '<span title="Warmtepomp">♨️</span>' : ''}
                    ${house.hasParking ? '<span title="Parkeren">🚗</span>' : ''}
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
            }
        }
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
            this.openFavorites(); // Refresh the list
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
    }

    handleKeydown(e) {
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

        this.detailGalleryImages = house.images?.length > 0 ? house.images : (house.image ? [house.image] : []);
        this.detailGalleryIndex = 0;

        const fact = NEIGHBORHOOD_FACTS[house.neighborhood] || '';
        
        // Build extra details section
        const extraDetails = [];
        if (house.houseType) extraDetails.push(`<span>🏠 ${escapeHtml(house.houseType)}</span>`);
        else if (house.propertyType) extraDetails.push(`<span>🏠 ${escapeHtml(house.propertyType)}</span>`);
        if (house.plotArea) extraDetails.push(`<span>🌳 Perceel: ${house.plotArea}m²</span>`);
        if (house.plotSize) extraDetails.push(`<span>🌳 Perceel: ${house.plotSize}m²</span>`);
        if (house.hasGarden) extraDetails.push(`<span>🌿 ${house.gardenType || 'Tuin'}</span>`);
        if (house.hasBalcony) extraDetails.push(`<span>🌅 Balkon</span>`);
        if (house.hasRoofTerrace) extraDetails.push(`<span>🏙️ Dakterras</span>`);
        if (house.hasSolarPanels) extraDetails.push(`<span>☀️ Zonnepanelen</span>`);
        if (house.hasHeatPump) extraDetails.push(`<span>♨️ Warmtepomp</span>`);
        if (house.hasParking) extraDetails.push(`<span>🚗 Parkeren</span>`);
        if (house.isMonument) extraDetails.push(`<span>🏛️ Monument</span>`);
        if (house.isFixerUpper) extraDetails.push(`<span>🔧 Kluswoning</span>`);
        if (house.isAuction) extraDetails.push(`<span>🔨 Veiling</span>`);
        if (house.parking) extraDetails.push(`<span>🚗 ${escapeHtml(house.parking)}</span>`);
        if (house.vveCosts) extraDetails.push(`<span>🏢 VvE: €${house.vveCosts}/mnd</span>`);
        if (house.status) extraDetails.push(`<span>📋 ${escapeHtml(house.status)}</span>`);
        if (house.acceptance) extraDetails.push(`<span>📅 ${escapeHtml(house.acceptance)}</span>`);
        
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
                ${house.views != null ? `<span>👁️ ${house.views} keer bekeken</span>` : ''}
                ${house.saves != null ? `<span>❤️ ${house.saves} keer opgeslagen</span>` : ''}
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
            <button data-action="openMapModal" class="btn-secondary" style="display:block;width:100%;text-align:center;padding:0.6rem;font-size:0.85rem;margin-top:0.5rem;cursor:pointer;">
                🗺️ Bekijk op Maps
            </button>` : '';

        // Broker contact
        const brokerHtml = (house.brokerName || house.brokerPhone) ? `
            <div class="detail-section">
                <h3>🏢 Makelaar</h3>
                ${house.brokerName ? `<p style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">${escapeHtml(house.brokerName)}</p>` : ''}
                ${house.brokerPhone ? `<a href="tel:${escapeHtml(house.brokerPhone.replace(/\s/g,''))}" class="btn-secondary" style="display:inline-block;margin-right:0.5rem;margin-bottom:0.25rem;padding:0.4rem 0.8rem;font-size:0.85rem;">📞 Bel</a>` : ''}
                ${house.brokerEmail ? `<a href="mailto:${escapeHtml(house.brokerEmail)}" class="btn-secondary" style="display:inline-block;padding:0.4rem 0.8rem;font-size:0.85rem;">✉️ Mail</a>` : ''}
            </div>` : '';

        // Floorplan (first one, if available)
        const floorplanHtml = house.floorplanUrls?.length > 0 ? `
            <div class="detail-section">
                <h3>Plattegrond</h3>
                <img src="${escapeHtml(safeImageUrl(house.floorplanUrls[0]))}" alt="Plattegrond" style="width:100%;border-radius:8px;" loading="lazy">
            </div>` : '';

        // Description
        const descHtml = house.description ? `
            <div class="detail-section">
                <h3>Omschrijving</h3>
                <p class="detail-description" style="font-size:0.875rem;line-height:1.5;color:var(--text-secondary);max-height:8rem;overflow:hidden;">${escapeHtml(house.description.substring(0, 500))}${house.description.length > 500 ? '…' : ''}</p>
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
                    <img id="detailMainImg" class="detail-main-image" src="${safeImage}" alt="${safeAddress}">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-next" data-action="detailNavNext" aria-label="Volgende foto">&#8250;</button>` : ''}
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
                <h3>Kenmerken</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">m²</div>
                        <div class="detail-item-value">${house.size || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Slaapk.</div>
                        <div class="detail-item-value">${house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Kamers</div>
                        <div class="detail-item-value">${house.rooms || house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Bouwjaar</div>
                        <div class="detail-item-value">${house.yearBuilt || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Energie</div>
                        <div class="detail-item-value">${escapeHtml(house.energyLabel || '?')}</div>
                    </div>
                </div>
                ${extraDetails.length > 0 ? `<div style="margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">${extraDetails.join('')}</div>` : ''}
                ${fact ? `<p style="margin-top:0.75rem;font-style:italic;font-size:0.85rem;color:var(--secondary);">${safeFact}</p>` : ''}
            </div>

            ${descHtml}
            ${floorplanHtml}
            ${brokerHtml}
            ${mapsLinkHtml}
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
                const statusLabels = { interested: '👀 Interessant', viewing: '📅 Bezichtiging', bid: '💰 Bod uitgebracht', accepted: '✅ Geaccepteerd', rejected: '❌ Afgewezen' };
                const statusBadge = meta.status ? `<span class="fav-meta-badge">${escapeHtml(statusLabels[meta.status] || meta.status)}</span>` : '';
                const deadlineBadge = meta.bidDeadline ? `<span class="fav-meta-badge fav-meta-bid">⏰ ${escapeHtml(meta.bidDeadline.split('T')[0])}</span>` : '';
                const daysStr = house.daysOnMarket != null ? (house.daysOnMarket === 0 ? ' · 🆕' : ` · ${house.daysOnMarket}d`) : '';
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
        if (house.houseType) extraDetails.push(`<span>🏠 ${escapeHtml(house.houseType)}</span>`);
        else if (house.propertyType) extraDetails.push(`<span>🏠 ${escapeHtml(house.propertyType)}</span>`);
        if (house.plotArea || house.plotSize) extraDetails.push(`<span>🌳 Perceel: ${house.plotArea || house.plotSize}m²</span>`);
        if (house.hasGarden) extraDetails.push(`<span>🌿 Tuin</span>`);
        if (house.hasBalcony) extraDetails.push(`<span>🌅 Balkon</span>`);
        if (house.hasRoofTerrace) extraDetails.push(`<span>🏙️ Dakterras</span>`);
        if (house.hasSolarPanels) extraDetails.push(`<span>☀️ Zonnepanelen</span>`);
        if (house.hasHeatPump) extraDetails.push(`<span>♨️ Warmtepomp</span>`);
        if (house.hasParking) extraDetails.push(`<span>🚗 Parkeren</span>`);
        if (house.isMonument) extraDetails.push(`<span>🏛️ Monument</span>`);

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
            <button data-action="openMapModal" class="btn-secondary btn-full" style="display:block;width:100%;text-align:center;margin-bottom:0.5rem;cursor:pointer;">
                🗺️ Bekijk op Maps
            </button>` : '';

        // Broker contact
        const brokerHtml = (house.brokerName || house.brokerPhone) ? `
            <div class="detail-section">
                <h3>🏢 Makelaar</h3>
                ${house.brokerName ? `<p style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">${escapeHtml(house.brokerName)}</p>` : ''}
                ${house.brokerPhone ? `<a href="tel:${escapeHtml(house.brokerPhone.replace(/\s/g,''))}" class="btn-secondary btn-full" style="display:block;text-align:center;margin-bottom:0.25rem;">📞 ${escapeHtml(house.brokerPhone)}</a>` : ''}
                ${house.brokerEmail ? `<a href="mailto:${escapeHtml(house.brokerEmail)}" class="btn-secondary btn-full" style="display:block;text-align:center;">✉️ Stuur e-mail</a>` : ''}
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
            { key: 'interested', label: '👀 Interessant' },
            { key: 'viewing', label: '📅 Bezichtiging' },
            { key: 'bid', label: '💰 Bod' },
            { key: 'accepted', label: '✅ Geaccepteerd' },
            { key: 'rejected', label: '❌ Afgewezen' },
        ];

        document.getElementById('detailTitle').textContent = cleanAddress(house.address);
        document.getElementById('detailContent').innerHTML = `
            <div class="detail-layout">
            <div class="detail-gallery-col">
                <div class="detail-gallery">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-prev" data-action="detailNavPrev" aria-label="Vorige foto">&#8249;</button>` : ''}
                    <img id="detailMainImg" class="detail-main-image" src="${safeImage}" alt="${safeAddress}">
                    ${hasMultiplePhotos ? `<button class="detail-nav-btn detail-nav-next" data-action="detailNavNext" aria-label="Volgende foto">&#8250;</button>` : ''}
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
                <h3>Kenmerken</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">m²</div>
                        <div class="detail-item-value">${house.size || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Slaapk.</div>
                        <div class="detail-item-value">${house.bedrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Bouwjaar</div>
                        <div class="detail-item-value">${house.yearBuilt || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Energie</div>
                        <div class="detail-item-value">${escapeHtml(house.energyLabel || '?')}</div>
                    </div>
                </div>
                ${extraDetails.length > 0 ? `<div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem;font-size:0.85rem;color:var(--text-muted);">${extraDetails.join('')}</div>` : ''}
            </div>

            ${house.description ? `
                <div class="detail-section">
                    <h3>Beschrijving</h3>
                    <p class="detail-description" style="font-size:0.875rem;line-height:1.5;color:var(--text-secondary);max-height:8rem;overflow:hidden;">${escapeHtml(house.description.substring(0, 500))}${house.description.length > 500 ? '…' : ''}</p>
                </div>
            ` : ''}

            <div class="detail-section bid-panel" id="bidPanel" data-house-id="${escapeHtml(String(houseId))}">
                <h3>📋 Notities &amp; Bieding</h3>
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
                            <button class="btn-secondary btn-full" data-action="addViewingToCalendar" data-id="${escapeHtml(String(houseId))}" style="margin-top:0.3rem;font-size:0.75rem;padding:0.3rem;cursor:pointer;">📅 Agenda</button>
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
                <button class="btn-primary btn-full" id="saveBidMetaBtn" style="margin-top:0.75rem;">💾 Notities opslaan</button>
            </div>

            ${brokerHtml}
            ${mapsLinkHtml}

            <button class="btn-primary btn-full" style="background: var(--danger); margin-top: 0.5rem;" data-action="removeFavoriteAndClose" data-id="${escapeHtml(String(houseId))}">
                🗑️ Verwijderen uit favorieten
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
        if (this._detailKeyHandler) {
            document.removeEventListener('keydown', this._detailKeyHandler);
            this._detailKeyHandler = null;
        }
    }

    reset() {
        this.currentIndex = 0;
        this.viewed = 0;
        this.favorites = [];
        this.filters = {
            minPrice: null,
            maxPrice: null,
            minBedrooms: null,
            neighborhood: null
        };

        // Reset filter UI
        document.getElementById('minPrice').value = '';
        document.getElementById('maxPrice').value = '';
        document.getElementById('neighborhood').value = '';
        document.querySelectorAll('.btn-option').forEach(btn => btn.classList.remove('active'));

        // Reshuffle houses
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
        document.getElementById('tabSwipe').classList.add('active');
        document.getElementById('tabBrowse').classList.remove('active');
        document.getElementById('swipeView').classList.remove('hidden');
        document.getElementById('swipeActions').classList.remove('hidden');
        document.getElementById('browseView').classList.add('hidden');
        document.querySelector('.stats-bar').classList.remove('hidden');
        this.elements.app.classList.remove('app--browse');
    }

    openBrowseView() {
        this.browseOpen = true;
        document.getElementById('tabBrowse').classList.add('active');
        document.getElementById('tabSwipe').classList.remove('active');
        document.getElementById('swipeView').classList.add('hidden');
        document.getElementById('swipeActions').classList.add('hidden');
        document.getElementById('browseView').classList.remove('hidden');
        document.querySelector('.stats-bar').classList.add('hidden');
        this.elements.app.classList.add('app--browse');
        this._populateBrowseNeighborhoods();
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
        const excludeSelect = document.getElementById('bfExcludeNeighAdd');
        const existing = new Set(Array.from(select.options).map(o => o.value).filter(Boolean));
        const existingExclude = new Set(Array.from(excludeSelect.options).map(o => o.value).filter(Boolean));
        const neighborhoods = [...new Set(
            this.houses.map(h => h.neighborhood || h.city || '').filter(Boolean)
        )].sort();
        neighborhoods.forEach(n => {
            if (!existing.has(n)) {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                select.appendChild(opt);
            }
            if (!existingExclude.has(n)) {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                excludeSelect.appendChild(opt);
            }
        });
    }

    _addExcludedNeighborhood(name) {
        if (!name) return;
        if (this.browseFilters.excludedNeighborhoods.includes(name)) return;
        this.browseFilters.excludedNeighborhoods.push(name);
        const pills = document.getElementById('excludedNeighPills');
        const pill = document.createElement('span');
        pill.className = 'excl-neigh-pill';
        pill.dataset.name = name;
        pill.innerHTML = `${escapeHtml(name)}<button type="button" aria-label="Verwijder ${escapeHtml(name)}">×</button>`;
        pill.querySelector('button').addEventListener('click', () => {
            this.browseFilters.excludedNeighborhoods = this.browseFilters.excludedNeighborhoods.filter(n => n !== name);
            pill.remove();
        });
        pills.appendChild(pill);
        // Reset exclude select
        document.getElementById('bfExcludeNeighAdd').value = '';
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
            return true;
        });

        // Sort
        switch (this.browseSort) {
            case 'price-asc':      houses.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
            case 'price-desc':     houses.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
            case 'size-desc':      houses.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
            case 'bedrooms-desc':  houses.sort((a, b) => (b.bedrooms || 0) - (a.bedrooms || 0)); break;
            case 'newest':         houses.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0)); break;
        }
        return houses;
    }

    applyBrowseFilters() {
        const f = this.browseFilters;

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
        f.minDaysOnMarket = parseInt(document.getElementById('bfMinDaysOnMarket').value, 10) || null;

        this.closeBrowseSidebarPanel();
        this.renderBrowseGrid();
        this.saveSettingsToFirebase();
    }

    resetBrowseFilters() {
        this.browseFilters = {
            minPrice: null, maxPrice: null,
            minSize: null, maxSize: null,
            minBedrooms: null, minEnergyLabel: null,
            neighborhood: '', minYear: null,
            hasTuin: false, hasBalcony: false, hasParking: false, hasSolar: false,
            excludedNeighborhoods: [],
            minDaysOnMarket: null
        };

        // Reset form controls
        ['bfMinPrice','bfMaxPrice','bfMinSize','bfMaxSize','bfMinYear','bfMinDaysOnMarket'].forEach(id => {
            document.getElementById(id).value = '';
        });
        document.getElementById('bfNeighborhood').value = '';
        document.getElementById('excludedNeighPills').innerHTML = '';
        ['bfHasTuin','bfHasBalcony','bfHasParking','bfHasSolar'].forEach(id => {
            document.getElementById(id).checked = false;
        });
        document.querySelectorAll('#browseSidebar .btn-option').forEach(b => b.classList.remove('active'));

        this.closeBrowseSidebarPanel();
        this.renderBrowseGrid();
    }

    renderBrowseGrid() {
        const houses = this.getBrowseHouses();
        const grid   = document.getElementById('browseGrid');
        const empty  = document.getElementById('browseEmpty');
        const count  = document.getElementById('browseCount');

        // Active filter badge
        const f = this.browseFilters;
        const activeCount = [
            f.minPrice, f.maxPrice, f.minSize, f.maxSize, f.minBedrooms,
            f.minEnergyLabel, f.neighborhood || null, f.minYear,
            f.hasTuin || null, f.hasBalcony || null, f.hasParking || null, f.hasSolar || null,
            f.minDaysOnMarket,
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
        const favLabel   = isFav ? '❤️' : '🤍';
        const favClass   = isFav ? 'bt-fav active' : 'bt-fav';

        // Badges
        const badges = [];
        if (house.isNew || house.daysOnMarket === 0)
            badges.push('<span class="bt-badge bt-badge-new">Nieuw</span>');
        if (house.status && /onderhandeling/i.test(house.status))
            badges.push('<span class="bt-badge bt-badge-nego">In onderhandeling</span>');

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

        // Spec icons (using Unicode + text — no external assets, CSP-safe)
        const specs = [];
        if (house.size)      specs.push(`<span class="bt-spec">◻ ${house.size}\u00a0m²</span>`);
        if (house.bedrooms)  specs.push(`<span class="bt-spec">🛏 ${house.bedrooms}</span>`);
        if (house.bathrooms && house.bathrooms > 0)
                             specs.push(`<span class="bt-spec">🚿 ${house.bathrooms}</span>`);
        if (house.yearBuilt) specs.push(`<span class="bt-spec">📅 ${house.yearBuilt}</span>`);

        // Feature pills
        const feats = [];
        if (house.hasGarden)  feats.push('🌿 Tuin');
        if (house.hasBalcony) feats.push('🌅 Balkon');
        if (house.hasRoofTerrace) feats.push('🏙 Dakterras');
        if (house.hasParking) feats.push('🚗 Parkeren');
        if (house.hasSolarPanels) feats.push('☀️ Zonnepanelen');

        // Days on market
        const daysHtml = (house.daysOnMarket != null && house.daysOnMarket > 0)
            ? `<span class="bt-days">${house.daysOnMarket}\u00a0dag${house.daysOnMarket !== 1 ? 'en' : ''} geleden</span>`
            : '';

        // Photo count
        const photoCount = house.images?.length > 1
            ? `<span class="bt-photo-count">📷\u00a0${house.images.length}</span>`
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
                    title="${isFav ? 'Verwijder favoriet' : 'Voeg toe aan favorieten'}">${favLabel}</button>
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
                ${feats.length ? `<div class="bt-feats">${feats.map(f => `<span class="bt-feat">${escapeHtml(f)}</span>`).join('')}</div>` : ''}
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
            btn.textContent = '🤍';
            btn.classList.remove('active');
            btn.title = 'Voeg toe aan favorieten';
        } else {
            this.addToFavorites(house);
            btn.textContent = '❤️';
            btn.classList.add('active');
            btn.title = 'Verwijder favoriet';
        }
        this.updateStats();
        this.saveToStorage();
    }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new FunDaApp();
});
