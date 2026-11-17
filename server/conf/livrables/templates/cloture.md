# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit}} |
| Organisme | {{profile.organisme}} |
| Référence normative | {{doc.ref}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Synthèse et recommandation

Critères de sortie : **{{calc.exitLabel}}**.

{{calc.recommendation}}

Décision du valideur ({{profile.valideur}}) : ☐ Mise en production acceptée ☐ Acceptée avec réserves ☐ Refusée

## Tests réalisés

{{#if facts.lastCampaign}}
Campagne de référence : **{{facts.lastCampaign.id}}** du {{facts.lastCampaign.at|datetime}}{{#if facts.lastCampaign.simulated}} (simulée){{/if}}, environnement {{facts.lastCampaign.env.baseUrl|—}} ({{facts.lastCampaign.env.browser|—}}), durée {{facts.lastCampaign.durationMs|duree}}.

| Total | Réussis | Échecs | Ignorés | Instables | Taux de réussite |
|---|---|---|---|---|---|
| {{facts.lastCampaign.total}} | {{facts.lastCampaign.passed}} | {{facts.lastCampaign.failed}} | {{facts.lastCampaign.skipped}} | {{facts.lastCampaign.flaky|0}} | {{calc.passRate|pct}} |
{{else}}
Aucune campagne d'exécution enregistrée.
{{/if}}

Campagnes sur la période : {{facts.campaigns|count}} (dont {{calc.campaignsReal}} réelle(s)). Couverture : {{facts.coverage.automated}} récit(s) automatisé(s) sur {{facts.coverage.stories}} ({{facts.coverage.pctAutomated|pct}}), {{facts.coverage.passed}} récit(s) réussi(s) ({{facts.coverage.pctPassed|pct}}).
{{#if facts.perf.last}}

Performance : dernier tir k6 « {{facts.perf.last.profile}} » du {{facts.perf.last.at|date}} — verdict {{facts.perf.last.verdict}}, p95 {{facts.perf.last.p95}} ms, taux d'erreur {{facts.perf.last.errorRate}}.
{{/if}}

## Évaluation des critères de sortie

| Critère | Cible | Mesuré | Évaluation |
|---|---|---|---|
{{#each calc.exit}}
| {{this.critere}} | {{this.cible}} | {{this.mesure}} | **{{this.statut}}** |
{{/each}}

{{#unless calc.exitMet}}
Les critères de sortie sont **non atteints** : toute mise en production nécessite une dérogation formelle du valideur, motivée et tracée.
{{/unless}}

## Anomalies résiduelles

| Anomalie | Sévérité | Récit | Test | Occurrences | Statut |
|---|---|---|---|---|---|
{{#each facts.defects}}
| {{this.id}} — {{this.title}} | {{this.severity}} | {{this.storyKey|—}} | {{this.testTitle}} | {{this.occurrences}} | {{this.status}} |
{{else}}
| Aucune anomalie | — | — | — | — | — |
{{/each}}

## Écarts par rapport au plan

{{#each calc.storiesUncovered}}
- Récit **{{this.key}}** ({{this.summary}}) prévu « À automatiser » : Gherkin {{this.gherkin}}, scripts {{this.specs}}.
{{/each}}
{{#each facts.gaps}}
- {{this.message}}
{{else}}
- Aucun écart de traçabilité détecté.
{{/each}}

## Enseignements

- Récits non triés en fin de période : {{facts.triage.untriaged}} — à intégrer au tri dès l'analyse.
- Récits sans critères d'acceptation : à compléter avant conception ({{facts.coverage.withCriteria}} sur {{facts.coverage.stories}} en disposent).
- Taux d'automatisation atteint : {{facts.coverage.pctAutomated|pct}}.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
