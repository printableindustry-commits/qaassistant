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
| Confidentialité | {{profile.confidentialite}} |
| Diffusion | {{profile.diffusion|join}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Contexte

Ce plan de test maître couvre la version **{{profile.versionProduit}}** du produit **{{profile.produit}}** (projet JIRA {{facts.project.key}}). Il applique la politique et la stratégie de test de {{profile.organisme}}.

{{profile.contexteReglementaire}}

### Éléments de test

{{facts.coverage.stories}} récits répartis en {{facts.epics|count}} épopées :

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

**Hors périmètre :**

{{#each profile.horsPerimetre}}
- {{this}}
{{else}}
- Aucune exclusion déclarée.
{{/each}}

## Hypothèses et contraintes

**Hypothèses et dépendances :** {{profile.hypotheses}}

**Contraintes :** {{profile.contraintesProjet}}

## Parties prenantes

| Rôle | Nom ou équipe | Responsabilité |
|---|---|---|
{{#each profile.partiesPrenantes}}
| {{this.role}} | {{this.nom}} | {{this.responsabilite|—}} |
{{else}}
| {{profile.partiesPrenantes}} | — | — |
{{/each}}

## Communication

Rapports d'avancement : fréquence {{profile.frequenceReporting|lower}}, adressés à : {{profile.diffusion|join}}. Les anomalies bloquantes sont signalées sans attendre le rapport suivant, selon le processus de la stratégie de test.

## Registre des risques

L'analyse automatique classe {{calc.storiesHighRisk|count}} récit(s) en risque élevé (détail dans la stratégie de test).

**Risques produit :**

| Risque | Récit / épopée | Probabilité | Impact | Niveau | Mesure de test |
|---|---|---|---|---|---|
{{#each profile.risquesProduit}}
| {{this.risque}} | {{this.source|—}} | {{this.probabilite|—}} | {{this.impact|—}} | {{this.niveau|—}} | {{this.attenuation|—}} |
{{else}}
| {{profile.risquesProduit}} | — | — | — | — | — |
{{/each}}

**Risques projet :**

| Risque | Impact | Mesure |
|---|---|---|
{{#each profile.risquesProjet}}
| {{this.risque}} | {{this.impact|—}} | {{this.attenuation|—}} |
{{else}}
| {{profile.risquesProjet}} | — | — |
{{/each}}

## Stratégie de test appliquée

- **Niveaux :** {{profile.niveauxTest|join}}
- **Types :** {{profile.typesTest|join}}
- **Techniques :** {{profile.techniquesTest|join}}

{{profile.strategieAutomatisation}}

{{#if profile.nonFonctionnel}}
**Non fonctionnel :** {{profile.nonFonctionnel}}
{{/if}}

État de préparation au {{doc.dataDate|date}} : {{facts.gherkin.validated}} fichier(s) Gherkin validé(s) sur {{facts.gherkin.total}}, {{facts.automation.specs|count}} script(s) Playwright, {{facts.coverage.automated}} récit(s) automatisé(s) ({{facts.coverage.pctAutomated|pct}}).

## Critères d'entrée et de sortie

**Critères d'entrée :**

{{#each profile.criteresEntree}}
- {{this}}
{{else}}
- {{profile.criteresEntree}}
{{/each}}

**Critères de sortie :**

| Critère | Cible |
|---|---|
| Taux de réussite des tests exécutés | ≥ {{profile.seuilReussite}} % |
| Anomalies bloquantes ouvertes | ≤ {{profile.maxAnomaliesBloquantes}} |
| Anomalies majeures ouvertes | ≤ {{profile.maxAnomaliesMajeures|sans plafond fixé}} |
| Couverture des récits « À automatiser » | ≥ {{profile.couvertureMin}} % |

## Critères de suspension et de reprise

**Suspension :** {{profile.criteresSuspension}}

**Reprise :** {{profile.criteresReprise}}

## Environnement et données de test

| Environnement | Adresse | Navigateur | Comptes | Usage |
|---|---|---|---|---|
{{#each profile.environnements}}
| {{this.nom}} | {{this.url|—}} | {{this.navigateur|—}} | {{this.comptes|—}} | {{this.usage|—}} |
{{else}}
| {{profile.environnements}} | — | — | — | — |
{{/each}}

{{profile.donneesTest}}

Outillage : {{profile.outils|join}}.

## Livrables de test

| Livrable | Référence | État | Version |
|---|---|---|---|
{{#each calc.docs}}
| {{this.title}} | {{this.ref}} | {{this.status}} | {{this.version}} |
{{/each}}

## Calendrier

| Jalon | Échéance | Livrable attendu |
|---|---|---|
{{#each profile.jalons}}
| {{this.jalon}} | {{this.date|—}} | {{this.livrable|—}} |
{{else}}
| {{profile.jalons}} | — | — |
{{/each}}

## Rôles et responsabilités

| Rôle | Titulaire |
|---|---|
| Responsable des tests | {{profile.responsableTest}} |
| Testeurs | {{profile.testeurs|join}} |
| Valideur | {{profile.valideur}} |

## Besoins en formation

{{profile.besoinsFormation}}

## Approbations

| Document | Rédacteur | Relecteur | Approbateur |
|---|---|---|---|
{{#each profile.circuitValidation}}
| {{this.document}} | {{this.redacteur|—}} | {{this.relecteur|—}} | {{this.approbateur|—}} |
{{else}}
| {{profile.circuitValidation}} | — | — | — |
{{/each}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
