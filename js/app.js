// Fun-da App - De leukste manier om een huis te vinden!
// Features: Funda scraping, Familie sync, Swipe interface

// Utility function
const $ = (id) => document.getElementById(id);

// Clean address: remove duplicate floor suffixes like "straat 27-H H" -> "straat 27-H"
const cleanAddress = (addr) => {
    if (!addr) return '';
    // Match patterns like "27-H H", "10-2 2", "15-III III" at the end
    return addr.replace(/(\d+[a-zA-Z]?[-\/]([a-zA-Z0-9]+))\s+\2\s*$/i, '$1').trim();
};

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
            filterModal: $('filterModal'),
            favoritesModal: $('favoritesModal'),
            detailModal: $('detailModal'),
            fundaModal: $('fundaModal'),
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
        
        // Backward compatibility getters
        this.cardStack = this.elements.cardStack;
        this.emptyState = this.elements.emptyState;
        this.filterModal = this.elements.filterModal;
        this.favoritesModal = this.elements.favoritesModal;
        this.detailModal = this.elements.detailModal;
        this.fundaModal = this.elements.fundaModal;
        this.familyModal = this.elements.familyModal;

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
        
        // Restore filter UI from saved state
        this.restoreFilterUI();

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
        }, 200);
    }

    async autoLoadNewListings() {
        console.log('🚀 Auto-loading nieuwe woningen van vandaag...');
        
        // Set the URL in the input field
        const urlInput = document.getElementById('fundaUrl');
        if (urlInput) {
            urlInput.value = this.defaultFundaUrl;
        }
        
        try {
            this.updateSplashStatus('Verbinden met Funda...');
            
            // Use the scraper directly for splash screen updates
            const houses = await this.scraper.scrapeAllSources({ 
                area: 'amsterdam', 
                days: '1',
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
                
                // Replace all houses with fresh data
                this.houses = houses;
                this.currentIndex = 0;
                this.viewed = 0;
                
                this.saveToStorage();
                this.renderCards();
                this.updateStats();
                
                this.updateSplashStatus(`${houses.length} woningen geladen`);
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
            
            // Load saved filters
            const savedFilters = localStorage.getItem('funda-filters');
            if (savedFilters) {
                this.filters = JSON.parse(savedFilters);
            }
        } catch (e) {
            console.error('Error loading from storage:', e);
        }
    }
    
    restoreFilterUI() {
        // Restore filter UI from saved state
        if (this.filters.minPrice) {
            document.getElementById('minPrice').value = this.filters.minPrice;
        }
        if (this.filters.maxPrice) {
            document.getElementById('maxPrice').value = this.filters.maxPrice;
        }
        if (this.filters.neighborhood) {
            document.getElementById('neighborhood').value = this.filters.neighborhood;
        }
        if (this.filters.minBedrooms) {
            document.querySelectorAll('.btn-option').forEach(btn => {
                if (parseInt(btn.dataset.value, 10) === this.filters.minBedrooms) {
                    btn.classList.add('active');
                }
            });
        }
    }

    saveToStorage() {
        try {
            localStorage.setItem('funda-favorites', JSON.stringify(this.favorites));
            localStorage.setItem('funda-viewed', this.viewed.toString());
            localStorage.setItem('funda-index', this.currentIndex.toString());
            localStorage.setItem('funda-houses', JSON.stringify(this.houses));
            localStorage.setItem('funda-filters', JSON.stringify(this.filters));
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
        document.getElementById('filterBtn').addEventListener('click', () => this.openModal(this.filterModal));
        document.getElementById('favoritesBtn').addEventListener('click', () => this.openFavorites());
        document.getElementById('fundaImportBtn').addEventListener('click', () => this.openModal(this.fundaModal));
        document.getElementById('familyBtn').addEventListener('click', () => this.openFamilyModal());

        // Modal close buttons
        document.getElementById('closeFilterModal').addEventListener('click', () => this.closeModal(this.filterModal));
        document.getElementById('closeFavModal').addEventListener('click', () => this.closeModal(this.favoritesModal));
        document.getElementById('closeDetailModal').addEventListener('click', () => this.closeModal(this.detailModal));
        document.getElementById('closeFundaModal').addEventListener('click', () => this.closeModal(this.fundaModal));
        document.getElementById('closeFamilyModal').addEventListener('click', () => this.closeModal(this.familyModal));

        // Filter options
        document.querySelectorAll('.btn-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const group = e.target.parentElement;
                group.querySelectorAll('.btn-option').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Apply filters
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());

        // Funda import
        document.getElementById('importFundaBtn').addEventListener('click', () => this.importFromFunda());
        
        // Clear data button
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearAllData());
        document.querySelectorAll('.quick-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.getElementById('fundaUrl').value = e.target.dataset.url;
            });
        });

        // Family controls
        document.getElementById('createFamilyBtn').addEventListener('click', () => this.createFamily());
        document.getElementById('joinFamilyBtn').addEventListener('click', () => this.joinFamily());
        document.getElementById('leaveFamilyBtn').addEventListener('click', () => this.leaveFamily());
        document.getElementById('copyFamilyCode').addEventListener('click', () => this.copyFamilyCode());
        document.getElementById('showQRCode').addEventListener('click', () => this.showQRCode());
        document.getElementById('scanQRBtn').addEventListener('click', () => this.startQRScanner());
        document.getElementById('closeQRModal').addEventListener('click', () => this.closeModal(document.getElementById('qrModal')));
        document.getElementById('closeQRScannerModal').addEventListener('click', () => this.stopQRScanner());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Close modals on backdrop click
        [this.filterModal, this.favoritesModal, this.detailModal, this.fundaModal, this.familyModal].forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal);
            });
        });

        // Logo click - easter egg
        document.querySelector('.logo').addEventListener('click', () => {
            this.showToast('🎉 Fun-da - Huizenjacht was nog nooit zo leuk!');
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
            
            this.showToast('🗑️ Alle data gewist! Importeer nieuwe woningen van Funda.');
        }
    }

    async importFromFunda() {
        const urlInput = document.getElementById('fundaUrl');
        const url = urlInput.value.trim();

        if (!url || !url.includes('funda.nl')) {
            this.showToast('❌ Voer een geldige Funda URL in');
            return;
        }

        const btnText = document.getElementById('importBtnText');
        const spinner = document.getElementById('importSpinner');
        const status = document.getElementById('importStatus');
        const statusText = document.getElementById('importStatusText');
        const progressBar = document.getElementById('importProgressBar');

        // Show loading state
        btnText.textContent = 'Bezig...';
        spinner.classList.remove('hidden');
        status.classList.remove('hidden');
        progressBar.style.width = '20%';
        statusText.textContent = '🔍 Verbinden met meerdere bronnen...';

        try {
            progressBar.style.width = '30%';
            statusText.textContent = '📡 Data ophalen van Funda, Jaap.nl, overheid...';

            // Use the new multi-source parallel scraper
            const houses = await this.scraper.scrapeAllSources({ area: 'amsterdam', days: '1' });

            progressBar.style.width = '70%';
            statusText.textContent = '🏛️ Verrijken met overheidsdata...';

            await new Promise(r => setTimeout(r, 300));

            progressBar.style.width = '85%';
            statusText.textContent = '🏠 Woningen verwerken...';

            if (houses.length > 0) {
                // Add import timestamp
                houses.forEach(h => {
                    h.importedAt = Date.now();
                });

                // REPLACE all houses with imported ones
                this.houses = houses;
                this.currentIndex = 0;
                this.viewed = 0;
                
                this.saveToStorage();
                this.renderCards();
                this.updateStats();

                progressBar.style.width = '100%';
                
                // Show which sources contributed
                const sources = [...new Set(houses.map(h => h.source).filter(Boolean))];
                const sourceText = sources.length > 0 ? ` (${sources.join(', ')})` : '';
                statusText.textContent = `✅ ${houses.length} woningen geïmporteerd${sourceText}!`;
                
                this.showToast(`🏠 ${houses.length} woningen geladen!`);
                this.triggerConfetti();

                setTimeout(() => {
                    this.closeModal(this.fundaModal);
                }, 1500);
            } else {
                statusText.textContent = '⚠️ Geen woningen gevonden. Alle bronnen geblokkeerd.';
                this.showToast('⚠️ Geen woningen gevonden');
            }
        } catch (error) {
            console.error('Import error:', error);
            const fundaSearchUrl = this.scraper.generateFundaUrl(url);
            statusText.innerHTML = `❌ ${error.message}<br><br>
                <a href="${fundaSearchUrl}" target="_blank" rel="noopener" class="funda-direct-link">
                    🔗 Open Funda.nl direct →
                </a>`;
            this.showToast('⚠️ Open Funda handmatig via de link');
        } finally {
            btnText.textContent = '🔍 Importeer woningen';
            spinner.classList.add('hidden');
            
            setTimeout(() => {
                status.classList.add('hidden');
                progressBar.style.width = '0%';
            }, 3000);
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

        const code = await this.familySync.createFamily(name);
        this.showToast(`🎉 Familie aangemaakt! Code: ${code}`);
        this.updateFamilyUI();
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

        await this.familySync.joinFamily(code, name);
        this.showToast(`👨‍👩‍👧‍👦 Je bent nu lid van familie ${code}!`);
        this.updateFamilyUI();
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
        
        // Use QR code API service
        const img = document.createElement('img');
        img.alt = 'QR Code';
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
        img.onload = () => {
            qrDisplay.innerHTML = '';
            qrDisplay.appendChild(img);
        };
        img.onerror = () => {
            qrDisplay.innerHTML = `<p>QR code kon niet laden.<br><strong>${code}</strong></p>`;
        };
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
        // Create canvas for frame capture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const scan = () => {
            if (!this.qrStream) return;
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            // Simple QR detection - look for the family code pattern in URL bar
            // For a full solution, you'd use a library like jsQR
            // For now, we'll use a simpler approach with BarcodeDetector if available
            if ('BarcodeDetector' in window) {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                detector.detect(video).then(barcodes => {
                    if (barcodes.length > 0) {
                        const data = barcodes[0].rawValue;
                        if (data.startsWith('funda-family:')) {
                            const code = data.replace('funda-family:', '');
                            this.stopQRScanner();
                            document.getElementById('joinFamilyCode').value = code;
                            this.showToast('QR code herkend!');
                            // Auto-join
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

            // Show members
            const members = this.familySync.getMembersList();
            membersList.innerHTML = members.map(m => `
                <div class="member-item ${m.isCurrentUser ? 'current-user' : ''}">
                    <div class="member-avatar">${this.getAvatarEmoji(m.name)}</div>
                    <div class="member-info">
                        <div class="member-name">${m.name} ${m.isCurrentUser ? '<span class="member-badge">Jij</span>' : ''}</div>
                        <div class="member-stats">❤️ ${m.favoriteCount} favorieten</div>
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
                        const safeId = String(houseId).replace(/'/g, "\\'");
                        matchHtml.push(`
                            <div class="match-item" onclick="app.showMatchDetail('${safeId}')">
                                <img class="match-image" src="${house.image}" alt="${house.address}">
                                <div class="match-info">
                                    <div class="match-price">${formatPrice(house.price)}</div>
                                    <div class="match-address">${house.address}</div>
                                    <div class="match-members">
                                        ${memberNames.map(n => `<span class="match-member-badge">${n}</span>`).join('')}
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
        
        document.getElementById('detailTitle').textContent = '🎉 Familie Match!';
        document.getElementById('detailContent').innerHTML = `
            <div style="background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(78, 205, 196, 0.2)); 
                        padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem; text-align: center;">
                <p style="font-weight: 600; margin-bottom: 0.5rem;">Deze woning is geliked door:</p>
                <div style="display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
                    ${memberNames ? memberNames.map(n => `<span class="match-member-badge">${n}</span>`).join('') : ''}
                </div>
            </div>
            
            <img class="detail-image" src="${house.image}" alt="${house.address}">
            
            <div class="detail-section">
                <div class="card-price" style="font-size: 2rem;">${formatPrice(house.price)}</div>
                <div class="card-neighborhood" style="margin-top: 0.5rem;">${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city}</div>
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

            ${house.url && house.url !== '#' ? `
                <a href="${house.url}" target="_blank" class="btn-primary btn-full" style="display: block; text-align: center; text-decoration: none;">
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
        const placeholderImage = 'https://via.placeholder.com/800x600.png?text=FOTO+LADEN...';
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
            const img1 = images[0] || mainImage;
            const img2 = images[1] || mainImage;
            const img3 = images[2] || mainImage;
            const img4 = images[3] || mainImage;
            
            imageGalleryHtml = `
                <div class="card-image-gallery">
                    <div>
                            <img class="gallery-thumb" src="${img1}" alt="${house.address}" loading="lazy" 
                                onerror="this.src='https://via.placeholder.com/800x600.png?text=FOTO+LADEN...'">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${img2}" alt="${house.address}" loading="lazy"
                                onerror="this.src='https://via.placeholder.com/800x600.png?text=FOTO+LADEN...'">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${img3}" alt="${house.address}" loading="lazy"
                                onerror="this.src='https://via.placeholder.com/800x600.png?text=FOTO+LADEN...'">
                    </div>
                    <div>
                            <img class="gallery-thumb" src="${img4}" alt="${house.address}" loading="lazy"
                                onerror="this.src='https://via.placeholder.com/800x600.png?text=FOTO+LADEN...'">
                    </div>
                </div>
            `;
        } else {
            // Fallback to single image
            imageGalleryHtml = `
                 <img class="card-image" src="${mainImage}" alt="${house.address}" loading="lazy" 
                     onerror="this.src='https://via.placeholder.com/800x600.png?text=FOTO+LADEN...'">
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
                <div class="card-address">${cleanAddress(house.address)}</div>
                <div class="card-neighborhood">${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city || 'Amsterdam'}</div>
                <div class="card-features">
                    <span class="feature">${house.size || '?'}m²</span>
                    <span class="feature">${house.bedrooms || '?'} slpk</span>
                    ${house.yearBuilt ? `<span class="feature">${house.yearBuilt}</span>` : ''}
                </div>
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

        // Mouse events
        card.addEventListener('mousedown', (e) => this.onDragStart(e));
        document.addEventListener('mousemove', (e) => this.onDragMove(e));
        document.addEventListener('mouseup', (e) => this.onDragEnd(e));

        // Double click for details
        card.addEventListener('dblclick', () => this.showDetail());
    }

    onDragStart(e) {
        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        this.isDragging = true;
        this.startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        this.startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        card.style.transition = 'none';
    }

    onDragMove(e) {
        if (!this.isDragging) return;

        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        this.currentX = clientX - this.startX;
        const currentY = clientY - this.startY;

        // Prevent scrolling while swiping horizontally
        if (Math.abs(this.currentX) > Math.abs(currentY) && e.cancelable) {
            e.preventDefault();
        }

        const rotate = this.currentX * 0.1;
        card.style.transform = `translateX(${this.currentX}px) translateY(${currentY * 0.3}px) rotate(${rotate}deg)`;

        // Show indicators
        const likeIndicator = card.querySelector('.swipe-indicator.like');
        const nopeIndicator = card.querySelector('.swipe-indicator.nope');

        const threshold = 50;
        if (this.currentX > threshold) {
            likeIndicator.style.opacity = Math.min((this.currentX - threshold) / 100, 1);
            nopeIndicator.style.opacity = 0;
        } else if (this.currentX < -threshold) {
            nopeIndicator.style.opacity = Math.min((-this.currentX - threshold) / 100, 1);
            likeIndicator.style.opacity = 0;
        } else {
            likeIndicator.style.opacity = 0;
            nopeIndicator.style.opacity = 0;
        }
    }

    onDragEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;

        const card = this.cardStack.querySelector('.house-card:last-child');
        if (!card) return;

        const threshold = 100;

        if (this.currentX > threshold) {
            this.swipe('right');
        } else if (this.currentX < -threshold) {
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

        this.currentX = 0;
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

    removeFromFavorites(houseId) {
        console.log('🗑️ Removing favorite:', houseId);
        const beforeCount = this.favorites.length;
        this.favorites = this.favorites.filter(h => String(h.id) !== String(houseId));
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
        const modals = [this.filterModal, this.favoritesModal, this.detailModal, this.fundaModal, this.familyModal];
        const anyModalOpen = modals.some(m => !m.classList.contains('hidden'));
        
        if (anyModalOpen) {
            if (e.key === 'Escape') {
                modals.forEach(m => this.closeModal(m));
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

    applyFilters() {
        const minPrice = document.getElementById('minPrice').value;
        const maxPrice = document.getElementById('maxPrice').value;
        const neighborhood = document.getElementById('neighborhood').value;
        const activeBedroomBtn = document.querySelector('.btn-option.active');

        this.filters = {
            minPrice: minPrice ? parseInt(minPrice, 10) : null,
            maxPrice: maxPrice ? parseInt(maxPrice, 10) : null,
            neighborhood: neighborhood || null,
            minBedrooms: activeBedroomBtn ? parseInt(activeBedroomBtn.dataset.value, 10) : null
        };

        this.currentIndex = 0;
        this.renderCards();
        this.updateStats();
        this.closeModal(this.filterModal);

        const filtered = this.getFilteredHouses();
        this.showToast(`🔍 ${filtered.length} woningen gevonden`);
    }

    showDetail() {
        const houses = this.getFilteredHouses();
        const house = houses[this.currentIndex];
        if (!house) return;

        const fact = NEIGHBORHOOD_FACTS[house.neighborhood] || '';
        
        // Build extra details section
        const extraDetails = [];
        if (house.propertyType) extraDetails.push(`<span>🏠 ${house.propertyType}</span>`);
        if (house.plotSize) extraDetails.push(`<span>🌳 Perceel: ${house.plotSize}m²</span>`);
        if (house.hasGarden) extraDetails.push(`<span>🌿 ${house.gardenType || 'Tuin'}</span>`);
        if (house.hasBalcony) extraDetails.push(`<span>🌅 Balkon</span>`);
        if (house.parking) extraDetails.push(`<span>🚗 ${house.parking}</span>`);
        if (house.vveCosts) extraDetails.push(`<span>🏢 VvE: €${house.vveCosts}/mnd</span>`);
        if (house.status) extraDetails.push(`<span>📋 ${house.status}</span>`);
        
        // Build data source badge
        const sourceBadges = [];
        if (house.enrichedFromBag) sourceBadges.push('<span class="source-badge source-bag">BAG ✓</span>');
        if (house.enrichedFromFunda) sourceBadges.push('<span class="source-badge source-funda">Details ✓</span>');

        document.getElementById('detailTitle').textContent = cleanAddress(house.address);
        document.getElementById('detailContent').innerHTML = `
            <img class="detail-image" src="${house.image}" alt="${cleanAddress(house.address)}">
            
            <div class="detail-section" style="margin-bottom: 0.75rem;">
                <div class="card-price" style="font-size: 1.75rem;">${formatPrice(house.price)}</div>
                <div class="card-neighborhood" style="margin-top: 0.25rem; font-size: 0.85rem;">${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city}</div>
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
                        <div class="detail-item-label">Badk.</div>
                        <div class="detail-item-value">${house.bathrooms || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Bouwjaar</div>
                        <div class="detail-item-value">${house.yearBuilt || '?'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Energie</div>
                        <div class="detail-item-value">${house.energyLabel || '?'}</div>
                    </div>
                </div>
                ${extraDetails.length > 0 ? `<div style="margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">${extraDetails.join('')}</div>` : ''}
            </div>

            ${house.url && house.url !== '#' ? `
                <a href="${house.url}" target="_blank" class="btn-secondary" style="display: block; text-align: center; text-decoration: none; padding: 0.75rem; font-size: 0.9rem; margin-top: 0.75rem;">
                    🔗 Bekijk op Funda
                </a>
            ` : ''}
        `;

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
                const safeId = String(house.id).replace(/'/g, "\\'");
                return `
                <div class="favorite-item" onclick="app.showFavoriteDetail('${safeId}')">
                    <img class="favorite-image" src="${house.image}" alt="${cleanAddress(house.address)}">
                    <div class="favorite-info">
                        <div class="favorite-price">${formatPrice(house.price)}</div>
                        <div class="favorite-address">${cleanAddress(house.address)}</div>
                        <div class="favorite-features">${house.bedrooms || '?'} slpk · ${house.size || '?'}m² · ${house.neighborhood || house.city}</div>
                    </div>
                    <button class="favorite-remove" onclick="event.stopPropagation(); app.removeFromFavorites('${safeId}')">
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

        this.closeModal(this.favoritesModal);

        const fact = NEIGHBORHOOD_FACTS[house.neighborhood] || '';

        document.getElementById('detailTitle').textContent = cleanAddress(house.address);
        document.getElementById('detailContent').innerHTML = `
            <img class="detail-image" src="${house.image}" alt="${cleanAddress(house.address)}">
            
            <div class="detail-section">
                <div class="card-price" style="font-size: 2rem;">${formatPrice(house.price)}</div>
                <div class="card-neighborhood" style="margin-top: 0.5rem;">${house.postalCode ? house.postalCode + ' - ' : ''}${house.neighborhood || house.city}</div>
                ${fact ? `<p style="margin-top: 0.5rem; font-style: italic; color: var(--secondary);">${fact}</p>` : ''}
            </div>

            <div class="detail-section">
                <h3>Kenmerken</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-item-label">Oppervlakte</div>
                        <div class="detail-item-value">${house.size || '?'} m²</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-item-label">Slaapkamers</div>
                        <div class="detail-item-value">${house.bedrooms || '?'}</div>
                    </div>
                </div>
            </div>

            ${house.description ? `
                <div class="detail-section">
                    <h3>Beschrijving</h3>
                    <p class="detail-description">${house.description}</p>
                </div>
            ` : ''}

            ${house.url && house.url !== '#' ? `
                <a href="${house.url}" target="_blank" class="btn-secondary btn-full" style="display: block; text-align: center; text-decoration: none; margin-bottom: 0.5rem;">
                    🔗 Bekijk op Funda
                </a>
            ` : ''}

            <button class="btn-primary btn-full" style="background: var(--danger);" onclick="app.removeFromFavorites('${String(house.id).replace(/'/g, "\\'")}'); app.closeModal(app.detailModal);">
                🗑️ Verwijderen uit favorieten
            </button>
        `;

        setTimeout(() => this.openModal(this.detailModal), 300);
    }

    openModal(modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
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
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new FunDaApp();
});
