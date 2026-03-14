// Helper functies voor Fun-da
// Mock data is verwijderd - app gebruikt alleen echte Funda data

// Clean address: remove duplicate floor suffixes like "straat 27-H H" -> "straat 27-H"
const cleanAddress = (addr) => {
    if (!addr) return '';
    return addr.replace(/(\d+[a-zA-Z]?[-\/]([a-zA-Z0-9]+))\s+\2\s*$/i, '$1').trim();
};

// Placeholder image as inline SVG data URI (no external dependency)
const PLACEHOLDER_IMAGE = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" fill="%23f0f0f0">' +
    '<rect width="800" height="600"/>' +
    '<text x="400" y="290" text-anchor="middle" font-family="sans-serif" font-size="24" fill="%23999">Foto laden...</text>' +
    '<text x="400" y="330" text-anchor="middle" font-family="sans-serif" font-size="24" fill="%23ccc">Geen foto</text>' +
    '</svg>'
)}`;

const APP_DEBUG = false;

// Fun facts about Amsterdam neighborhoods
const NEIGHBORHOOD_FACTS = {
    "Centrum": "Het historische hart van Amsterdam met de beroemde grachten!",
    "Jordaan": "Ooit een arbeiderswijk, nu d\u00e9 plek voor kunstenaars en gezellige caf\u00e9s!",
    "De Pijp": "Thuisbasis van de Albert Cuypmarkt - de grootste markt van Europa!",
    "Oost": "Hip en groen met het prachtige Oosterpark als middelpunt!",
    "West": "Van industrieel naar trendy - de Houthavens zijn helemaal hot!",
    "Noord": "De nieuwe creative hub van Amsterdam - edgy en upcoming!",
    "Zuid": "Chic en verfijnd - hier wonen de echte Amsterdammers!",
    "Oud-West": "Foodhallen, boutiques en de gezelligste pleintjes!",
    "IJburg": "Strand in de stad - moderne architectuur op het water!",
    "Amsterdam": ""
};

// Price range labels for fun
const PRICE_LABELS = [
    { max: 350000, label: "Startersvriendelijk", color: "#2ECC71" },
    { max: 500000, label: "Middenklasse", color: "#3498DB" },
    { max: 750000, label: "Comfortabel", color: "#9B59B6" },
    { max: 1000000, label: "Premium", color: "#E67E22" },
    { max: Infinity, label: "Luxe", color: "#E74C3C" }
];

// Helper function to get price label
function getPriceLabel(price) {
    if (!price) return { label: "Prijs onbekend", color: "#999" };
    return PRICE_LABELS.find(p => price <= p.max);
}

// Helper function to format price
function formatPrice(price) {
    if (!price) return "Prijs op aanvraag";
    return new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

// Escape HTML special characters to prevent XSS when inserting user-controlled
// or external strings into innerHTML
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function sanitizeUrl(url, options = {}) {
    const {
        fallback = '#',
        allowData = false,
        allowBlob = false,
    } = options;

    if (!url) return fallback;

    const trimmed = String(url).trim();
    if (!trimmed) return fallback;

    if (allowData && trimmed.startsWith('data:image/')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed, window.location.origin);
        const allowedProtocols = ['http:', 'https:'];
        if (allowBlob) allowedProtocols.push('blob:');
        if (allowData) allowedProtocols.push('data:');
        return allowedProtocols.includes(parsed.protocol) ? parsed.href : fallback;
    } catch {
        return fallback;
    }
}

function safeExternalUrl(url) {
    return sanitizeUrl(url, { fallback: '#' });
}

/**
 * Split a Funda description that contains both Dutch and English text.
 * Returns { nl, en }. If no separator is found, the full text goes into
 * the 'primary' key and the other is empty.
 */
function splitDescription(text) {
    if (!text) return { nl: '', en: '' };
    // Common separator patterns brokers use between NL and EN sections.
    // Matches lines like: --- , *** , === , ___ , ~~~~~~
    // Or lines containing: ENGLISH, IN ENGLISH, ENGLISH BELOW, ENGLISH VERSION,
    //   ENGLISH TRANSLATION, TRANSLATION, EN: , EN -, ENGLISH DESCRIPTION
    const sepPattern = /\n\s*(?:[-=*_~]{3,}|\*{3,})\s*\n|\n\s*(?:(?:--+\s*)?(?:ENGLISH(?:\s+(?:BELOW|VERSION|TRANSLATION|DESCRIPTION|TEXT))?|IN\s+ENGLISH|TRANSLATION|EN\s*[:–—-])\s*(?:--+)?\s*)\s*\n/i;
    const match = text.match(sepPattern);
    if (!match) return { nl: text, en: '' };
    const idx = match.index;
    const nl = text.substring(0, idx).trim();
    const en = text.substring(idx + match[0].length).trim();
    return { nl, en };
}

function safeImageUrl(url) {
    return sanitizeUrl(url, {
        fallback: PLACEHOLDER_IMAGE,
        allowData: true,
        allowBlob: true,
    });
}

// Helper function to shuffle array
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Translations for NL/EN language toggle
const TRANSLATIONS = {
    nl: {
        'nav.swipe': 'Swipen',
        'nav.browse': 'Bladeren',
        'badge.new': 'Nieuw',
        'badge.nego': 'In onderhandeling',
        'feat.garden': 'Tuin',
        'feat.balcony': 'Balkon',
        'feat.roofterrace': 'Dakterras',
        'feat.solar': 'Zonnepanelen',
        'feat.heatpump': 'Warmtepomp',
        'feat.parking': 'Parkeren',
        'feat.monument': 'Monument',
        'feat.fixer': 'Kluswoning',
        'feat.auction': 'Veiling',
        'label.plot': 'Perceel',
        'label.days_ago': (n) => `${n}\u00a0dag${n !== 1 ? 'en' : ''} geleden`,
        'detail.features': 'Kenmerken',
        'detail.desc': 'Omschrijving',
        'detail.desc_alt': 'Beschrijving',
        'detail.broker_title': '🏢 Makelaar',
        'detail.floorplan': 'Plattegrond',
        'detail.call': 'Bel',
        'detail.email': 'Stuur e-mail',
        'detail.maps': 'Locatie',
        'detail.yearbuilt': 'Bouwjaar',
        'detail.energy': 'Energie',
        'detail.rooms': 'Kamers',
        'detail.beds': 'Slaapk.',
        'detail.viewed': (n) => `${n} keer bekeken`,
        'detail.saved': (n) => `${n} keer opgeslagen`,
        'settings.title': 'Instellingen',
        'settings.account': 'Account',
        'settings.search': 'Zoekinstellingen',
        'settings.data': 'Data',
        'settings.language': 'Taal',
        'settings.period_label': 'Zoekperiode (ook bij automatisch laden)',
        'settings.clear': '🗑️ Wis alle data (start opnieuw)',
        'settings.login': 'Inloggen met Google',
        'settings.logout': 'Uitloggen',
        'settings.view_mode': 'Startweergave',
        'settings.install': 'App installeren',
        'settings.bin': 'Prullenbak',
        'settings.bin_desc': 'Weggeswipete woningen worden 7 dagen bewaard.',
        'settings.bin_open': 'Prullenbak openen',
        'settings.bin_empty': 'De prullenbak is leeg.',
        'stats.viewed': 'Bekeken',
        'stats.remaining': 'Te gaan',
        'empty.title': 'Alle huizen bekeken!',
        'empty.text': 'Je hebt alle beschikbare woningen gezien.',
        'empty.reset': 'Opnieuw beginnen',
        'filters.title': 'Filters',
        'filters.area': 'Zoekgebied',
        'filters.area_hint': 'Stad, straat, of postcode',
        'filters.type': 'Type woning',
        'filters.period': 'Zoekperiode',
        'filters.period_hint': 'Hoeveel dagen terug worden nieuwe woningen opgehaald',
        'filters.price': 'Prijs',
        'filters.size': 'Woonoppervlak (m\u00b2)',
        'filters.bedrooms': 'Slaapkamers',
        'filters.energy': 'Min. energielabel',
        'filters.neighborhood': 'Buurt',
        'filters.exclude_neigh': 'Buurten uitsluiten',
        'filters.year': 'Bouwjaar vanaf',
        'filters.days_min': 'Op de markt (min. dagen)',
        'filters.days_min_hint': 'Langer op de markt = meer ruimte voor een lager bod',
        'filters.days_max': 'Op de markt (max. dagen)',
        'filters.rooms': 'Kamers (min.)',
        'filters.status': 'Status',
        'filters.features': 'Kenmerken',
        'filters.apply': 'Filters toepassen',
        'filters.reset': 'Wis alle filters',
        'browse.empty': 'Geen woningen gevonden met deze filters.',
        'sort.newest': 'Nieuwste',
        'sort.price_asc': 'Prijs \u2191',
        'sort.price_desc': 'Prijs \u2193',
        'sort.ppm2_asc': 'Prijs/m\u00b2 \u2191',
        'sort.size_desc': 'm\u00b2 \u2193',
        'sort.bedrooms_desc': 'Kamers \u2193',
        'sort.oldest': 'Langst te koop',
        'fav.title': 'Mijn Favorieten',
        'fav.empty1': 'Nog geen favorieten!',
        'fav.empty2': 'Swipe naar rechts of druk op het hartje om huizen toe te voegen.',
        'family.title': 'Familie Modus',
        'family.intro': 'Zoek samen met je gezin naar jullie droomhuis! Als meerdere familieleden hetzelfde huis liken, wordt het een <strong>Familie Match</strong>!',
        'family.your_name': 'Jouw naam',
        'family.start_new': 'Nieuwe familie starten',
        'family.start_desc': 'Maak een nieuwe familie aan en deel de code met je gezinsleden.',
        'family.create': 'Familie aanmaken',
        'family.or': 'of',
        'family.join_existing': 'Bestaande familie joinen',
        'family.join': 'Familie joinen',
        'family.scan_qr': 'QR Code scannen',
        'family.your_code': 'Jullie familie code:',
        'family.copy': 'Kopieer',
        'family.members': 'Gezinsleden',
        'family.matches': 'Familie Matches',
        'family.matches_desc': 'Woningen die door meerdere gezinsleden zijn geliked:',
        'family.no_matches': 'Nog geen matches! Blijf swipen en kijk of jullie dezelfde smaak hebben.',
        'family.leave': 'Familie verlaten',
        'family.share_code': 'Deelcode',
        'family.share_hint': 'Deel deze code veilig met je familie om te joinen',
        'tile.beds': 'slpk',
        'tile.baths': 'badk',
        'tile.plot': 'perceel',
        'tile.stale_90': '90+ dagen',
        'tile.stale_title_90': 'Al meer dan 90 dagen te koop',
        'tile.stale_title': (n) => `Al ${n} dagen te koop`,
        'tile.fav_add': 'Voeg toe aan favorieten',
        'tile.fav_remove': 'Verwijder favoriet',
        'swipe.like': 'Ja!',
        'swipe.nope': '\u2715 Nee',
        'share.title': 'Woning op Funda',
        'share.failed': 'Delen mislukt',
        'status.interested': 'Interessant',
        'status.viewing': 'Bezichtiging',
        'status.bid': 'Bod uitgebracht',
        'status.accepted': 'Geaccepteerd',
        'status.rejected': 'Afgewezen',
        'splash.loading': 'Woningen laden...',
        'splash.choose_area': 'Kies eerst een zoekgebied om woningen op te halen.',
        'splash.connecting': 'Verbinden met Funda...',
        'splash.saving': 'Woningen opslaan...',
        'splash.loaded': (n, more) => `${n} woningen geladen${more ? ' (meer laden...)' : ''}`,
        'splash.none': 'Geen woningen gevonden',
        'splash.cache': 'Cache laden...',
        'splash.cache_loading': (n) => `${n} woningen uit cache, verversen...`,
        'browse.count': (n, loading) => `${n} woning${n !== 1 ? 'en' : ''}${loading ? ' (laden...)' : ''}`,
        'browse.loading': 'Woningen ophalen...',
        'browse.refresh': 'Nieuwe woningen ophalen...',
        'empty.no_area': 'Kies eerst een zoekgebied',
        'empty.no_area_text': 'Open filters en kies een stad of regio voordat woningen worden opgehaald.',
        'empty.no_area_browse': 'Kies eerst een zoekgebied in de filters voordat woningen worden opgehaald.',
        'empty.open_filters': 'Open filters',
        'toast.installed': 'Fun-da is ge\u00efnstalleerd!',
        'toast.easter': 'Fun-da - Huizenjacht was nog nooit zo leuk!',
        'toast.online': 'Internetverbinding hersteld',
        'toast.cleared': 'Alle data gewist!',
        'toast.no_auth': 'Firebase Auth niet beschikbaar',
        'toast.logged_in': 'Ingelogd!',
        'toast.login_fail': 'Inloggen mislukt',
        'toast.logged_out': 'Uitgelogd',
        'toast.login_required': 'Log eerst in met Google om familie sync te gebruiken',
        'toast.name_required': 'Vul eerst je naam in',
        'toast.family_fail': 'Familie aanmaken mislukt. Probeer het opnieuw.',
        'toast.family_created': (code) => `Familie aangemaakt! Code: ${code}`,
        'toast.family_net_fail': 'Familie aanmaken mislukt. Controleer je internetverbinding.',
        'toast.code_required': 'Vul de familie code in',
        'toast.family_not_found': 'Familie niet gevonden. Controleer de code.',
        'toast.family_joined': (code) => `Je bent nu lid van familie ${code}!`,
        'toast.family_join_fail': 'Familie joinen mislukt.',
        'toast.family_left': 'Je hebt de familie verlaten',
        'toast.code_copied': 'Code gekopieerd!',
        'toast.no_code': 'Geen familie code gevonden',
        'toast.notes_saved': 'Notities opgeslagen',
        'toast.hidden': 'Woning verborgen',
        'toast.restored': 'Woning hersteld',
        'toast.added': (n) => `${n} nieuwe woningen toegevoegd`,
        'toast.updated': 'Woningen bijgewerkt',
        'toast.no_new': 'Geen nieuwe woningen gevonden',
        'toast.refresh_fail': 'Vernieuwen mislukt',
        'bid.title': 'Notities & Bieding',
        'bid.viewing': 'Bezichtiging',
        'bid.bid': 'Bod',
        'detail.prev_photo': 'Vorige foto',
        'detail.next_photo': 'Volgende foto',
        'detail.fullscreen': 'Volledig scherm',
        'detail.zoom': 'Vergroot foto',
        'detail.photo': 'Foto',
        'celebration.title': 'FAMILIE MATCH!',
        'celebration.subtitle': 'Jullie hebben dezelfde woning geliked!',
        'match.liked_by': 'Deze woning is geliked door:',
    },
    en: {
        'nav.swipe': 'Swipe',
        'nav.browse': 'Browse',
        'badge.new': 'New',
        'badge.nego': 'Under negotiation',
        'feat.garden': 'Garden',
        'feat.balcony': 'Balcony',
        'feat.roofterrace': 'Roof terrace',
        'feat.solar': 'Solar panels',
        'feat.heatpump': 'Heat pump',
        'feat.parking': 'Parking',
        'feat.monument': 'Monument',
        'feat.fixer': 'Fixer-upper',
        'feat.auction': 'Auction',
        'label.plot': 'Plot',
        'label.days_ago': (n) => `${n}\u00a0day${n !== 1 ? 's' : ''} ago`,
        'detail.features': 'Features',
        'detail.desc': 'Description',
        'detail.desc_alt': 'Description',
        'detail.broker_title': '🏢 Agent',
        'detail.floorplan': 'Floorplan',
        'detail.call': 'Call',
        'detail.email': 'Send email',
        'detail.maps': 'Location',
        'detail.yearbuilt': 'Year built',
        'detail.energy': 'Energy',
        'detail.rooms': 'Rooms',
        'detail.beds': 'Beds',
        'detail.viewed': (n) => `Viewed ${n} times`,
        'detail.saved': (n) => `Saved ${n} times`,
        'settings.title': 'Settings',
        'settings.account': 'Account',
        'settings.search': 'Search settings',
        'settings.data': 'Data',
        'settings.language': 'Language',
        'settings.period_label': 'Search period (also for auto-load)',
        'settings.clear': '🗑️ Clear all data (start over)',
        'settings.login': 'Sign in with Google',
        'settings.logout': 'Sign out',
        'settings.view_mode': 'Default view',
        'settings.install': 'Install app',
        'settings.bin': 'Recycle bin',
        'settings.bin_desc': 'Swiped-away listings are kept for 7 days.',
        'settings.bin_open': 'Open recycle bin',
        'settings.bin_empty': 'The recycle bin is empty.',
        'stats.viewed': 'Viewed',
        'stats.remaining': 'Remaining',
        'empty.title': 'All houses viewed!',
        'empty.text': 'You have seen all available listings.',
        'empty.reset': 'Start over',
        'filters.title': 'Filters',
        'filters.area': 'Search area',
        'filters.area_hint': 'City, street, or postal code',
        'filters.type': 'Property type',
        'filters.period': 'Search period',
        'filters.period_hint': 'How many days back new listings are fetched',
        'filters.price': 'Price',
        'filters.size': 'Living area (m\u00b2)',
        'filters.bedrooms': 'Bedrooms',
        'filters.energy': 'Min. energy label',
        'filters.neighborhood': 'Neighborhood',
        'filters.exclude_neigh': 'Exclude neighborhoods',
        'filters.year': 'Year built from',
        'filters.days_min': 'On market (min. days)',
        'filters.days_min_hint': 'Longer on market = more room for a lower bid',
        'filters.days_max': 'On market (max. days)',
        'filters.rooms': 'Rooms (min.)',
        'filters.status': 'Status',
        'filters.features': 'Features',
        'filters.apply': 'Apply filters',
        'filters.reset': 'Clear all filters',
        'browse.empty': 'No listings found with these filters.',
        'sort.newest': 'Newest',
        'sort.price_asc': 'Price \u2191',
        'sort.price_desc': 'Price \u2193',
        'sort.ppm2_asc': 'Price/m\u00b2 \u2191',
        'sort.size_desc': 'm\u00b2 \u2193',
        'sort.bedrooms_desc': 'Rooms \u2193',
        'sort.oldest': 'Longest listed',
        'fav.title': 'My Favorites',
        'fav.empty1': 'No favorites yet!',
        'fav.empty2': 'Swipe right or tap the heart to add houses.',
        'family.title': 'Family Mode',
        'family.intro': 'Search for your dream home together! When multiple family members like the same house, it becomes a <strong>Family Match</strong>!',
        'family.your_name': 'Your name',
        'family.start_new': 'Start a new family',
        'family.start_desc': 'Create a new family and share the code with your family members.',
        'family.create': 'Create family',
        'family.or': 'or',
        'family.join_existing': 'Join existing family',
        'family.join': 'Join family',
        'family.scan_qr': 'Scan QR Code',
        'family.your_code': 'Your family code:',
        'family.copy': 'Copy',
        'family.members': 'Family members',
        'family.matches': 'Family Matches',
        'family.matches_desc': 'Listings liked by multiple family members:',
        'family.no_matches': 'No matches yet! Keep swiping and see if you share the same taste.',
        'family.leave': 'Leave family',
        'family.share_code': 'Share code',
        'family.share_hint': 'Share this code securely with your family to join',
        'tile.beds': 'beds',
        'tile.baths': 'baths',
        'tile.plot': 'plot',
        'tile.stale_90': '90+ days',
        'tile.stale_title_90': 'Listed for more than 90 days',
        'tile.stale_title': (n) => `Listed for ${n} days`,
        'tile.fav_add': 'Add to favorites',
        'tile.fav_remove': 'Remove favorite',
        'swipe.like': 'Yes!',
        'swipe.nope': '\u2715 No',
        'share.title': 'Property on Funda',
        'share.failed': 'Sharing failed',
        'status.interested': 'Interested',
        'status.viewing': 'Viewing',
        'status.bid': 'Bid placed',
        'status.accepted': 'Accepted',
        'status.rejected': 'Rejected',
        'splash.loading': 'Loading listings...',
        'splash.choose_area': 'Choose a search area to load listings.',
        'splash.connecting': 'Connecting to Funda...',
        'splash.saving': 'Saving listings...',
        'splash.loaded': (n, more) => `${n} listings loaded${more ? ' (loading more...)' : ''}`,
        'splash.none': 'No listings found',
        'splash.cache': 'Loading cache...',
        'splash.cache_loading': (n) => `${n} listings from cache, refreshing...`,
        'browse.count': (n, loading) => `${n} listing${n !== 1 ? 's' : ''}${loading ? ' (loading...)' : ''}`,
        'browse.loading': 'Loading listings...',
        'browse.refresh': 'Fetching new listings...',
        'empty.no_area': 'Choose a search area first',
        'empty.no_area_text': 'Open filters and pick a city or region before listings are loaded.',
        'empty.no_area_browse': 'Choose a search area in the filters before listings are loaded.',
        'empty.open_filters': 'Open filters',
        'toast.installed': 'Fun-da is installed!',
        'toast.easter': 'Fun-da - House hunting was never this fun!',
        'toast.online': 'Internet connection restored',
        'toast.cleared': 'All data cleared!',
        'toast.no_auth': 'Firebase Auth not available',
        'toast.logged_in': 'Logged in!',
        'toast.login_fail': 'Login failed',
        'toast.logged_out': 'Logged out',
        'toast.login_required': 'Sign in with Google first to use family sync',
        'toast.name_required': 'Enter your name first',
        'toast.family_fail': 'Failed to create family. Try again.',
        'toast.family_created': (code) => `Family created! Code: ${code}`,
        'toast.family_net_fail': 'Failed to create family. Check your internet connection.',
        'toast.code_required': 'Enter the family code',
        'toast.family_not_found': 'Family not found. Check the code.',
        'toast.family_joined': (code) => `You joined family ${code}!`,
        'toast.family_join_fail': 'Failed to join family.',
        'toast.family_left': 'You have left the family',
        'toast.code_copied': 'Code copied!',
        'toast.no_code': 'No family code found',
        'toast.notes_saved': 'Notes saved',
        'toast.hidden': 'House hidden',
        'toast.restored': 'House restored',
        'toast.added': (n) => `${n} new listings added`,
        'toast.updated': 'Listings updated',
        'toast.no_new': 'No new listings found',
        'toast.refresh_fail': 'Refresh failed',
        'bid.title': 'Notes & Bid',
        'bid.viewing': 'Viewing',
        'bid.bid': 'Bid',
        'detail.prev_photo': 'Previous photo',
        'detail.next_photo': 'Next photo',
        'detail.fullscreen': 'Full screen',
        'detail.zoom': 'Enlarge photo',
        'detail.photo': 'Photo',
        'celebration.title': 'FAMILY MATCH!',
        'celebration.subtitle': 'You liked the same house!',
        'match.liked_by': 'This house was liked by:',
    },
};

