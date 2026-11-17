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

## Objet

Journal chronologique des campagnes d'exécution de la version {{profile.versionProduit}}. Testeurs : {{profile.testeurs|join}}. Environnements de référence : document « Disponibilité de l'environnement et des données de test ».

## Campagnes d'exécution

| Campagne | Début | Environnement | Navigateur | Tests | Réussis | Échoués | Ignorés | Durée | Nature |
|---|---|---|---|---|---|---|---|---|---|
{{#each facts.campaigns}}
| {{this.id}} | {{this.at|datetime}} | {{this.env|—}} | {{this.browser|—}} | {{this.total}} | {{this.passed}} | {{this.failed}} | {{this.skipped}} | {{this.durationMs|duree}} | {{#if this.simulated}}simulée{{else}}réelle{{/if}} |
{{else}}
| Aucune campagne exécutée | — | — | — | — | — | — | — | — | — |
{{/each}}

## Détail de la dernière campagne

{{#if facts.lastCampaign}}
Campagne **{{facts.lastCampaign.id}}**, lancée le {{facts.lastCampaign.at|datetime}} par {{facts.lastCampaign.by|—}}, terminée le {{facts.lastCampaign.finishedAt|datetime}} : {{facts.lastCampaign.passed}} réussi(s), {{facts.lastCampaign.failed}} échoué(s), {{facts.lastCampaign.skipped}} ignoré(s), {{facts.lastCampaign.flaky|0}} instable(s) sur {{facts.lastCampaign.total}}.
{{#if facts.lastCampaign.simulated}}

**Campagne simulée** : résultats générés pour préparer les tests, sans valeur de preuve d'exécution.{{#if facts.lastCampaign.simulatedReason}} Motif : {{facts.lastCampaign.simulatedReason}}.{{/if}}
{{/if}}

| N° | Test | Récit | Fichier | Résultat | Durée | Relances |
|---|---|---|---|---|---|---|
{{#each calc.lastTests}}
| {{@n}} | {{this.title}} | {{this.storyKey}} | {{this.file|—}} | {{this.resultLabel}} | {{this.durationMs|duree}} | {{this.retries|0}} |
{{/each}}

{{#if calc.failedTests}}
Événements constatés (tests en échec) :

{{#each calc.failedTests}}
- **{{this.title}}** — {{this.error|sans message}}
{{/each}}

Les anomalies correspondantes sont tracées dans le document « Rapports d'anomalies ».
{{/if}}
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
