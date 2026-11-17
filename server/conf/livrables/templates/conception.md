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

Récits utilisateur du projet JIRA **{{facts.project.key}}** ({{facts.project.jiraBaseUrl|—}}), importés le {{facts.project.scanAt|datetime}}, et leurs critères d'acceptation : {{facts.coverage.stories}} récit(s), dont {{facts.coverage.withCriteria}} avec critères d'acceptation. Toute évolution d'un récit dans JIRA impose la mise à jour des conditions et des cas de test qui en dérivent.

## Ensembles de fonctionnalités

| Épopée | Intitulé | Récits |
|---|---|---|
{{#each facts.epics}}
| {{this.key}} | {{this.summary}} | {{this.stories}} |
{{else}}
| — | Aucune épopée importée | — |
{{/each}}

## Conditions de test

Chaque critère d'acceptation d'un récit constitue une condition de test ; sa priorité découle du niveau de risque du récit. Une condition « à clarifier » doit être confirmée par le Product Owner avant la conception des cas.

| Récit | Intitulé | Priorité | Risque | Conditions | À clarifier |
|---|---|---|---|---|---|
{{#each facts.stories}}
| {{this.key}} | {{this.summary}} | {{this.priority|—}} | {{this.risk.level}} | {{this.criteriaCount}} | {{this.toClarify|ouinon}} |
{{else}}
| — | Aucun récit importé | — | — | — | — |
{{/each}}

## Éléments de couverture

L'élément de couverture est le critère d'acceptation : chacun doit être vérifié par au moins un scénario Gherkin. Les techniques de conception ci-dessous servent à décliner un critère en plusieurs scénarios (classes valides et invalides, bornes, transitions).

{{#each profile.techniquesTest}}
- {{this}}
{{else}}
- {{profile.techniquesTest}}
{{/each}}

## Cas de test

Un cas de test est un scénario Gherkin, identifié par le récit et le titre du scénario :

- **préconditions** : étapes « Étant donné » et bloc « Contexte » ;
- **entrées et actions** : étapes « Quand » et, le cas échéant, tableau « Exemples » ;
- **résultats attendus** : étapes « Alors ».

Le fichier `.feature` référencé fait partie intégrante de la présente spécification. État : {{facts.gherkin.total}} fichier(s), {{facts.gherkin.scenarios}} scénario(s), {{facts.gherkin.validated}} validé(s), {{facts.gherkin.draft}} brouillon(s), {{facts.gherkin.exported}} exporté(s) dans le projet de test.

| Récit | Intitulé | Critères | Scénarios | Fichier |
|---|---|---|---|---|
{{#each calc.storiesWithGherkin}}
| {{this.key}} | {{this.summary}} | {{this.criteriaCount}} | {{this.gherkin.scenarios}} | {{this.gherkin.exportedPath|non exporté}} |
{{else}}
| — | Aucun scénario Gherkin rédigé à ce jour | — | — | — |
{{/each}}

## Récits non couverts

{{#each calc.storiesUncovered}}
- **{{this.key}}** — {{this.summary}} : Gherkin {{this.gherkin}}, scripts {{this.specs}}.
{{else}}
{{#if facts.triage.todo}}
Tous les récits triés « À automatiser » disposent d'un scénario et d'un test automatisé.
{{else}}
Aucun récit n'est encore trié « À automatiser ».
{{/if}}
{{/each}}

Récits sans critère d'acceptation (conditions non dérivables) :
{{#each facts.stories}}
{{#unless this.criteriaCount}}
- **{{this.key}}** — {{this.summary}}
{{/unless}}
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
