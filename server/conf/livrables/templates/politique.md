# {{doc.title}}

| Rubrique | Valeur |
|---|---|
| Projet | {{facts.project.name}} ({{facts.project.key}}) |
| Organisme | {{profile.organisation}} |
| Produit | {{profile.produit}} |
| Référence normative | {{doc.ref}} |
| Version du document | {{doc.version}} |
| Date | {{doc.date|date}} |
| Statut | {{doc.status}} |
| Auteur | {{doc.author}} |
| Relu par | {{doc.reviewedBy|En attente de relecture}} |
| Approuvé par | {{doc.approvedBy|En attente d'approbation}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Objet et domaine d'application

La présente politique définit les principes et objectifs de test retenus par **{{profile.organisation}}** pour le produit **{{profile.produit}}**. Elle s'impose à tous les projets et évolutions de ce produit et sert de référence à la stratégie de test et aux plans de test.

Elle couvre les activités de test fonctionnel, de non-régression et, lorsque c'est pertinent, de performance, qu'elles soient manuelles ou automatisées.

## Objectifs du test

{{#if profile.objectifsTest}}
{{profile.objectifsTest}}
{{else}}
Les tests visent à :

- vérifier que chaque exigence (récit utilisateur) est satisfaite au regard de ses critères d'acceptation ;
- réduire le niveau de risque produit à un niveau acceptable avant chaque mise en production ;
- fournir aux décideurs une information objective, fondée sur des résultats d'exécution réels ;
- détecter les anomalies au plus tôt et prévenir leur réapparition par la non-régression automatisée.
{{/if}}

Indicateurs suivis en continu (état au {{doc.dataDate|date}}) :

| Indicateur | Valeur |
|---|---|
| Récits du périmètre | {{facts.coverage.stories}} |
| Récits avec critères d'acceptation | {{facts.coverage.withCriteria}} |
| Récits couverts par un scénario Gherkin | {{facts.coverage.withGherkin}} |
| Récits automatisés | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |
| Récits réussis lors de la dernière exécution | {{facts.coverage.passed}} ({{facts.coverage.pctPassed|pct}}) |

## Processus de test

Le processus de test suit le modèle ISTQB / ISO/IEC/IEEE 29119-2 :

1. **Planification et pilotage** : plan de test maître, suivi par rapports d'avancement.
2. **Analyse** : récits JIRA importés, triés selon le risque (À automatiser / Plus tard / Non retenu).
3. **Conception** : conditions et cas de test formalisés en scénarios Gherkin, relus et validés.
4. **Implémentation** : scripts automatisés Playwright (et k6 pour la performance), rattachés aux récits.
5. **Exécution** : campagnes d'exécution tracées dans le journal d'exécution, résultats publiés dans Xray.
6. **Clôture** : évaluation des critères de sortie, rapport de clôture, capitalisation.

Outillage de référence : {{calc.tools|join}}.

## Organisation et rôles

| Rôle | Titulaire |
|---|---|
| Responsable des tests | {{profile.responsableTest}} |
| Testeurs | {{profile.testeurs|join}} |
| Valideur (approbation des livrables) | {{profile.valideur}} |

{{#if profile.partiesPrenantes}}
Parties prenantes :

| Rôle | Nom | Responsabilités |
|---|---|---|
{{#each profile.partiesPrenantes}}
| {{this.role}} | {{this.nom}} | {{this.responsabilites|—}} |
{{/each}}
{{/if}}

## Normes et exigences réglementaires

{{profile.contexteReglementaire}}

{{#if profile.normes}}
Normes et référentiels appliqués :

{{#each profile.normes}}
- {{this}}
{{/each}}
{{/if}}

Les livrables de test sont structurés selon ISO/IEC/IEEE 29119-3 et le glossaire ISTQB ; ils sont régénérés à partir des données réelles de test et approuvés selon le circuit de validation défini dans la stratégie.

## Mesure et amélioration du processus

Les mesures suivantes sont collectées automatiquement et revues à chaque clôture : couverture des récits par des tests automatisés, taux de réussite des campagnes ({{facts.campaigns|count}} campagne(s) enregistrée(s)), anomalies détectées ({{calc.defectsCount.total}}) et écarts de traçabilité ({{facts.gaps|count}}). Les enseignements de chaque rapport de clôture alimentent la révision annuelle de cette politique.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
