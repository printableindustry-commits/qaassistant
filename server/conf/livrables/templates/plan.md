# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Produit / version | {{profile.produit}} {{profile.versionProduit}} |
| Organisme | {{profile.organisation}} |
| Référence normative | {{doc.ref}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Contexte du test

Ce plan de test maître couvre la version **{{profile.versionProduit}}** du produit **{{profile.produit}}** (projet JIRA {{facts.project.key}}). Il applique la stratégie de test et la politique de test de {{profile.organisation}}.

{{profile.contexteReglementaire|}}

**Niveaux de test :** {{profile.niveauxTest|join}} — **Types de test :** {{profile.typesTest|join}}

## Éléments de test

{{facts.coverage.stories}} récits répartis en {{facts.epics|count}} épopées constituent les bases de test ; le tri par risque détermine leur traitement :

| Épopée | Intitulé | Récits |
|---|---|---|
{{#each facts.epics}}
| {{this.key}} | {{this.summary}} | {{this.stories}} |
{{/each}}

| Décision de tri | Récits |
|---|---|
| À automatiser | {{facts.triage.todo}} |
| Plus tard | {{facts.triage.later}} |
| Non retenu | {{facts.triage.skip}} |
| Non trié | {{facts.triage.untriaged}} |

**Hors périmètre :** {{profile.horsPerimetre|join}}

## Registre des risques

Risques produit issus de l'analyse des récits (niveau élevé) :

| Récit | Intitulé | Priorité | Score | Traitement |
|---|---|---|---|---|
{{#each calc.storiesHighRisk}}
| {{this.key}} | {{this.summary}} | {{this.priority}} | {{this.risk.score}} | {{this.triageLabel}} |
{{else}}
| — | Aucun récit à risque élevé | — | — | — |
{{/each}}

{{#if profile.risquesProduit}}
Risques complémentaires (produit et projet) :

| Risque | Probabilité | Impact | Mesure de réduction |
|---|---|---|---|
{{#each profile.risquesProduit}}
| {{this.risque}} | {{this.probabilite|—}} | {{this.impact|—}} | {{this.mesure|—}} |
{{/each}}
{{/if}}

## Approche de test

{{profile.approcheAutomatisation|Les récits à risque élevé et les récits triés « À automatiser » sont couverts par des scénarios Gherkin validés puis par des scripts Playwright exécutés en campagne. Les autres récits sont testés manuellement ou reportés.}}

Techniques de conception : {{profile.techniquesTest|join}}.

État de préparation au {{doc.dataDate|date}} : {{facts.gherkin.validated}} Gherkin validé(s) sur {{facts.gherkin.total}}, {{facts.automation.specs|count}} script(s) Playwright, {{facts.coverage.automated}} récit(s) automatisé(s) ({{facts.coverage.pctAutomated|pct}}).

{{#if profile.nonFonctionnel}}
Tests non fonctionnels : {{profile.nonFonctionnel}}
{{/if}}

## Critères d'achèvement

| Critère | Cible |
|---|---|
| Taux de réussite des tests exécutés | ≥ {{profile.seuilReussite}} % |
| Anomalies bloquantes ouvertes | ≤ {{profile.anomaliesBloquantesMax|0}} |
| Couverture des récits « À automatiser » | ≥ {{profile.seuilCouverture|100}} % |

Critères d'entrée : {{profile.criteresEntree|join}}

## Critères de suspension et de reprise

- **Suspension :** {{profile.criteresSuspension|environnement indisponible, anomalie bloquante empêchant la poursuite des tests ou version non conforme aux critères d'entrée.}}
- **Reprise :** {{profile.criteresReprise|correction livrée et vérifiée, environnement rétabli ; les tests interrompus sont rejoués intégralement.}}

## Rôles et responsabilités

| Rôle | Titulaire |
|---|---|
| Responsable des tests | {{profile.responsableTest}} |
| Testeurs | {{profile.testeurs|join}} |
| Valideur | {{profile.valideur}} |

## Calendrier

| Jalon | Date | Responsable |
|---|---|---|
{{#each profile.jalons}}
| {{this.jalon}} | {{this.date|date}} | {{this.responsable|—}} |
{{else}}
| {{profile.jalons}} | — | — |
{{/each}}

## Livrables de test

| Livrable | Référence | État | Version |
|---|---|---|---|
{{#each calc.docs}}
| {{this.title}} | {{this.ref}} | {{this.status}} | {{this.version}} |
{{/each}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
