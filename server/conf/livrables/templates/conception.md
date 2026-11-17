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

## Bases de test

Les bases de test sont les récits utilisateur du projet JIRA **{{facts.project.key}}** ({{facts.project.jiraBaseUrl|—}}), importés le {{facts.project.scanAt|datetime}}, et leurs critères d'acceptation : {{facts.coverage.stories}} récits, dont {{facts.coverage.withCriteria}} avec critères d'acceptation.

| Récit | Intitulé | Épopée | Priorité | Critères | Risque | Tri |
|---|---|---|---|---|---|---|
{{#each calc.traceRows}}
| {{this.key}} | {{this.summary}} | {{this.epic}} | {{this.priority|—}} | {{this.criteria}} | {{this.risk}} | {{this.triage}} |
{{/each}}

## Conditions de test

Chaque critère d'acceptation d'un récit retenu constitue une condition de test. Les récits marqués « à clarifier » sont signalés : leurs conditions doivent être confirmées avec le métier avant conception.

| Récit | Conditions (critères d'acceptation) | À clarifier |
|---|---|---|
{{#each facts.stories}}
| {{this.key}} | {{this.criteriaCount}} | {{this.toClarify|ouinon}} |
{{/each}}

## Cas de test

Les cas de test sont formalisés en scénarios Gherkin (Étant donné / Quand / Alors), relus puis validés : {{facts.gherkin.total}} fichier(s), {{facts.gherkin.scenarios}} scénario(s), {{facts.gherkin.validated}} validé(s), {{facts.gherkin.draft}} brouillon(s), {{facts.gherkin.exported}} exporté(s) dans le projet de test.

| Récit | Intitulé | État Gherkin | Scénarios | Fichier exporté |
|---|---|---|---|---|
{{#each calc.storiesWithGherkin}}
| {{this.key}} | {{this.summary}} | {{this.gherkin.status}} | {{this.gherkin.scenarios}} | {{this.gherkin.exportedPath|—}} |
{{else}}
| — | Aucun scénario Gherkin rédigé à ce jour | — | — | — |
{{/each}}

## Techniques appliquées

{{#each profile.techniquesTest}}
- {{this}}
{{else}}
- Tests basés sur les critères d'acceptation (ATDD / BDD) ; partitions d'équivalence et valeurs limites pour les règles de gestion.
{{/each}}

## Récits non couverts

{{#each calc.storiesUncovered}}
- **{{this.key}}** — {{this.summary}} : Gherkin {{this.gherkin}}, scripts {{this.specs}}.
{{else}}
Tous les récits triés « À automatiser » disposent d'un scénario et d'un test automatisé.
{{/each}}

{{#if facts.triage.untriaged}}
{{facts.triage.untriaged}} récit(s) ne sont pas encore triés : leur traitement (automatisation, test manuel ou exclusion) reste à décider.
{{/if}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
