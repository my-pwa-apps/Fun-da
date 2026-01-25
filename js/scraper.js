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
        this.cacheExpiry = 1 * 60 * 1000; // 1 minuut (voor debugging, later terug naar 5)
        
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
                        // Debug: log eerste 500 chars om te zien wat we krijgen
                        console.log('📄 Response preview:', html.substring(0, 500));
                        
                        // Check of het een bot-detectie pagina is
                        if (html.includes('captcha') || html.includes('challenge') || html.includes('blocked') || html.includes('Access Denied')) {
                            console.warn('🤖 Bot detectie pagina ontvangen, probeer volgende proxy...');
                            continue;
                        }
                        
                        // Cache het resultaat
                        this.setCache(url, html);
                        console.log(`✅ Succesvol opgehaald via proxy ${i + 1}`);
                        return html;
                    } else {
                        console.warn('⚠️ Onverwachte response, probeer volgende proxy...', html ? html.substring(0, 200) : 'empty');
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

        // EERST probeer __NEXT_DATA__ - dit is de meest betrouwbare bron
        const nextData = doc.querySelector('#__NEXT_DATA__');
        if (nextData) {
            try {
                const data = JSON.parse(nextData.textContent);
                console.log('📦 Found __NEXT_DATA__ via DOM');
                const parsed = this.parseNextData(data);
                if (parsed.length > 0) {
                    return parsed;
                }
            } catch (e) {
                console.warn('Could not parse __NEXT_DATA__:', e);
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

        // Als JSON-LD resultaten heeft, return die
        if (houses.length > 0) {
            return houses;
        }

        // Probeer HTML cards te parsen als laatste optie
        const cards = doc.querySelectorAll('[data-test-id="search-result-item"], .search-result, [class*="search-result"]');
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
            if (!props) {
                console.log('❌ No pageProps found');
                return houses;
            }

            console.log('📦 PageProps keys:', Object.keys(props));
            
            // Debug: log de hele props structuur (eerste 3000 chars)
            const propsStr = JSON.stringify(props);
            console.log('🔍 Full pageProps (first 3000 chars):', propsStr.substring(0, 3000));

            // Nieuwe Funda structuur (2024+) - zoek in verschillende locaties
            let listings = [];
            
            // Probeer alle bekende locaties
            const possiblePaths = [
                props.searchResult?.resultList,
                props.searchResult?.objects,
                props.searchResult?.listings,
                props.searchResults?.resultList,
                props.searchResults?.objects,
                props.searchResults?.listings,
                props.objects,
                props.listings,
                props.results,
                props.data?.searchResult?.resultList,
                props.data?.objects,
                // Nieuwe Funda 2025 structuur
                props.pageData?.searchResult?.resultList,
                props.dehydratedState?.queries?.[0]?.state?.data?.resultList,
            ];
            
            for (const path of possiblePaths) {
                if (Array.isArray(path) && path.length > 0) {
                    listings = path;
                    console.log('📍 Found listings in known path, count:', path.length);
                    break;
                }
            }

            // Deep search for arrays that look like listings
            if (listings.length === 0) {
                console.log('🔍 Deep searching for listings...');
                const findListings = (obj, path = '', depth = 0) => {
                    if (depth > 8 || !obj) return [];
                    
                    if (Array.isArray(obj) && obj.length > 0) {
                        // Check if this looks like a listing array
                        const first = obj[0];
                        if (first && typeof first === 'object') {
                            // Check for common listing properties
                            const hasListingProps = first.id || first.address || first.price || 
                                first.sellPrice || first.askingPrice || first.url || first.globalId;
                            if (hasListingProps) {
                                console.log(`📍 Found potential listings at ${path}, count:`, obj.length);
                                return obj;
                            }
                        }
                    }
                    
                    if (typeof obj === 'object' && obj !== null) {
                        for (const key of Object.keys(obj)) {
                            const result = findListings(obj[key], `${path}.${key}`, depth + 1);
                            if (result.length > 0) return result;
                        }
                    }
                    return [];
                };
                listings = findListings(props, 'props');
            }

            console.log(`📋 Found ${listings.length} listings`);
            
            // Debug: log eerste item om structuur te zien
            if (listings.length > 0) {
                console.log('🏠 First listing structure:', JSON.stringify(listings[0], null, 2));
            }

            listings.forEach((item, index) => {
                // Debug: log ALLE velden van eerste item
                if (index === 0) {
                    console.log('🏠 All item keys:', Object.keys(item));
                    console.log('💰 Raw price data:', JSON.stringify({
                        price: item.price,
                        priceInfo: item.priceInfo,
                        koopprijs: item.koopprijs,
                        sellPrice: item.sellPrice,
                        askingPrice: item.askingPrice,
                        salePrice: item.salePrice,
                        prijs: item.prijs,
                        vraagprijs: item.vraagprijs,
                        koopsomTotaal: item.koopsomTotaal,
                        // Nested price objects
                        priceSale: item.priceSale,
                        priceRent: item.priceRent,
                    }));
                }
                
                // Handle different property name formats
                const id = item.id || item.globalId || item.objectId || `funda-${Date.now()}-${index}`;
                
                // Price extraction - try ALL possible locations
                let price = this.extractPriceFromItem(item);
                
                // Debug: log extracted price for first 3 items
                if (index < 3) {
                    console.log(`💵 Item ${index} price extracted:`, price, 'from item:', item.address || item.id);
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

                // Image handling - try all possible image fields
                let image = null;
                
                // Debug: log alle mogelijke image velden voor eerste item
                if (index === 0) {
                    console.log('📷 Image fields:', {
                        mainPhoto: item.mainPhoto,
                        coverPhoto: item.coverPhoto,
                        photo: item.photo,
                        photos: item.photos,
                        images: item.images,
                        image: item.image,
                        media: item.media,
                        thumbnail: item.thumbnail,
                        primaryPhoto: item.primaryPhoto,
                        fotoPrimair: item.fotoPrimair,
                        foto: item.foto
                    });
                }
                
                // Try all possible image field locations
                const imageFields = [
                    item.mainPhoto?.url,
                    item.mainPhoto?.src,
                    item.mainPhoto,
                    item.coverPhoto?.url,
                    item.coverPhoto?.src,
                    item.coverPhoto,
                    item.primaryPhoto?.url,
                    item.primaryPhoto,
                    item.photo?.url,
                    item.photo,
                    item.thumbnail?.url,
                    item.thumbnail,
                    item.image?.url,
                    item.image,
                    item.media?.[0]?.url,
                    item.media?.[0],
                    item.photos?.[0]?.url,
                    item.photos?.[0],
                    item.images?.[0]?.url,
                    item.images?.[0],
                    item.fotoPrimair,
                    item.foto
                ];
                
                for (const field of imageFields) {
                    if (field && typeof field === 'string' && field.startsWith('http')) {
                        image = field;
                        break;
                    }
                }
                
                // Fallback to placeholder if no image found
                if (!image) {
                    image = this.getPlaceholderImage();
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
        
        // Debug: check of __NEXT_DATA__ in de HTML zit
        const hasNextData = html.includes('__NEXT_DATA__');
        console.log('📦 HTML contains __NEXT_DATA__:', hasNextData);
        
        // Probeer eerst de __NEXT_DATA__ te vinden via meerdere regex patronen
        const nextDataPatterns = [
            /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
            /<script id=\\"__NEXT_DATA__\\"[^>]*>([\s\S]*?)<\/script>/,
            /<script id='__NEXT_DATA__'[^>]*>([\s\S]*?)<\/script>/,
            /__NEXT_DATA__[^>]*>(\{[\s\S]*?\})<\/script>/,
        ];
        
        for (const pattern of nextDataPatterns) {
            const nextDataMatch = html.match(pattern);
            if (nextDataMatch && nextDataMatch[1]) {
                try {
                    // Clean up escaped characters if needed
                    let jsonStr = nextDataMatch[1];
                    if (jsonStr.includes('\\"')) {
                        jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    }
                    
                    const nextData = JSON.parse(jsonStr);
                    console.log('📦 Found __NEXT_DATA__ via regex, parsing...');
                    const parsed = this.parseNextData(nextData);
                    if (parsed.length > 0) {
                        return parsed;
                    }
                } catch (e) {
                    console.warn('Failed to parse __NEXT_DATA__:', e.message);
                }
            }
        }
        
        // Als __NEXT_DATA__ niet werkt, zoek naar inline JSON data
        // Funda 2024+ heeft vaak window.__NUXT__ of andere data formaten
        const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
        if (nuxtMatch) {
            try {
                const nuxtData = JSON.parse(nuxtMatch[1]);
                console.log('📦 Found __NUXT__ data');
                // Try to find listings in NUXT data
                if (nuxtData.data) {
                    const listings = this.findListingsInObject(nuxtData.data);
                    if (listings.length > 0) {
                        return listings.map((item, i) => this.normalizeHouseData(item, i));
                    }
                }
            } catch (e) {
                console.warn('Failed to parse __NUXT__:', e.message);
            }
        }
        
        // Probeer JSON data te vinden in de HTML
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

        // Zoek naar complete listing blokken in de HTML
        // Funda kaarten hebben meestal een prijs en adres dicht bij elkaar
        const listingBlockRegex = /<[^>]+data-test-id="search-result-item"[^>]*>[\s\S]*?<\/[^>]+>/gi;
        const cardMatches = html.match(listingBlockRegex) || [];
        
        // Verzamel ook alle Funda afbeelding URLs
        const allFundaImages = [...new Set([...html.matchAll(/https?:\/\/cloud\.funda\.nl\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi)].map(m => m[0]))];
        console.log(`📷 Found ${allFundaImages.length} Funda images in HTML`);
        
        // Helper function to get images for a house (cycles through available images)
        const getImagesForHouse = (index, totalHouses) => {
            if (allFundaImages.length === 0) return [];
            // Calculate how many images per house we can afford
            const imagesPerHouse = Math.max(1, Math.floor(allFundaImages.length / Math.max(1, totalHouses)));
            const startIdx = (index * imagesPerHouse) % allFundaImages.length;
            // Get up to 4 images, cycling through if needed
            const houseImages = [];
            for (let j = 0; j < Math.min(4, allFundaImages.length); j++) {
                const imgIdx = (startIdx + j) % allFundaImages.length;
                houseImages.push(allFundaImages[imgIdx]);
            }
            return houseImages;
        };
        
        console.log(`📊 Found ${cardMatches.length} listing blocks via data-test-id`);
        
        if (cardMatches.length > 0) {
            cardMatches.forEach((block, i) => {
                const priceMatch = block.match(/€\s*([\d.,]+)/);
                // Verbeterde adres regex met huisnummer toevoegingen (-2, -H, /I etc)
                const addressMatch = block.match(/([A-Za-z][a-zA-Z\s\-']+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof|steeg|markt|park)\s*\d+[a-zA-Z]?(?:[\-\/][a-zA-Z0-9]+)?)/i);
                // Verbeterde image regex voor Funda
                const imageMatch = block.match(/https?:\/\/cloud\.funda\.nl\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
                // Extra details uit block
                const sizeMatch = block.match(/(\d+)\s*m²/i);
                const roomMatch = block.match(/(\d+)\s*(?:kamers?|slaapkamers?)/i);
                const postcodeMatch = block.match(/\b(\d{4}\s*[A-Z]{2})\b/);
                
                if (priceMatch) {
                    const price = this.extractPrice(priceMatch[0]);
                    // Get multiple images for this house using the helper
                    const houseImages = getImagesForHouse(i, cardMatches.length);
                    const postcode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
                    
                    houses.push({
                        id: `funda-block-${i}-${Date.now()}`,
                        price: price,
                        address: addressMatch ? addressMatch[1] : `Woning ${i + 1}`,
                        postalCode: postcode,
                        city: 'Amsterdam',
                        neighborhood: this.getNeighborhoodFromPostcode(postcode) || this.extractNeighborhood(addressMatch ? addressMatch[1] : ''),
                        bedrooms: roomMatch ? parseInt(roomMatch[1]) : 0,
                        bathrooms: 1,
                        size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                        image: houseImages[0] || (imageMatch ? imageMatch[0] : this.getPlaceholderImage()),
                        images: houseImages.length > 0 ? houseImages : [],
                        url: '#',
                        description: '',
                        features: [],
                        isNew: block.toLowerCase().includes('nieuw'),
                        daysOnMarket: 0
                    });
                }
            });
            
            if (houses.length > 0) {
                console.log(`📊 Extracted ${houses.length} houses from listing blocks`);
                return houses;
            }
        }
        
        // Probeer een meer geavanceerde aanpak: zoek price+address paren
        // Zoek eerst alle kenmerken (m², kamers, postcodes) uit de HTML
        // Funda toont dit vaak als "85 m²" of "3 kamers"
        const allSizes = [...html.matchAll(/(\d+)\s*m²/gi)].map(m => parseInt(m[1]));
        const allRooms = [...html.matchAll(/(\d+)\s*(?:kamers?|slaapkamers?|kamer)/gi)].map(m => parseInt(m[1]));
        // Nederlandse postcodes: 1234 AB formaat - filter invalid codes
        const allPostcodes = [...html.matchAll(/\b(\d{4}\s*[A-Z]{2})\b/g)]
            .map(m => m[1].replace(/\s+/g, ' '))
            .filter(pc => {
                const digits = parseInt(pc.substring(0, 4));
                // Amsterdam postcodes are 1000-1109, also include nearby areas
                return digits >= 1000 && digits <= 1200;
            });
        
        console.log(`📊 Found ${allSizes.length} sizes, ${allRooms.length} room counts, ${allPostcodes.length} postcodes in HTML`);
        
        // NIEUWE AANPAK: Zoek naar Funda listing cards/items via meerdere methodes
        // Funda 2024+ gebruikt vaak data-attributes of specifieke class patterns
        
        // Verbeterde adres pattern die ook huisnummer toevoegingen vangt (bijv: 68-2, 10-H, 12-I, 15A-1)
        // Format: Straatnaam + huisnummer + optioneel: letter en/of -toevoeging
        const addressPattern = "([A-Z][a-zA-Z\\s\\-']+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof|park|markt|steeg|burcht|haven|brug|sluis|ring)\\s*\\d+[a-zA-Z]?(?:[\\-\\/][a-zA-Z0-9]+)?)";
        
        // Methode 1: Zoek naar listing items met prijs en adres dicht bij elkaar
        const listingPatterns = [
            // Pattern 1: "€ 650.000 k.k." gevolgd door postcode en adres
            new RegExp("€\\s*([\\d.,]+)\\s*(?:k\\.k\\.|v\\.o\\.n\\.)?[^<]*?(\\d{4}\\s*[A-Z]{2})[^<]*?" + addressPattern, "gi"),
            // Pattern 2: Adres gevolgd door postcode en prijs
            new RegExp(addressPattern + "[^<]*?(\\d{4}\\s*[A-Z]{2})[^<]*?€\\s*([\\d.,]+)", "gi"),
        ];
        
        let foundListings = [];
        
        for (const pattern of listingPatterns) {
            const matches = [...html.matchAll(pattern)];
            if (matches.length > foundListings.length) {
                foundListings = matches;
                console.log(`📊 Pattern matched ${matches.length} listings`);
            }
        }
        
        // Methode 2: Zoek naar listing blokken met alle data erin
        // Funda structureert data vaak als: [prijs] [m²] [kamers] [adres] [postcode]
        const completeListingRegex = new RegExp("€\\s*([\\d.,]+)[^€]{0,800}?(\\d+)\\s*m²[^€]{0,200}?(\\d+)\\s*(?:kamers?|slaapkamers?)[^€]{0,200}?" + addressPattern + "[^€]{0,100}?(\\d{4}\\s*[A-Z]{2})", "gi");
        const blockMatches = [...html.matchAll(completeListingRegex)];
        console.log(`📊 Block pattern found ${blockMatches.length} complete listings`);
        
        if (blockMatches.length > 0) {
            const seenAddresses = new Set();
            let imageIndex = 0;
            
            blockMatches.forEach((match, i) => {
                const [, price, size, rooms, address, postcode] = match;
                
                if (!seenAddresses.has(address)) {
                    seenAddresses.add(address);
                    const image = allFundaImages[imageIndex] || this.getPlaceholderImage();
                    imageIndex++;
                    
                    const cleanPostcode = postcode.replace(/\s+/g, ' ');
                    
                    houses.push({
                        id: `funda-block-${i}-${Date.now()}`,
                        price: this.extractPrice(price),
                        address: address.trim(),
                        postalCode: cleanPostcode,
                        city: 'Amsterdam',
                        neighborhood: this.getNeighborhoodFromPostcode(cleanPostcode) || this.extractNeighborhood(address),
                        bedrooms: parseInt(rooms) || 0,
                        bathrooms: 1,
                        size: parseInt(size) || 0,
                        image: image,
                        url: '#',
                        description: '',
                        features: [],
                        isNew: false,
                        daysOnMarket: 0
                    });
                }
            });
            
            if (houses.length > 0) {
                console.log(`✅ Extracted ${houses.length} houses from block pattern`);
                return houses;
            }
        }
        
        // Fallback: Door te zoeken naar secties die beide bevatten
        // Verbeterde adres pattern voor fallback met huisnummer toevoegingen
        const fallbackAddressPattern = "[A-Z][a-zA-Z\\s\\-']+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof|park|markt|steeg)\\s*\\d+[a-zA-Z]?(?:[\\-\\/][a-zA-Z0-9]+)?";
        const sectionRegex = new RegExp("€\\s*([\\d.,]+)[^€]{0,500}?(" + fallbackAddressPattern + ")|(" + fallbackAddressPattern + ")[^€]{0,500}?€\\s*([\\d.,]+)", "gi");
        const sectionMatches = [...html.matchAll(sectionRegex)];
        
        console.log(`📊 Found ${sectionMatches.length} price+address pairs`);
        
        if (sectionMatches.length > 0) {
            const seenAddresses = new Set();
            let houseIndex = 0;
            sectionMatches.forEach((match, i) => {
                const price = match[1] || match[4];
                const address = match[2] || match[3];
                
                if (price && address && !seenAddresses.has(address)) {
                    seenAddresses.add(address);
                    
                    // Get multiple images for this house using the helper
                    const houseImages = getImagesForHouse(houseIndex, sectionMatches.length);
                    const image = houseImages[0] || this.getPlaceholderImage();
                    houseIndex++;
                    
                    // Zoek naar size, rooms en postcode in de context rond deze match (500 chars before/after voor meer data)
                    const matchIndex = match.index || 0;
                    const contextStart = Math.max(0, matchIndex - 500);
                    const contextEnd = Math.min(html.length, matchIndex + match[0].length + 500);
                    const context = html.substring(contextStart, contextEnd);
                    
                    // Extract data from local context - meer patronen
                    const sizeMatch = context.match(/(\d+)\s*m²/i);
                    const roomMatch = context.match(/(\d+)\s*(?:kamers?|slaapkamers?)/i);
                    const bedroomMatch = context.match(/(\d+)\s*slaapkamer/i);
                    const bathroomMatch = context.match(/(\d+)\s*(?:badkamers?|badkamer)/i);
                    const postcodeMatch = context.match(/\b(\d{4}\s*[A-Z]{2})\b/);
                    const yearMatch = context.match(/(?:bouwjaar|gebouwd)[:\s]*(\d{4})/i) || context.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
                    const energyMatch = context.match(/(?:energielabel|energie)[:\s]*([A-G]\+*)/i) || context.match(/\b([A-G]\+{0,4})\s*(?:label|energielabel)/i);
                    
                    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
                    const bedrooms = bedroomMatch ? parseInt(bedroomMatch[1]) : (roomMatch ? parseInt(roomMatch[1]) : 0);
                    const bathrooms = bathroomMatch ? parseInt(bathroomMatch[1]) : 1;
                    const postalCode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
                    const yearBuilt = yearMatch ? parseInt(yearMatch[1]) : null;
                    const energyLabel = energyMatch ? energyMatch[1].toUpperCase() : '';
                    
                    houses.push({
                        id: `funda-pair-${i}-${Date.now()}`,
                        price: this.extractPrice(price),
                        address: address,
                        postalCode: postalCode,
                        city: 'Amsterdam',
                        neighborhood: this.getNeighborhoodFromPostcode(postalCode) || this.extractNeighborhood(address),
                        bedrooms: bedrooms,
                        bathrooms: bathrooms,
                        size: size,
                        yearBuilt: yearBuilt,
                        energyLabel: energyLabel,
                        image: image,
                        images: houseImages.length > 0 ? houseImages : [],
                        url: '#',
                        description: '',
                        features: [],
                        isNew: false,
                        daysOnMarket: 0
                    });
                }
            });
            
            if (houses.length > 0) {
                console.log(`📊 Extracted ${houses.length} houses from price+address pairs`);
                return houses;
            }
        }

        // Fallback: oude methode met verbeterde image matching
        const priceRegex = /€\s*([\d.,]+)\s*(k\.k\.|v\.o\.n\.|p\/mnd)?/gi;
        // Verbeterde adres regex met huisnummer toevoegingen
        const addressRegex = /([A-Z][a-zA-Z\s\-']+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof|park|markt|steeg)\s*\d+[a-zA-Z]?(?:[\-\/][a-zA-Z0-9]+)?)/gi;
        // Verbeterde image regex specifiek voor Funda CDN
        const imageRegex = /https?:\/\/cloud\.funda\.nl\/valentina_media\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi;

        // Extract data
        const prices = [...html.matchAll(priceRegex)].map(m => this.extractPrice(m[0])).filter(p => p > 100000);
        const addresses = [...new Set([...html.matchAll(addressRegex)].map(m => m[0]))];
        let images = [...new Set([...html.matchAll(imageRegex)].map(m => m[0]))];
        
        // Als geen specifieke images gevonden, gebruik alle eerder gevonden Funda images
        if (images.length === 0 && allFundaImages.length > 0) {
            images = allFundaImages;
        }

        console.log(`📊 Regex fallback found: ${prices.length} prices, ${addresses.length} addresses, ${images.length} images`);

        // Gebruik ALLEEN de adressen als basis (niet de prijzen)
        // Voor elke adres, zoek de context om data te extracten
        for (let i = 0; i < addresses.length; i++) {
            const address = addresses[i];
            
            // Zoek waar dit adres voorkomt in de HTML en extract context
            const addrIndex = html.indexOf(address);
            const contextStart = Math.max(0, addrIndex - 300);
            const contextEnd = Math.min(html.length, addrIndex + address.length + 300);
            const context = addrIndex >= 0 ? html.substring(contextStart, contextEnd) : '';
            
            // Extract data from local context
            // Extract data from local context - meer patronen
            const sizeMatch = context.match(/(\d+)\s*m²/i);
            const roomMatch = context.match(/(\d+)\s*(?:kamers?|slaapkamers?)/i);
            const bedroomMatch = context.match(/(\d+)\s*slaapkamer/i);
            const bathroomMatch = context.match(/(\d+)\s*(?:badkamers?|badkamer)/i);
            const postcodeMatch = context.match(/\b(\d{4}\s*[A-Z]{2})\b/);
            const priceMatch = context.match(/€\s*([\d.,]+)/);
            const yearMatch = context.match(/(?:bouwjaar|gebouwd)[:\s]*(\d{4})/i) || context.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
            const energyMatch = context.match(/(?:energielabel|energie)[:\s]*([A-G]\+*)/i);
            
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            const bedrooms = bedroomMatch ? parseInt(bedroomMatch[1]) : (roomMatch ? parseInt(roomMatch[1]) : 0);
            const bathrooms = bathroomMatch ? parseInt(bathroomMatch[1]) : 1;
            const postcode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
            const price = priceMatch ? this.extractPrice(priceMatch[0]) : (prices[i] || null);
            const yearBuilt = yearMatch ? parseInt(yearMatch[1]) : null;
            const energyLabel = energyMatch ? energyMatch[1].toUpperCase() : '';
            
            // Get images using the helper function
            const houseImages = getImagesForHouse(i, addresses.length);
            
            houses.push({
                id: `funda-regex-${i}-${Date.now()}`,
                price: price,
                address: address,
                postalCode: postcode,
                city: 'Amsterdam',
                neighborhood: this.getNeighborhoodFromPostcode(postcode) || this.extractNeighborhood(address),
                bedrooms: bedrooms,
                bathrooms: bathrooms,
                size: size,
                yearBuilt: yearBuilt,
                energyLabel: energyLabel,
                image: houseImages[0] || images[i] || this.getPlaceholderImage(),
                images: houseImages.length > 0 ? houseImages : [],
                url: '#',
                description: '',
                features: [],
                isNew: false,
                daysOnMarket: 0
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

    extractPriceFromItem(item) {
        // Try all possible price field locations in Funda data
        const priceFields = [
            // Direct fields
            item.sellPrice,
            item.askingPrice, 
            item.salePrice,
            item.koopprijs,
            item.vraagprijs,
            item.prijs,
            item.price,
            // Nested in price object
            item.price?.sellPrice,
            item.price?.askingPrice,
            item.price?.amount,
            item.price?.value,
            item.price?.mainValue,
            item.price?.koopprijs,
            // Nested in priceInfo
            item.priceInfo?.sellPrice,
            item.priceInfo?.price,
            item.priceInfo?.mainPrice,
            item.priceInfo?.askingPrice,
            // Nested in priceSale
            item.priceSale?.price,
            item.priceSale?.amount,
            // Other possible structures
            item.object?.price,
            item.object?.sellPrice,
            item.listing?.price,
        ];
        
        for (const priceValue of priceFields) {
            if (priceValue) {
                const extracted = this.extractPrice(priceValue);
                if (extracted) {
                    return extracted;
                }
            }
        }
        
        return null;
    }

    extractPrice(priceStr) {
        if (!priceStr) return null;
        if (typeof priceStr === 'number') return priceStr;
        
        // Als het een object is, probeer waarde te extracten
        if (typeof priceStr === 'object') {
            const val = priceStr.amount || priceStr.value || priceStr.price || priceStr.sellPrice;
            if (val) return this.extractPrice(val);
            return null;
        }
        
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

    getNeighborhoodFromPostcode(postcode) {
        if (!postcode) return null;
        
        // Amsterdam postcode ranges mapped to neighborhoods
        const postcodeMap = {
            '1011': 'Centrum', '1012': 'Centrum', '1013': 'Centrum', '1014': 'Centrum', '1015': 'Centrum', '1016': 'Centrum', '1017': 'Centrum', '1018': 'Centrum', '1019': 'Centrum',
            '1051': 'Bos en Lommer', '1052': 'Bos en Lommer', '1053': 'Bos en Lommer', '1054': 'Oud-West', '1055': 'Bos en Lommer',
            '1056': 'Nieuw-West', '1057': 'Nieuw-West', '1058': 'Nieuw-West', '1059': 'Nieuw-West',
            '1060': 'Nieuw-West', '1061': 'Nieuw-West', '1062': 'Nieuw-West', '1063': 'Nieuw-West', '1064': 'Nieuw-West', '1065': 'Nieuw-West', '1066': 'Nieuw-West', '1067': 'Nieuw-West', '1068': 'Nieuw-West', '1069': 'Nieuw-West',
            '1071': 'Oud-Zuid', '1072': 'Oud-Zuid', '1073': 'De Pijp', '1074': 'De Pijp', '1075': 'Oud-Zuid', '1076': 'Oud-Zuid', '1077': 'Oud-Zuid', '1078': 'Oud-Zuid', '1079': 'Zuid',
            '1081': 'Zuid', '1082': 'Zuid', '1083': 'Zuid', '1086': 'Zuid', '1087': 'Zuid', '1091': 'Oost', '1092': 'Oost', '1093': 'Oost', '1094': 'Oost', '1095': 'Oost', '1096': 'Oost', '1097': 'Oost', '1098': 'Oost',
            '1021': 'Noord', '1022': 'Noord', '1023': 'Noord', '1024': 'Noord', '1025': 'Noord', '1026': 'Noord', '1027': 'Noord', '1028': 'Noord', '1029': 'Noord', '1030': 'Noord', '1031': 'Noord', '1032': 'Noord', '1033': 'Noord', '1034': 'Noord', '1035': 'Noord', '1036': 'Noord', '1037': 'Noord', '1038': 'Noord', '1039': 'Noord',
            '1101': 'Zuidoost', '1102': 'Zuidoost', '1103': 'Zuidoost', '1104': 'Zuidoost', '1105': 'Zuidoost', '1106': 'Zuidoost', '1107': 'Zuidoost', '1108': 'Zuidoost', '1109': 'Zuidoost',
            '1086': 'IJburg', '1087': 'IJburg',
            '1181': 'Amstelveen', '1182': 'Amstelveen', '1183': 'Amstelveen', '1184': 'Amstelveen', '1185': 'Amstelveen', '1186': 'Amstelveen',
            '1111': 'Diemen', '1112': 'Diemen'
        };
        
        // Extract just the 4-digit part
        const digits = postcode.replace(/\s+/g, '').substring(0, 4);
        return postcodeMap[digits] || null;
    }

    getPlaceholderImage() {
        const images = [
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
            'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
            'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80'
        ];
        return images[Math.floor(Math.random() * images.length)];
    }

    findListingsInObject(obj, depth = 0) {
        if (depth > 10 || !obj) return [];
        
        if (Array.isArray(obj) && obj.length > 0) {
            const first = obj[0];
            if (first && typeof first === 'object') {
                // Check for listing-like properties
                if (first.id || first.address || first.price || first.sellPrice || first.url) {
                    return obj;
                }
            }
        }
        
        if (typeof obj === 'object' && obj !== null) {
            for (const key of Object.keys(obj)) {
                const result = this.findListingsInObject(obj[key], depth + 1);
                if (result.length > 0) return result;
            }
        }
        
        return [];
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
