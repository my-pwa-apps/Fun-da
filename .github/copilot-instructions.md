# Fun-da AI Coding Instructions

## Project Overview
Fun-da is a vanilla JavaScript PWA for browsing Dutch real estate listings from Funda.nl. It features a Tinder-style swipe interface, a browse/grid view with advanced filters, family sync via Firebase, and bilingual NL/EN support.

## Architecture

### Core Components
- **`js/app.js`** — Main `FunDaApp` class: UI rendering, swipe/browse views, detail pages, modals, filter management, LocalStorage + Firebase persistence
- **`js/scraper.js`** — `FundaScraper` class: Funda mobile API integration via Cloudflare Worker proxy, detail enrichment, PDOK city autocomplete
- **`js/firebase-sync.js`** — `FamilySync` class: Firebase Realtime Database for cross-device family matching
- **`js/data.js`** — Helper functions (`formatPrice`, `escapeHtml`, `cleanAddress`), translations (`TRANSLATIONS`), neighborhood facts
- **`sw.js`** — Service worker with network-first caching, `updateViaCache: 'none'` for instant update detection
- **`cloudflare-worker/cors-proxy.js`** — Dedicated CORS proxy deployed at `spring-night-8d4d.garfieldapp.workers.dev`

### Data Flow
1. User selects a city via PDOK autocomplete (no default area — app starts empty)
2. Scraper calls Funda's mobile API (`listing-search-wonen.funda.io`) through CF Worker proxy
3. Results enriched with detail API (`listing-detail-page.funda.io`) for photos, floorplans, video, 360°, kenmerken, bilingual descriptions
4. Houses stored in LocalStorage per area, favorites synced to Firebase

## Key Rules

### No Multi-Color Emoji Icons
Never use colored emoji (🏠🌿🚗 etc.) in the UI. Use:
- Plain text labels for features (e.g., "Tuin", "Balkon", "Parkeren")
- Single-color SVG icons where an icon is needed
- **Exception**: Red filled heart (`#e53e3e`) for favorited state

### Service Worker Versioning
**Always bump `CACHE_NAME` in `sw.js`** when making any change to HTML/CSS/JS. Format: `fun-da-vN` (increment N).

### No Amsterdam Default
The app starts with no search area. Never hardcode `'amsterdam'` as a default in state or API calls. The user must explicitly select a city.

### Mobile vs Desktop Behavior
- **Mobile**: Filters sidebar is a slide-in panel. User must tap "Filters toepassen" to apply. Autocomplete selection does NOT auto-apply.
- **Desktop (≥768px)**: Sidebar always visible. Filter changes auto-apply. Autocomplete selection auto-applies.

### Button Styling
All detail page buttons use `detail-action-btn` class for consistent sizing. Never use inline `style=` for buttons — use CSS classes.

### XSS Prevention
Always use `escapeHtml()` on any data from the API before inserting into DOM via innerHTML. Use `safeExternalUrl()` for external links. Use `safeImageUrl()` for image sources.

### CSP
The Content-Security-Policy meta tag in `index.html` must whitelist all external domains. When adding new iframe sources, add them to `frame-src`. API endpoints go in `connect-src`.

### Global `.hidden` Class
Use `.hidden { display: none !important; }` — it's defined globally in CSS. Never create element-specific `.hidden` rules unless they need special behavior (like `.splash.hidden` with opacity transition).

## House Object Schema
```javascript
{
    id: string,
    price: number,
    address: string,
    postalCode: string,
    city: string,
    neighborhood: string,
    bedrooms: number,
    size: number,              // m²
    image: string,
    images: string[],
    url: string,
    description: string,       // Dutch (from /nl/ endpoint)
    descriptionEN: string,     // English (from /en/ endpoint)
    kenmerkSections: [{title, items: [{label, value}]}],
    interactiveFloorplans: [{name, embedUrl, thumbnailUrl}],
    videoItems: [{id, thumbnailUrl, streamUrl, watchUrl}],
    photos360: [{name, embedUrl, thumbnailUrl}],
    brokerName: string,
    brokerId: number,
    contactUrl: string,        // Funda contact page URL
    hasOpenHouse: boolean,
    // ... plus feature booleans (hasGarden, hasBalcony, etc.)
}
```

## Bilingual Support
- Description: store both `description` (NL) and `descriptionEN` (EN). Show only the active language. Fall back to the other only if primary is empty.
- UI labels: use `this.t('key')` with translations from `TRANSLATIONS` in `data.js`.
- Kenmerken come from the API in Dutch only — show them regardless of language.

## Filter Persistence
- Filters are saved per area in `localStorage` key `funda-area-filters` (keyed by lowercase area name)
- When switching areas, current filters are saved and the target area's saved filters are restored
- `browseFilters` is the active filter state; `saveSettingsToFirebase()` persists to both localStorage and Firebase

## PDOK City Autocomplete
Uses the `free` endpoint (not `suggest`): `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free`
- Filter: `fq=type:(gemeente OR woonplaats)`
- Extract city name from `doc.woonplaatsnaam || doc.gemeentenaam`
- Lowercase for Funda API compatibility

## Development Commands
```bash
python -m http.server 8000    # or: npx serve
```

## Common Tasks

### Adding New House Fields
1. Extract in `js/scraper.js` → `parseMobileDetail()` or `parseMobileSearchResults()`
2. Display in `js/app.js` → `showDetail()` (main) and `showFavoriteDetail()` (favorites)
3. If filterable, add to `browseFilters` object and `applyBrowseFilters()` + `getBrowseHouses()`

### Updating the CF Worker Proxy
Edit `cloudflare-worker/cors-proxy.js`, then deploy via Cloudflare dashboard.

### Adding New Media Types
1. Extract in `parseMobileDetail()` from `data.Media`
2. Add to house object return
3. Display in `showDetail()` as media cards with `data-action="openMediaViewer"` or `data-action="openFloorplan"`

### Neighborhood Features
- Neighborhoods populate dynamically from loaded houses via `_populateBrowseNeighborhoods()`
- Clearing old entries on area switch is critical — always clear before repopulating
- Exclude checkboxes call `renderBrowseGrid()` on each change for live updates
