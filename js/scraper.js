// Funda Scraper - fetches listings via Funda's internal mobile API
// Uses a Cloudflare Worker proxy to forward requests

// Suppress verbose logging in production; keep warn + error visible
if (!window.__FUNDA_DEBUG) {
    console.log = () => {};
    console.debug = () => {};
}

class FundaScraper {
    constructor() {
        this.proxyUrl = 'https://spring-night-8d4d.garfieldapp.workers.dev/?url=';
        this.cache = new Map();
        this._wantEnglishDesc = false;
        this._backgroundFetch = null;
    }

    // ==========================================
    // FUNDA MOBILE API
    // ==========================================

    get FUNDA_API_SEARCH() {
        return 'https://listing-search-wonen.funda.io/_msearch/template';
    }

    get FUNDA_API_DETAIL_BASE() {
        return 'https://listing-detail-page.funda.io/api/v4/listing/object/nl';
    }

    async fetchViaProxyPost(targetUrl, body) {
        const response = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        if (response.ok) return response.json();
        const err = new Error('Mobile API POST failed: ' + response.status);
        err.status = response.status;
        throw err;
    }

    async searchFundaMobileAPI(params = {}) {
        const area = params.area || '';
        if (!area) throw new Error('No search area specified');

        const searchParams = {
            availability: ['available', 'negotiations'],
            type: ['single'],
            zoning: ['residential'],
            object_type: ['house', 'apartment'],
            publication_date: params.days ? { days: parseInt(params.days) } : { no_preference: true },
            offering_type: 'buy',
            selected_area: [area],
            sort: { field: 'publish_date_utc', order: 'desc' },
            page: { from: params.from || 0, size: params.size || 15 },
        };

        if (params.minPrice || params.maxPrice) {
            const priceFilter = {};
            if (params.minPrice) priceFilter.from = params.minPrice;
            if (params.maxPrice) priceFilter.to = params.maxPrice;
            searchParams.price = { selling_price: priceFilter };
        }

        const ndjson = JSON.stringify({ index: 'listings-wonen-searcher-alias-prod' }) + '\n' +
                        JSON.stringify({ id: 'search_result_20250805', params: searchParams }) + '\n';

        console.log('Funda API request:', { area, days: params.days, from: params.from, size: params.size });
        return this.parseMobileSearchResults(await this.fetchViaProxyPost(this.FUNDA_API_SEARCH, ndjson));
    }

    // ==========================================
    // SEARCH RESULTS PARSER
    // ==========================================

    parseMobileSearchResults(data) {
        const hitsObj = data?.responses?.[0]?.hits || {};
        const hits = hitsObj.hits || [];
        this._lastMobileTotal = hitsObj.total?.value || hits.length;

        return hits.map(hit => {
            const source = hit._source || {};
            const addr = source.address || {};
            const price = source.price?.selling_price?.[0] || source.price?.rent_price?.[0] || null;
            const detailPath = source.object_detail_page_relative_url;
            const fullAddress = [addr.street_name, addr.house_number, addr.house_number_suffix].filter(Boolean).join(' ');

            const photoUrls = (Array.isArray(source.thumbnail_id) ? source.thumbnail_id : source.thumbnail_id ? [source.thumbnail_id] : [])
                .map(id => {
                    const s = String(id);
                    return 'https://cloud.funda.nl/valentina_media/' + (s.length >= 9 ? s.substring(0,3)+'/'+s.substring(3,6)+'/'+s.substring(6) : s) + '.jpg';
                });

            return {
                id: 'funda-api-' + hit._id,
                globalId: hit._id,
                price: typeof price === 'number' ? price : null,
                address: fullAddress || 'Adres onbekend',
                houseNumber: addr.house_number || '',
                postalCode: addr.postal_code || '',
                city: addr.city || '',
                neighborhood: addr.neighbourhood || '',
                bedrooms: source.number_of_bedrooms || 0,
                rooms: source.number_of_rooms || 0,
                size: source.floor_area?.[0] || 0,
                plotArea: source.plot_area_range?.gte || 0,
                energyLabel: (source.energy_label && source.energy_label !== 'unknown') ? source.energy_label : '',
                yearBuilt: null,
                propertyType: { house: 'Woning', apartment: 'Appartement', parking_space: 'Parkeerplaats', building_plot: 'Bouwgrond' }[source.object_type] || source.object_type || '',
                constructionType: source.construction_type || '',
                publicationDate: source.publish_date || '',
                daysOnMarket: this._computeDaysOnMarket(source.publish_date),
                brokerName: source.agent?.[0]?.name || '',
                brokerPhone: source.agent?.[0]?.phone_number || source.agent?.[0]?.phone || '',
                brokerEmail: source.agent?.[0]?.email || '',
                brokerId: source.agent?.[0]?.id || null,
                brokerUrl: source.agent?.[0]?.relative_url ? 'https://www.funda.nl' + source.agent[0].relative_url : '',
                contactUrl: detailPath ? 'https://www.funda.nl' + detailPath + 'contact/' : '',
                hasDetailData: false,
                image: photoUrls[0] || PLACEHOLDER_IMAGE,
                images: photoUrls.slice(0, 30),
                url: detailPath ? 'https://www.funda.nl' + detailPath : '#',
                description: '',
                features: [],
                isNew: false,
                fromMobileAPI: true,
                availability: source.availability || 'available',
            };
        });
    }

