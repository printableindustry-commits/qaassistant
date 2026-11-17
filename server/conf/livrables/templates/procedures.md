# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit}} |
| Référence normative | {{doc.ref}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Outillage

| Outil | Version / état |
|---|---|
| Playwright (tests de bout en bout) | {{facts.tools.playwright.version|non installé}} |
| k6 (performance) | {{facts.tools.k6.version|non installé}} |
| Xray (gestion des tests) | mode {{facts.tools.xray.mode|—}}, {{#if facts.tools.xray.configured}}configuré{{else}}non configuré{{/if}} |
| Navigateurs installés | {{facts.tools.browsers|join}} |

## Scripts de test

Chaque procédure de test est un fichier de spécification Playwright ; son rattachement au récit se fait par l'étiquette `@CLÉ` du titre ou la clé dans le nom du fichier.

| Script | Récit | Tests |
|---|---|---|
{{#each facts.automation.specs}}
| `{{this.relPath}}` | {{this.storyKey|non rattaché}} | {{this.tests}} |
{{else}}
| Aucun script | — | — |
{{/each}}

Sessions d'exploration (génération assistée de scripts) : {{facts.automation.sessions.total}} session(s), {{facts.automation.sessions.validated}} validée(s), {{facts.automation.sessions.needsHuman}} en attente d'intervention.

| Récit | Session | Script | Étapes | Validée | Cible |
|---|---|---|---|---|---|
{{#each calc.automationRows}}
| {{this.storyKey}} | {{this.sessionId|—}} | {{this.relPath|—}} | {{this.steps|—}} | {{this.validated|ouinon}} | {{this.target|—}} |
{{else}}
| — | Aucune session d'exploration | — | — | — | — |
{{/each}}

## Lancement et ordonnancement

Les procédures sont exécutées en campagne par la commande `npx playwright test --reporter=json` depuis le projet de test ; l'ordre d'exécution n'est pas imposé (tests indépendants), les tests à risque élevé étant prioritaires en cas de campagne partielle. {{profile.ordonnancement|Une campagne complète est lancée à chaque livraison sur l'environnement de test, puis avant la mise en production.}}

Chaque campagne est consignée dans le journal d'exécution ; les résultats sont publiés dans Xray.

## Prérequis

{{#each facts.automation.targets}}
- Application **{{this.name}}** accessible à l'adresse {{this.baseUrl}} (navigateur {{this.browser}}, {{this.accounts}} compte(s) de test).
{{else}}
- {{profile.environnements}}
{{/each}}
- Dépendances du projet de test installées (`npm ci`) et navigateurs Playwright disponibles.
- Comptes et jeux de données de test conformes au document « Disponibilité de l'environnement et des données de test ».

## Tests de performance

{{#if facts.perf.last}}
{{facts.perf.runs}} tir(s) k6 enregistré(s). Dernier tir : profil « {{facts.perf.last.profile}} » du {{facts.perf.last.at|datetime}}, verdict **{{facts.perf.last.verdict}}**, p95 = {{facts.perf.last.p95}} ms, taux d'erreur = {{facts.perf.last.errorRate}}.
{{else}}
Aucun tir de performance k6 enregistré à ce jour.
{{/if}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
