// Amsterdam Houses Data
// Since Funda doesn't have a public API, we use realistic mock data
// Images from Unsplash (free to use)

const AMSTERDAM_HOUSES = [
    {
        id: 1,
        price: 595000,
        address: "Prinsengracht 263",
        neighborhood: "Jordaan",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 85,
        yearBuilt: 1685,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
            "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80"
        ],
        description: "Prachtig monumentaal grachtenpand in het hart van de Jordaan. Dit karakteristieke appartement biedt een unieke combinatie van historische charme en modern comfort. Gelegen aan één van de mooiste grachten van Amsterdam.",
        features: ["Monumentaal pand", "Grachtenview", "Originele details", "Vloerverwarming"],
        isNew: true,
        isHot: false,
        daysOnMarket: 3
    },
    {
        id: 2,
        price: 425000,
        address: "Van Woustraat 154",
        neighborhood: "De Pijp",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 72,
        yearBuilt: 1920,
        energyLabel: "D",
        image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80",
            "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80"
        ],
        description: "Sfeervolle bovenwoning in het bruisende De Pijp. Op loopafstand van de Albert Cuypmarkt en Sarphatipark. Perfect voor starters of als investering.",
        features: ["Dakterras", "Gerenoveerde keuken", "Houten vloeren", "Berging"],
        isNew: false,
        isHot: true,
        daysOnMarket: 7
    },
    {
        id: 3,
        price: 875000,
        address: "Oostelijke Handelskade 45",
        neighborhood: "Oost",
        city: "Amsterdam",
        bedrooms: 3,
        bathrooms: 2,
        size: 120,
        yearBuilt: 2015,
        energyLabel: "A",
        image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
            "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80"
        ],
        description: "Luxe nieuwbouw appartement met spectaculair uitzicht over het IJ. Modern ontwerp met hoogwaardige afwerking. Inclusief parkeerplaats en berging.",
        features: ["Panorama uitzicht", "Parkeerplaats", "Lift", "Balkon", "Smart home"],
        isNew: true,
        isHot: true,
        daysOnMarket: 1
    },
    {
        id: 4,
        price: 349000,
        address: "NDSM-Plein 28",
        neighborhood: "Noord",
        city: "Amsterdam",
        bedrooms: 1,
        bathrooms: 1,
        size: 55,
        yearBuilt: 2018,
        energyLabel: "A+",
        image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80",
            "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&q=80"
        ],
        description: "Hip loft appartement op de trendy NDSM-werf. Industrieel karakter met hoge plafonds en grote ramen. Perfecte uitvalsbasis voor de moderne stadsmens.",
        features: ["Industrieel", "Hoge plafonds", "Open keuken", "Gemeenschappelijke tuin"],
        isNew: false,
        isHot: false,
        daysOnMarket: 21
    },
    {
        id: 5,
        price: 1250000,
        address: "Apollolaan 87",
        neighborhood: "Zuid",
        city: "Amsterdam",
        bedrooms: 4,
        bathrooms: 2,
        size: 175,
        yearBuilt: 1935,
        energyLabel: "B",
        image: "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800&q=80",
            "https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=800&q=80"
        ],
        description: "Statig herenhuis in het prestigieuze Apollobuurt. Royale kamers met authentieke details. Eigen tuin en garage. Een zeldzame kans in deze gewilde buurt.",
        features: ["Tuin", "Garage", "Originele details", "Open haard", "Kelder"],
        isNew: false,
        isHot: true,
        daysOnMarket: 5
    },
    {
        id: 6,
        price: 475000,
        address: "Kinkerstraat 212",
        neighborhood: "Oud-West",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 78,
        yearBuilt: 1905,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80",
            "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=80"
        ],
        description: "Charmant appartement in het levendige Oud-West. Recent gerenoveerd met behoud van authentieke elementen. Op steenworp afstand van de Foodhallen.",
        features: ["Gerenoveerd", "Hoge plafonds", "Balkon", "Moderne badkamer"],
        isNew: true,
        isHot: false,
        daysOnMarket: 4
    },
    {
        id: 7,
        price: 525000,
        address: "IJburglaan 536",
        neighborhood: "IJburg",
        city: "Amsterdam",
        bedrooms: 3,
        bathrooms: 1,
        size: 95,
        yearBuilt: 2010,
        energyLabel: "A",
        image: "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80",
            "https://images.unsplash.com/photo-1600566753151-384129cf4e3e?w=800&q=80"
        ],
        description: "Ruim eengezinswoning op het unieke IJburg. Kindvriendelijke buurt met veel groen en water. Ideaal voor jonge gezinnen die ruimte zoeken.",
        features: ["Tuin", "3 Verdiepingen", "Parkeren eigen terrein", "Nabij strand"],
        isNew: false,
        isHot: false,
        daysOnMarket: 14
    },
    {
        id: 8,
        price: 699000,
        address: "Herengracht 401",
        neighborhood: "Centrum",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 90,
        yearBuilt: 1670,
        energyLabel: "D",
        image: "https://images.unsplash.com/photo-1600573472591-ee6c563f8db2?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600573472591-ee6c563f8db2?w=800&q=80",
            "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?w=800&q=80"
        ],
        description: "Authentiek grachtenpand op de Gouden Bocht. UNESCO Werelderfgoed locatie. Originele marmeren schouw en plafondschilderingen. Een stukje Amsterdamse geschiedenis.",
        features: ["Monumentaal", "Gouden Bocht", "Originele details", "Kelder"],
        isNew: false,
        isHot: true,
        daysOnMarket: 2
    },
    {
        id: 9,
        price: 389000,
        address: "Spaarndammerstraat 78",
        neighborhood: "West",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 65,
        yearBuilt: 1918,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1600585154363-67eb9e2e2099?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600585154363-67eb9e2e2099?w=800&q=80",
            "https://images.unsplash.com/photo-1600566752355-35792bedcfea?w=800&q=80"
        ],
        description: "Knus appartement in de hippe Spaarndammerbuurt. Amsterdamse School architectuur. Op loopafstand van het Westerpark en de Houthavens.",
        features: ["Amsterdamse School", "Nabij Westerpark", "Rustige straat", "Berging"],
        isNew: true,
        isHot: false,
        daysOnMarket: 6
    },
    {
        id: 10,
        price: 745000,
        address: "Museumplein 12",
        neighborhood: "Zuid",
        city: "Amsterdam",
        bedrooms: 3,
        bathrooms: 2,
        size: 110,
        yearBuilt: 1895,
        energyLabel: "B",
        image: "https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=800&q=80",
            "https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?w=800&q=80"
        ],
        description: "Exclusief appartement met uitzicht op het Museumplein. Volledig gerenoveerd met luxe afwerking. Direct bij het Rijksmuseum en Van Gogh Museum.",
        features: ["Uitzicht Museumplein", "Volledig gerenoveerd", "Lift", "Luxe afwerking"],
        isNew: false,
        isHot: true,
        daysOnMarket: 3
    },
    {
        id: 11,
        price: 298000,
        address: "Molukkenstraat 45",
        neighborhood: "Oost",
        city: "Amsterdam",
        bedrooms: 1,
        bathrooms: 1,
        size: 48,
        yearBuilt: 1930,
        energyLabel: "D",
        image: "https://images.unsplash.com/photo-1600585153490-76fb20a32601?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600585153490-76fb20a32601?w=800&q=80",
            "https://images.unsplash.com/photo-1600210491369-e753d80a41f3?w=800&q=80"
        ],
        description: "Compact maar slim ingedeeld appartement in de Indische Buurt. Perfect als starterswoning. Vlakbij het Oosterpark en de Dappermarkt.",
        features: ["Starterswoning", "Nabij Dappermarkt", "Opknappertje", "Veel potentie"],
        isNew: false,
        isHot: false,
        daysOnMarket: 28
    },
    {
        id: 12,
        price: 1850000,
        address: "Keizersgracht 672",
        neighborhood: "Centrum",
        city: "Amsterdam",
        bedrooms: 5,
        bathrooms: 3,
        size: 280,
        yearBuilt: 1680,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1600047509358-9dc75507daeb?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600047509358-9dc75507daeb?w=800&q=80",
            "https://images.unsplash.com/photo-1600566752734-2a0cd66c42ae?w=800&q=80"
        ],
        description: "Majestueus grachtenpand over drie verdiepingen. Originele trap, schouw en plafondschilderingen. Eigen tuin aan het water. Een waar Amsterdams paleis.",
        features: ["Eigen ingang", "Tuin aan water", "Monumentaal", "Parkeren vergunning", "Kelder"],
        isNew: true,
        isHot: true,
        daysOnMarket: 1
    },
    {
        id: 13,
        price: 455000,
        address: "Eerste Oosterparkstraat 88",
        neighborhood: "Oost",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 75,
        yearBuilt: 1910,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1600573472556-e636c2acda88?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600573472556-e636c2acda88?w=800&q=80",
            "https://images.unsplash.com/photo-1600566753104-685f4f24cb4d?w=800&q=80"
        ],
        description: "Karaktervol bovenhuis aan het Oosterpark. Lichte woonkamer met erker. Recent gerenoveerde keuken en badkamer. Ideale locatie voor parkliefhebbers.",
        features: ["Aan park", "Erker", "Nieuwe keuken", "Hoge plafonds"],
        isNew: false,
        isHot: false,
        daysOnMarket: 12
    },
    {
        id: 14,
        price: 575000,
        address: "Westerstraat 187",
        neighborhood: "Jordaan",
        city: "Amsterdam",
        bedrooms: 2,
        bathrooms: 1,
        size: 82,
        yearBuilt: 1890,
        energyLabel: "C",
        image: "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?w=800&q=80",
            "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800&q=80"
        ],
        description: "Typisch Jordanese bovenwoning met veel sfeer. Op de populaire Westerstraat met markt. Authentieke details gecombineerd met moderne gemakken.",
        features: ["Jordaan sfeer", "Aan markt", "Authentiek", "Moderne keuken"],
        isNew: false,
        isHot: false,
        daysOnMarket: 8
    },
    {
        id: 15,
        price: 625000,
        address: "Amsteldijk 156",
        neighborhood: "De Pijp",
        city: "Amsterdam",
        bedrooms: 3,
        bathrooms: 1,
        size: 98,
        yearBuilt: 1925,
        energyLabel: "B",
        image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&q=80",
        images: [
            "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&q=80",
            "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80"
        ],
        description: "Ruim familiehuis aan de Amstel. Uitzicht over de rivier. Eigen aanlegsteiger voor boot. Nabij Amstelpark en de trendy horeca van De Pijp.",
        features: ["Aan Amstel", "Aanlegsteiger", "Uitzicht op water", "Grote woonkamer"],
        isNew: true,
        isHot: true,
        daysOnMarket: 2
    }
];

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
    "IJburg": "🏖️ Strand in de stad - moderne architectuur op het water!"
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
    return PRICE_LABELS.find(p => price <= p.max);
}

// Helper function to format price
function formatPrice(price) {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: 'EUR',
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

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AMSTERDAM_HOUSES, NEIGHBORHOOD_FACTS, PRICE_LABELS, getPriceLabel, formatPrice, shuffleArray };
}
