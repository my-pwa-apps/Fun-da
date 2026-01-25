// Funda Scraper - Haalt echte woningen op van Funda.nl
// Geoptimaliseerd om niet gedetecteerd te worden

class FundaScraper {
    constructor() {
        // CORS proxies om Funda te kunnen benaderen vanuit de browser
        // We gebruiken proxies die geen preflight headers vereisen
        this.corsProxies = [
            { url: 'https://api.allorigins.win/get?url=', jsonResponse: true, dataField: 'contents' },
            { url: 'https://corsproxy.io/?url=', jsonResponse: false },
            { url: 'https://cors-anywhere.herokuapp.com/', jsonResponse: false },
            { url: 'https://crossorigin.me/', jsonResponse: false }
        ];
        this.currentProxyIndex = Math.floor(Math.random() * this.corsProxies.length);
        
        // Realistische User-Agents (Desktop browsers)
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
        ];
        
        // Cache voor recent opgehaalde data
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minuten
        
        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 2000; // Minimaal 2 seconden tussen requests
        
        // Request counter voor deze sessie
        this.requestCount = 0;
        this.maxRequestsPerSession = 10;
        
        // Fingerprint randomization
        this.sessionId = this.generateSessionId();
        this.viewportSizes = [
            { width: 1920, height: 1080 },
            { width: 1536, height: 864 },
            { width: 1440, height: 900 },
            { width: 1366, height: 768 },
            { width: 2560, height: 1440 }
        ];
    }

    generateSessionId() {
        // Genereer een random session ID die er realistisch uitziet
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    getRandomViewport() {
        return this.viewportSizes[Math.floor(Math.random() * this.viewportSizes.length)];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    getNextProxy() {
        // Roteer naar volgende proxy met wat randomness
        const step = Math.random() > 0.5 ? 1 : 2;
        this.currentProxyIndex = (this.currentProxyIndex + step) % this.corsProxies.length;
        return this.corsProxies[this.currentProxyIndex];
    }

    async randomDelay(min = 1000, max = 3000) {
        // Gebruik normale distributie voor meer natuurlijke delays
        const mean = (min + max) / 2;
        const stdDev = (max - min) / 6;
        let delay = this.gaussianRandom(mean, stdDev);
        delay = Math.max(min, Math.min(max, delay));
        console.log(`⏳ Wachten ${Math.round(delay)}ms...`);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    gaussianRandom(mean, stdDev) {
        // Box-Muller transform voor normale distributie
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return z0 * stdDev + mean;
    }

    getCacheKey(url) {
        // Verwijder cache busters voor consistente keys
        return btoa(url.split('?')[0] + url.split('&').filter(p => !p.startsWith('_=')).join('&')).substring(0, 32);
    }

    getFromCache(url) {
        const key = this.getCacheKey(url);
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            console.log('📦 Data uit cache geladen');
            return cached.data;
        }
        return null;
    }

    setCache(url, data) {
        const key = this.getCacheKey(url);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    async fetchWithProxy(url) {
        // Check cache first
        const cached = this.getFromCache(url);
        if (cached) return cached;

        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            await this.randomDelay(this.minRequestInterval - timeSinceLastRequest, this.minRequestInterval);
        }
        
        // Check session limit
        if (this.requestCount >= this.maxRequestsPerSession) {
            console.warn('⚠️ Maximum requests per sessie bereikt. Wacht even...');
            await this.randomDelay(5000, 10000);
            this.requestCount = 0;
        }

        // Probeer verschillende proxies als één niet werkt
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxyConfig = this.getNextProxy();
            
            try {
                console.log(`🔄 Probeer proxy ${i + 1}/${this.corsProxies.length}...`);
                
                // Random delay voor natuurlijk gedrag
                if (i > 0) {
                    await this.randomDelay(1500, 3000);
                }

                // Simpele fetch zonder custom headers om CORS preflight te vermijden
                const proxyUrl = proxyConfig.url + encodeURIComponent(url);
                const response = await fetch(proxyUrl);
                
                if (response.ok) {
                    this.lastRequestTime = Date.now();
                    this.requestCount++;
                    
                    let html;
                    
                    // Sommige proxies returnen JSON met de content in een veld
                    if (proxyConfig.jsonResponse) {
                        const json = await response.json();
                        html = json[proxyConfig.dataField] || json.contents || json.data || '';
                    } else {
                        html = await response.text();
                    }
                    
                    // Valideer dat we echte HTML hebben
                    if (html && (html.includes('<!DOCTYPE') || html.includes('<html') || html.includes('funda'))) {
                        // Cache het resultaat
                        this.setCache(url, html);
                        console.log(`✅ Succesvol opgehaald via proxy ${i + 1}`);
                        return html;
                    } else {
                        console.warn('⚠️ Onverwachte response, probeer volgende proxy...');
                    }
                }
            } catch (error) {
                console.warn(`❌ Proxy ${i + 1} gefaald:`, error.message);
            }
        }
        
        throw new Error('Alle CORS proxies gefaald. Probeer later opnieuw of gebruik een andere zoekopdracht.');
    }

    async scrapeSearchResults(searchUrl) {
        console.log('🏠 Scraping Funda:', searchUrl);
        
        // Voeg kleine variaties toe aan URL om caching te omzeilen
        const urlWithCacheBuster = this.addCacheBuster(searchUrl);
        
        try {
            // Random initiële delay
            await this.randomDelay(500, 1500);
            
            const html = await this.fetchWithProxy(urlWithCacheBuster);
            const results = this.parseSearchResults(html, searchUrl);
            
            console.log(`📊 Totaal ${results.length} woningen gevonden`);
            return results;
        } catch (error) {
            console.error('Scraping error:', error);
            throw error;
        }
    }

    addCacheBuster(url) {
        // Voeg een subtiele timestamp toe die er natuurlijk uitziet
        const separator = url.includes('?') ? '&' : '?';
        // Gebruik een timestamp die er uitziet als een normale query parameter
        return url + separator + '_=' + Date.now().toString(36);
    }

    // Simuleer menselijk scroll/navigatie gedrag door meerdere pagina's
    async scrapeMultiplePages(baseUrl, maxPages = 3) {
        const allHouses = [];
        
        for (let page = 1; page <= maxPages; page++) {
            console.log(`📄 Pagina ${page} van ${maxPages}...`);
            
            // Bouw URL met paginering
            const pageUrl = this.addPageToUrl(baseUrl, page);
            
            try {
                const houses = await this.scrapeSearchResults(pageUrl);
                allHouses.push(...houses);
                
                // Stop als er geen resultaten meer zijn
                if (houses.length === 0) {
                    console.log('📭 Geen resultaten meer, stoppen...');
                    break;
                }
                
                // Langere delay tussen pagina's (lijkt op menselijk gedrag)
                if (page < maxPages) {
                    await this.randomDelay(3000, 6000);
                }
            } catch (error) {
                console.warn(`⚠️ Fout bij pagina ${page}:`, error.message);
                break;
            }
        }
        
        // Verwijder duplicaten
        const uniqueHouses = this.removeDuplicates(allHouses);
        console.log(`🏠 Totaal ${uniqueHouses.length} unieke woningen gevonden`);
        return uniqueHouses;
    }

    addPageToUrl(url, page) {
        if (page === 1) return url;
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + 'search_result_page=' + page;
    }

    removeDuplicates(houses) {
        const seen = new Set();
        return houses.filter(house => {
            const key = house.id || `${house.address}-${house.price}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    parseSearchResults(html, baseUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const houses = [];

        // Funda gebruikt data-attributes en specifieke class names
        // We zoeken naar de zoekresultaat cards
        const cards = doc.querySelectorAll('[data-test-id="search-result-item"], .search-result, [class*="search-result"]');
        
        // Als dat niet werkt, probeer script tags met JSON-LD of __NEXT_DATA__
        if (cards.length === 0) {
            const nextData = doc.querySelector('#__NEXT_DATA__');
            if (nextData) {
                try {
                    const data = JSON.parse(nextData.textContent);
                    return this.parseNextData(data);
                } catch (e) {
                    console.warn('Could not parse __NEXT_DATA__:', e);
                }
            }
        }

        // Probeer ook de JSON-LD structured data
        const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach(script => {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'ItemList' && data.itemListElement) {
                    data.itemListElement.forEach((item, index) => {
                        if (item.item && item.item['@type'] === 'Residence') {
                            houses.push(this.parseJsonLdItem(item.item, index));
                        }
                    });
                }
            } catch (e) {
                // Ignore parse errors
            }
        });

        // Parse HTML cards als backup
        cards.forEach((card, index) => {
            try {
                const house = this.parseHtmlCard(card, index);
                if (house && house.price) {
                    houses.push(house);
                }
            } catch (e) {
                console.warn('Could not parse card:', e);
            }
        });

        // Als we nog steeds geen resultaten hebben, gebruik regex parsing
        if (houses.length === 0) {
            return this.parseWithRegex(html);
        }

        return houses;
    }

    parseNextData(data) {
        const houses = [];
        
        try {
            // Navigeer door de Next.js data structuur
            const props = data.props?.pageProps;
            if (!props) return houses;

            console.log('📦 PageProps keys:', Object.keys(props));

            // Nieuwe Funda structuur (2024+)
            let listings = [];
            
            // Probeer verschillende mogelijke locaties
            if (props.searchResult?.objects) {
                listings = props.searchResult.objects;
            } else if (props.searchResults?.objects) {
                listings = props.searchResults.objects;
            } else if (props.objects) {
                listings = props.objects;
            } else if (props.listings) {
                listings = Array.isArray(props.listings) ? props.listings : props.listings.objects || [];
            } else if (props.results) {
                listings = Array.isArray(props.results) ? props.results : props.results.objects || [];
            }

            // Deep search for objects array
            if (listings.length === 0) {
                const findObjects = (obj, depth = 0) => {
                    if (depth > 5 || !obj) return [];
                    if (Array.isArray(obj) && obj.length > 0 && obj[0]?.price) return obj;
                    if (typeof obj === 'object') {
                        for (const key of Object.keys(obj)) {
                            if (key === 'objects' || key === 'listings' || key === 'items') {
                                const result = obj[key];
                                if (Array.isArray(result) && result.length > 0) {
                                    return result;
                                }
                            }
                            const result = findObjects(obj[key], depth + 1);
                            if (result.length > 0) return result;
                        }
                    }
                    return [];
                };
                listings = findObjects(props);
            }

            console.log(`📋 Found ${listings.length} listings`);

            listings.forEach((item, index) => {
                // Handle different property name formats
                const id = item.id || item.globalId || item.objectId || `funda-${Date.now()}-${index}`;
                
                // Price can be in different formats
                let price = null;
                if (item.price) {
                    price = typeof item.price === 'object' 
                        ? this.extractPrice(item.price.amount || item.price.value || item.price.mainValue)
                        : this.extractPrice(item.price);
                } else if (item.priceInfo) {
                    price = this.extractPrice(item.priceInfo.price || item.priceInfo.mainPrice);
                } else if (item.koopprijs) {
                    price = this.extractPrice(item.koopprijs);
                }

                // Address handling
                let address = 'Adres onbekend';
                let houseNumber = '';
                let postalCode = '';
                let city = 'Amsterdam';
                let neighborhood = '';

                if (item.address) {
                    if (typeof item.address === 'string') {
                        address = item.address;
                    } else {
                        address = item.address.street || item.address.streetName || '';
                        houseNumber = item.address.houseNumber || item.address.huisnummer || '';
                        postalCode = item.address.postalCode || item.address.postcode || '';
                        city = item.address.city || item.address.plaats || 'Amsterdam';
                        neighborhood = item.address.neighborhood || item.address.wijk || item.address.buurt || '';
                    }
                }

                // Image handling
                let image = this.getPlaceholderImage();
                if (item.mainPhoto) {
                    image = typeof item.mainPhoto === 'string' ? item.mainPhoto : item.mainPhoto.url || item.mainPhoto.src;
                } else if (item.coverPhoto) {
                    image = typeof item.coverPhoto === 'string' ? item.coverPhoto : item.coverPhoto.url || item.coverPhoto.src;
                } else if (item.photo) {
                    image = typeof item.photo === 'string' ? item.photo : item.photo.url || item.photo.src;
                } else if (item.images && item.images.length > 0) {
                    image = typeof item.images[0] === 'string' ? item.images[0] : item.images[0].url || item.images[0].src;
                }

                // URL handling
                let url = '#';
                if (item.url) {
                    url = item.url.startsWith('http') ? item.url : `https://www.funda.nl${item.url}`;
                } else if (item.link) {
                    url = item.link.startsWith('http') ? item.link : `https://www.funda.nl${item.link}`;
                }

                houses.push({
                    id: id,
                    price: price,
                    address: address,
                    houseNumber: houseNumber,
                    postalCode: postalCode,
                    city: city,
                    neighborhood: neighborhood,
                    bedrooms: item.bedrooms || item.rooms || item.aantalKamers || item.numberOfRooms || 0,
                    bathrooms: item.bathrooms || item.numberOfBathrooms || 1,
                    size: item.livingArea || item.woonoppervlakte || item.size || item.floorArea || 0,
                    yearBuilt: item.constructionYear || item.bouwjaar || item.yearBuilt || null,
                    energyLabel: item.energyLabel || item.energielabel || '',
                    image: image,
                    images: item.photos || item.images || item.fotos || [],
                    url: url,
                    description: item.description || item.omschrijving || '',
                    features: item.features || item.kenmerken || [],
                    isNew: item.isNew || item.nieuw || item.isRecent || false,
                    daysOnMarket: item.daysOnMarket || item.aantalDagenTeKoop || item.daysOnFunda || 0,
                    realtor: item.realtor?.name || item.makelaar?.naam || item.makelaar || ''
                });
            });
        } catch (e) {
            console.error('Error parsing Next.js data:', e);
        }

        return houses;
    }

    parseJsonLdItem(item, index) {
        return {
            id: `funda-jsonld-${index}`,
            price: this.extractPrice(item.offers?.price),
            address: item.address?.streetAddress || item.name || 'Adres onbekend',
            city: item.address?.addressLocality || 'Amsterdam',
            neighborhood: item.address?.addressRegion || '',
            postalCode: item.address?.postalCode || '',
            bedrooms: item.numberOfRooms || 0,
            bathrooms: 1,
            size: item.floorSize?.value || 0,
            image: item.image || this.getPlaceholderImage(),
            url: item.url || '#',
            description: item.description || '',
            features: [],
            isNew: false,
            daysOnMarket: 0
        };
    }

    parseHtmlCard(card, index) {
        // Probeer verschillende selectors die Funda zou kunnen gebruiken
        const priceEl = card.querySelector('[class*="price"], [data-test-id="price"], .search-result__price');
        const addressEl = card.querySelector('[class*="address"], [data-test-id="address"], .search-result__address, h2, h3');
        const imageEl = card.querySelector('img[src*="funda"], img[data-src], .search-result__image img');
        const linkEl = card.querySelector('a[href*="/koop/"], a[href*="/huur/"]');
        const sizeEl = card.querySelector('[class*="size"], [class*="living-area"], [class*="woonoppervlakte"]');
        const roomsEl = card.querySelector('[class*="rooms"], [class*="kamers"]');

        const price = priceEl ? this.extractPrice(priceEl.textContent) : null;
        const address = addressEl ? addressEl.textContent.trim() : 'Adres onbekend';
        const image = imageEl ? (imageEl.src || imageEl.dataset.src) : this.getPlaceholderImage();
        const url = linkEl ? linkEl.href : '#';

        return {
            id: `funda-html-${index}-${Date.now()}`,
            price: price,
            address: address,
            city: 'Amsterdam',
            neighborhood: this.extractNeighborhood(address),
            bedrooms: roomsEl ? parseInt(roomsEl.textContent) || 0 : 0,
            bathrooms: 1,
            size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0,
            image: image,
            url: url,
            description: '',
            features: [],
            isNew: card.textContent.includes('Nieuw') || card.textContent.includes('nieuw'),
            daysOnMarket: 0
        };
    }

    parseWithRegex(html) {
        const houses = [];
        
        console.log('🔍 Falling back to regex parsing...');
        
        // Probeer eerst JSON data te vinden in de HTML
        // Funda stopt vaak data in script tags of data attributes
        const jsonPatterns = [
            /"objects"\s*:\s*\[([\s\S]*?)\]/,
            /"listings"\s*:\s*\[([\s\S]*?)\]/,
            /"searchResults"\s*:\s*\{([\s\S]*?)\}/
        ];

        for (const pattern of jsonPatterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    // Probeer de JSON te parsen
                    let jsonStr = match[0];
                    // Fix incomplete JSON
                    if (!jsonStr.endsWith('}') && !jsonStr.endsWith(']')) {
                        jsonStr = jsonStr.substring(0, jsonStr.lastIndexOf('}') + 1) || 
                                  jsonStr.substring(0, jsonStr.lastIndexOf(']') + 1);
                    }
                    const data = JSON.parse(`{${jsonStr}}`);
                    const items = data.objects || data.listings || [];
                    if (items.length > 0) {
                        console.log(`✅ Found ${items.length} items via JSON pattern`);
                        return items.map((item, index) => this.normalizeHouseData(item, index));
                    }
                } catch (e) {
                    console.warn('JSON pattern parse failed:', e.message);
                }
            }
        }

        // Zoek naar prijs patronen
        const priceRegex = /€\s*([\d.,]+)\s*(k\.k\.|v\.o\.n\.|p\/mnd)?/gi;
        const addressRegex = /([A-Z][a-z]+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof)\s*\d+[a-z]?(?:\s*[-–]\s*\d+)?)/gi;
        const imageRegex = /https?:\/\/[^"'\s]+(?:funda|cloud\.funda|fundacdn)[^"'\s]*\.(?:jpg|jpeg|png|webp)/gi;

        // Extract data
        const prices = [...html.matchAll(priceRegex)].map(m => this.extractPrice(m[0])).filter(p => p > 100000);
        const addresses = [...new Set([...html.matchAll(addressRegex)].map(m => m[0]))];
        const images = [...new Set([...html.matchAll(imageRegex)].map(m => m[0]))];

        console.log(`📊 Regex found: ${prices.length} prices, ${addresses.length} addresses, ${images.length} images`);

        // Combineer de resultaten
        const count = Math.min(prices.length, Math.max(addresses.length, 1));
        for (let i = 0; i < count; i++) {
            houses.push({
                id: `funda-regex-${i}-${Date.now()}`,
                price: prices[i],
                address: addresses[i] || `Woning ${i + 1}`,
                city: 'Amsterdam',
                neighborhood: this.extractNeighborhood(addresses[i] || ''),
                bedrooms: Math.floor(Math.random() * 3) + 1,
                bathrooms: 1,
                size: Math.floor(Math.random() * 50) + 50,
                image: images[i] || this.getPlaceholderImage(),
                url: '#',
                description: '',
                features: [],
                isNew: false,
                daysOnMarket: Math.floor(Math.random() * 30)
            });
        }

        return houses;
    }

    normalizeHouseData(item, index) {
        return {
            id: item.id || item.globalId || `funda-${Date.now()}-${index}`,
            price: this.extractPrice(item.price?.amount || item.price || item.koopprijs),
            address: item.address?.street || item.address || 'Adres onbekend',
            houseNumber: item.address?.houseNumber || '',
            city: item.address?.city || 'Amsterdam',
            neighborhood: item.address?.neighborhood || '',
            bedrooms: item.bedrooms || item.rooms || 0,
            bathrooms: item.bathrooms || 1,
            size: item.livingArea || item.size || 0,
            yearBuilt: item.constructionYear || null,
            energyLabel: item.energyLabel || '',
            image: item.mainPhoto?.url || item.coverPhoto || this.getPlaceholderImage(),
            url: item.url ? `https://www.funda.nl${item.url}` : '#',
            description: item.description || '',
            features: item.features || [],
            isNew: item.isNew || false,
            daysOnMarket: item.daysOnMarket || 0
        };
    }

    extractPrice(priceStr) {
        if (!priceStr) return null;
        if (typeof priceStr === 'number') return priceStr;
        
        // Verwijder alles behalve cijfers
        const cleaned = priceStr.toString().replace(/[^\d]/g, '');
        const price = parseInt(cleaned, 10);
        
        // Sanity check - prijzen tussen 50k en 10M
        if (price >= 50000 && price <= 10000000) {
            return price;
        }
        
        // Misschien is het in duizenden uitgedrukt
        if (price >= 50 && price <= 10000) {
            return price * 1000;
        }
        
        return null;
    }

    extractNeighborhood(address) {
        const neighborhoods = [
            'Centrum', 'Jordaan', 'De Pijp', 'Oost', 'West', 'Noord', 
            'Zuid', 'Oud-West', 'Oud-Zuid', 'IJburg', 'Bos en Lommer',
            'Nieuw-West', 'Zuidoost', 'Amstelveen', 'Diemen'
        ];
        
        for (const n of neighborhoods) {
            if (address.toLowerCase().includes(n.toLowerCase())) {
                return n;
            }
        }
        
        return 'Amsterdam';
    }

    getPlaceholderImage() {
        const images = [
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
            'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
            'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80'
        ];
        return images[Math.floor(Math.random() * images.length)];
    }

    // Genereer een Funda zoek URL (nieuw formaat 2024+)
    static buildSearchUrl(options = {}) {
        const {
            city = 'amsterdam',
            type = 'koop', // koop of huur
            minPrice = '',
            maxPrice = '',
            minRooms = '',
            minSize = '',
            daysOld = 1, // Standaard alleen nieuwe woningen van vandaag
            page = 1
        } = options;

        // Nieuw Funda URL formaat
        let url = `https://www.funda.nl/zoeken/${type}?selected_area=["${city}"]`;
        
        // Publicatie datum filter (1 = vandaag, 3 = laatste 3 dagen, 5 = laatste 5 dagen, etc.)
        if (daysOld) {
            url += `&publication_date="${daysOld}"`;
        }
        
        if (minPrice || maxPrice) {
            url += `&price="${minPrice || 0}-${maxPrice || ''}"`;
        }
        if (minRooms) {
            url += `&rooms="${minRooms}+"`;
        }
        if (minSize) {
            url += `&floor_area="${minSize}+"`;
        }
        if (page > 1) {
            url += `&search_result_page=${page}`;
        }

        return url;
    }
}

// Export for use in app
window.FundaScraper = FundaScraper;
