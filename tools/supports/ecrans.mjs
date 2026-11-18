// Écrans à capturer : URL, actions préalables, repères (cible = sélecteur CSS ou { sel, texte, rang }).
// Les titres et phrases reprennent le vocabulaire de la visite guidée (server/conf/demo/visite.json).
export const ECRANS = [
  {
    n: '01', id: 'pilotage', url: '/', titre: 'Pilotage', sousTitre: 'Où en est la campagne de test, en un coup d’œil.',
    reperes: [
      { cible: '.p-strip', titre: 'Bandeau d’état', texte: 'Poste, récits, points à clarifier, Gherkin, k6 et IA : l’état du projet en une ligne.' },
      { cible: '.p-kpis', titre: 'Indicateurs clés', texte: 'Poste de test, récits scannés, points à clarifier et couverture Gherkin.' },
      { cible: '.home-journey', titre: 'Parcours QA', texte: 'Du poste installé aux tests reliés à Xray : chaque étape et son état.' },
      { cible: { sel: 'section.p-card', texte: 'À traiter' }, titre: 'À traiter', texte: 'Les actions prioritaires, chacune avec son bouton pour agir.' },
      { cible: { sel: 'section.p-card', texte: 'Couverture des récits par épopée' }, titre: 'Couverture par épopée', texte: 'Part des récits dont les scénarios Gherkin sont validés.' },
      { cible: '.p-tour-launch', titre: 'Visite guidée', texte: 'Lance l’autodémo : l’application passe seule d’écran en écran.' }
    ]
  },
  {
    n: '02', id: 'prise-de-connaissance', url: '/connaissance.html#synthese', titre: 'Prise de connaissance', sousTitre: 'Comprendre ce qu’il faut tester avant d’écrire le moindre test.',
    reperes: [
      { cible: '.kn-stepper-card', titre: 'Projet, JIRA, scan', texte: 'Une URL JIRA suffit : instance et projet sont déduits, puis les récits scannés.' },
      { cible: '.p-kpis', titre: 'Synthèse du scan', texte: 'Récits, critères d’acceptation extraits, points à clarifier et épopées.' },
      { cible: { sel: 'section.p-card', texte: 'Critères d’acceptation' }, titre: 'Critères d’acceptation', texte: 'D’où viennent les critères : champ dédié, section de la description ou absents.' },
      { cible: { sel: 'section.p-card', texte: 'Répartition par statut' }, titre: 'Statuts JIRA', texte: 'Où en sont les récits dans le flux de l’équipe.' },
      { cible: { sel: 'section.p-card', texte: 'Par récit' }, titre: 'Par épopée', texte: 'Récits, critères et questions à clarifier, épopée par épopée.' }
    ]
  },
  {
    n: '03', id: 'recits-tri', url: '/recits.html?key=P0326-9302',
    actions: [{ defiler: '.p-kpis', haut: 96 }],
    titre: 'Récits et tri', sousTitre: 'Chaque récit reçoit une décision de test.',
    reperes: [
      { cible: '.p-kpis', titre: 'Indicateurs', texte: 'Récits, à automatiser, couverture Gherkin, brouillons à relire, validés.' },
      { cible: '.rc-tabs', titre: 'Tri des récits', texte: 'À automatiser, plus tard ou ignoré : chaque récit reçoit une décision.' },
      { cible: '.rc-bulk', titre: 'Actions par lot', texte: 'Trier plusieurs récits d’un coup, appliquer les suggestions ou classer avec l’IA.' },
      { cible: '.rc-list-card', titre: 'Liste par épopée', texte: 'Décision et état Gherkin de chaque récit.' },
      { cible: '.rc-decision-card', titre: 'Suggestions motivées', texte: 'L’assistant propose un tri et explique pourquoi ; vous gardez la décision.' }
    ]
  },
  {
    n: '04', id: 'gherkin', url: '/recits.html?key=P0326-9301',
    actions: [{ defiler: '.rc-editor-card', haut: 70 }],
    titre: 'Scénarios Gherkin', sousTitre: 'Générés depuis les critères d’acceptation, relus puis validés par le testeur.',
    reperes: [
      { cible: '.rc-editor-card .p-card-head', titre: 'État du scénario', texte: 'Validé, brouillon ou à générer ; source (IA ou modèle intégré) et fournisseur IA actif.' },
      { cible: '.rc-editor-bar .p-row', titre: 'Générer', texte: 'Par l’assistant IA (Copilot local d’abord) ou par le modèle intégré, sans IA.' },
      { cible: '.rc-editor-bar .p-seg', titre: 'Affichage', texte: 'Édition, côte à côte ou aperçu coloré.' },
      { cible: 'textarea.rc-source', titre: 'Éditeur', texte: 'Le Gherkin reste modifiable par le testeur avant validation.' },
      { cible: 'pre.rc-preview', titre: 'Aperçu contrôlé', texte: 'Mots-clés français ou anglais reconnus, étiquettes et récit JIRA rappelés.' }
    ]
  },
  {
    n: '05', id: 'automatisation', url: '/automatisation.html?key=P0326-9301',
    actions: [{ clic: { sel: '.p-step', texte: 'Exploration' } }],
    titre: 'Automatisation', sousTitre: 'L’agent explore l’application et écrit le test Playwright.',
    reperes: [
      { cible: '.au-head', titre: 'Récit à automatiser', texte: 'Le récit, sa décision de tri et son Gherkin validé.' },
      { cible: '.au-wizard', titre: 'Étapes de la session', texte: 'Application, plan de test IA, exploration, test généré, envoi dans JIRA.' },
      { cible: '.au-progress', titre: 'Plan exploré', texte: 'L’IA déduit les étapes du Gherkin ; chacune est trouvée, passée ou confiée au testeur.' },
      { cible: '.au-shot', titre: 'Navigateur en direct', texte: 'L’agent ouvre l’application, trouve les sélecteurs et capture chaque écran.' }
    ]
  },
  {
    n: '06', id: 'prenez-la-main', url: '/automatisation.html?key=P0326-9310',
    actions: [{ clic: { sel: '.p-step', texte: 'Exploration' } }, { clic: { sel: '.au-foot button', texte: 'Prendre la main' }, attente: 1500 }],
    titre: 'Prenez la main', sousTitre: 'Si l’IA bloque, le testeur montre le geste : il est enregistré dans le test.',
    reperes: [
      { cible: '.au-tk-why', titre: 'Où l’IA bloque', texte: 'L’étape du plan que l’IA cherchait, après ses tentatives.' },
      { cible: { sel: 'button.au-tk-choice', rang: 0 }, titre: 'Fenêtre du navigateur', texte: 'Le testeur agit directement dans Edge ou Chrome, sur la page en cours.' },
      { cible: { sel: 'button.au-tk-choice', rang: 1 }, titre: 'Agir sur la capture', texte: 'Ou il clique et saisit sur la capture, sans quitter Wizard QA.' },
      { cible: '.au-log', titre: 'Journal', texte: 'Les gestes enregistrés deviennent des étapes du test, sélecteurs compris.' }
    ]
  },
  {
    n: '07', id: 'envoi-xray', url: '/automatisation.html?key=P0326-9301',
    actions: [{ clic: { sel: 'button', texte: 'Envoyer dans JIRA / Xray' }, attente: 1800 }],
    titre: 'Envoi vers Xray', sousTitre: 'Un ticket Test relié au récit et au plan de test, aperçu avant tout envoi.',
    reperes: [
      { cible: '.xp-story', titre: 'Récit', texte: 'Le récit couvert et la source du test (Playwright ou Gherkin).' },
      { cible: '.xp-banners', titre: 'Simulé en démo', texte: 'Sur les données de démonstration, rien n’est créé dans JIRA ; un renvoi met à jour sans doublon.' },
      { cible: '.xp-form', titre: 'Ticket Test et plan', texte: 'Résumé proposé, type Xray, plan de test facultatif.' },
      { cible: '.xp-preview', titre: 'Aperçu', texte: 'Ce qui sera créé ou mis à jour : ticket, lien « Test », plan, étiquettes.' },
      { cible: '.p-modal-foot', titre: 'Envoyer', texte: 'L’envoi n’a lieu qu’après cet aperçu.' }
    ]
  },
  {
    n: '08', id: 'livrables', url: '/livrables.html',
    titre: 'Livrables ISTQB', sousTitre: 'Onze documents ISO/IEC/IEEE 29119-3 tirés des faits collectés.',
    reperes: [
      { cible: '.lv-top .p-kpis', titre: 'Indicateurs', texte: 'Documents à jour, relus, approuvés ; couverture et dernière campagne.' },
      { cible: '.lv-doclist', titre: 'Documents ISTQB', texte: 'Politique, stratégie, plan, rapports : la structure ISO/IEC/IEEE 29119-3.' },
      { cible: '.lv-dochead-actions', titre: 'Relire et approuver', texte: 'Chaque document est généré, relu par l’agent puis approuvé par un humain.' },
      { cible: '.lv-doczone .p-tabs', titre: 'Onglets du document', texte: 'Aperçu, modification, relecture, sources, modèle et versions.' },
      { cible: '.lv-preview', titre: 'Aperçu', texte: 'Le document tel qu’il sera exporté, chiffres tirés des faits collectés.' }
    ]
  },
  {
    n: '09', id: 'livrable-document', url: '/livrables.html',
    actions: [{ clic: { sel: 'button.lv-docitem', texte: 'Plan de test' } }, { clic: { sel: '.lv-doczone .p-tab', texte: 'Relecture' } }],
    titre: 'Relecture d’un livrable', sousTitre: 'Plan de test relu par l’agent avant approbation humaine.',
    reperes: [
      { cible: '.lv-dochead-main', titre: 'Document', texte: 'Référence ISO 29119-3, phase, objet du document.' },
      { cible: '.lv-dochead-actions', titre: 'Relire et approuver', texte: 'Actualiser, relire, approuver ; export Word, HTML / PDF, Markdown.' },
      { cible: '.lv-tabbody', titre: 'Relecture par l’agent', texte: 'Sections manquantes, « À compléter », chiffres écartés des faits : verdict et score.' }
    ]
  },
  {
    n: '10', id: 'informations-projet', url: '/livrables.html',
    actions: [{ clic: { sel: 'button', texte: 'Informations projet' }, attente: 1200 }],
    titre: 'Informations projet', sousTitre: 'Ce que les données ne disent pas, demandé une fois pour tous les livrables.',
    reperes: [
      { cible: '.lv-wizard .p-stepper', titre: 'Six étapes', texte: 'Organisation, périmètre, risques produit, approche, environnements, critères.' },
      { cible: { sel: '.lv-wiz-step .p-field', rang: 0 }, titre: 'Organisation', texte: 'Organisme, équipe, produit et version : cartouche et rôles des documents.' },
      { cible: { sel: '.lv-wiz-step .p-field', texte: 'Contexte réglementaire' }, titre: 'Contexte réglementaire', texte: 'Obligations du produit, reprises dans la politique et la stratégie.' },
      { cible: { sel: '.lv-wiz-step .p-field', texte: 'Normes et référentiels' }, titre: 'Normes', texte: 'ISO/IEC/IEEE 29119, ISTQB et référentiels propres au produit.' }
    ]
  },
  {
    n: '11', id: 'campagne', url: '/livrables.html',
    actions: [{ clic: { sel: '.lv-camp-links button', texte: 'Résultats par test' }, attente: 1200 }],
    titre: 'Campagne d’exécution', sousTitre: 'Les résultats des campagnes nourrissent directement les livrables.',
    reperes: [
      { cible: '.p-modal-head', titre: 'Campagne', texte: 'Une exécution des tests Playwright du projet, réelle ou simulée en démo.' },
      { cible: '.p-modal table', titre: 'Résultats par test', texte: 'Chaque test avec son récit JIRA, son fichier et sa durée.' },
      { cible: { sel: '.p-modal tr', texte: 'Instable' }, titre: 'Instable', texte: 'Réussi après une nouvelle tentative : signalé, pas masqué.' },
      { cible: { sel: '.p-modal tr', texte: 'Échec' }, titre: 'Échec', texte: 'Le message d’erreur Playwright est gardé ; il alimente le rapport d’anomalies.' }
    ]
  },
  {
    n: '12', id: 'performance-k6', url: '/perf.html',
    actions: [{ clic: { sel: '.p-tab', texte: 'Runs' } }],
    titre: 'Performance k6', sousTitre: 'Profils de charge, runs et seuils : la performance suit les exigences des récits.',
    reperes: [
      { cible: '.p-kpis', titre: 'Indicateurs', texte: 'Profils, runs, taux de réussite, p95 du dernier run et son seuil.' },
      { cible: '.p-tabs', titre: 'Onglets', texte: 'Lancer, runs, comparer, exigences de performance tirées des récits.' },
      { cible: '.perf-panel table', titre: 'Historique des runs', texte: 'Temps de réponse p95, débit et erreurs de chaque run, comparables.' },
      { cible: { sel: '.perf-panel tr', texte: 'Seuils non respectés' }, titre: 'Seuil franchi', texte: 'p95 au-delà du seuil : le run est signalé, à comparer à la référence.' }
    ]
  },
  {
    n: '13', id: 'installation', url: '/installation.html', attente: 9000,
    actions: [{ script: "document.querySelectorAll('.p-banner').forEach(b => { if (/machine qui exécute/.test(b.textContent)) b.remove() })" }],
    titre: 'Installation du poste', sousTitre: 'Node, Playwright, k6 : tout le poste QA s’installe en une fois.',
    reperes: [
      { cible: '.p-kpis', titre: 'État du poste', texte: 'Composants requis en place, à installer, optionnels, dernière vérification.' },
      { cible: '.inst-stacks', titre: 'Stacks à installer', texte: 'Playwright, Gherkin, k6, assistant IA : on coche, seuls les composants manquants s’installent.' },
      { cible: { sel: 'section.p-card', texte: 'Installation du' }, titre: 'Suivi en direct', texte: 'Chaque composant est détecté, installé puis vérifié ; journal et console.' },
      { cible: { sel: 'button', texte: 'Installer tout' }, titre: 'Installer tout', texte: 'Une installation en une fois ; la simulation est ouverte à tous.' }
    ]
  },
  {
    n: '14', id: 'assistant-ia', url: '/ia.html',
    actions: [{ clic: { sel: 'button, a, .p-tab', texte: 'Brancher Copilot local' } }],
    titre: 'Assistant IA', sousTitre: 'Copilot local d’abord, sans clé exposée.',
    reperes: [
      { cible: '.p-kpis', titre: 'État de l’IA', texte: 'Fournisseur actif, fournisseurs prêts, pont Copilot local, appels ; sans IA, mode copier-coller.' },
      { cible: '.p-tabs', titre: 'Onglets', texte: 'Fournisseurs (ordre d’essai), Copilot local, Copilot CLI, bac à sable, journal.' },
      { cible: '.ia-panel .p-stepper', titre: 'Brancher Copilot local', texte: 'VS Code, Copilot Chat, extension Wizard QA, appairage par jeton, essai.' },
      { cible: '.ia-steps', titre: 'Procédure guidée', texte: 'Chaque étape expliquée ; la page se met à jour seule quand l’extension se connecte.' }
    ]
  },
  {
    n: '15', id: 'reglages-demonstration', url: '/reglages.html',
    actions: [{ clic: { sel: '.p-tab', texte: 'Démonstration' } }],
    titre: 'Réglages › Démonstration', sousTitre: 'Un jeu de données fictif et complet, chargé en un clic.',
    reperes: [
      { cible: '.p-tabs', titre: 'Réglages', texte: 'Compte, utilisateurs, configuration, démonstration, JIRA / Xray.' },
      { cible: '.rg-panel .p-card-head, .rg-panel > *:first-child', titre: 'Données de démonstration', texte: 'Projet fictif IRMA de la Banque Horizon : rien n’est envoyé vers JIRA, Xray ou k6.' },
      { cible: '.rg-form .p-kpis', titre: 'Contenu chargé', texte: 'Récits, tri, Gherkin, sessions, envois Xray, campagnes, anomalies, runs k6, livrables.' },
      { cible: '.rg-form *:has(> #demoLoad)', titre: 'Charger ou réinitialiser', texte: 'Recharger remplace le jeu ; réinitialiser n’efface que ce que la démo a créé.' }
    ]
  },
  {
    n: '16', id: 'visite-guidee', url: '/recits.html?visite=recits-suggestions', attente: 5000,
    titre: 'Visite guidée', sousTitre: 'L’autodémo encadrée : 25 étapes, environ 7 minutes.',
    reperes: [
      { cible: '.p-tour-hole', titre: 'Halo', texte: 'L’élément à regarder est entouré, le reste de l’écran est voilé.' },
      { cible: '.p-tour-label', titre: 'Étiquette', texte: 'Titre et une phrase sobre, numérotés, toujours dans l’écran.' },
      { cible: '.p-tour-track', titre: 'Étapes', texte: 'Largeur selon la durée ; un clic saute à l’étape.' },
      { cible: '.p-tour-stop', titre: 'Arrêter l’autodémo', texte: 'Rend la main ; « Reprendre la visite » repart où elle en était.' }
    ]
  },
  {
    n: '17', id: 'palette', url: '/',
    actions: [{ touche: 'Control+k' }],
    titre: 'Palette Ctrl K', sousTitre: 'Rechercher ou lancer n’importe quelle action au clavier.',
    reperes: [
      { cible: '.p-palette input', titre: 'Recherche', texte: 'Pages, actions et récits, filtrés à la frappe.' },
      { cible: '.p-palette-list', titre: 'Actions et pages', texte: 'Installer, scanner, générer, lancer un test de charge ; toutes les pages.' },
      { cible: { sel: '.p-palette-item', texte: 'Visite guidée' }, titre: 'Visite guidée', texte: 'L’autodémo se lance aussi d’ici ; Entrée exécute l’action choisie.' }
    ]
  }
]
