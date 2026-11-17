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

## Synthèse de couverture

| Mesure | Récits |
|---|---|
| Récits du périmètre (exigences) | {{facts.coverage.stories}} |
| Avec critères d'acceptation (conditions de test) | {{facts.coverage.withCriteria}} |
| Avec scénario Gherkin (cas de test) | {{facts.coverage.withGherkin}} |
| Automatisés (script Playwright) | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |
| Exécutés lors de la dernière campagne | {{facts.coverage.executed}} |
| Réussis lors de la dernière campagne | {{facts.coverage.passed}} ({{facts.coverage.pctPassed|pct}} des exécutés) |
| Tests publiés dans Xray | {{facts.xray.pushed}} (+ {{facts.xray.simulated}} simulé(s)) |

Couverture minimale exigée des récits « À automatiser » : {{profile.couvertureMin}} %.

## Matrice

Chaque ligne relie une exigence (récit JIRA) à ses conditions de test (critères d'acceptation), à ses cas de test (scénarios Gherkin), à ses scripts, à ses tests Xray et au résultat de la dernière exécution.

| Récit | Intitulé | Risque | Tri | Critères | Gherkin | Script(s) | Test(s) Xray | Dernier résultat |
|---|---|---|---|---|---|---|---|---|
{{#each calc.traceRows}}
| {{this.key}} | {{this.summary}} | {{this.risk}} | {{this.triage}} | {{this.criteria}} | {{this.gherkin}} | {{this.specs}} | {{this.xray}} | {{this.result}} |
{{else}}
| — | Aucun récit importé | — | — | — | — | — | — | — |
{{/each}}

## Traçabilité inverse (scripts → exigences)

| Script | Récit | Tests |
|---|---|---|
{{#each facts.automation.specs}}
| `{{this.relPath}}` | {{this.storyKey|non rattaché}} | {{this.tests}} |
{{else}}
| Aucun script | — | — |
{{/each}}

## Écarts de traçabilité

{{#each facts.gaps}}
- {{#if this.storyKey}}**{{this.storyKey}}** — {{/if}}{{this.message}}
{{else}}
Aucun écart signalé : chaque récit « À automatiser » est couvert et chaque script est rattaché à un récit.
{{/each}}

Exigences sans cas de test (aucun scénario Gherkin) :
{{#each facts.stories}}
{{#unless this.gherkin.scenarios}}
- **{{this.key}}** — {{this.summary}} (risque {{this.risk.level}})
{{/unless}}
{{/each}}

{{#if facts.triage.untriaged}}
{{facts.triage.untriaged}} récit(s) non triés : leur couverture attendue (automatisée, manuelle ou exclue) n'est pas encore décidée.
{{/if}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
