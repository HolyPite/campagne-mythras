# Campagne Mythras — Fiche Personnage

## Contexte

Application web mobile de fiche de personnage pour le jeu de rôle **Mythras** (système BRP/d100). Multi-personnages, partageable avec les autres joueurs. Hébergée sur GitHub Pages.

## Fichiers principaux

| Fichier | Rôle |
|---------|------|
| `index.html` | Structure HTML — charge `styles.css` et `app.js` |
| `styles.css` | Tout le CSS + animations de transition d'onglets |
| `app.js` | Toute la logique JS (état, rendu, IndexedDB, swipe, export…) |
| `manifest.json` | Manifest PWA — installable sur écran d'accueil mobile |
| `sw.js` | Service Worker — cache offline + bannière de mise à jour |
| `icon-192.png` / `icon-512.png` | Icônes PWA |
| `nyxa-app.html` | Ancien fichier (conservé, ne plus modifier) |

**Travailler sur `index.html`, `styles.css` et `app.js` selon le besoin.**

## Fonctionnalités

- Multi-personnages (créer, dupliquer, supprimer, importer/exporter)
- Mode édition (toutes les données modifiables inline)
- Swipe gauche/droite pour naviguer entre onglets
- PWA installable avec cache offline
- Export JSON (re-importable) et texte lisible

## Onglets

| Onglet | Contenu |
|--------|---------|
| 👤 Perso | Stats, attributs dérivés, identité, argent, background, capacités |
| 🎯 Skills | Résistances, compétences standard/pro, passions |
| ⚡ Magie | Points de magie, compétences magiques, sorts Folk Magic + Sorcellerie |
| ⚔️ Combat | Fatigue, points de vie par localisation, styles de combat, armes, équipement |
| 🎲 Dés | Lanceur de dés (d4–d100) avec animation et historique |
| 📖 Journal | Pages libres avec dessin, archivables + export fiche |

## Architecture JS

### Storage (`localStorage`)
```
mythras_charlist          → liste des personnages [{id, name, subtitle}]
mythras_active_char       → id du personnage actif
mythras_char_<id>         → état JSON complet d'un personnage
```

Migration auto depuis anciens formats (`nyxa_charlist`, `nyxa_v1`).

### État par personnage (`S`)
```js
{
  charName, charSubtitle,
  stats: { STR, CON, SIZ, DEX, INT, POW, CHA },
  derivedAttrs: [{name, value}],
  identity: [{key, val}],
  money: { po, pa, rc },          // cascade: 100rc=1pa, 100pa=1po
  abilities: [], abilitiesDesc,
  passions: [{name, pct}],
  stdSkills, profSkills, magicSkills: [{name, formula, trained?}],
  combatStyles: [{name, formula, trait, weapons}],
  folkSpells, sorcSpells: [{name, cost, desc, notes}],
  sorcSchoolQuote,
  weapons: [{name, dmg, size, range, apHP, effects}],
  equipment: [{name, enc}],
  enc: { current, encumbered, overloaded },
  lp: { current, max },
  mp: { current, max },
  fatigue: string,
  hitLocations: [{name, range, maxHP, currentHP}],
  skillMods: { [skillName]: number },   // modificateurs par compétence
  skillSuccesses: { [skillName]: number },
  pages: [{id, title, content, drawing, date, archived}],  // Journal
  bgNotes: string,
}
```

### Logique compétences
```
total% = calcBase(formula) + skillMods[name]
```
`calcBase` évalue la formule avec les stats (`INT+POW`, `CONx2`, etc.)

### Fonctions clés

| Fonction | Rôle |
|----------|------|
| `renderAll()` | Re-render tous les composants |
| `save()` | Sauvegarde S en localStorage (avec try/catch quota) |
| `calcBase(formula)` | Calcule la base d'une compétence depuis les stats |
| `migrateState(S)` | Remplit les champs manquants depuis D (défaut) |
| `loadStateForChar(id)` | Charge + migre un personnage depuis localStorage |
| `adjMod(name, delta)` | Ajuste le modificateur d'une compétence |
| `applyMoney(po, pa, rc)` | Ajoute/retire de l'argent avec cascade |
| `renderJournal()` | Render les pages du journal |
| `initCanvas(pageId, drawing)` | Initialise le canvas de dessin d'une page |
| `switchChar(id)` | Bascule sur un autre personnage |
| `exportJSON()` / `exportText()` | Export fiche |

## Règles de modification

- HTML → `index.html`, CSS → `styles.css`, JS → `app.js`
- `sw.js` : incrémenter `CACHE = 'mythras-vX'` à chaque déploiement pour invalider le cache
- Personnage vierge par défaut (D) — stats à 10, listes vides, pas de données spécifiques

## Architecture — nouveautés v3

### Dessins du Journal (IndexedDB)
Les `page.drawing` (data URL base64) sont stockés dans IndexedDB (`mythras_db`, store `drawings`), plus dans localStorage. La clé est `charId|pageId`. `page.hasDrawing: true` indique la présence d'un dessin. Migration automatique au démarrage via `migratePendingDrawings()`.

### Rendu partiel
`renderTab(tab)` ne re-rend que l'onglet actif. `renderAll()` = `renderHeader()` + `renderTab(currentTab)`.

### Transitions d'onglets
`showTab(tab, direction)` ajoute la classe CSS `slide-left` ou `slide-right` sur l'onglet entrant. Les keyframes sont dans `styles.css`.

### Protection swipe
Le swipe gauche/droite est bloqué si le touchstart démarre sur `input, textarea, select, canvas, .drag-handle, .draw-canvas, .canvas-wrap, [data-noswipe]`.
