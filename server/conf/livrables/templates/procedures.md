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

Chaque procédure de test est un fichier de spécification Playwright qui exécute les cas de test (scénarios Gherkin) d'un récit ; le rattachement se fait par l'étiquette `@CLÉ` du titre du test ou la clé dans le nom du fichier. Le code du script décrit les étapes ; il est versionné avec le projet de test.

| Script | Récit | Tests |
|---|---|---|
{{#each facts.automation.specs}}
| `{{this.relPath}}` | {{this.storyKey|non rattaché}} | {{this.tests}} |
{{else}}
| Aucun script | — | — |
{{/each}}

{{#if facts.automation.sessions.total}}
Scripts issus des sessions d'exploration assistée : {{facts.automation.sessions.total}} session(s), {{facts.automation.sessions.validated}} validée(s) par un testeur, {{facts.automation.sessions.needsHuman}} en attente d'intervention.

| Récit | Session | Script | Étapes | Validée | Cible |
|---|---|---|---|---|---|
{{#each calc.automationRows}}
| {{this.storyKey}} | {{this.sessionId|—}} | {{this.relPath|—}} | {{this.steps|—}} | {{this.validated|ouinon}} | {{this.target|—}} |
{{/each}}
{{else}}
Aucune session d'exploration assistée enregistrée.
{{/if}}

## Ordre d'exécution

Commande de campagne : `npx playwright test --reporter=json`, depuis le projet de test. Les tests sont indépendants les uns des autres.

{{profile.ordonnancement}}

Chaque campagne est consignée dans le journal d'exécution{{#if facts.tools.xray.configured}} et ses résultats sont publiés dans Xray{{else}} ; la publication dans Xray n'est pas configurée{{/if}}.

## Préconditions

{{#each facts.automation.targets}}
- Application **{{this.name}}** accessible à l'adresse {{this.baseUrl}} (navigateur {{this.browser}}, {{this.accounts}} compte(s) de test déclaré(s)).
{{else}}
- Aucune cible d'exécution déclarée dans Wizard QA.
{{/each}}
- Dépendances du projet de test installées (`npm ci`) et navigateurs Playwright disponibles.
- Données de test chargées conformément au document « Disponibilité de l'environnement et des données de test ».

## Jeu de comptes de test

Seuls les profils sont indiqués ; les identifiants et mots de passe sont conservés dans le coffre de Wizard QA et ne figurent ni dans les scripts ni dans ce document.

| Environnement | Comptes (profils) | Usage |
|---|---|---|
{{#each profile.environnements}}
| {{this.nom}} | {{this.comptes|—}} | {{this.usage|—}} |
{{/each}}

## Tests de performance

{{#if facts.perf.last}}
{{facts.perf.runs}} tir(s) k6 enregistré(s). Dernier tir : profil « {{facts.perf.last.profile}} » du {{facts.perf.last.at|datetime}}, verdict k6 `{{facts.perf.last.verdict}}`, p95 = {{facts.perf.last.p95}} ms, taux d'erreur HTTP (ratio) = {{facts.perf.last.errorRate}}.
{{else}}
Aucun tir de performance k6 enregistré à ce jour.
{{/if}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
