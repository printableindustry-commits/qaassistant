# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit|}} |
| Organisme | {{profile.organisme}} |
| Référence normative | {{doc.ref}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Périmètre

**Dans le périmètre :**

{{#each profile.dansPerimetre}}
- {{this}}
{{else}}
- {{profile.dansPerimetre}}
{{/each}}

**Hors périmètre :**

{{#each profile.horsPerimetre}}
- {{this}}
{{else}}
- {{profile.horsPerimetre|Aucune exclusion déclarée.}}
{{/each}}

Le périmètre fonctionnel est constitué des {{facts.coverage.stories}} récits du projet {{facts.project.key}}, regroupés en {{facts.epics|count}} épopées :

| Épopée | Intitulé | Récits |
|---|---|---|
{{#each facts.epics}}
| {{this.key}} | {{this.summary}} | {{this.stories}} |
{{/each}}

## Analyse des risques produit

Le niveau de risque de chaque récit est évalué à partir de sa priorité, de son épopée et de ses critères d'acceptation (score de 0 à 100). Les récits à risque **élevé** sont testés en priorité et automatisés.

| Récit | Intitulé | Score | Niveau |
|---|---|---|---|
{{#each calc.storiesHighRisk}}
| {{this.key}} | {{this.summary}} | {{this.risk.score}} | {{this.risk.level}} |
{{else}}
| — | Aucun récit à risque élevé | — | — |
{{/each}}

{{#if profile.risquesProduit}}
Risques produit complémentaires identifiés par l'équipe :

| Risque | Probabilité | Impact | Mesure de réduction |
|---|---|---|---|
{{#each profile.risquesProduit}}
| {{this.risque}} | {{this.probabilite|—}} | {{this.impact|—}} | {{this.mesure|—}} |
{{/each}}
{{/if}}

## Niveaux et types de test

**Niveaux de test :** {{profile.niveauxTest|join}}

**Types de test :** {{profile.typesTest|join}}

{{#if profile.nonFonctionnel}}
**Exigences non fonctionnelles :** {{profile.nonFonctionnel}}
{{/if}}

## Techniques de conception

{{#each profile.techniquesTest}}
- {{this}}
{{else}}
- {{profile.techniquesTest}}
{{/each}}

Les conditions de test sont dérivées des critères d'acceptation des récits ({{facts.coverage.withCriteria}} récits sur {{facts.coverage.stories}} en comportent) et formalisées en scénarios Gherkin (Étant donné / Quand / Alors) : {{facts.gherkin.total}} fichier(s), {{facts.gherkin.scenarios}} scénario(s), dont {{facts.gherkin.validated}} validé(s).

## Automatisation

{{profile.approcheAutomatisation|Les récits triés « À automatiser » sont couverts par des scripts Playwright générés et relus, exécutés en campagne et rattachés à des tests Xray.}}

| Indicateur | Valeur |
|---|---|
| Récits triés « À automatiser » | {{facts.triage.todo}} |
| Récits « Plus tard » / « Non retenu » | {{facts.triage.later}} / {{facts.triage.skip}} |
| Récits non triés | {{facts.triage.untriaged}} |
| Scripts Playwright | {{facts.automation.specs|count}} |
| Sessions d'exploration validées | {{facts.automation.sessions.validated}} / {{facts.automation.sessions.total}} |
| Récits automatisés | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |

## Environnements et outillage

{{#if profile.environnements}}
| Environnement | URL | Navigateur | Données |
|---|---|---|---|
{{#each profile.environnements}}
| {{this.nom}} | {{this.url|—}} | {{this.navigateur|—}} | {{this.donnees|—}} |
{{/each}}
{{else}}
| Cible | URL | Navigateur | Comptes de test |
|---|---|---|---|
{{#each facts.automation.targets}}
| {{this.name}} | {{this.baseUrl}} | {{this.browser}} | {{this.accounts}} |
{{else}}
| {{profile.environnements}} | — | — | — |
{{/each}}
{{/if}}

Outillage : {{calc.tools|join}}.

## Critères d'entrée et de sortie

**Critères d'entrée :**

{{#each profile.criteresEntree}}
- {{this}}
{{else}}
- {{profile.criteresEntree|Version livrée sur l'environnement de test et récits du périmètre triés.}}
{{/each}}

**Critères de sortie :**

- taux de réussite des tests exécutés ≥ {{profile.seuilReussite}} % ;
- anomalies bloquantes ouvertes ≤ {{profile.anomaliesBloquantesMax|0}} ;
- récits « À automatiser » couverts par un test automatisé ≥ {{profile.seuilCouverture|100}} %.

## Gestion des anomalies

Les anomalies sont dérivées des échecs des campagnes d'exécution, regroupées par test, qualifiées (bloquante, majeure, mineure) et suivies jusqu'à correction. {{profile.processusAnomalies|Chaque anomalie bloquante ou majeure est remontée dans JIRA et rattachée au récit concerné.}}

## Livrables de test

| Livrable | Référence | État | Version |
|---|---|---|---|
{{#each calc.docs}}
| {{this.title}} | {{this.ref}} | {{this.status}} | {{this.version}} |
{{/each}}

Circuit de validation : {{profile.circuitValidation|rédaction par l'équipe de test, relecture par l'agent QA, approbation par le valideur.}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
