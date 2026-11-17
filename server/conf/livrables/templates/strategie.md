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
| Confidentialité | {{profile.confidentialite}} |
| Diffusion | {{profile.diffusion|join}} |

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Périmètre

La présente stratégie décline la politique de test de {{profile.organisme}}. Objectifs qualité visés :

{{profile.objectifsQualite}}

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
- Aucune exclusion déclarée.
{{/each}}

Bases de test : {{facts.coverage.stories}} récits du projet {{facts.project.key}}, répartis en {{facts.epics|count}} épopées.

## Gestion des risques

Le test est piloté par les risques. Chaque récit reçoit un score de risque (priorité, épopée, critères d'acceptation, état des scénarios) qui le classe en niveau élevé, moyen ou faible. Les récits à risque élevé sont conçus, automatisés et exécutés en priorité ; les risques produit retenus et leurs mesures figurent au registre du plan de test.

Récits à risque élevé ({{calc.storiesHighRisk|count}}) :

| Récit | Intitulé | Priorité | Score |
|---|---|---|---|
{{#each calc.storiesHighRisk}}
| {{this.key}} | {{this.summary}} | {{this.priority|—}} | {{this.risk.score}} |
{{else}}
| — | Aucun récit à risque élevé | — | — |
{{/each}}

## Niveaux et types de test

- **Niveaux :** {{profile.niveauxTest|join}}
- **Types :** {{profile.typesTest|join}}

{{#if profile.nonFonctionnel}}
**Exigences non fonctionnelles :** {{profile.nonFonctionnel}}
{{/if}}

## Techniques de conception

{{#each profile.techniquesTest}}
- {{this}}
{{else}}
- {{profile.techniquesTest}}
{{/each}}

Les conditions de test sont dérivées des critères d'acceptation ({{facts.coverage.withCriteria}} récits sur {{facts.coverage.stories}} en comportent) et formalisées en scénarios Gherkin : {{facts.gherkin.total}} fichier(s), {{facts.gherkin.scenarios}} scénario(s), dont {{facts.gherkin.validated}} fichier(s) validé(s).

## Indépendance du test

{{profile.independanceTest}}

## Critères de complétude

**Critères d'entrée :**

{{#each profile.criteresEntree}}
- {{this}}
{{else}}
- {{profile.criteresEntree}}
{{/each}}

**Critères de sortie :**

- taux de réussite des tests exécutés ≥ {{profile.seuilReussite}} % ;
- anomalies bloquantes ouvertes ≤ {{profile.maxAnomaliesBloquantes}} ;
- anomalies majeures ouvertes tolérées : {{profile.maxAnomaliesMajeures|sans plafond fixé}} ;
- récits « À automatiser » couverts par un test automatisé ≥ {{profile.couvertureMin}} %.

## Tests de confirmation et de non-régression

{{profile.retestRegression}}

## Automatisation

{{profile.strategieAutomatisation}}

| Indicateur | Valeur |
|---|---|
| Récits triés « À automatiser » / « Plus tard » / « Non retenu » | {{facts.triage.todo}} / {{facts.triage.later}} / {{facts.triage.skip}} |
| Récits non triés | {{facts.triage.untriaged}} |
| Scripts Playwright | {{facts.automation.specs|count}} |
| Parcours explorés validés | {{facts.automation.sessions.validated}} / {{facts.automation.sessions.total}} |
| Récits automatisés | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |

## Données et environnements de test

{{profile.donneesTest}}

Environnements :

{{#each profile.environnements}}
- **{{this.nom}}** ({{this.navigateur|navigateur non précisé}}) : {{this.usage|usage non précisé}}
{{else}}
- {{profile.environnements}}
{{/each}}

Outillage : {{profile.outils|join}}. Versions détectées : {{calc.tools|join}}.

## Gestion des anomalies

{{profile.gestionAnomalies}}

## Métriques

| Métrique | Valeur au {{doc.dataDate|date}} |
|---|---|
| Récits avec critères d'acceptation | {{facts.coverage.withCriteria}} / {{facts.coverage.stories}} |
| Récits couverts par un scénario Gherkin | {{facts.coverage.withGherkin}} / {{facts.coverage.stories}} |
| Écarts de traçabilité détectés | {{facts.gaps|count}} |
| Récits réussis (sur les récits exécutés) | {{facts.coverage.passed}} / {{facts.coverage.executed}} ({{facts.coverage.pctPassed|pct}}) |
| Anomalies ouvertes (bloquantes / majeures / mineures) | {{calc.defectsCount.bloquante}} / {{calc.defectsCount.majeure}} / {{calc.defectsCount.mineure}} |
| Campagnes d'exécution | {{facts.campaigns|count}} |

## Documentation et reporting

Livrables produits : {{calc.docs|join}}. Fréquence des rapports d'avancement : {{profile.frequenceReporting|lower}}.

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
