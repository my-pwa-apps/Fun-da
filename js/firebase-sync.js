// Firebase Configuration voor Familie Sync
// Gebruikt Firebase Realtime Database voor het delen van favorieten tussen gezinsleden

// Suppress verbose logging in production; keep warn + error visible
if (!window.__FUNDA_DEBUG) {
    console.log = () => {};
    console.debug = () => {};
}

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBfpRQOaWISrNH9rb7Yn_-FOtACrGVXQhM",
    authDomain: "fun-da-cf8d6.firebaseapp.com",
    databaseURL: "https://fun-da-cf8d6-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fun-da-cf8d6",
    storageBucket: "fun-da-cf8d6.firebasestorage.app",
    messagingSenderId: "565804242548",
    appId: "1:565804242548:web:5513a6566b80e0a41de321",
    measurementId: "G-2YNS1C80BD"
};

class FamilySync {
    constructor() {
        this.familyCode = null;
        this.userName = null;
        this.userId = null;
        this.authUid = null;
        this.members = new Map();
        this.onFamilyUpdate = null;
        this.unsubscribe = null;
        this.db = null;
        this.isFirebaseReady = false;
        this.photoURL = '';

        this.init();
    }

    async init() {
        // Initialize Firebase
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            this.db = firebase.database();
            this.authUid = firebase.auth?.().currentUser?.uid || null;
            
            this.isFirebaseReady = true;
            console.log('🔥 Firebase initialized successfully!');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            this.isFirebaseReady = false;
        }

        // Laad opgeslagen familie code
        this.familyCode = localStorage.getItem('funda-family-code');
        this.userName = localStorage.getItem('funda-user-name') || this.generateUserName();
        this.userId = localStorage.getItem('funda-user-id') || this.generateUserId();
        localStorage.setItem('funda-user-id', this.userId);

