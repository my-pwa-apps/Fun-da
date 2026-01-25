# Fun-da 🏠

**Bring the fun back to huizenjacht!**

Fun-da is een Progressive Web App (PWA) die het zoeken naar een huis in Amsterdam weer leuk maakt. Met een Tinder-style swipe interface kun je snel door beschikbare woningen bladeren.

## ✨ Features

- 🏠 **Swipe Interface** - Swipe naar rechts om te liken, naar links om door te gaan
- ❤️ **Favorieten** - Sla je favoriete woningen op
- 🔍 **Filters** - Filter op prijs, slaapkamers en buurt
- 📱 **PWA** - Installeerbaar op je telefoon, werkt offline
- 🎉 **Confetti** - Want huizenjacht mag leuk zijn!
- ⌨️ **Keyboard shortcuts** - Gebruik pijltjestoetsen voor snel swipen
- 🌙 **Dark mode** - Automatische ondersteuning voor dark mode

## 🚀 Aan de slag

### Lokaal draaien

1. Clone de repository:
```bash
git clone https://github.com/yourusername/fun-da.git
cd fun-da
```

2. Start een lokale webserver. Bijvoorbeeld met Python:
```bash
# Python 3
python -m http.server 8000

# Of met Node.js
npx serve
```

3. Open http://localhost:8000 in je browser

### Installeren als PWA

1. Open de app in Chrome, Edge of Safari
2. Klik op "Installeren" of "Toevoegen aan beginscherm"
3. Geniet van de native app-ervaring!

## 🎮 Bediening

| Actie | Muis/Touch | Toetsenbord |
|-------|------------|-------------|
| Nee/Overslaan | Swipe links / ✕ knop | ← |
| Ja/Favoriet | Swipe rechts / ❤️ knop | → |
| Details bekijken | Dubbel-klik / ℹ️ knop | ↑ of Spatie |
| Modal sluiten | Klik buiten modal | Escape |

## 🏗️ Technologie

- **Vanilla JavaScript** - Geen frameworks nodig!
- **CSS3** - Moderne styling met CSS Variables
- **Service Worker** - Voor offline functionaliteit
- **LocalStorage** - Voor het opslaan van favorieten
- **Web Manifest** - Voor PWA installatie

## 📁 Projectstructuur

```
fun-da/
├── index.html          # Hoofd HTML bestand
├── manifest.json       # PWA manifest
├── sw.js              # Service Worker
├── css/
│   └── styles.css     # Alle styling
├── js/
│   ├── app.js         # Applicatie logica
│   └── data.js        # Huizen data
└── icons/
    └── icon-*.png     # PWA iconen
```

## 🏠 Over de data

Aangezien Funda geen publieke API heeft, gebruiken we realistische mockdata van Amsterdamse woningen. De data bevat:

- Adressen in verschillende buurten (Jordaan, De Pijp, Oost, etc.)
- Realistische prijzen voor de Amsterdamse markt
- Kenmerken zoals oppervlakte, slaapkamers, bouwjaar
- Leuke neighborhood facts

## 🎨 Aanpassen

### Kleuren wijzigen
Pas de CSS variables aan in `css/styles.css`:

```css
:root {
    --primary: #FF6B35;      /* Hoofdkleur */
    --secondary: #4ECDC4;    /* Accent kleur */
    --success: #2ECC71;      /* Like/succes */
    --danger: #E74C3C;       /* Nope/verwijderen */
}
```

### Huizen toevoegen
Voeg nieuwe objecten toe aan de `AMSTERDAM_HOUSES` array in `js/data.js`.

## 📄 Licentie

MIT License - Voel je vrij om dit project te gebruiken en aan te passen!

## 🙏 Credits

- Foto's via [Unsplash](https://unsplash.com)
- Font: [Poppins](https://fonts.google.com/specimen/Poppins) van Google Fonts
- Inspiratie: Funda.nl (maar dan leuker! 😉)

---

Made with ❤️ in Amsterdam
