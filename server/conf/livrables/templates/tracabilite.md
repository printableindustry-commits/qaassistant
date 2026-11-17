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

| Mesure | Récits | Part |
|---|---|---|
| Récits du périmètre | {{facts.coverage.stories}} | 100 % |
| Avec critères d'acceptation | {{facts.coverage.withCriteria}} | — |
| Avec scénario Gherkin | {{facts.coverage.withGherkin}} | — |
| Automatisés (script Playwright) | {{facts.coverage.automated}} | {{facts.coverage.pctAutomated|pct}} |
| Exécutés lors de la dernière campagne | {{facts.coverage.executed}} | — |
| Réussis lors de la dernière campagne | {{facts.coverage.passed}} | {{facts.coverage.pctPassed|pct}} |
| Publiés dans Xray | {{facts.xray.pushed}} | — |

## Matrice

Chaque ligne relie une exigence (récit JIRA) à ses scénarios Gherkin, à ses scripts automatisés, à ses tests Xray et au résultat de la dernière exécution.

| Récit | Intitulé | Risque | Tri | Gherkin | Script(s) | Test(s) Xray | Dernier résultat |
|---|---|---|---|---|---|---|---|
{{#each calc.traceRows}}
| {{this.key}} | {{this.summary}} | {{this.risk}} | {{this.triage}} | {{this.gherkin}} | {{this.specs}} | {{this.xray}} | {{this.result}} |
{{else}}
| — | Aucun récit importé | — | — | — | — | — | — |
{{/each}}

## Écarts de traçabilité

{{#each facts.gaps}}
- {{#if this.storyKey}}**{{this.storyKey}}** — {{/if}}{{this.message}}
{{else}}
Aucun écart : chaque récit « À automatiser » est couvert et chaque script est rattaché à un récit.
{{/each}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
