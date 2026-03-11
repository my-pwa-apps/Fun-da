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
    },
};

