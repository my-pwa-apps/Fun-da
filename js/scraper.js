// Funda Scraper - Haalt woningen op van meerdere bronnen
// Bronnen: Funda, Jaap.nl, BAG (overheid), en meer
// Parallel fetching voor snelheid

console.log = () => {};
console.warn = () => {};
console.debug = () => {};

class FundaScraper {
    constructor() {
        // CORS proxies om websites te kunnen benaderen vanuit de browser
        // Eigen proxy eerst, daarna publieke fallbacks
        this.corsProxies = [
            // Eigen Cloudflare Worker proxy (meest betrouwbaar)
            { url: 'https://spring-night-8d4d.garfieldapp.workers.dev/?url=', jsonResponse: false },
            // Publieke fallbacks
            { url: 'https://corsproxy.io/?', jsonResponse: false },
            { url: 'https://api.allorigins.win/raw?url=', jsonResponse: false },
            { url: 'https://api.allorigins.win/get?url=', jsonResponse: true, dataField: 'contents' },
        ];
        this.currentProxyIndex = 0;
        
        // Data bronnen configuratie
        this.dataSources = {
            funda: {
                name: 'Funda',
                baseUrl: 'https://www.funda.nl',
                searchUrl: 'https://www.funda.nl/zoeken/koop?selected_area=["amsterdam"]&publication_date="1"',
                enabled: true
            }
        };
        
        // PDOK Locatieserver voor adres lookup
        this.pdokUrl = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
        
        // Cache voor recent opgehaalde data
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minuten cache
        
        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 500; // 0.5 seconde tussen requests
        
        // Request counter voor deze sessie
        this.requestCount = 0;
        this.maxRequestsPerSession = 20;
    }

    // ==========================================
    // FUNDA MOBILE API (primary source)
    // Uses Funda's internal *.funda.io API reverse-engineered from the Android app.
    // Much more reliable and data-rich than HTML scraping.
    // Requires the Cloudflare Worker proxy to forward mobile headers + POST body.
    // ==========================================

    get FUNDA_API_SEARCH() {
        return 'https://listing-search-wonen.funda.io/_msearch/template';
    }

    get FUNDA_API_DETAIL_BASE() {
        return 'https://listing-detail-page.funda.io/api/v4/listing/object/nl';
    }