    // ==========================================
    // DETAIL PAGE
    // ==========================================

    extractTinyId(url) {
        if (!url) return null;
        const match = url.match(/\/(\d{7,9})\/?(?:\?|$|#)?/);
        return match ? match[1] : null;
    }

    async fetchFundaMobileDetail(url) {
        const tinyId = this.extractTinyId(url);
        if (!tinyId) return null;

        const detailUrl = this.FUNDA_API_DETAIL_BASE + '/tinyId/' + tinyId;
        try {
            // Always fetch both NL and EN descriptions so the app can show the correct one
            const enDetailUrl = detailUrl.replace('/nl/', '/en/');
            const promises = [
                fetch(this.proxyUrl + encodeURIComponent(detailUrl)),
                fetch(this.proxyUrl + encodeURIComponent(enDetailUrl)),
            ];

            const responses = await Promise.all(promises);
            if (!responses[0].ok) return null;

            const raw = await responses[0].json().catch(() => null);
            if (!raw) return null;

            const result = this.parseMobileDetail(raw);
            if (!result) return null;

            // Store English description from the /en/ endpoint
            if (responses[1]?.ok) {
                try {
                    const enRaw = await responses[1].json();
                    result.descriptionEN = enRaw?.ListingDescription?.Description || '';
                } catch { /* EN unavailable */ }
            }
            return result;
        } catch (e) {
            console.debug('Detail fetch failed for ' + tinyId + ':', e.message);
            return null;
        }
    }

    parseMobileDetail(data) {
        if (!data || data.IsSoldOrRented === true) return null;

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
            const n = parseInt(String(val).replace(/[^0-9]/g, ''));
            return isNaN(n) ? null : n;
        };

        // Photos
        const photosData = media.Photos || {};
        const photoBase = (photosData.MediaBaseUrl || '').replace('{id}', '{}');
        const photoUrls = photoBase
            ? (photosData.Items || []).map(p => photoBase.replace('{}', p.Id)).filter(Boolean)
            : [];

        // Floorplan thumbnails
        const fpData = media.LegacyFloorPlan || {};
        const fpBase = (fpData.ThumbnailBaseUrl || '').replace('{id}', '{}');
        const floorplanUrls = fpBase
            ? (fpData.Items || []).map(f => fpBase.replace('{}', f.ThumbnailId)).filter(Boolean)
            : [];

        // Interactive floorplans
        const ifpData = media.FloorPlan || {};
        const interactiveFloorplans = (ifpData.Items || []).map(fp => ({
            name: fp.DisplayName || '',
            embedUrl: fp.EmbedUrl || '',
            thumbnailUrl: ifpData.ThumbnailBaseUrl ? ifpData.ThumbnailBaseUrl.replace('{id}', fp.Id) : '',
        })).filter(fp => fp.embedUrl);

        // Videos
        const vidData = media.Videos || {};
        const videoItems = (vidData.Items || []).map(v => ({
            id: v.Id,
            thumbnailUrl: vidData.ThumbnailBaseUrl ? vidData.ThumbnailBaseUrl.replace('{id}', v.Id) : '',
            streamUrl: vidData.MediaBaseUrl ? vidData.MediaBaseUrl.replace('{id}', v.Id) : '',
            watchUrl: v.Id ? 'https://customer-vzk8jgcsaz84e8sb.cloudflarestream.com/' + v.Id + '/watch' : '',
        })).filter(v => v.watchUrl || v.streamUrl || v.id);

        // 360 photos
        const p360Data = media.Photos360 || {};
        const photos360 = (p360Data.Items || []).map(p => ({
            name: p.DisplayName || '',
            embedUrl: p.EmbedUrl || '',
            thumbnailUrl: p360Data.ThumbnailBaseUrl ? p360Data.ThumbnailBaseUrl.replace('{id}', p.Id) : '',
        })).filter(p => p.embedUrl);

        // URL
        const tinyId = identifiers.TinyId;
        const citySlug = (address.City || '').toLowerCase().replace(/ /g, '-');
        const titleSlug = (address.Title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const offering = data.OfferingType === 'Sale' ? 'koop' : 'huur';
        const url = tinyId ? 'https://www.funda.nl/detail/' + offering + '/' + citySlug + '/' + titleSlug + '/' + tinyId + '/' : '#';

        // Characteristics
        const characteristics = {};
        const kenmerkSections = [];
        for (const section of data.KenmerkSections || []) {
            const items = [];
            for (const item of section.KenmerkenList || []) {
                if (item.Label && item.Value) {
                    characteristics[item.Label] = item.Value;
                    items.push({ label: item.Label, value: item.Value });
                }
            }
            if (items.length > 0) {
                kenmerkSections.push({ title: section.Title || '', items });
            }
        }

        return {
            globalId: identifiers.GlobalId,
            tinyId,
            price: priceData.NumericSellingPrice || priceData.NumericRentalPrice || null,
            priceFormatted: priceData.SellingPrice || priceData.RentalPrice || null,
            pricePerM2: characteristics['Vraagprijs per m\u00B2'] || null,
            address: address.Title || '',
            houseNumber: address.HouseNumber || '',
            houseNumberExt: address.HouseNumberExtension || '',
            postalCode: address.PostCode || '',
            city: address.City || ads.gemeente || '',
            neighborhood: address.NeighborhoodName || '',
            municipality: ads.gemeente || '',
            bedrooms: fastView.NumberOfBedrooms || null,
            rooms: ads.aantalkamers ? parseInt(ads.aantalkamers) || null : null,
            size: ads.woonoppervlakte ? parseArea(ads.woonoppervlakte) : parseArea(fastView.LivingArea),
            plotArea: ads.perceeloppervlakte ? parseArea(ads.perceeloppervlakte) : parseArea(fastView.PlotArea),
            energyLabel: fastView.EnergyLabel || '',
            yearBuilt: ads.bouwjaar && /^\d{4}$/.test(ads.bouwjaar) ? parseInt(ads.bouwjaar) : null,
            constructionType: data.ConstructionType || '',
            propertyType: { Apartment: 'Appartement', House: 'Woning', 'Parking space': 'Parkeerplaats', 'Building plot': 'Bouwgrond' }[data.ObjectType] || data.ObjectType || '',
            houseType: ads.soortwoning || '',
            description: data.ListingDescription?.Description || '',
            descriptionEN: '',
            kenmerkSections,
            publicationDate: data.PublicationDate || '',
            offeredSince: characteristics['Aangeboden sinds'] || null,
            acceptance: characteristics['Aanvaarding'] || null,
            url,
            image: photoUrls[0] || PLACEHOLDER_IMAGE,
            images: photoUrls.slice(0, 30),
            floorplanUrls,
            interactiveFloorplans,
            videoItems,
            photos360,
            latitude: coords.Latitude ? parseFloat(coords.Latitude) : null,
            longitude: coords.Longitude ? parseFloat(coords.Longitude) : null,
            googleMapsUrl: data.GoogleMapsObjectUrl || null,
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
            views: data.ObjectInsights?.Views ?? null,
            saves: data.ObjectInsights?.Saves ?? null,
            daysOnMarket: this._computeDaysOnMarket(data.PublicationDate),
            brokerName: data.SellingAgent?.Name || data.SellingAgent?.name || '',
            brokerPhone: data.SellingAgent?.PhoneNumber || data.SellingAgent?.phone_number || data.SellingAgent?.Phone || '',
            brokerEmail: data.SellingAgent?.Email || data.SellingAgent?.email || '',
            brokerId: parseInt(ads.hoofdaanbieder) || null,
            brokerUrl: ads.hoofdaanbieder ? 'https://www.funda.nl/makelaar/' + ads.hoofdaanbieder + '/' : '',
            contactUrl: url && url !== '#' ? url + 'contact/' : '',
            hasOpenHouse: ads.openhuis === 'true',
            isSold: data.IsSoldOrRented === true,
            status: ads.status || '',
            enrichedFromMobileAPI: true,
            hasDetailData: true,
        };
    }

    // ==========================================
    // PROGRESSIVE SCRAPE
    // ==========================================

    async scrapeAllSources(searchParams = {}) {
        const startTime = Date.now();
        const onProgress = searchParams.onProgress || (() => {});
        const onBatch = searchParams.onBatch || null;

        onProgress('Verbinden met Funda API...', 15);

        const days = parseInt(searchParams.days) || 3;
        const pageSize = 15;
        const maxResults = 3000;
        const area = searchParams.area || '';
        if (!area) throw new Error('No search area specified');

        // Fetch first page with retries
        let firstPage = [];
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
                firstPage = await this.searchFundaMobileAPI({ area, days: searchParams.days, size: pageSize, from: 0 });
                break;
            } catch (e) {
                if (attempt < 2) {
                    console.warn('First page failed (attempt ' + (attempt + 1) + '/3), retrying...');
                } else {
                    throw e;
                }
            }
        }

        if (firstPage.length === 0) {
            onProgress('Geen woningen gevonden', 100);
            return [];
        }

        const apiTotal = this._lastMobileTotal || firstPage.length;
        const totalPages = Math.min(Math.ceil(apiTotal / pageSize), Math.ceil(maxResults / pageSize));
        console.log('First page: ' + firstPage.length + ' houses in ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's (total: ' + apiTotal + ')');
        onProgress(firstPage.length + ' woningen geladen...', 30);

        const oldestFirst = firstPage[firstPage.length - 1].daysOnMarket ?? Infinity;
        const needsMore = oldestFirst <= days && totalPages > 1;

        if (!needsMore) {
            onProgress('Klaar!', 100);
            return firstPage;
        }

        // Background pagination
        if (onBatch) {
            const existingIds = new Set(firstPage.map(h => h.id));
            this._backgroundFetch = this._fetchRemainingPages({
                area, days, searchParams, pageSize, totalPages, startTime, existingIds, onBatch,
            });
            return firstPage;
        }

        // Synchronous pagination (legacy)
        let allResults = [...firstPage];
        let consecutiveFailures = 0;
        for (let page = 1; page < totalPages; page++) {
            onProgress('Pagina ' + (page + 1) + ' ophalen (' + allResults.length + ' woningen)...', 20 + Math.round((page / totalPages) * 30));
            try {
                await new Promise(r => setTimeout(r, 500));
                const pageResults = await this.searchFundaMobileAPI({ area, days: searchParams.days, size: pageSize, from: page * pageSize });
                if (pageResults.length === 0) break;
                consecutiveFailures = 0;
                const ids = new Set(allResults.map(h => h.id));
                allResults.push(...pageResults.filter(h => !ids.has(h.id)));
                const oldest = pageResults[pageResults.length - 1]?.daysOnMarket;
                if (oldest != null && oldest > days) break;
            } catch {
                if (++consecutiveFailures >= 3) break;
                console.warn('Page ' + (page + 1) + ' failed (' + consecutiveFailures + '/3), pausing 5s...');
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        onProgress('Klaar!', 100);
        return allResults;
    }

    async _fetchRemainingPages({ area, days, searchParams, pageSize, totalPages, startTime, existingIds, onBatch }) {
        let totalNew = 0;
        let consecutiveFailures = 0;

        for (let page = 1; page < totalPages; page++) {
            try {
                await new Promise(r => setTimeout(r, 500));
                const pageResults = await this.searchFundaMobileAPI({ area, days: searchParams.days, size: pageSize, from: page * pageSize });
                if (pageResults.length === 0) break;

                consecutiveFailures = 0;
                const newHouses = pageResults.filter(h => !existingIds.has(h.id));
                newHouses.forEach(h => existingIds.add(h.id));
                totalNew += newHouses.length;

                if (newHouses.length > 0) {
                    onBatch(newHouses, { page: page + 1, totalPages, totalLoaded: existingIds.size });
                }

                const oldest = pageResults[pageResults.length - 1]?.daysOnMarket;
                if (oldest != null && oldest > days) {
                    console.warn('Stop: reached ' + oldest + ' days old (limit: ' + days + ')');
                    break;
                }
            } catch (e) {
                consecutiveFailures++;
                if (consecutiveFailures >= 3) {
                    console.warn('Stopping after ' + consecutiveFailures + ' consecutive failures');
                    break;
                }
                console.warn('Page ' + (page + 1) + ' failed (' + consecutiveFailures + '/3), pausing 5s...');
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('Background fetch done: ' + totalNew + ' extra houses in ' + elapsed + 's');
        onBatch(null, { done: true, totalLoaded: existingIds.size });
        this._backgroundFetch = null;
    }

    // ==========================================
    // HELPERS
    // ==========================================

    _computeDaysOnMarket(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        return isNaN(d) ? null : Math.floor((Date.now() - d) / 86400000);
    }
}

window.FundaScraper = FundaScraper;
