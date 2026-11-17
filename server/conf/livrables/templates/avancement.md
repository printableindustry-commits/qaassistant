# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit}} |
| Référence normative | {{doc.ref}} |
| Période couverte | {{profile.periodeRapport}} |
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
Dernière campagne **{{facts.lastCampaign.id}}** du {{facts.lastCampaign.at|datetime}}{{#if facts.lastCampaign.simulated}} (simulée){{/if}} : **{{facts.lastCampaign.passed}} réussi(s) sur {{facts.lastCampaign.total}}** test(s), {{facts.lastCampaign.failed}} échec(s), {{facts.lastCampaign.skipped}} ignoré(s) — taux de réussite **{{calc.passRate|pct}}** (objectif du plan : {{profile.seuilReussite}} %).
{{else}}
Aucune campagne d'exécution n'a encore été lancée : seul l'avancement de la préparation est mesuré.
{{/if}}

Anomalies ouvertes : **{{calc.defectsCount.ouvertes}}** (dont {{calc.defectsCount.bloquante}} bloquante(s)). Récits automatisés : **{{facts.coverage.automated}} / {{facts.coverage.stories}}** ({{facts.coverage.pctAutomated|pct}}, objectif du plan : {{profile.couvertureMin}} %).

## Avancement par rapport au plan

| Activité | Réalisé | Référence |
|---|---|---|
| Récits triés | {{facts.triage.todo}} à automatiser, {{facts.triage.later}} plus tard, {{facts.triage.skip}} non retenus | {{facts.triage.untriaged}} non triés |
| Récits avec critères d'acceptation | {{facts.coverage.withCriteria}} | {{facts.coverage.stories}} récits |
| Scénarios Gherkin | {{facts.gherkin.scenarios}} scénario(s), {{facts.gherkin.validated}} fichier(s) validé(s) | {{facts.gherkin.total}} fichier(s) |
| Scripts automatisés | {{facts.automation.specs|count}} script(s) Playwright | {{facts.coverage.automated}} récit(s) couverts |
| Récits exécutés | {{facts.coverage.executed}} | {{facts.coverage.stories}} récits |
| Tests publiés dans Xray | {{facts.xray.pushed}} | dont {{facts.xray.simulated}} simulé(s) |

Jalons du plan de test :

| Jalon | Échéance | Livrable attendu |
|---|---|---|
{{#each profile.jalons}}
| {{this.jalon}} | {{this.date}} | {{this.livrable}} |
{{else}}
| {{profile.jalons}} | — | — |
{{/each}}

## Métriques d'exécution

| Campagne | Date | Nature | Total | Réussis | Échecs | Ignorés | Durée |
|---|---|---|---|---|---|---|---|
{{#each facts.campaigns}}
| {{this.id}} | {{this.at|datetime}} | {{#if this.simulated}}simulée{{else}}réelle{{/if}} | {{this.total}} | {{this.passed}} | {{this.failed}} | {{this.skipped}} | {{this.durationMs|duree}} |
{{else}}
| Aucune campagne | — | — | — | — | — | — | — |
{{/each}}

{{#if calc.failedTests}}
Tests en échec lors de la dernière campagne :

{{#each calc.failedTests}}
- {{this.title}} (récit {{this.storyKey|non rattaché}}) : {{this.error|sans message}}
{{/each}}
{{/if}}

| Sévérité | Anomalies ouvertes |
|---|---|
| Bloquante | {{calc.defectsCount.bloquante}} |
| Majeure | {{calc.defectsCount.majeure}} |
| Mineure | {{calc.defectsCount.mineure}} |

{{#each calc.defectsOpen}}
- **{{this.id}}** ({{this.severity}}) — {{this.title}} — récit {{this.storyKey|non rattaché}}, {{this.occurrences}} occurrence(s) depuis le {{this.firstSeen|date}}
{{/each}}

## Obstacles

{{profile.obstaclesPeriode}}

{{#each facts.gaps}}
- {{this.message}}
{{/each}}

## Risques

Risques produit (registre du plan, mis à jour pour la période) :

| Risque | Source | Niveau | Mesure de test |
|---|---|---|---|
{{#each profile.risquesProduit}}
| {{this.risque}} | {{this.source}} | {{this.niveau}} | {{this.attenuation}} |
{{else}}
| {{profile.risquesProduit}} | — | — | — |
{{/each}}

{{#if profile.risquesProjet}}
Risques projet :

| Risque | Impact | Mesure |
|---|---|---|
{{#each profile.risquesProjet}}
| {{this.risque}} | {{this.impact}} | {{this.attenuation}} |
{{/each}}
{{/if}}

{{#if calc.storiesUncovered}}
Récits « À automatiser » encore non couverts :

{{#each calc.storiesUncovered}}
- {{this.key}} — {{this.summary}} (Gherkin : {{this.gherkin}}, scripts : {{this.specs}})
{{/each}}
{{/if}}

## Activités prévues pour la période suivante

{{#if facts.triage.untriaged}}
- Trier les récits restants ({{facts.triage.untriaged}}) et compléter les scénarios Gherkin manquants.
{{/if}}
{{#if calc.storiesUncovered}}
- Automatiser les récits « À automatiser » non couverts ({{calc.storiesUncovered|count}}).
{{/if}}
{{#if calc.defectsCount.ouvertes}}
- Faire corriger puis retester les anomalies ouvertes ({{calc.defectsCount.ouvertes}}).
{{/if}}
- Relancer une campagne complète de non-régression ; fréquence des rapports : {{profile.frequenceReporting|lower|selon le plan de test}}.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
