# Wizard QA — visite guidée (autodémo encadrée)

Transposition web de l'autopilote PRISME. Les pages ne savent rien de la visite : elle navigue par l'URL de
l'étape, clique au besoin un onglet ou un bouton, puis trouve la cible par sélecteur CSS ou par texte.

| Fichier | Rôle |
|---|---|
| `server/assets/prisme/prisme-tour.js` | moteur (`Prisme.tour`) : voile, halo, étiquette, barre, horloge, clavier |
| `server/assets/prisme/prisme.css` (section « visite guidée », préfixe `.p-tour-`) | styles |
| `server/assets/prisme/prisme-shell.js` | bouton d'en-tête, entrée de palette, `?visite=`, reprise à chaque page |
| `server/conf/demo/visite.json` | script de la visite (25 étapes, ≈ 7 min à ×1) |
| `server/lib/demo/tour-routes.mjs` | `GET /api/demo/visite` |

La visite est faite pour les données de démonstration : chargez-les d'abord (voir `DEMO.md`). Sans elles, elle
fonctionne quand même, mais certaines étapes retombent sur leur cible de repli.

## Comportement

- **Départ** : bouton « ▶ Visite guidée » de l'en-tête, palette Ctrl K « Visite guidée (autodémo) », ou une URL
  `?visite=1` sur n'importe quelle page. `?visite=<id>` part de l'étape `<id>` (ex. `/?visite=livrables-documents`).
  Le paramètre est retiré de l'adresse une fois lu.
- **Visite** : l'application passe seule de page en page ; l'élément à regarder est entouré d'un halo qui respire,
  le reste de l'écran est voilé (découpe du voile), une étiquette numérotée (titre + une phrase) suit la cible
  et reste toujours dans l'écran.
- **Étape** : navigation vers `page` si besoin → actions facultatives (clic d'un onglet, d'un bouton, ouverture d'une
  fenêtre) → attente de la cible, 6 s au plus. Introuvable : l'étiquette s'affiche en haut de l'écran, sans halo
  (la console signale `[visite] cible absente`). L'horloge de l'étape ne démarre qu'une fois la cible trouvée.
  Une fenêtre ouverte par une action est refermée en quittant l'étape.
- **Barre du bas** : ◇ Démonstration, ⏮ ⏯ ⏭, étapes (largeur selon la durée, clic = saut), étape courante,
  temps écoulé / total / restant, vitesse ×0,5 ×1 ×2, **■ Arrêter l'autodémo** (toujours visible pendant la visite).
- **Main rendue** : « Arrêter l'autodémo » (ou Échap) coupe la navigation et la surbrillance ; la barre reste,
  on navigue librement. « ▶ Reprendre la visite » revient sur la page de l'étape et repart où elle en était ;
  un clic sur une étape de la barre y reprend directement ; ✕ quitte la démonstration.
- **Fin** : « Visite terminée », « ↺ Rejouer » repart de l'étape 1.
- **Clavier** pendant la visite : Espace = pause / lecture, Page suiv. / Page préc. = étape suivante / précédente
  (télécommandes de présentation), Échap = arrêter l'autodémo (sauf si une fenêtre est ouverte : elle se ferme).
  Espace garde son sens dans un champ de saisie ou sur un bouton de la page.
- **Clic de souris dans l'écran** : met la visite en pause (le clic agit normalement). Si l'on change de page
  pendant la pause, la barre suit ; ⏯ ramène sur l'écran de l'étape.
- **Mouvement réduit** (réglage du poste) : pas de respiration du halo ni de glissement.
- **Écran étroit** (< 700 px) : barre compacte sur deux lignes (commandes + arrêt, puis étapes).

### Plusieurs pages

L'état — étape, temps dans l'étape, vitesse, pause, arrêt, action déjà jouée — vit dans `sessionStorage`
(clé `p-tour`, script en cache sous `p-tour-script`) : il est propre à l'onglet. À chaque chargement, la coquille
voit la visite en cours, charge `prisme-tour.js` et la reprend. Un nouveau départ relit le script sur le serveur.

## Script de visite (JSON)

