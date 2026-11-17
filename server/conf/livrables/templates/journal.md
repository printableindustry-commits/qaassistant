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

## Campagnes d'exécution

Testeurs : {{profile.testeurs|join}}. Environnements de référence : voir le document « Disponibilité de l'environnement et des données de test ».

| Campagne | Date | Environnement | Navigateur | Tests | Réussis | Échoués | Ignorés | Durée | Nature |
|---|---|---|---|---|---|---|---|---|---|
{{#each facts.campaigns}}
| {{this.id}} | {{this.at|datetime}} | {{this.env.baseUrl|—}} | {{this.env.browser|—}} | {{this.total}} | {{this.passed}} | {{this.failed}} | {{this.skipped}} | {{this.durationMs|duree}} | {{#if this.simulated}}simulée{{else}}réelle{{/if}} |
{{else}}
| Aucune campagne exécutée | — | — | — | — | — | — | — | — | — |
{{/each}}

## Détail de la dernière campagne

{{#if facts.lastCampaign}}
Campagne **{{facts.lastCampaign.id}}** du {{facts.lastCampaign.at|datetime}}{{#if facts.lastCampaign.simulated}} (simulée){{/if}} : {{facts.lastCampaign.passed}} réussi(s), {{facts.lastCampaign.failed}} échoué(s), {{facts.lastCampaign.skipped}} ignoré(s) sur {{facts.lastCampaign.total}}.

| # | Test | Récit | Fichier | Résultat | Durée | Message |
|---|---|---|---|---|---|---|
{{#each facts.lastCampaign.tests}}
| {{@index}} | {{this.title}} | {{this.storyKey|—}} | {{this.file|—}} | {{this.status}} | {{this.durationMs|duree}} | {{this.error|—}} |
{{/each}}
{{else}}
Aucune campagne n'a encore été exécutée. Lancez une campagne depuis la page Livrables pour alimenter ce journal.
{{/if}}

## Publication dans Xray

{{facts.xray.pushed}} test(s) publié(s) dans JIRA / Xray, dont {{facts.xray.simulated}} en simulation.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
