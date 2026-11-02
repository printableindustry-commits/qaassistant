/**
 * Paragraphes explicatifs du questionnaire k6 (bonnes pratiques, repères métier).
 * Fusionnés sur chaque question via enrichK6QuestionsWithGuides().
 */
export const K6_QUESTION_GUIDES = {
  campaignName: [
    'Donnez un nom unique et lisible : environnement + objectif + date ou sprint.',
    'Bonnes pratiques : « Smoke-recette-S0998 », « Load-nominal-preprod-2026Q2 ». Évitez les noms génériques « test1 » ou « perf » seuls.',
  ],
  campaignObjective: [
    'Le type de test détermine la charge, la durée et les seuils attendus.',
    'Smoke : 1–5 VUs, 1–3 min — vérifier que l’appli répond. Load : charge nominale métier (souvent 20–50 % du pic réel). Stress / spike / soak / breakpoint : campagnes dédiées, jamais en première intention sur un nouvel environnement.',
  ],
  businessCriticality: [
    'Plus la criticité est élevée, plus les seuils doivent être stricts et l’environnement iso-prod.',
    'Pour une appli critique, prévoyez validation PO + ops avant toute montée au-delà du smoke.',
  ],
  releaseGate: [
    'Bloquant : le pipeline CI échoue si un seuil k6 est violé — à réserver aux campagnes smoke/load stabilisées.',
    'Conseil : commencez en mode indicatif, puis passez en bloquant une fois les seuils calibrés sur 3 exécutions réussies.',
  ],
  stakeholders: [
    'Listez les personnes qui valident les résultats ou doivent être alertées (PO, QA, ops, sécurité, architecte).',
    'Une ligne par personne : « Prénom Nom — rôle ». Utilisez le bouton + pour ajouter des validateurs.',
  ],
  targetType: [
    'Web : pages HTML/SPA, temps de rendu inclus. API : JSON REST, latence pure. Mixte : parcours réaliste (front + API).',
    'Choisissez le type dominant du scénario ; le script généré adaptera les requêtes HTTP.',
  ],
  baseUrl: [
    'URL racine sans chemin final (ex. https://app-recette.example.com). Les chemins sont ajoutés à l’étape suivante.',
    'Ne jamais pointer la production réelle sans accord écrit ops/sécurité. Privilégiez recette dédiée charge ou préprod iso-prod.',
  ],
  entryPaths: [
    '**Chemins relatifs** à l’URL de base ou URLs complètes si besoin.\n• Une ligne = un parcours ou endpoint à sonder',
    '**Pour démarrer**\n• `/` — page d’accueil\n• `/health` — disponibilité',
    '**Bonnes pratiques**\n• Ajoutez les parcours métier critiques (login, recherche, création)\n• En __smoke__ : ne dépassez pas **10 chemins**',
  ],
  healthCheckPath: [
    'Le **healthcheck** est l’endpoint minimal de disponibilité, exécuté en premier dans le smoke.',
    '**Modes courants**\n• `/health` ou `/api/health` — simple 200 OK\n• `/actuator/health` — Spring Boot\n• `/ready` / `/readiness` — Kubernetes (dépendances OK)\n• `/live` / `/liveness` — processus vivant\n• `/ping` — statique',
    '**Bonnes pratiques**\n• Même endpoint que le monitoring ops\n• Pas d’écriture en base\n• En recette : **200** en __moins de 500 ms__',
  ],
  environment: [
    'Recette QA : smoke et premiers loads. Préprod / prod-like : charge nominale et stress contrôlé. Bac à sable : prototypage script uniquement.',
    'L’environnement doit être dimensionné comme la cible de test ; un load sur une recette sous-dimensionnée donne des faux positifs.',
  ],
  executorType: [
    'VUs constants : charge stable — idéal load test et soak. Rampe (ramping-vus) : montée/descente progressive — recommandé stress et spike.',
    'Débit constant (req/s) : modèle « ouvert » (file d’attente) — utile pour APIs à SLA en requêtes/seconde. Itérations partagées / par VU : nombre fixe de passages — plutôt pour tests fonctionnels perf légers.',
    'Pour une campagne « normale » débutante : constant-vus ou ramping-vus avec montée ≥ 1 min.',
  ],
  virtualUsers: [
    'Un **VU** (Virtual User) est un agent k6 qui exécute votre script en boucle, en parallèle avec les autres VUs. Ce n\'est __pas__ un utilisateur réel unique : chaque VU simule un parcours complet (plusieurs requêtes + pauses).',
    '**Ordre de grandeur**\n• 10 VUs + pause 2 s ≈ **5 requêtes/s** au total\n• 50 VUs au même rythme ≈ **25 req/s**\n• Multipliez par le nombre de requêtes HTTP par itération',
    '**Exemple Apache 2 Go RAM** (PHP léger, mpm_event) : saturation souvent entre **150 et 400 VUs** selon cache et taille des réponses.\n• Smoke : **5–10 VUs**\n• Load nominal : paliers de **+10 %** jusqu\'au SLA',
    '**Bonnes pratiques** : démarrez bas, observez p95 et taux d\'erreur, puis augmentez progressivement. Ne lancez jamais **1000 VUs** sans accord ops.',
  ],
  duration: [
    'Durée totale de la campagne au format k6 : s (secondes), m (minutes), h (heures). Exemples : 30s, 5m, 1h30m.',
    'Smoke : 1–3 min. Load nominal : 10–30 min pour stabiliser les métriques. Soak : plusieurs heures (avec plafond gouvernance). Évitez les durées « démentes » (> 2 h) sans accord ops.',
  ],
  rampUpDuration: [
    'Durée pendant laquelle k6 augmente progressivement le nombre de VUs jusqu’au pic. Lisse les pics de connexion TCP et le warm-up JVM/cache.',
    'Bonnes pratiques : au moins 1–2 min pour 50+ VUs ; 30 s acceptable pour un smoke à 10 VUs. Montée instantanée = risque de faux timeouts au démarrage.',
  ],
  rampDownDuration: [
    'Durée de descente progressive après le pic. Permet d’observer la dégradation et d’éviter un arrêt brutal côté serveur.',
    'Souvent 30 s à 2 min, proportionnelle à la rampe de montée. Peut être courte (30 s) pour un smoke.',
  ],
  thinkTimeMin: [
    'Pause minimale (en secondes) entre deux requêtes dans le script, simulant le temps de lecture/saisie utilisateur.',
    '0 s = charge maximale (stress artificiel). 1–3 s = parcours web réaliste. 5–15 s = consultation métier lente. Des pauses trop courtes surchargent l’appli sans refléter l’usage réel.',
  ],
  thinkTimeMax: [
    'Pause maximale aléatoire entre min et max à chaque itération. k6 tire une valeur uniforme dans [min, max].',
    'Gardez max ≤ 2–3 × min pour un comportement crédible. Ex. min 1 s, max 3 s pour un parcours standard.',
  ],
  arrivalRate: [
    'Réservé au modèle « débit constant » (constant-arrival-rate) : nombre de nouvelles itérations démarrées par seconde, indépendamment du nombre de VUs.',
    'Ex. 50 req/s avec temps de réponse 200 ms nécessite environ 10 VUs actifs. Commencez au débit métier nominal (souvent 10–100 req/s) ; montez par paliers de 10 %.',
  ],
  maxVUsCap: [
    'Filet de sécurité : k6 arrête la campagne si le nombre de VUs dépasse ce plafond (modèle à débit ouvert).',
    'Réglez à 2–5 × votre pic prévu (ex. pic 100 VUs → plafond 300–500). Protège l’environnement contre une configuration erronée.',
  ],
  p95Ms: [
    '95 % des requêtes doivent répondre en moins de ce délai (millisecondes). Métrique standard pour les SLA web.',
    'Repères : API interne < 300 ms · page web < 800 ms · parcours lourd < 1500 ms. Calibrez sur un smoke à faible charge avant de durcir le seuil.',
  ],
  p99Ms: [
    '99 % des requêtes sous ce délai — capture les outliers (files d’attente, GC).',
    'Règle empirique : p99 ≈ 1,5 à 2 × p95 (ex. p95 500 ms → p99 750–1000 ms). Ne fixez pas p99 = p95 : vous masqueriez les dégradations.',
  ],
  maxErrorRate: [
    'Pourcentage maximal de requêtes en échec (HTTP ≥ 400 ou checks k6 KO) encore acceptable.',
    'Smoke / load : 0–1 % en recette stable. Stress : tolérance plus haute (5–10 %) car l’objectif est de trouver la limite. 0 % est idéal mais rare sur des environnements partagés.',
  ],
  minThroughputRps: [
    'Débit minimal en requêtes/seconde que la campagne doit maintenir. 0 = non applicable (seuils latence seuls).',
    'Utile pour valider qu’une API tient un contrat métier (ex. ≥ 100 req/s). Fixez-le après une campagne load réussie, pas au premier essai.',
  ],
  abortOnFail: [
    'Oui (fail fast) : k6 s’arrête dès qu’un seuil est violé — économise l’environnement et le temps CI.',
    'Non : la campagne va au bout — utile pour analyse post-mortem ou stress. En CI smoke, préférez Oui.',
  ],
  authMode: [
    'Alignez le mode sur l’application réelle. Public : aucune auth. Bearer/OAuth : APIs. Cookie : sessions web après login.',
    'Ne stockez jamais de secrets dans le script : utilisez __ENV et des variables CI masquées.',
  ],
  authHeaderName: [
    'Nom du header HTTP pour le token (souvent Authorization). Certains gateways utilisent X-Api-Key ou un header custom.',
    'Laissez Authorization sauf documentation contraire de l’API.',
  ],
  tokenEnvVar: [
    'Nom de la variable d’environnement lue par k6 (__ENV.NOM). Ex. AUTH_TOKEN, API_KEY.',
    'Injectez la valeur via le pipeline CI ou un fichier .env local non versionné.',
  ],
  loginScriptNeeded: [
    'Oui si chaque VU doit obtenir une session (cookie/JWT) via un POST /login avant le parcours.',
    'k6 exécute setup() une fois par VU au démarrage — évite de logger à chaque itération. Non si token statique ou endpoints publics.',
  ],
  dataDriven: [
    'CSV/JSON : chaque VU consomme des lignes différentes (comptes, références) — indispensable pour éviter les conflits données.',
    'Pool partagé : données chargées une fois en setup() — pour jeux modestes (< 10 000 lignes).',
  ],
  csvDataPath: [
    'Chemin relatif à la racine du dépôt. Placez les fichiers dans k6/data/ et excluez les données sensibles du Git.',
    'Format typique : login,password ou id,ref — une ligne par jeu de données, en-tête optionnel selon le script.',
  ],
  scenarioDescription: [
    'Décrivez les parcours métier et leur répartition de trafic (ex. 70 % consultation, 20 % création).',
    'Aide l’équipe à relire le script généré et à calibrer les VUs par scénario futur multi-scripts.',
  ],
  useProxy: [
    'Sur poste CA-TS, le proxy entreprise est souvent obligatoire pour atteindre la recette.',
    'Accès direct : agents CI dans le réseau applicatif ou VPN sans proxy.',
  ],
  proxyUrl: [
    'URL complète du proxy si custom (ex. http://proxy.saas.cagip.group.gna:8080). Laissez vide si proxy standard poste.',
    'Testez avec curl -x avant la campagne k6.',
  ],
  tlsInsecure: [
    'Désactiver la vérification TLS uniquement en recette avec certificats auto-signés — jamais en préprod/prod.',
    'Variable k6 : K6_INSECURE_SKIP_TLS_VERIFY=true. Préférez importer le CA interne quand c’est possible.',
  ],
  userAgent: [
    'Identifie les requêtes k6 dans les logs serveur et WAF. Format recommandé : WizardQA-k6/<version> ou nom de campagne.',
    'Certains WAF bloquent les User-Agent par défaut de k6 — personnalisez si vous obtenez des 403.',
  ],
  outputFormats: [
    'Console : résumé terminal. JSON : archivage dans reports/k6/. CSV : courbes dans Excel.',
    'Influx/Prometheus/Grafana Cloud : monitoring temps réel — utile pour campagnes longues ou stress.',
  ],
  reportTags: [
    'Tags k6 (key=value) propagés dans les métriques pour filtrer par projet, env, sprint.',
    'Ex. projet=P0326, env=recette, campagne=smoke. Un tag par ligne ou format key=value.',
  ],
  grafanaCloudProject: [
    'Identifiant du projet Grafana Cloud k6 si vous exportez vers le cloud. Optionnel pour exécution locale.',
    'Nécessite un token Grafana Cloud configuré en variable d’environnement.',
  ],
  runInCi: [
    'Intégrer k6 en pipeline permet de rejouer le smoke à chaque merge. Charge lourde : plutôt planifiée (nuit/week-end).',
    'Isolez les jobs perf sur un runner dédié pour ne pas fausser les métriques.',
  ],
  ciParallelism: [
    'Nombre d’agents CI exécutant k6 en parallèle. 1 par défaut — évite de multiplier la charge sur le même environnement.',
    'Augmentez seulement si chaque agent cible un environnement distinct ou une partition de données.',
  ],
  scheduleCron: [
    'Expression cron pour campagnes récurrentes (ex. 0 2 * * 1 = lundi 2h). Vide = exécution manuelle uniquement.',
    'Planifiez les loads lourds hors heures ouvrées et après accord ops.',
  ],
  notifyOnFail: [
    'Canaux d’alerte si seuils violés : e-mail, Teams, ticket JIRA.',
    'Configurez au minimum une notification pour les campagnes bloquantes release.',
  ],
  isolationConfirmed: [
    'L’environnement de charge ne doit pas partager la prod ni une recette critique utilisée par d’autres équipes.',
    'Obligatoire avant toute campagne > smoke. En cas de doute, choisissez Non et validez avec ops.',
  ],
  dataAnonymized: [
    'Les jeux de test ne doivent pas contenir de données personnelles réelles (RGPD).',
    'Données fictives, masquées ou générées — jamais un dump prod brut.',
  ],
  rollbackPlan: [
    'Documentez les actions si l’environnement est saturé : arrêt k6, alerte ops, restauration snapshot DB, redémarrage pods.',
    'Partagez ce plan avec les parties prenantes avant la première campagne stress.',
  ],
  maxDurationCap: [
    'Plafond durée absolue (sécurité) — k6 ou le superviseur arrête au-delà. Ex. 2h pour un soak, 15m pour un smoke CI.',
    'Protège contre une boucle infinie ou une mauvaise configuration de durée.',
  ],
}

export function normalizeGuideParagraphs(paragraphs) {
  if (!Array.isArray(paragraphs)) return []
  return paragraphs.flatMap((raw) => {
    const text = String(raw || '').trim()
    if (!text) return []
    if (text.includes('\n')) return [text]
    if (/ :\s/.test(text) && text.includes(' · ')) {
      const idx = text.indexOf(' · ')
      const head = text.slice(0, idx).trim()
      const tail = text.slice(idx + 3).split(' · ').map((s) => s.trim()).filter(Boolean)
      return [`${head}\n${tail.map((t) => `• ${t}`).join('\n')}`]
    }
    if (text.includes(' · ') && text.split(' · ').length >= 3) {
      return [text.split(' · ').map((s) => `• ${s.trim()}`).join('\n')]
    }
    return [text]
  })
}

export function enrichK6QuestionsWithGuides(questions) {
  if (!Array.isArray(questions)) return questions
  return questions.map((q) => {
    const guide = K6_QUESTION_GUIDES[q.id]
    if (!guide?.length) return q
    return { ...q, guide: normalizeGuideParagraphs(guide) }
  })
}
