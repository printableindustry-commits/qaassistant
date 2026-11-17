# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit}} |
| Référence normative | {{doc.ref}} |
| Période arrêtée au | {{doc.dataDate|datetime}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Synthèse

{{#if facts.lastCampaign}}
Dernière campagne **{{facts.lastCampaign.id}}** du {{facts.lastCampaign.at|datetime}}{{#if facts.lastCampaign.simulated}} (simulée){{/if}} : **{{facts.lastCampaign.passed}} réussi(s) sur {{facts.lastCampaign.total}}** test(s), {{facts.lastCampaign.failed}} échec(s), {{facts.lastCampaign.skipped}} ignoré(s) — taux de réussite **{{calc.passRate|pct}}** (objectif : {{profile.seuilReussite}} %).
{{else}}
Aucune campagne d'exécution n'a encore été lancée : seul l'avancement de la préparation est mesuré.
{{/if}}

Anomalies ouvertes : **{{calc.defectsCount.ouvertes}}** (dont {{calc.defectsCount.bloquante}} bloquante(s)). Récits automatisés : **{{facts.coverage.automated}} / {{facts.coverage.stories}}** ({{facts.coverage.pctAutomated|pct}}).

## Avancement de la préparation

| Activité | Réalisé | Référence |
|---|---|---|
| Récits triés | {{facts.triage.todo}} à automatiser, {{facts.triage.later}} plus tard, {{facts.triage.skip}} non retenus | {{facts.triage.untriaged}} non triés |
| Récits avec critères d'acceptation | {{facts.coverage.withCriteria}} | {{facts.coverage.stories}} récits |
| Scénarios Gherkin | {{facts.gherkin.scenarios}} scénario(s), {{facts.gherkin.validated}} fichier(s) validé(s) | {{facts.gherkin.total}} fichier(s) |
| Scripts automatisés | {{facts.automation.specs|count}} script(s) Playwright | {{facts.coverage.automated}} récit(s) couverts |
| Tests publiés dans Xray | {{facts.xray.pushed}} | dont {{facts.xray.simulated}} simulé(s) |

## Résultats d'exécution

| Campagne | Date | Nature | Total | Réussis | Échecs | Ignorés | Durée |
|---|---|---|---|---|---|---|---|
{{#each facts.campaigns}}
| {{this.id}} | {{this.at|datetime}} | {{#if this.simulated}}simulée{{else}}réelle{{/if}} | {{this.total}} | {{this.passed}} | {{this.failed}} | {{this.skipped}} | {{this.durationMs|duree}} |
{{else}}
| — | — | — | 0 | 0 | 0 | 0 | — |
{{/each}}

{{#if calc.failedTests}}
Tests en échec lors de la dernière campagne :

| Test | Récit | Erreur |
|---|---|---|
{{#each calc.failedTests}}
| {{this.title}} | {{this.storyKey|—}} | {{this.error|—}} |
{{/each}}
{{/if}}

## Anomalies

| Sévérité | Ouvertes |
|---|---|
| Bloquante | {{calc.defectsCount.bloquante}} |
| Majeure | {{calc.defectsCount.majeure}} |
| Mineure | {{calc.defectsCount.mineure}} |

{{#each calc.defectsOpen}}
- **{{this.id}}** ({{this.severity}}) — {{this.title}} — récit {{this.storyKey|non rattaché}}, {{this.occurrences}} occurrence(s) depuis le {{this.firstSeen|date}}
{{else}}
Aucune anomalie ouverte.
{{/each}}

## Risques et points d'attention

{{#each facts.gaps}}
- {{this.message}}
{{else}}
- Aucun écart de traçabilité détecté.
{{/each}}
{{#each calc.storiesUncovered}}
- Récit {{this.key}} « À automatiser » sans test automatisé ou sans scénario Gherkin.
{{/each}}

## Activités prévues

- Traiter les récits non triés ({{facts.triage.untriaged}}) et compléter les scénarios Gherkin manquants.
- Automatiser les récits « À automatiser » non couverts ({{calc.storiesUncovered|count}}).
- Corriger et retester les anomalies ouvertes ({{calc.defectsCount.ouvertes}}), puis relancer une campagne complète.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