    // POST request through the CF worker proxy (only CF worker supports body forwarding)
    async fetchViaProxyPost(targetUrl, ndjsonBody) {
        const cfProxy = this.corsProxies[0]; // Our CF worker – the only proxy that forwards POST body
        const proxyUrl = cfProxy.url + encodeURIComponent(targetUrl);
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: ndjsonBody,
        });
        if (!response.ok) throw new Error(`Mobile API POST failed: ${response.status}`);
        return response.json();
    }

    async searchFundaMobileAPI(params = {}) {
        const area = params.area || 'amsterdam';
        const searchParams = {
            availability: ['available', 'negotiations'],
            type: ['single'],
            zoning: ['residential'],
            object_type: ['house', 'apartment'],
            publication_date: params.days ? { days: parseInt(params.days) } : { no_preference: true },
            offering_type: 'buy',
            selected_area: [area],
            sort: { field: 'publish_date_utc', order: 'desc' },
            page: { from: 0, size: params.size || 40 },
        };

        // Add price filter
        if (params.minPrice || params.maxPrice) {
            const priceFilter = {};
            if (params.minPrice) priceFilter.from = params.minPrice;
            if (params.maxPrice) priceFilter.to = params.maxPrice;
            searchParams.price = { selling_price: priceFilter };
        }

        const indexLine = JSON.stringify({ index: 'listings-wonen-searcher-alias-prod' });
        const queryLine = JSON.stringify({ id: 'search_result_20250805', params: searchParams });
        const ndjson = `${indexLine}\n${queryLine}\n`;

        console.log('📱 Fetching from Funda mobile API...');
        const data = await this.fetchViaProxyPost(this.FUNDA_API_SEARCH, ndjson);
        return this.parseMobileSearchResults(data);
    }

    parseMobileSearchResults(data) {
        const houses = [];
        const hits = data?.responses?.[0]?.hits?.hits || [];
        console.log(`📱 Mobile API returned ${hits.length} search results`);

        for (const hit of hits) {
            const source = hit._source || {};
            const address = source.address || {};
            const price = source.price?.selling_price?.[0] || source.price?.rent_price?.[0] || null;
            const detailPath = source.object_detail_page_relative_url;

            const postalCode = address.postal_code || '';
            const streetName = address.street_name || '';
            const houseNumber = address.house_number || '';
            const houseNumberSuffix = address.house_number_suffix || '';
            const fullAddress = [streetName, houseNumber, houseNumberSuffix].filter(Boolean).join(' ');

            houses.push({
                id: `funda-api-${hit._id}`,
                globalId: hit._id,
                price: typeof price === 'number' ? price : null,
                address: fullAddress || 'Adres onbekend',
                houseNumber: houseNumber,
                postalCode: postalCode,
                city: address.city || 'Amsterdam',
                neighborhood: address.neighbourhood || this.getNeighborhoodFromPostcode(postalCode),
                bedrooms: source.number_of_bedrooms || 0,
                rooms: source.number_of_rooms || 0,
                size: source.floor_area?.[0] || 0,
                plotArea: source.plot_area_range?.gte || 0,
                energyLabel: source.energy_label || '',
                yearBuilt: null,           // Not in search results – fetched from detail
                propertyType: { house: 'Woning', apartment: 'Appartement', parking_space: 'Parkeerplaats', building_plot: 'Bouwgrond' }[source.object_type] || source.object_type || '',
                constructionType: source.construction_type || '',
                publicationDate: source.publish_date || '',
                daysOnMarket: (() => { const d = source.publish_date ? new Date(source.publish_date) : null; return d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null; })(),
                brokerName: source.agent?.[0]?.name || '',
                brokerPhone: source.agent?.[0]?.phone_number || source.agent?.[0]?.phone || '',
                brokerEmail: source.agent?.[0]?.email || '',
                image: this.getPlaceholderImage(),
                images: [],
                url: detailPath ? `https://www.funda.nl${detailPath}` : '#',
                description: '',
                features: [],
                isNew: false,
                fromMobileAPI: true,
            });
        }
        return houses;
    }

    // Extract tinyId from a Funda URL (…/12345678/)
    extractTinyId(url) {
        if (!url) return null;
        const match = url.match(/\/(\d{7,9})\/?(?:\?|$|#)?/);
        return match ? match[1] : null;
    }

    async fetchFundaMobileDetail(url) {
        const tinyId = this.extractTinyId(url);
        if (!tinyId) return null;

        const detailUrl = `${this.FUNDA_API_DETAIL_BASE}/tinyId/${tinyId}`;

        // Try all proxies in order; CF Worker first, then public fallbacks.
        const proxiesToTry = this.corsProxies;

        for (const proxy of proxiesToTry) {
            try {
                const proxyUrl = proxy.url + encodeURIComponent(detailUrl);
                const response = await fetch(proxyUrl);
                if (!response.ok) continue;
                const raw = proxy.jsonResponse
                    ? await response.json()
                    : await response.json().catch(async () => {
                        // Some proxies wrap JSON in a field
                        return null;
                    });
                if (!raw) continue;
                const data = proxy.dataField ? raw[proxy.dataField] : raw;
                if (!data) continue;
                const parsed = typeof data === 'string' ? JSON.parse(data) : data;
                const result = this.parseMobileDetail(parsed);
                if (result && result.images?.length > 0) return result;
                if (result) return result; // accept even if no images
            } catch (e) {
                console.debug(`Detail proxy failed for ${tinyId}:`, e.message);
            }
        }
        return null;
    }

    parseMobileDetail(data) {
        if (!data) return null;

        const identifiers = data.Identifiers || {};
        const address = data.AddressDetails || {};
        const priceData = data.Price || {};
        const coords = data.Coordinates || {};
        const media = data.Media || {};
        const fastView = data.FastView || {};
        const ads = data.Advertising?.TargetingOptions || {};

        const parseArea = (val) => {
            if (!val) return null;
            if (typeof val === 'number') return Math.round(val);
            const cleaned = String(val).replace(/[^0-9]/g, '');
            const n = parseInt(cleaned);
            return isNaN(n) ? null : n;
        };

        // Build photo URLs from CDN template
        const photosData = media.Photos || {};
        const photoBase = (photosData.MediaBaseUrl || '').replace('{id}', '{}');
        const photoItems = photosData.Items || [];
        const photoUrls = photoBase
            ? photoItems.map(p => photoBase.replace('{}', p.Id)).filter(Boolean)
            : [];

        // Floorplan URLs
        const floorplansData = media.LegacyFloorPlan || {};
        const floorplanBase = (floorplansData.ThumbnailBaseUrl || '').replace('{id}', '{}');
        const floorplanItems = floorplansData.Items || [];
        const floorplanUrls = floorplanBase
            ? floorplanItems.map(f => floorplanBase.replace('{}', f.ThumbnailId)).filter(Boolean)
            : [];

        const tinyId = identifiers.TinyId;
        const citySlug = (address.City || '').toLowerCase().replace(/ /g, '-');
        const titleSlug = (address.Title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const offering = data.OfferingType === 'Sale' ? 'koop' : 'huur';
        const url = tinyId ? `https://www.funda.nl/detail/${offering}/${citySlug}/${titleSlug}/${tinyId}/` : '#';

        // Characteristics dictionary (KenmerkSections)
        const characteristics = {};
        for (const section of data.KenmerkSections || []) {
            for (const item of section.KenmerkenList || []) {
                if (item.Label && item.Value) characteristics[item.Label] = item.Value;
            }
        }

        return {
            globalId: identifiers.GlobalId,
            tinyId: tinyId,
            price: priceData.NumericSellingPrice || priceData.NumericRentalPrice || null,
            priceFormatted: priceData.SellingPrice || priceData.RentalPrice || null,
            pricePerM2: characteristics['Vraagprijs per m²'] || null,
            address: address.Title || '',
            houseNumber: address.HouseNumber || '',
            houseNumberExt: address.HouseNumberExtension || '',
            postalCode: address.PostCode || '',
            city: address.City || 'Amsterdam',
            neighborhood: address.NeighborhoodName || '',
            municipality: ads.gemeente || '',
            bedrooms: fastView.NumberOfBedrooms || null,
            rooms: ads.aantalkamers ? parseInt(ads.aantalkamers) || null : null,
            size: ads.woonoppervlakte ? parseArea(ads.woonoppervlakte) : parseArea(fastView.LivingArea),
            plotArea: ads.perceeloppervlakte ? parseArea(ads.perceeloppervlakte) : parseArea(fastView.PlotArea),
            energyLabel: fastView.EnergyLabel || '',
            yearBuilt: ads.bouwjaar && /^\d{4}$/.test(ads.bouwjaar) ? parseInt(ads.bouwjaar) : null,
            constructionType: data.ConstructionType || '',
            propertyType: data.ObjectType || '',
            houseType: ads.soortwoning || '',
            description: data.ListingDescription?.Description || '',
            publicationDate: data.PublicationDate || '',
            offeredSince: characteristics['Aangeboden sinds'] || null,
            acceptance: characteristics['Aanvaarding'] || null,
            url: url,
            image: photoUrls[0] || this.getPlaceholderImage(),
            images: photoUrls.slice(0, 30),
            floorplanUrls: floorplanUrls,
            latitude: coords.Latitude ? parseFloat(coords.Latitude) : null,
            longitude: coords.Longitude ? parseFloat(coords.Longitude) : null,
            googleMapsUrl: data.GoogleMapsObjectUrl || null,
            // Boolean features from TargetingOptions
            hasGarden: ads.tuin === 'true',
            hasBalcony: ads.balkon === 'true',
            hasSolarPanels: ads.zonnepanelen === 'true',
            hasHeatPump: ads.warmtepomp === 'true',
            hasRoofTerrace: ads.dakterras === 'true',
            hasParking: ads.parkeergelegenheidopeigenterrein === 'true' || ads.parkeergelegenheidopafgeslotenterrein === 'true',
            isMonument: ads.monumentalestatus === 'true',
            isFixerUpper: ads.kluswoning === 'true',
            isAuction: priceData.IsAuction === true,
            isEnergyEfficient: ads.energiezuinig === 'true',
            // Popularity stats
            views: data.ObjectInsights?.Views ?? null,
            saves: data.ObjectInsights?.Saves ?? null,
            // Days on market (computed from PublicationDate)
            daysOnMarket: (() => { const d = data.PublicationDate ? new Date(data.PublicationDate) : null; return d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null; })(),
            // Broker contact
            brokerName: data.SellingAgent?.Name || data.SellingAgent?.name || '',
            brokerPhone: data.SellingAgent?.PhoneNumber || data.SellingAgent?.phone_number || data.SellingAgent?.Phone || '',
            brokerEmail: data.SellingAgent?.Email || data.SellingAgent?.email || '',
            // Source flag
            enrichedFromMobileAPI: true,
        };
    }

    // Enrich a batch of houses with full mobile API detail data
    async enrichWithMobileDetails(houses, onProgress = () => {}) {
        const batchSize = 3;
        const enriched = [];

        for (let i = 0; i < houses.length; i += batchSize) {
            const batch = houses.slice(i, i + batchSize);
            const progressPercent = 50 + Math.round((enriched.length / houses.length) * 40);
            onProgress(`Details ophalen (${enriched.length + 1}/${houses.length})...`, progressPercent);

            const enrichedBatch = await Promise.all(
                batch.map(async house => {
                    if (house.url && house.url !== '#') {
                        const detail = await this.fetchFundaMobileDetail(house.url);
                        if (detail) {
                            return { ...house, ...detail, id: house.id, address: detail.address || house.address };
                        }
                    }
                    return house;
                })
            );

            enriched.push(...enrichedBatch);

            if (i + batchSize < houses.length) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        const withPhotos = enriched.filter(h => h.images?.length > 0).length;
        console.log(`📸 Photos fetched: ${withPhotos}/${enriched.length} houses have photos`);
        return enriched;
    }

    getNextProxy() {
        const proxy = this.corsProxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.corsProxies.length;
        return proxy;
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
        // Use full URL as cache key to avoid collisions
        // Only remove cache buster parameters
        const cleanUrl = url.split('?')[0] + 
            (url.includes('?') ? '?' + url.split('?')[1].split('&').filter(p => !p.startsWith('_=')).join('&') : '');
        return cleanUrl;
    }

    getFromCache(url) {
        // DISABLE cache for detail pages to ensure each house gets its own data
        if (url.includes('/detail/')) {
            return null;
        }
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
                
                // Korte delay tussen proxy retries
                if (i > 0) {
                    await this.randomDelay(500, 1000);
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
                    if (html && (html.includes('<!DOCTYPE') || html.includes('<html') || html.includes('funda') || html.includes('pararius'))) {
                        // Check of het een bot-detectie pagina is
                        const hasPrices = html.includes('€') || html.includes('EUR');
                        const hasListings = html.includes('koopprijs') || html.includes('koopwoningen') || html.includes('te-koop') || html.includes('searchResults');
                        
                        const isBotPage = !hasPrices && !hasListings && (
                            html.includes('captcha') || 
                            html.includes('Je bent bijna op de pagina') ||
                            html.includes('Access Denied') ||
                            (html.includes('Cloudflare') && html.includes('challenge'))
                        );
                        
                        if (isBotPage) {
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
        
        throw new Error('Alle bronnen geblokkeerd. Open Funda handmatig via de link hieronder.');
    }

    // ==========================================
    // MULTI-SOURCE PARALLEL SCRAPING
    // ==========================================
    
    async scrapeAllSources(searchParams = {}) {
        console.log('🚀 Starting scrape from available sources...');
        const startTime = Date.now();
        const onProgress = searchParams.onProgress || (() => {});

        // ── PRIMARY: Funda Mobile API ──────────────────────────────────────────
        // This uses Funda's internal *.funda.io API (reverse-engineered from Android app).
        // Returns rich JSON with 70+ fields – much better than HTML scraping.
        // Requires the Cloudflare Worker proxy to be deployed and support POST + funda.io headers.
        onProgress('Verbinden met Funda API...', 15);
        try {
            const mobileResults = await this.searchFundaMobileAPI({ area: searchParams.area || 'amsterdam', days: searchParams.days });
            if (mobileResults.length > 0) {
                console.log(`📱 Mobile API: ${mobileResults.length} woningen via JSON API`);
                onProgress(`${mobileResults.length} woningen gevonden, details ophalen...`, 50);
                const enriched = await this.enrichWithMobileDetails(mobileResults, onProgress);

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`✅ Klaar in ${elapsed}s – ${enriched.length} woningen via Funda Mobile API`);
                onProgress('Klaar!', 100);
                return enriched;
            }
        } catch (error) {
            console.warn('📱 Mobile API niet beschikbaar, val terug op HTML scraping:', error.message);
        }

        // ── FALLBACK: HTML scraping ────────────────────────────────────────────
        console.log('🔄 Fallback: HTML scraping van Funda...');
        const scrapePromises = [];
        const sourceNames = [];

        if (this.dataSources.funda.enabled) {
            onProgress('Verbinden met Funda...', 20);
            const fundaUrl = this.buildFundaUrl(searchParams);
            scrapePromises.push(this.scrapeFunda(fundaUrl));
            sourceNames.push('Funda');
        }

        onProgress('Woningen zoeken...', 35);

        const results = await Promise.allSettled(scrapePromises);

        let allHouses = [];
        const sourceStats = {};

        results.forEach((result, index) => {
            const sourceName = sourceNames[index];
            if (result.status === 'fulfilled' && result.value.length > 0) {
                console.log(`✅ ${sourceName}: ${result.value.length} woningen`);
                sourceStats[sourceName] = result.value.length;
                allHouses.push(...result.value.map(h => ({ ...h, source: sourceName })));
            } else {
                console.warn(`❌ ${sourceName}: ${result.reason?.message || 'geen resultaten'}`);
                sourceStats[sourceName] = 0;
            }
        });

        const uniqueHouses = this.deduplicateHouses(allHouses);
        console.log(`📊 ${uniqueHouses.length} unieke woningen na deduplicatie`);

        onProgress(`${uniqueHouses.length} woningen, details ophalen...`, 45);

        console.log('🏛️ Verrijken met overheidsdata (BAG) en Funda details...');
        const enrichedHouses = await this.enrichWithBagData(uniqueHouses, onProgress);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Klaar in ${elapsed}s - ${enrichedHouses.length} woningen van ${Object.keys(sourceStats).filter(k => sourceStats[k] > 0).join(', ')}`);

        return enrichedHouses;
    }

    buildFundaUrl(params = {}) {
        const area = params.area || 'amsterdam';
        const days = params.days || '1';
        return `https://www.funda.nl/zoeken/koop?selected_area=["${area}"]&publication_date="${days}"`;
    }
    
    deduplicateHouses(houses) {
        const seen = new Map();
        
        houses.forEach(house => {
            // Normalize address for comparison
            const normalizedAddress = house.address.toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[-–]/g, '-')
                .trim();
            
            // If we haven't seen this address, or the new one has more data, keep it
            if (!seen.has(normalizedAddress)) {
                seen.set(normalizedAddress, house);
            } else {
                const existing = seen.get(normalizedAddress);
                // Merge: prefer non-zero values and actual URLs over search URLs
                const merged = {
                    ...existing,
                    price: house.price || existing.price,
                    size: house.size || existing.size,
                    bedrooms: house.bedrooms || existing.bedrooms,
                    yearBuilt: house.yearBuilt || existing.yearBuilt,
                    energyLabel: house.energyLabel || existing.energyLabel,
                    postalCode: house.postalCode || existing.postalCode,
                    // Prefer actual detail URLs (contain /detail/) over search URLs
                    url: (house.url?.includes('/detail/') ? house.url : null) || 
                         (existing.url?.includes('/detail/') ? existing.url : null) || 
                         house.url || existing.url,
                    // Combine images
                    images: [...new Set([...(existing.images || []), ...(house.images || [])])].slice(0, 30),
                    // Keep track of sources
                    sources: [...(existing.sources || [existing.source]), house.source]
                };
                seen.set(normalizedAddress, merged);
            }
        });
        
        return Array.from(seen.values());
    }
    
    // ==========================================
    // BAG API - GOVERNMENT BUILDING DATA
    // ==========================================
    
    async enrichWithBagData(houses, onProgress = () => {}) {
        // Process in batches to avoid rate limiting
        const batchSize = 3;
        const enriched = [];
        
        console.log(`🔍 Verrijken van ${houses.length} woningen met BAG data en Funda details...`);
        
        for (let i = 0; i < houses.length; i += batchSize) {
            const batch = houses.slice(i, i + batchSize);
            
            // Calculate progress (45% to 85% range for enrichment)
            const progressPercent = 45 + Math.round((enriched.length / houses.length) * 40);
            onProgress(`Details ophalen...`, progressPercent);
            
            // Fetch BAG data AND Funda details for batch in parallel
            const enrichedBatch = await Promise.all(
                batch.map(async house => {
                    // First get BAG data
                    let enrichedHouse = await this.fetchBagDataForHouse(house);
                    // Then get Funda detail page data if we have a detail URL
                    if (enrichedHouse.url?.includes('funda.nl') && enrichedHouse.url?.includes('/detail/')) {
                        enrichedHouse = await this.fetchFundaDetails(enrichedHouse);
                    }
                    return enrichedHouse;
                })
            );
            
            enriched.push(...enrichedBatch);
            
            // Progress indicator
            console.log(`📊 Verrijkt: ${enriched.length}/${houses.length} woningen`);
            
            // Small delay between batches to be nice to the APIs
            if (i + batchSize < houses.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
        
        return enriched;
    }
    
    async fetchFundaDetails(house) {
        try {
            console.log(`📄 Ophalen Funda details: ${house.address}`);
            const html = await this.fetchWithProxy(house.url);
            
            if (!html || html.length < 1000) return house;
            
            // Extract more details from Funda detail page
            const details = {};
            
            // Price - ALWAYS use price from detail page as it's more reliable
            // The search page price matching is often incorrect
            const priceMatch = html.match(/€\s*([\d.,]+)(?:\s*(?:k\.k\.|v\.o\.n\.))?/i);
            if (priceMatch) {
                const detailPrice = this.extractPrice(priceMatch[0]);
                if (detailPrice && detailPrice > 50000) {
                    details.price = detailPrice;
                }
            }
            
            // Woonoppervlakte (living space) - be specific to avoid matching floor sizes
            // Priority order: "Woonoppervlakte" > "Gebruiksoppervlakte wonen" > "wonen" area
            const woonOppMatch = html.match(/woonoppervlakte[^<\d]{0,50}?(\d+)\s*m²/i);
            const gebruiksOppMatch = html.match(/gebruiksoppervlakte\s*wonen[^<\d]{0,50}?(\d+)\s*m²/i);
            // Also try to find the summary size near address (often in format: "85 m² • 3 kamers")
            const summaryMatch = html.match(/<span[^>]*>(\d{2,4})\s*m²<\/span>/i);
            
            if (woonOppMatch) {
                details.size = parseInt(woonOppMatch[1]);
            } else if (gebruiksOppMatch) {
                details.size = parseInt(gebruiksOppMatch[1]);
            } else if (summaryMatch && !house.size) {
                // Only use summary if we don't have a size yet
                details.size = parseInt(summaryMatch[1]);
            }
            
            // Perceeloppervlakte (plot size)
            const plotMatch = html.match(/(?:perceel(?:oppervlakte)?)[^\d]{0,30}(\d+)\s*m²/i);
            if (plotMatch) {
                details.plotSize = parseInt(plotMatch[1]);
            }
            
            // Aantal kamers - require explicit slaapkamer/aantal prefix with word boundary
            // to avoid matching compound words like "woonkamers" where the next number
            // could be the floor area, causing bedrooms = size.
            const roomMatch = html.match(/(?:\baantal\s*(?:slaap)?kamers?|\bslaapkamers?)[^\d]{0,20}(\d+)/i);
            if (roomMatch) {
                const bedroomCandidate = parseInt(roomMatch[1]);
                // Sanity check: skip if the number looks like a floor area (> 20)
                if (bedroomCandidate <= 20) {
                    details.bedrooms = bedroomCandidate;
                }
            }
            
            // Bouwjaar
            const yearMatch = html.match(/(?:bouwjaar|gebouwd)[^\d]{0,20}(1[89]\d{2}|20[0-2]\d)/i);
            if (yearMatch && !house.yearBuilt) {
                details.yearBuilt = parseInt(yearMatch[1]);
            }
            
            // Energielabel
            const energyMatch = html.match(/(?:energielabel|energie(?:klasse)?)[^A-G]{0,20}([A-G]\+{0,4})/i);
            if (energyMatch) {
                details.energyLabel = energyMatch[1].toUpperCase();
            }
            
            // Status (beschikbaar, verkocht, etc)
            const statusMatch = html.match(/(?:status|beschikbaarheid)[^\w]{0,20}(beschikbaar|in\s*verkoop|verkocht|verhuurd|onder\s*bod)/i);
            if (statusMatch) {
                details.status = statusMatch[1];
            }
            
            // Type woning
            const typeMatch = html.match(/(?:soort\s*(?:woning|object)|type)[^\w]{0,20}(appartement|eengezinswoning|hoekwoning|tussenwoning|vrijstaand|twee-onder-een-kap|bovenwoning|benedenwoning|penthouse|maisonnette|grachtenpand)/i);
            if (typeMatch) {
                details.propertyType = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase();
            }
            
            // Tuin
            const gardenMatch = html.match(/(?:tuin(?:type)?)[^\w]{0,20}(achtertuin|voortuin|zijtuin|daktuin|patio|ja|aanwezig)/i);
            if (gardenMatch) {
                details.hasGarden = true;
                details.gardenType = gardenMatch[1];
            }
            
            // Balkon
            if (/balkon/i.test(html)) {
                details.hasBalcony = true;
            }
            
            // Parkeren
            const parkingMatch = html.match(/(?:parkeren|garage)[^\w]{0,30}(eigen\s*parkeer|garage|parkeerplaats|parkeerkelder|geen)/i);
            if (parkingMatch) {
                details.parking = parkingMatch[1];
            }
            
            // Get all images from detail page
            const imageMatches = [...html.matchAll(/https?:\/\/cloud\.funda\.nl\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi)];
            if (imageMatches.length > 0) {
                // Deduplicate by base image ID (ignoring size suffixes)
                const seenBaseIds = new Set();
                const uniqueImages = [];
                for (const match of imageMatches) {
                    const url = match[0];
                    // Extract base image ID: "valentina_media/178/869/520_groot.jpg" -> "178/869/520"
                    const baseMatch = url.match(/valentina_media\/(\d+\/\d+\/\d+)/);
                    const baseId = baseMatch ? baseMatch[1] : url.replace(/_(?:klein|middel|groot|xlarge)\./, '.');
                    if (!seenBaseIds.has(baseId)) {
                        seenBaseIds.add(baseId);
                        uniqueImages.push(url);
                    }
                }
                details.images = uniqueImages.slice(0, 30);
                details.image = uniqueImages[0];
            }
            
            // Postcode if not found earlier
            if (!house.postalCode) {
                const postcodeMatch = html.match(/(\d{4})\s*([A-Z]{2})/i);
                if (postcodeMatch) {
                    details.postalCode = `${postcodeMatch[1]} ${postcodeMatch[2].toUpperCase()}`;
                }
            }
            
            // VvE bijdrage (for apartments)
            // Funda often shows: "Servicekosten € 150 per maand" or "VvE bijdrage € 200"
            const vvePatterns = [
                /(?:servicekosten|service\s*kosten)[^€\d]{0,30}€\s*([\d.,]+)/i,
                /(?:VvE[\s-]*bijdrage|VvE[\s-]*kosten)[^€\d]{0,30}€\s*([\d.,]+)/i,
                /€\s*([\d.,]+)[^\d]{0,20}(?:per\s*maand|p\/m|pm)[^\d]{0,20}(?:VvE|servicekosten)/i,
                /(?:maandelijkse\s*)?(?:VvE|bijdrage)[^€\d]{0,20}€\s*([\d.,]+)/i
            ];
            
            for (const pattern of vvePatterns) {
                const vveMatch = html.match(pattern);
                if (vveMatch) {
                    const vveCost = parseInt(vveMatch[1].replace(/\./g, '').replace(',', '.'));
                    // VvE is typically between €50 and €1000 per month
                    if (vveCost >= 30 && vveCost <= 1500) {
                        details.vveCosts = vveCost;
                        break;
                    }
                }
            }
            
            console.log(`✅ Funda details voor ${house.address}:`, Object.keys(details).length, 'extra velden');
            
            return { ...house, ...details, enrichedFromFunda: true };
        } catch (error) {
            console.debug(`Funda detail fetch failed for ${house.address}:`, error.message);
            return house;
        }
    }
    
    async fetchBagDataForHouse(house) {
        try {
            // Use PDOK Locatieserver to find address and get BAG data
            const searchQuery = `${house.address} ${house.postalCode || 'Amsterdam'}`;
            const url = `${this.pdokUrl}?q=${encodeURIComponent(searchQuery)}&rows=1&fq=type:adres`;
            
            const response = await fetch(url);
            if (!response.ok) return house;
            
            const data = await response.json();
            
            if (data.response?.docs?.length > 0) {
                const doc = data.response.docs[0];
                
                // Extract BAG data
                const bagData = {
                    bagId: doc.identificatie,
                    // Bouwjaar from BAG
                    yearBuilt: house.yearBuilt || this.extractYear(doc.bouwjaar),
                    // Postcode from BAG (more reliable)
                    postalCode: house.postalCode || doc.postcode,
                    // Woonplaats
                    city: doc.woonplaatsnaam || house.city,
                    // Straatnaam (verified)
                    street: doc.straatnaam,
                    // Huisnummer
                    houseNumber: doc.huisnummer,
                    // Toevoeging
                    addition: doc.huisletter || doc.huisnummertoevoeging,
                    // Coordinates for map
                    coordinates: doc.centroide_ll ? this.parseCoordinates(doc.centroide_ll) : null,
                    // Neighborhood from BAG
                    neighborhood: house.neighborhood || doc.buurtnaam || doc.wijknaam,
                    // Gebruiksdoel (woonfunctie, etc)
                    usage: doc.gebruiksdoel,
                    // Oppervlakte from BAG (if available and house doesn't have it)
                    size: house.size || doc.oppervlakte
                };
                
                return { ...house, ...bagData, enrichedFromBag: true };
            }
        } catch (error) {
            // Silently fail - BAG enrichment is optional
            console.debug(`BAG lookup failed for ${house.address}:`, error.message);
        }
        
        return house;
    }
    
    extractYear(yearValue) {
        if (!yearValue) return null;
        const year = parseInt(yearValue);
        return (year > 1600 && year <= new Date().getFullYear()) ? year : null;
    }
    
    parseCoordinates(pointString) {
        // Parse "POINT(4.89 52.37)" format
        const match = pointString?.match(/POINT\(([0-9.]+)\s+([0-9.]+)\)/);
        if (match) {
            return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
        }
        return null;
    }
    
    // ==========================================
    // FUNDA SCRAPER
    // ==========================================
    
    async scrapeFunda(searchUrl) {
        console.log('🏠 Scraping Funda:', searchUrl);
        
        try {
            await this.randomDelay(300, 800);
            const html = await this.fetchWithProxy(this.addCacheBuster(searchUrl));
            return this.parseSearchResults(html, searchUrl);
        } catch (error) {
            console.warn('Funda scraping failed:', error.message);
            return [];
        }
    }

    addCacheBuster(url) {
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + '_=' + Date.now().toString(36);
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
            const props = data.props?.pageProps;
            if (!props) {
                console.debug('No pageProps found in __NEXT_DATA__');
                return houses;
            }

            // Nieuwe Funda structuur (2024+) - zoek in verschillende locaties
            let listings = [];
            
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
                props.pageData?.searchResult?.resultList,
                props.dehydratedState?.queries?.[0]?.state?.data?.resultList,
            ];
            
            for (const path of possiblePaths) {
                if (Array.isArray(path) && path.length > 0) {
                    listings = path;
                    break;
                }
            }

            // Deep search for arrays that look like listings
            if (listings.length === 0) {
                const findListings = (obj, depth = 0) => {
                    if (depth > 8 || !obj) return [];
                    
                    if (Array.isArray(obj) && obj.length > 0) {
                        const first = obj[0];
                        if (first && typeof first === 'object') {
                            const hasListingProps = first.id || first.address || first.price || 
                                first.sellPrice || first.askingPrice || first.url || first.globalId;
                            if (hasListingProps) return obj;
                        }
                    }
                    
                    if (typeof obj === 'object' && obj !== null) {
                        for (const key of Object.keys(obj)) {
                            const result = findListings(obj[key], depth + 1);
                            if (result.length > 0) return result;
                        }
                    }
                    return [];
                };
                listings = findListings(props);
            }

            console.log(`📦 __NEXT_DATA__: ${listings.length} listings gevonden`);

            listings.forEach((item, index) => {
                const id = item.id || item.globalId || item.objectId || `funda-${Date.now()}-${index}`;
                let price = this.extractPriceFromItem(item);

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
        // DON'T extract images from search page - they get shared between houses
        // Real images come from detail page enrichment
        const linkEl = card.querySelector('a[href*="/koop/"], a[href*="/huur/"]');
        const sizeEl = card.querySelector('[class*="size"], [class*="living-area"], [class*="woonoppervlakte"]');
        const roomsEl = card.querySelector('[class*="rooms"], [class*="kamers"]');

        const price = priceEl ? this.extractPrice(priceEl.textContent) : null;
        const address = addressEl ? addressEl.textContent.trim() : 'Adres onbekend';
        const url = linkEl ? linkEl.href : '#';

        return {
            id: `funda-html-${index}-${Math.random().toString(36).substring(2, 9)}`,
            price: price,
            address: address,
            city: 'Amsterdam',
            neighborhood: this.extractNeighborhood(address),
            bedrooms: roomsEl ? parseInt(roomsEl.textContent) || 0 : 0,
            bathrooms: 1,
            size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0,
            image: this.getPlaceholderImage(),
            url: url,
            description: '',
            features: [],
            isNew: card.textContent.includes('Nieuw') || card.textContent.includes('nieuw'),
            daysOnMarket: 0
        };
    }

    parseWithRegex(html) {
        const houses = [];
        
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
        // Funda 2024+ heeft vaak window.__NUXT__ maar dit is JS, niet JSON
        // We skippen __NUXT__ parsing omdat het geen valide JSON is
        
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

        // NIEUWE STRATEGIE: Verzamel eerst ALLE prijzen en hun posities in de HTML
        // Dan matchen we later prijzen aan adressen op basis van nabijheid
        // BELANGRIJK: Elke prijs mag maar 1x gebruikt worden om duplicatie te voorkomen!
        const priceMap = new Map(); // position -> price
        const usedPricePositions = new Set(); // Track welke prijzen al gebruikt zijn
        const allPrices = [...html.matchAll(/€\s*([\d]{3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:k\.k\.|v\.o\.n\.)?/gi)];
        for (const match of allPrices) {
            const priceStr = match[1].replace(/\./g, '').replace(',', '.');
            const price = parseInt(priceStr);
            // Filter out CSS values and unrealistic prices
            if (price >= 50000 && price <= 50000000) {
                priceMap.set(match.index, price);
            }
        }
        console.log(`💰 Found ${priceMap.size} valid prices in HTML`);
        
        // Helper function to find nearest UNUSED price to a position
        const findNearestPrice = (position, maxDistance = 3000) => {
            let nearestPrice = 0;
            let nearestDistance = Infinity;
            let nearestPricePos = null;
            for (const [pricePos, price] of priceMap) {
                // Skip already used prices
                if (usedPricePositions.has(pricePos)) continue;
                
                const distance = Math.abs(pricePos - position);
                if (distance < nearestDistance && distance < maxDistance) {
                    nearestDistance = distance;
                    nearestPrice = price;
                    nearestPricePos = pricePos;
                }
            }
            // Mark this price as used so it won't be assigned to another house
            if (nearestPricePos !== null) {
                usedPricePositions.add(nearestPricePos);
            }
            return nearestPrice;
        };
        

        
        // NIEUWE METHODE: Zoek naar detail URLs om listings te vinden
        // Format: /detail/koop/amsterdam/[type-]straatnaam-huisnummer/id/
        // Types: huis, appartement, penthouse, etc.
        const detailUrlRegex = /href="(\/detail\/koop\/amsterdam\/([a-z\-]+?)-(\d+[a-z]?(?:-[a-z0-9]+)?)\/([\d]+)\/)"/gi;
        const detailMatches = [...html.matchAll(detailUrlRegex)];
        console.log(`📊 Found ${detailMatches.length} detail URLs in HTML`);
        
        if (detailMatches.length > 0) {
            const seenUrls = new Set();
            // Property type prefixes to remove from street names
            const typesPrefixes = ['huis', 'appartement', 'penthouse', 'studio', 'woning', 'bovenwoning', 'benedenwoning', 'grachtenpand', 'herenhuis', 'villa'];
            
            detailMatches.forEach((match, i) => {
                const [, fullUrl, streetPart, houseNumber, listingId] = match;
                
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);
                
                // Remove type prefix from street name if present
                let streetName = streetPart;
                for (const prefix of typesPrefixes) {
                    if (streetName.startsWith(prefix + '-')) {
                        streetName = streetName.substring(prefix.length + 1);
                        break;
                    }
                }
                
                // Convert "jan-van-galenstraat" to "Jan Van Galenstraat"
                const streetCapitalized = streetName.split('-').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ');
                
                // Handle house number with suffix like "36-h" or "10-2"
                const houseNumberClean = houseNumber.replace(/-/g, '-');
                const address = `${streetCapitalized} ${houseNumberClean}`;
                
                // Find the listing card context for other details
                const urlIndex = html.indexOf(fullUrl);
                const contextStart = Math.max(0, urlIndex - 2000);
                const contextEnd = Math.min(html.length, urlIndex + 2000);
                const context = html.substring(contextStart, contextEnd);
                
                // Extract other details from context (but NOT price - that comes from detail page)
                // For size, look for the summary format first (e.g. "85 m² · 3 kamers")
                // This is usually the total living area, not floor-specific sizes
                const summaryMatch = context.match(/(\d{2,4})\s*m²\s*[·•\-]\s*\d+\s*kamer/i);
                const sizeMatch = summaryMatch || context.match(/woonoppervlakte[^\d]{0,30}(\d+)\s*m²/i) || context.match(/(\d{2,4})\s*m²/);
                const roomMatch = context.match(/(\d+)\s*kamer/i);
                const postcodeMatch = context.match(/\b(\d{4}\s*[A-Z]{2})\b/);
                const yearMatch = context.match(/(?:bouwjaar|gebouwd\s*(?:in)?)[:\s]*(\d{4})/i);
                const energyMatch = context.match(/(?:energielabel|energie)[:\s]*([A-G]\+*)/i);
                
                // DON'T try to match images or prices from search page - they're often wrong/shared
                // Real data will be fetched from detail page in fetchFundaDetails()
                
                const postcode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
                
                houses.push({
                    id: `funda-url-${listingId}`,
                    price: null, // Will be filled from detail page
                    address: address,
                    postalCode: postcode,
                    city: 'Amsterdam',
                    neighborhood: this.getNeighborhoodFromPostcode(postcode) || this.extractNeighborhood(address),
                    bedrooms: roomMatch ? parseInt(roomMatch[1]) : 0,
                    bathrooms: 1,
                    size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                    yearBuilt: yearMatch ? parseInt(yearMatch[1]) : null,
                    energyLabel: energyMatch ? energyMatch[1].toUpperCase() : '',
                    image: this.getPlaceholderImage(),
                    images: [],
                    url: `https://www.funda.nl${fullUrl}`,
                    description: '',
                    features: [],
                    isNew: context.toLowerCase().includes('nieuw'),
                    daysOnMarket: 0
                });
            });
            
            if (houses.length > 0) {
                console.log(`✅ Extracted ${houses.length} houses from detail URLs`);
                return houses;
            }
        }
        
        // Search for listing blocks using data-test-id or search-result patterns
        const cardBlockRegex = /data-test-id="search-result-item"[^]*?(?=data-test-id="search-result-item"|$)/gi;
        const cardMatches = html.match(cardBlockRegex) || [];
        
        console.log(`📊 Found ${cardMatches.length} listing blocks via data-test-id`);
        
        if (cardMatches.length > 0) {
            cardMatches.forEach((block, i) => {
                const priceMatch = block.match(/€\s*([\d.,]+)/);
                // Verbeterde adres regex met huisnummer toevoegingen (-2, -H, /I etc)
                const addressMatch = block.match(/([A-Za-z][a-zA-Z\s\-']+(?:straat|weg|laan|plein|gracht|kade|singel|dijk|dreef|pad|hof|steeg|markt|park)\s*\d+[a-zA-Z]?(?:[\-\/][a-zA-Z0-9]+)?)/i);
                // Extra details uit block
                const sizeMatch = block.match(/(\d+)\s*m²/i);
                const roomMatch = block.match(/(\d+)\s*(?:kamers?|slaapkamers?)/i);
                const postcodeMatch = block.match(/\b(\d{4}\s*[A-Z]{2})\b/);
                
                if (priceMatch) {
                    const price = this.extractPrice(priceMatch[0]);
                    // DON'T use images from search page - real images come from detail page
                    const postcode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
                    const addr = addressMatch ? addressMatch[1] : `Woning ${i + 1}`;
                    
                    houses.push({
                        id: `funda-block-${i}-${Date.now()}`,
                        price: price,
                        address: addr,
                        postalCode: postcode,
                        city: 'Amsterdam',
                        neighborhood: this.getNeighborhoodFromPostcode(postcode) || this.extractNeighborhood(addr),
                        bedrooms: roomMatch ? parseInt(roomMatch[1]) : 0,
                        bathrooms: 1,
                        size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                        image: this.getPlaceholderImage(),
                        images: [],
                        url: this.generateFundaUrl(addr, postcode),
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
            
            blockMatches.forEach((match, i) => {
                const [, price, size, rooms, address, postcode] = match;
                
                if (!seenAddresses.has(address)) {
                    seenAddresses.add(address);
                    
                    const cleanPostcode = postcode.replace(/\s+/g, ' ');
                    const cleanAddress = address.trim();
                    
                    houses.push({
                        id: `funda-block-${i}-${Date.now()}`,
                        price: this.extractPrice(price),
                        address: cleanAddress,
                        postalCode: cleanPostcode,
                        city: 'Amsterdam',
                        neighborhood: this.getNeighborhoodFromPostcode(cleanPostcode) || this.extractNeighborhood(cleanAddress),
                        bedrooms: parseInt(rooms) || 0,
                        bathrooms: 1,
                        size: parseInt(size) || 0,
                        image: this.getPlaceholderImage(),
                        images: [],
                        url: this.generateFundaUrl(cleanAddress, cleanPostcode),
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
            sectionMatches.forEach((match, i) => {
                const price = match[1] || match[4];
                const address = match[2] || match[3];
                
                if (price && address && !seenAddresses.has(address)) {
                    seenAddresses.add(address);
                    
                    // DON'T use images from search page - real images come from detail page
                    
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
                    // Only match explicit "bouwjaar" or "gebouwd in" patterns, not random years
                    const yearMatch = context.match(/(?:bouwjaar|gebouwd\s*(?:in)?)[:\s]*(\d{4})/i);
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
                        image: this.getPlaceholderImage(),
                        images: [],
                        url: this.generateFundaUrl(address, postalCode),
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
            // Only match explicit "bouwjaar" or "gebouwd in" patterns, not random years
            const yearMatch = context.match(/(?:bouwjaar|gebouwd\s*(?:in)?)[:\s]*(\d{4})/i);
            const energyMatch = context.match(/(?:energielabel|energie)[:\s]*([A-G]\+*)/i);
            
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            const bedrooms = bedroomMatch ? parseInt(bedroomMatch[1]) : (roomMatch ? parseInt(roomMatch[1]) : 0);
            const bathrooms = bathroomMatch ? parseInt(bathroomMatch[1]) : 1;
            const postcode = postcodeMatch ? postcodeMatch[1].replace(/\s+/g, ' ') : '';
            const price = priceMatch ? this.extractPrice(priceMatch[0]) : (prices[i] || null);
            const yearBuilt = yearMatch ? parseInt(yearMatch[1]) : null;
            const energyLabel = energyMatch ? energyMatch[1].toUpperCase() : '';
            
            // DON'T use images from search page - they're shared/incorrect
            // Real images come from fetchFundaDetails
            
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
                image: this.getPlaceholderImage(),
                images: [],
                url: this.generateFundaUrl(address, postcode),
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
            '1081': 'Zuid', '1082': 'Zuid', '1083': 'Zuid', '1091': 'Oost', '1092': 'Oost', '1093': 'Oost', '1094': 'Oost', '1095': 'Oost', '1096': 'Oost', '1097': 'Oost', '1098': 'Oost',
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
        return PLACEHOLDER_IMAGE;
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

    // Genereer een Funda zoek-URL op basis van adres
    generateFundaUrl(address, postalCode) {
        // Als we een postcode hebben, zoek op postcode + huisnummer (meer precies)
        if (postalCode) {
            // Extract huisnummer from address
            const houseNumberMatch = address.match(/(\d+[a-zA-Z]?(?:[\-\/][a-zA-Z0-9]+)?)\s*$/);
            const houseNumber = houseNumberMatch ? houseNumberMatch[1] : '';
            const searchQuery = `${postalCode} ${houseNumber}`.trim();
            return `https://www.funda.nl/zoeken/koop?selected_area=["amsterdam"]&search_query=${encodeURIComponent(searchQuery)}`;
        }
        
        // Anders zoek op adres
        return `https://www.funda.nl/zoeken/koop?selected_area=["amsterdam"]&search_query=${encodeURIComponent(address)}`;
    }
}

// Export for use in app
window.FundaScraper = FundaScraper;
