# Fun-da AI Coding Instructions

## Project Overview
Fun-da is a vanilla JavaScript PWA that scrapes Funda.nl listings and presents them in a Tinder-style swipe interface. It includes family sync via Firebase for shared house hunting.

## Architecture

### Core Components
- **`js/app.js`** - Main `FunDaApp` class: UI rendering, swipe handling, modal management, LocalStorage persistence
- **`js/scraper.js`** - `FundaScraper` class: CORS proxy rotation, HTML parsing with regex fallbacks, anti-detection measures
- **`js/firebase-sync.js`** - `FamilySync` class: Firebase Realtime Database for cross-device family matching
- **`js/data.js`** - Helper functions only (`formatPrice`, `getPriceLabel`, `NEIGHBORHOOD_FACTS`)
- **`sw.js`** - Service worker with network-first caching strategy

### Data Flow
1. App auto-loads "Nieuw vandaag" listings on startup via `autoLoadNewListings()`
2. Scraper fetches Funda HTML through CORS proxies (prefer `corsproxy.io`)
3. Parsing cascade: `__NEXT_DATA__` JSON → `__NUXT__` → regex patterns → fallback
4. Houses stored in LocalStorage, favorites synced to Firebase if in family group

## Key Patterns

### House Object Schema
```javascript
{
    id: string,           // e.g., "funda-pair-0-1706000000"
    price: number,
    address: string,
    postalCode: string,   // "1071 AB"
    neighborhood: string, // Derived from postcode via getNeighborhoodFromPostcode()
    bedrooms: number,
    size: number,         // m²
    image: string,        // Main image URL
    images: string[],     // Array for thumbnail gallery (4+ shows grid)
    url: string
}
```

### Scraper Multi-Strategy Parsing
The scraper tries multiple extraction methods in order:
1. `parseNextData()` - Parse `__NEXT_DATA__` script tag
2. `findListingsInObject()` - Recursively search JSON for listing arrays
3. Regex patterns for price+address pairs with context-based data extraction

### Service Worker Versioning
**Always bump `CACHE_NAME` in `sw.js`** when making changes (currently `fun-da-v4`). Users won't see updates until the new SW activates.

## Development Commands
```bash
# Start local server
python -m http.server 8000
# or
npx serve
```

## Conventions

### Styling
- CSS variables in `:root` of `css/styles.css`
- Logo uses `.logo-fun` (orange gradient) and `.logo-da` (teal) spans
- Cards have `.card-image-gallery` for 4-image grid layout

### String IDs in onclick
House IDs contain hyphens. Always quote them in inline handlers:
```javascript
onclick="app.showDetail('${safeId}')"  // ✅ Correct
onclick="app.showDetail(${house.id})"  // ❌ Breaks on "funda-pair-0-123"
```

### Firebase Path Sanitization
Firebase paths can't contain `.#$[]`. Use `sanitizeForFirebase()` before writing:
```javascript
const sanitizedCode = this.sanitizeForFirebase(this.familyCode);
```

## Common Tasks

### Adding New House Fields
1. Extract in `js/scraper.js` `parseWithRegex()` or `normalizeHouseData()`
2. Add to house object in all creation points (search for `houses.push({`)
3. Display in `createCard()` in `js/app.js`

### Updating CORS Proxies
Edit `this.corsProxies` array in `FundaScraper` constructor. Format:
```javascript
{ url: 'https://proxy.example/?url=', jsonResponse: boolean, dataField: 'contents' }
```

### Postcode → Neighborhood Mapping
Update `getNeighborhoodFromPostcode()` in `js/scraper.js` to add new Amsterdam postcode ranges.