Lu dans cet ordre : `WIZARD_DEMO_VISITE=<fichier>`, sinon `server/conf/demo/visite.json`. Un fichier fautif est
écarté (journal `[visite]` du serveur) et le script embarqué est utilisé.

```json
{
  "titre": "Visite Wizard QA",
  "etapes": [
    {"id": "xray", "page": "/automatisation.html?key=P0326-9301",
     "action": [{"clic": "Envoyer dans JIRA"}, {"clic": "Envoyer dans JIRA / Xray", "attente": 1200}],
     "cible": ".p-modal:has(.xp-root), .xp-root", "secondes": 20,
     "titre": "Envoi vers Xray", "texte": "Un ticket Test relié au récit et au plan de test, aperçu avant tout envoi."}
  ]
}
```

| Champ | Sens |
|---|---|
| `id` | identifiant stable de l'étape (sert à `?visite=<id>`) |
| `page` | URL de la page (`/recits.html`, `/automatisation.html?key=P0326-9301`, `/connaissance.html#scan`). Sans paramètre, toute URL de même chemin convient (on reste sur `?key=…`) ; avec paramètres, ils doivent correspondre ; une ancre seule est posée sans recharger |
| `action` | facultatif : `{ "clic": "…" }` ou une liste, jouée une fois à l'entrée de l'étape. `clic` = sélecteur CSS, sinon texte d'un bouton, lien, onglet, étape de stepper ou ligne cliquable (le plus intérieur, dans l'ordre de lecture) ; `attente` = ms après le clic (450 par défaut) |
| `cible` | sélecteur CSS du nœud à entourer ; `".a, .b"` = repli dans l'ordre (les virgules dans `:has(…)` ou `[…]` restent) ; absent = étiquette en haut de l'écran |
| `texteCible` | texte que la cible doit contenir (sans casse) ; le candidat le plus intérieur est gardé. Sans `cible`, cherché parmi titres, cartes, indicateurs, boutons et liens |
| `rang` | rang du candidat visible, dans l'ordre de lecture (0 = premier) |
| `voile` | `false` pour ne pas voiler le reste de l'écran |
| `secondes` | durée de l'étape à ×1 (2 à 300, 12 par défaut) |
| `titre`, `texte` | étiquette : titre ≤ 24 caractères, une phrase sobre ≤ 90 caractères |

Les clés anglaises (`steps`, `screen`, `target`, `match`, `index`, `dim`, `seconds`, `title`, `text`, `click`, `wait`)
sont acceptées.

## Éditer la visite

1. Modifier `server/conf/demo/visite.json` (ou pointer `WIZARD_DEMO_VISITE` vers une copie) ; pas de redémarrage :
   le script est relu à chaque départ.
2. Choisir des cibles stables : classes de composant (`.p-kpis`, `.lv-doclist`, `.rc-tabs`…), attribut
   `data-tour="…"` ajouté dans la page si rien de stable n'existe, et toujours un repli large en dernier
   (`.p-stepper`, `.p-kpis`…).
3. Tester une étape seule : `/?visite=<id>` ; ⏭ / Page suiv. pour enchaîner. Dans la console du navigateur,
   `Prisme.tour.state()` donne l'étape, le temps et `target` (cible trouvée ou non) ; `document.documentElement.dataset.tourFound`
   vaut `1` / `0` pour l'étape affichée.
4. Garder la visite autour de 6 à 8 minutes à ×1 ; ×2 la ramène à 3 ou 4 minutes.

## Parcours actuel (25 étapes, 7 min 02 à ×1)

Pilotage (accueil, indicateurs, parcours QA) → Prise de connaissance (URL JIRA, synthèse du scan, points à clarifier)
→ Récits (tri, suggestions motivées) → Gherkin → Automatisation (plan IA, exploration, Prenez la main, test généré,
rejeu) → envoi Xray (fenêtre d'aperçu, simulé en démo) → Livrables (campagne, documents ISTQB, relire et approuver,
export Word) → Performance k6 (indicateurs, runs) → Installation → Assistant IA (Copilot local) → Réglages → fin.
