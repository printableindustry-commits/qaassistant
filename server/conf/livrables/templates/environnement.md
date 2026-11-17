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

## Exigences d'environnement

Responsable des environnements : {{profile.responsableEnvironnement}}.

| Environnement | Adresse | Navigateur | Comptes (profils) | Usage |
|---|---|---|---|---|
{{#each profile.environnements}}
| {{this.nom}} | {{this.url|—}} | {{this.navigateur|—}} | {{this.comptes|—}} | {{this.usage|—}} |
{{/each}}

Cibles d'exécution déclarées dans Wizard QA :

| Cible | Adresse | Navigateur | Comptes de test |
|---|---|---|---|
{{#each facts.automation.targets}}
| {{this.name}} | {{this.baseUrl}} | {{this.browser}} | {{this.accounts}} |
{{else}}
| Aucune cible déclarée | — | — | — |
{{/each}}

## Outillage

| Outil | Version / état |
|---|---|
| Playwright | {{facts.tools.playwright.version|non installé}} |
| k6 | {{facts.tools.k6.version|non installé}} |
| Xray | mode {{facts.tools.xray.mode|—}}, {{#if facts.tools.xray.configured}}configuré{{else}}non configuré{{/if}} |
| Navigateurs | {{facts.tools.browsers|join}} |

## Données de test

{{profile.donneesTest}}

Les identifiants des comptes de test sont conservés dans le coffre de Wizard QA ; ils ne figurent ni dans ce document ni dans les scripts.

## Confidentialité et protection des données

Niveau de confidentialité des livrables : {{profile.confidentialite}}.

{{profile.protectionDonnees}}

## État de disponibilité

| Élément | État constaté |
|---|---|
| Cibles d'exécution déclarées | {{facts.automation.targets|count}} |
| Playwright | {{#if facts.tools.playwright}}installé{{else}}non installé{{/if}} |
| k6 | {{#if facts.tools.k6}}installé{{else}}non installé{{/if}} |
| Publication Xray | {{#if facts.tools.xray.configured}}configurée{{else}}non configurée{{/if}} |
| Dernière campagne | {{#if facts.lastCampaign}}{{facts.lastCampaign.id}} du {{facts.lastCampaign.at|datetime}}{{else}}aucune{{/if}} |

{{#if facts.lastCampaign}}
Dernière exécution sur **{{facts.lastCampaign.env.baseUrl|—}}** ({{facts.lastCampaign.env.browser|—}}) : {{facts.lastCampaign.total}} test(s), {{facts.lastCampaign.passed}} réussi(s), {{facts.lastCampaign.failed}} en échec, {{facts.lastCampaign.skipped}} ignoré(s).{{#if facts.lastCampaign.simulated}} **Campagne simulée : elle ne prouve pas la disponibilité réelle de l'environnement.**{{/if}}
{{else}}
Aucune campagne exécutée : la disponibilité de l'environnement n'est pas confirmée par une exécution.
{{/if}}

Confirmation de disponibilité avant campagne : ☐ Environnement disponible ☐ Données chargées ☐ Comptes de test opérationnels — visa : {{profile.responsableTest}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
