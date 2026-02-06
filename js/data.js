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
    '<text x="400" y="330" text-anchor="middle" font-family="sans-serif" font-size="40" fill="%23ccc">🏠</text>' +
    '</svg>'
)}`;

// Fun facts about Amsterdam neighborhoods
const NEIGHBORHOOD_FACTS = {
    "Centrum": "🏛️ Het historische hart van Amsterdam met de beroemde grachten!",
    "Jordaan": "🎨 Ooit een arbeiderswijk, nu dé plek voor kunstenaars en gezellige cafés!",
    "De Pijp": "🥬 Thuisbasis van de Albert Cuypmarkt - de grootste markt van Europa!",
    "Oost": "🌳 Hip en groen met het prachtige Oosterpark als middelpunt!",
    "West": "🎪 Van industrieel naar trendy - de Houthavens zijn helemaal hot!",
    "Noord": "🚀 De nieuwe creative hub van Amsterdam - edgy en upcoming!",
    "Zuid": "🏆 Chic en verfijnd - hier wonen de echte Amsterdammers!",
    "Oud-West": "🍔 Foodhallen, boutiques en de gezelligste pleintjes!",
    "IJburg": "🏖️ Strand in de stad - moderne architectuur op het water!",
    "Amsterdam": ""
};

// Price range labels for fun
const PRICE_LABELS = [
    { max: 350000, label: "🎓 Startersvriendelijk", color: "#2ECC71" },
    { max: 500000, label: "💼 Middenklasse", color: "#3498DB" },
    { max: 750000, label: "🏡 Comfortabel", color: "#9B59B6" },
    { max: 1000000, label: "✨ Premium", color: "#E67E22" },
    { max: Infinity, label: "👑 Luxe", color: "#E74C3C" }
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

// Helper function to shuffle array
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

