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

## Environnements de test

| Environnement | URL | Navigateur | Données |
|---|---|---|---|
{{#each profile.environnements}}
| {{this.nom}} | {{this.url|—}} | {{this.navigateur|—}} | {{this.donnees|—}} |
{{else}}
| {{profile.environnements}} | — | — | — |
{{/each}}

Cibles d'exécution déclarées dans Wizard QA (sans les secrets) :

| Cible | URL | Navigateur | Comptes de test |
|---|---|---|---|
{{#each facts.automation.targets}}
| {{this.name}} | {{this.baseUrl}} | {{this.browser}} | {{this.accounts}} |
{{else}}
| Aucune cible déclarée | — | — | — |
{{/each}}

## Données de test

{{profile.donneesTest}}

Les identifiants des comptes de test sont conservés dans le coffre de Wizard QA et ne figurent pas dans ce document.

## Outillage disponible

| Outil | Version |
|---|---|
| Playwright | {{facts.tools.playwright.version|non installé}} |
| k6 | {{facts.tools.k6.version|non installé}} |
| Xray | mode {{facts.tools.xray.mode|—}}, {{#if facts.tools.xray.configured}}configuré{{else}}non configuré{{/if}} |
| Navigateurs | {{facts.tools.browsers|join}} |

## État de disponibilité

{{#if facts.lastCampaign}}
Dernière exécution sur l'environnement **{{facts.lastCampaign.env.baseUrl|—}}** ({{facts.lastCampaign.env.browser|—}}) le {{facts.lastCampaign.at|datetime}} : campagne {{facts.lastCampaign.id}} terminée avec le statut « {{facts.lastCampaign.status}} »{{#if facts.lastCampaign.simulated}} (simulée){{/if}}, {{facts.lastCampaign.total}} test(s) exécuté(s).
{{else}}
Aucune campagne n'a encore été exécutée : la disponibilité de l'environnement n'est pas confirmée par une exécution.
{{/if}}

Confirmation de disponibilité : ☐ Environnement disponible ☐ Données chargées ☐ Comptes de test opérationnels — visa : {{profile.responsableTest}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
