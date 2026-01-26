// Firebase Configuration voor Familie Sync
// Gebruikt Firebase Realtime Database voor het delen van favorieten tussen gezinsleden

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
        this.members = new Map();
        this.onFamilyUpdate = null;
        this.unsubscribe = null;
        this.db = null;
        this.isFirebaseReady = false;

        this.init();
    }

    async init() {
        // Initialize Firebase
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            this.db = firebase.database();
            
            this.isFirebaseReady = true;
            console.log('🔥 Firebase initialized successfully!');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            this.isFirebaseReady = false;
        }

        // Laad opgeslagen familie code
        this.familyCode = localStorage.getItem('funda-family-code');
        this.userName = localStorage.getItem('funda-user-name') || this.generateUserName();

        if (this.familyCode && this.isFirebaseReady) {
            await this.startRealtimeSync();
        }
    }
    generateUserName() {
        const adjectives = ['Vrolijke', 'Slimme', 'Snelle', 'Leuke', 'Handige'];
        const nouns = ['Huizenjager', 'Woningzoeker', 'Appartementfan', 'Grachtenloper', 'Stadsmens'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj} ${noun}`;
    }

    generateFamilyCode() {
        // Genereer een makkelijk te onthouden code
        const words = ['huis', 'tuin', 'gracht', 'boot', 'fiets', 'tulp', 'molen', 'kaas', 'klok', 'brug'];
        const word1 = words[Math.floor(Math.random() * words.length)];
        const word2 = words[Math.floor(Math.random() * words.length)];
        const number = Math.floor(Math.random() * 100);
        return `${word1}-${word2}-${number}`;
    }

    // Sanitize family code for Firebase path (no dots, #, $, [, ])
    sanitizeForFirebase(str) {
        return str.replace(/[.#$\[\]]/g, '_');
    }

    async createFamily(userName) {
        if (!this.isFirebaseReady) {
            console.error('Firebase not ready');
            return null;
        }

        this.userName = userName || this.userName;
        this.familyCode = this.generateFamilyCode();

        localStorage.setItem('funda-family-code', this.familyCode);
        localStorage.setItem('funda-user-name', this.userName);

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        // Initialiseer de familie in Firebase
        try {
            const familyRef = this.db.ref(`families/${sanitizedCode}`);
            
            // Set family metadata
            await familyRef.child('metadata').set({
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                createdBy: this.userName
            });

            // Add current user as member
            await familyRef.child(`members/${sanitizedName}`).set({
                name: this.userName,
                favorites: [],
                joinedAt: firebase.database.ServerValue.TIMESTAMP,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

            console.log(`✅ Family created: ${this.familyCode}`);
            await this.startRealtimeSync();

            return this.familyCode;
        } catch (error) {
            console.error('Error creating family:', error);
            return null;
        }
    }

    async joinFamily(familyCode, userName) {
        if (!this.isFirebaseReady) {
            console.error('Firebase not ready');
            return false;
        }

        this.familyCode = familyCode.toLowerCase().trim();
        this.userName = userName || this.userName;

        localStorage.setItem('funda-family-code', this.familyCode);
        localStorage.setItem('funda-user-name', this.userName);

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        try {
            // Check if family exists
            const familyRef = this.db.ref(`families/${sanitizedCode}`);
            const snapshot = await familyRef.once('value');

            if (!snapshot.exists()) {
                // Create the family if it doesn't exist
                await familyRef.child('metadata').set({
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    createdBy: this.userName
                });
            }

            // Sync bestaande favorieten naar de familie
            const existingFavorites = JSON.parse(localStorage.getItem('funda-favorites') || '[]');
            const favoriteIds = existingFavorites.map(h => h.id);

            // Add current user as member
            await familyRef.child(`members/${sanitizedName}`).set({
                name: this.userName,
                favorites: favoriteIds,
                joinedAt: firebase.database.ServerValue.TIMESTAMP,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });

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
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        try {
            // Remove user from family
            if (this.isFirebaseReady) {
                await this.db.ref(`families/${sanitizedCode}/members/${sanitizedName}`).remove();
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
        if (!this.familyCode || !this.isFirebaseReady) return;

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
        if (!this.familyCode || !this.isFirebaseReady) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        try {
            await this.db.ref(`families/${sanitizedCode}/members/${sanitizedName}/lastSeen`)
                .set(firebase.database.ServerValue.TIMESTAMP);
        } catch (error) {
            console.error('Error updating presence:', error);
        }
    }

    async addFavorite(houseId) {
        if (!this.familyCode || !this.isFirebaseReady) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        try {
            const memberRef = this.db.ref(`families/${sanitizedCode}/members/${sanitizedName}`);
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
        if (!this.familyCode || !this.isFirebaseReady) return;

        const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
        const sanitizedName = this.sanitizeForFirebase(this.userName);

        try {
            const memberRef = this.db.ref(`families/${sanitizedCode}/members/${sanitizedName}`);
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
                favoriteCount: (data.favorites || []).length,
                lastSeen: data.lastSeen,
                isCurrentUser: (data.name || name) === this.userName
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
}

// Export
window.FamilySync = FamilySync;
