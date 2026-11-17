# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Organisme | {{profile.organisme}} |
| Produit | {{profile.produit}} |
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

## Objet et domaine d'application

La présente politique fixe les principes de test de **{{profile.organisme}}** pour le produit **{{profile.produit}}**. Elle s'applique à toutes ses versions et évolutions ; la stratégie de test et les plans de test la déclinent.

## Objectifs du test

{{profile.objectifsQualite}}

## Processus de test

Le test suit les processus ISO/IEC/IEEE 29119-2 :

1. **Planification, suivi et contrôle** : plan de test maître, rapports d'avancement, rapport de clôture.
2. **Analyse et conception** : récits JIRA triés selon le risque, conditions de test formalisées en scénarios Gherkin relus.
3. **Implémentation et exécution** : scripts automatisés rattachés aux récits, campagnes tracées et publiées dans Xray.
4. **Gestion des anomalies** : voir ci-dessous.
5. **Clôture** : évaluation des critères de sortie et capitalisation.

{{profile.gestionAnomalies}}

## Organisation et rôles

| Rôle | Nom ou équipe | Responsabilité |
|---|---|---|
{{#each profile.partiesPrenantes}}
| {{this.role}} | {{this.nom}} | {{this.responsabilite|—}} |
{{else}}
| {{profile.partiesPrenantes}} | — | — |
{{/each}}

## Formation des testeurs

{{profile.formationTesteurs}}

## Éthique

{{profile.ethiqueTest}}

## Normes et exigences réglementaires

{{profile.contexteReglementaire}}

Normes et référentiels appliqués : {{profile.normes|join}}.

Les livrables de test sont structurés selon ISO/IEC/IEEE 29119-3 et le glossaire ISTQB.

## Mesure de la valeur du test

Mesures collectées automatiquement (état au {{doc.dataDate|date}}) :

| Indicateur | Valeur |
|---|---|
| Récits du périmètre | {{facts.coverage.stories}} |
| Récits automatisés | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |
| Récits réussis lors de la dernière exécution | {{facts.coverage.passed}} sur {{facts.coverage.executed}} exécutés ({{facts.coverage.pctPassed|pct}}) |
| Campagnes d'exécution enregistrées | {{facts.campaigns|count}} |
| Anomalies détectées / ouvertes | {{calc.defectsCount.total}} / {{calc.defectsCount.ouvertes}} |
| Écarts de traçabilité | {{facts.gaps|count}} |

## Archivage et réutilisation des actifs de test

{{profile.archivageTest}}

## Amélioration du processus

{{profile.ameliorationProcessus}}

## Circuit d'approbation

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