        if (this.familyCode && this.canUseFamilySync()) {
            await this.startRealtimeSync();
        }
    }

    canUseFamilySync() {
        return Boolean(this.isFirebaseReady && typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
    }

    async handleAuthStateChanged(user) {
        this.authUid = user?.uid || null;
        this.photoURL = user?.photoURL || '';

        if (!this.familyCode || !this.isFirebaseReady) {
            return;
        }

        if (!user) {
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
            this.members.clear();
            if (this.onFamilyUpdate) {
                this.onFamilyUpdate(new Map(), this.members);
            }
            return;
        }

        await this.registerWriterAccess();
        await this.startRealtimeSync();
    }

    async registerWriterAccess() {
        if (!this.familyCode || !this.canUseFamilySync() || !this.authUid) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        try {
            await this.db.ref(`families/${sanitizedCode}/writers/${this.authUid}`).set(true);
        } catch (error) {
            console.error('Error registering family writer access:', error);
        }
    }

    async updateMemberProfile(profile = {}) {
        if (!this.familyCode || !this.canUseFamilySync() || !this.authUid) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const userKey = this.sanitizeForFirebase(this.userId);
        try {
            await this.db.ref(`families/${sanitizedCode}/members/${userKey}`).update({
                ...profile,
                authUid: this.authUid,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
            });
        } catch (error) {
            console.error('Error updating family member profile:', error);
        }
    }
    generateUserName() {
        const adjectives = ['Vrolijke', 'Slimme', 'Snelle', 'Leuke', 'Handige'];
        const nouns = ['Huizenjager', 'Woningzoeker', 'Appartementfan', 'Grachtenloper', 'Stadsmens'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj} ${noun}`;
    }

    generateRandomHex(byteLength) {
        const bytes = new Uint8Array(byteLength);
        if (window.crypto?.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    generateUserId() {
        return `user-${this.generateRandomHex(8)}`;
    }

    generateFamilyCode() {
        const raw = this.generateRandomHex(12);
        const parts = raw.match(/.{1,4}/g) || [raw];
        return `fd-${parts.join('-')}`;
    }

    // Sanitize family code for Firebase path (no dots, #, $, [, ])
    sanitizeForFirebase(str) {
        return str.replace(/[.#$\[\]]/g, '_');
    }

    async createFamily(userName) {
        if (!this.canUseFamilySync() || !this.authUid) {
            console.error('Firebase not ready');
            return null;
        }

        this.userName = userName || this.userName;
        const userKey = this.sanitizeForFirebase(this.userId);

        // Initialiseer de familie in Firebase
        try {
            let familyRef;
            let sanitizedCode;
            let existingFamily = null;

            for (let attempt = 0; attempt < 5; attempt++) {
                this.familyCode = this.generateFamilyCode();
                sanitizedCode = this.sanitizeForFirebase(this.familyCode);
                familyRef = this.db.ref(`families/${sanitizedCode}`);
                existingFamily = await familyRef.child('metadata').once('value');
                if (!existingFamily.exists()) {
                    break;
                }
            }

            if (existingFamily?.exists()) {
                throw new Error('Kon geen unieke familiecode genereren');
            }
            
            // Set family metadata
            await familyRef.child('metadata').set({
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                createdBy: this.userName,
                createdByUserId: this.userId
            });

            // Add current user as member
            await familyRef.update({
                [`members/${userKey}`]: {
                    name: this.userName,
                    userId: this.userId,
                    authUid: this.authUid,
                    photoURL: this.photoURL || '',
                    favorites: [],
                    joinedAt: firebase.database.ServerValue.TIMESTAMP,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                },
                [`writers/${this.authUid}`]: true,
            });

            localStorage.setItem('funda-family-code', this.familyCode);
            localStorage.setItem('funda-user-name', this.userName);
            localStorage.setItem('funda-user-id', this.userId);

            console.log(`✅ Family created: ${this.familyCode}`);
            await this.startRealtimeSync();

            return this.familyCode;
        } catch (error) {
            console.error('Error creating family:', error);
            return null;
        }
    }

    async joinFamily(familyCode, userName) {
        if (!this.canUseFamilySync() || !this.authUid) {
            console.error('Firebase not ready');
            return false;
        }

        const normalizedFamilyCode = familyCode.toLowerCase().trim();
        const nextUserName = userName || this.userName;
        const sanitizedCode = this.sanitizeForFirebase(normalizedFamilyCode);
        const userKey = this.sanitizeForFirebase(this.userId);

        try {
            // Check if family exists
            const familyRef = this.db.ref(`families/${sanitizedCode}`);
            const snapshot = await familyRef.child('metadata').once('value');

            if (!snapshot.exists()) {
                return false;
            }

            // Sync bestaande favorieten naar de familie
            const existingFavorites = JSON.parse(localStorage.getItem('funda-favorites') || '[]');
            const favoriteIds = existingFavorites.map(h => h.id);

            // Add current user as member
            await familyRef.update({
                [`members/${userKey}`]: {
                    name: nextUserName,
                    userId: this.userId,
                    authUid: this.authUid,
                    photoURL: this.photoURL || '',
                    favorites: favoriteIds,
                    joinedAt: firebase.database.ServerValue.TIMESTAMP,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP
                },
                [`writers/${this.authUid}`]: true,
            });

            this.familyCode = normalizedFamilyCode;
            this.userName = nextUserName;
            localStorage.setItem('funda-family-code', this.familyCode);
            localStorage.setItem('funda-user-name', this.userName);
            localStorage.setItem('funda-user-id', this.userId);

            console.log(`✅ Joined family: ${this.familyCode}`);
            await this.startRealtimeSync();

            return true;
        } catch (error) {
            console.error('Error joining family:', error);
            return false;
        }
    }

    async leaveFamily() {
        if (!this.familyCode) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const userKey = this.sanitizeForFirebase(this.userId);

        try {
            // Remove user from family
            if (this.canUseFamilySync()) {
                const updates = {
                    [`families/${sanitizedCode}/members/${userKey}`]: null,
                };
                if (this.authUid) {
                    updates[`families/${sanitizedCode}/writers/${this.authUid}`] = null;
                }
                await this.db.ref().update(updates);
            }
        } catch (error) {
            console.error('Error leaving family:', error);
        }

        // Stop realtime sync
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        this.familyCode = null;
        this.members.clear();

        localStorage.removeItem('funda-family-code');
    }

    async startRealtimeSync() {
        if (!this.familyCode || !this.canUseFamilySync()) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const familyRef = this.db.ref(`families/${sanitizedCode}/members`);

        // Stop any existing listener
        if (this.unsubscribe) {
            this.unsubscribe();
        }

        // Listen for changes in realtime
        const listener = familyRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            // Update members
            this.members.clear();
            for (const [key, userData] of Object.entries(data)) {
                this.members.set(userData.name || key, userData);
            }

            // Bereken matches
            const matches = this.calculateMatches();

            // Callback
            if (this.onFamilyUpdate) {
                this.onFamilyUpdate(matches, this.members);
            }

            console.log(`📡 Family sync update: ${this.members.size} members, ${matches.size} matches`);
        }, (error) => {
            console.error('Firebase listener error:', error);
        });

        // Store unsubscribe function
        this.unsubscribe = () => familyRef.off('value', listener);

        // Update last seen periodically
        this.updatePresence();
    }

    async updatePresence() {
        if (!this.familyCode || !this.canUseFamilySync()) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const userKey = this.sanitizeForFirebase(this.userId);

        try {
            await this.db.ref(`families/${sanitizedCode}/members/${userKey}/lastSeen`)
                .set(firebase.database.ServerValue.TIMESTAMP);
        } catch (error) {
            console.error('Error updating presence:', error);
        }
    }

    async addFavorite(houseId) {
        if (!this.familyCode || !this.canUseFamilySync()) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const userKey = this.sanitizeForFirebase(this.userId);

        try {
            const memberRef = this.db.ref(`families/${sanitizedCode}/members/${userKey}`);
            const snapshot = await memberRef.child('favorites').once('value');
            const currentFavorites = snapshot.val() || [];

            if (!currentFavorites.includes(houseId)) {
                currentFavorites.push(houseId);
                await memberRef.child('favorites').set(currentFavorites);
                await memberRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP);
                console.log(`❤️ Added favorite: ${houseId}`);
            }
        } catch (error) {
            console.error('Error adding favorite:', error);
        }
    }

    async removeFavorite(houseId) {
        if (!this.familyCode || !this.canUseFamilySync()) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const userKey = this.sanitizeForFirebase(this.userId);

        try {
            const memberRef = this.db.ref(`families/${sanitizedCode}/members/${userKey}`);
            const snapshot = await memberRef.child('favorites').once('value');
            const currentFavorites = snapshot.val() || [];

            const updatedFavorites = currentFavorites.filter(id => id !== houseId);
            await memberRef.child('favorites').set(updatedFavorites);
            await memberRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP);
            console.log(`💔 Removed favorite: ${houseId}`);
        } catch (error) {
            console.error('Error removing favorite:', error);
        }
    }

    calculateMatches() {
        const matches = new Map(); // houseId -> [member names who liked it]

        for (const [memberName, data] of this.members) {
            const favorites = data.favorites || [];

            for (const houseId of favorites) {
                const key = houseId.toString();
                if (!matches.has(key)) {
                    matches.set(key, []);
                }
                matches.get(key).push(memberName);
            }
        }

        // Filter op huizen met meer dan 1 like
        const familyMatches = new Map();
        for (const [houseId, members] of matches) {
            if (members.length > 1) {
                familyMatches.set(houseId, members);
            }
        }

        return familyMatches;
    }

    getMemberCount() {
        return this.members.size;
    }

    isInFamily() {
        return !!this.familyCode;
    }

    getFamilyCode() {
        return this.familyCode;
    }

    getUserName() {
        return this.userName;
    }

    getMembersList() {
        const list = [];
        for (const [name, data] of this.members) {
            list.push({
                name: data.name || name,
                photoURL: data.photoURL || '',
                favoriteCount: (data.favorites || []).length,
                lastSeen: data.lastSeen,
                isCurrentUser: data.userId === this.userId || (data.name || name) === this.userName
            });
        }
        return list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    }

    // Get all favorites from all family members (for potential use)
    getAllFamilyFavorites() {
        const allFavorites = new Set();
        for (const [_, data] of this.members) {
            const favorites = data.favorites || [];
            favorites.forEach(id => allFavorites.add(id));
        }
        return Array.from(allFavorites);
    }

    // ==========================================
    // HOUSE PERSISTENCE (all found houses, not just favorites)
    // ==========================================

    async saveHousesToDB(houses) {
        if (!this.familyCode || !this.canUseFamilySync() || !houses.length) return;
        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const updates = {};
        for (const house of houses) {
            const key = this.sanitizeForFirebase(String(house.id));
            updates[`families/${sanitizedCode}/houses/${key}`] = {
                id: house.id,
                globalId: house.globalId || '',
                price: house.price || 0,
                address: house.address || '',
                postalCode: house.postalCode || '',
                city: house.city || '',
                neighborhood: house.neighborhood || '',
                bedrooms: house.bedrooms || 0,
                rooms: house.rooms || 0,
                size: house.size || 0,
                plotArea: house.plotArea || 0,
                image: house.image || '',
                images: (house.images || []).slice(0, 30),
                url: house.url || '',
                energyLabel: house.energyLabel || '',
                yearBuilt: house.yearBuilt || null,
                propertyType: house.propertyType || '',
                hasGarden: house.hasGarden || false,
                hasBalcony: house.hasBalcony || false,
                hasRoofTerrace: house.hasRoofTerrace || false,
                hasSolarPanels: house.hasSolarPanels || false,
                hasHeatPump: house.hasHeatPump || false,
                hasParking: house.hasParking || false,
                daysOnMarket: house.daysOnMarket || null,
                pricePerM2: house.pricePerM2 || null,
                importedAt: house.importedAt || Date.now(),
                savedAt: firebase.database.ServerValue.TIMESTAMP,
            };
        }
        try {
            await this.db.ref().update(updates);
        } catch (e) {
            console.error('Error saving houses to DB:', e);
        }
    }

    async loadHousesFromDB() {
        if (!this.familyCode || !this.canUseFamilySync()) return [];
        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        try {
            const snapshot = await this.db.ref(`families/${sanitizedCode}/houses`).once('value');
            const data = snapshot.val();
            return data ? Object.values(data) : [];
        } catch (e) {
            console.error('Error loading houses from DB:', e);
            return [];
        }
    }

    async discardHouseInDB(houseId) {
        if (!this.familyCode || !this.canUseFamilySync()) return;
        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const key = this.sanitizeForFirebase(String(houseId));
        try {
            await this.db.ref(`families/${sanitizedCode}/houses/${key}`).remove();
        } catch (e) {
            // silently ignore
        }
    }

    // ==========================================
    // FAVORITE META (bid timeline, notes, dates)
    // ==========================================

    async saveFavoriteMetaInDB(houseId, meta) {
        if (!this.familyCode || !this.canUseFamilySync()) return;
        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const key = this.sanitizeForFirebase(String(houseId));
        try {
            await this.db.ref(`families/${sanitizedCode}/favoriteMeta/${key}`).set({
                ...meta,
                updatedAt: firebase.database.ServerValue.TIMESTAMP,
            });
        } catch (e) {
            console.error('Error saving favorite meta:', e);
        }
    }

    async loadAllFavoriteMetaFromDB() {
        if (!this.familyCode || !this.canUseFamilySync()) return {};
        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        try {
            const snapshot = await this.db.ref(`families/${sanitizedCode}/favoriteMeta`).once('value');
            return snapshot.val() || {};
        } catch (e) {
            console.error('Error loading favorite meta:', e);
            return {};
        }
    }
}

// Export
window.FamilySync = FamilySync;
