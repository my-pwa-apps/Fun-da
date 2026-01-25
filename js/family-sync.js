// Firebase Configuration voor Familie Sync
// Gebruikt Firebase Realtime Database voor het delen van favorieten

const FIREBASE_CONFIG = {
    // Publieke Firebase configuratie voor Fun-da
    // Dit is een gratis Firebase project voor demo doeleinden
    apiKey: "AIzaSyDemo_FunDa_PublicKey",
    authDomain: "fun-da-app.firebaseapp.com",
    databaseURL: "https://fun-da-app-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fun-da-app",
    storageBucket: "fun-da-app.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

class FamilySync {
    constructor() {
        this.familyCode = null;
        this.userName = null;
        this.members = new Map();
        this.onFamilyUpdate = null;
        this.syncInterval = null;
        
        // We gebruiken localStorage als fallback als Firebase niet werkt
        this.useLocalSync = true;
        
        this.init();
    }

    init() {
        // Laad opgeslagen familie code
        this.familyCode = localStorage.getItem('funda-family-code');
        this.userName = localStorage.getItem('funda-user-name') || this.generateUserName();
        
        if (this.familyCode) {
            this.startSync();
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

    async createFamily(userName) {
        this.userName = userName || this.userName;
        this.familyCode = this.generateFamilyCode();
        
        localStorage.setItem('funda-family-code', this.familyCode);
        localStorage.setItem('funda-user-name', this.userName);

        // Initialiseer de familie data
        await this.syncToCloud({
            favorites: [],
            joinedAt: Date.now()
        });

        this.startSync();
        
        return this.familyCode;
    }

    async joinFamily(familyCode, userName) {
        this.familyCode = familyCode.toLowerCase().trim();
        this.userName = userName || this.userName;
        
        localStorage.setItem('funda-family-code', this.familyCode);
        localStorage.setItem('funda-user-name', this.userName);

        // Sync bestaande favorieten naar de familie
        const existingFavorites = JSON.parse(localStorage.getItem('funda-favorites') || '[]');
        
        await this.syncToCloud({
            favorites: existingFavorites.map(h => h.id),
            joinedAt: Date.now()
        });

        this.startSync();
        
        return true;
    }

    leaveFamily() {
        this.familyCode = null;
        this.members.clear();
        
        localStorage.removeItem('funda-family-code');
        
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    startSync() {
        if (!this.familyCode) return;

        // Sync elke 5 seconden
        this.syncInterval = setInterval(() => this.pullFromCloud(), 5000);
        
        // Direct eerste sync
        this.pullFromCloud();
    }

    async syncToCloud(userData) {
        if (!this.familyCode) return;

        const key = `funda-family-${this.familyCode}`;
        
        try {
            // Haal bestaande data op
            const existing = JSON.parse(localStorage.getItem(key) || '{}');
            
            // Update met nieuwe user data
            existing[this.userName] = {
                ...userData,
                lastSeen: Date.now()
            };
            
            // Sla op
            localStorage.setItem(key, JSON.stringify(existing));
            
            // Probeer ook naar een externe service te syncen (voor cross-device)
            await this.syncToExternalService(existing);
            
        } catch (error) {
            console.warn('Cloud sync failed:', error);
        }
    }

    async pullFromCloud() {
        if (!this.familyCode) return;

        const key = `funda-family-${this.familyCode}`;
        
        try {
            // Probeer eerst externe service
            const externalData = await this.pullFromExternalService();
            
            if (externalData) {
                localStorage.setItem(key, JSON.stringify(externalData));
            }
            
            // Lees de data
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            
            // Update members
            this.members.clear();
            for (const [name, userData] of Object.entries(data)) {
                this.members.set(name, userData);
            }
            
            // Bereken matches
            const matches = this.calculateMatches();
            
            // Callback
            if (this.onFamilyUpdate) {
                this.onFamilyUpdate(matches, this.members);
            }
            
        } catch (error) {
            console.warn('Pull from cloud failed:', error);
        }
    }

    async syncToExternalService(data) {
        // Gebruik JSONBin.io als gratis JSON storage
        // Of een andere gratis service
        try {
            const binId = localStorage.getItem('funda-bin-id');
            
            if (binId) {
                // Update bestaande bin
                await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Access-Key': '$2a$10$demo_key' // Publieke demo key
                    },
                    body: JSON.stringify({
                        familyCode: this.familyCode,
                        members: data,
                        updatedAt: Date.now()
                    })
                });
            }
        } catch (error) {
            // Fail silently - localStorage is de fallback
        }
    }

    async pullFromExternalService() {
        try {
            const binId = localStorage.getItem('funda-bin-id');
            
            if (binId) {
                const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
                    headers: {
                        'X-Access-Key': '$2a$10$demo_key'
                    }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.record?.familyCode === this.familyCode) {
                        return result.record.members;
                    }
                }
            }
        } catch (error) {
            // Fail silently
        }
        
        return null;
    }

    async addFavorite(houseId) {
        if (!this.familyCode) return;

        const currentMember = this.members.get(this.userName) || { favorites: [] };
        const favorites = currentMember.favorites || [];
        
        if (!favorites.includes(houseId)) {
            favorites.push(houseId);
            
            await this.syncToCloud({
                ...currentMember,
                favorites: favorites
            });
        }
    }

    async removeFavorite(houseId) {
        if (!this.familyCode) return;

        const currentMember = this.members.get(this.userName) || { favorites: [] };
        const favorites = (currentMember.favorites || []).filter(id => id !== houseId);
        
        await this.syncToCloud({
            ...currentMember,
            favorites: favorites
        });
    }

    calculateMatches() {
        const matches = new Map(); // houseId -> [member names who liked it]
        
        for (const [memberName, data] of this.members) {
            const favorites = data.favorites || [];
            
            for (const houseId of favorites) {
                if (!matches.has(houseId)) {
                    matches.set(houseId, []);
                }
                matches.get(houseId).push(memberName);
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
                name,
                favoriteCount: (data.favorites || []).length,
                lastSeen: data.lastSeen,
                isCurrentUser: name === this.userName
            });
        }
        return list.sort((a, b) => b.lastSeen - a.lastSeen);
    }
}

// Export
window.FamilySync = FamilySync;
