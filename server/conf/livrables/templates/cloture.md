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

> Données au {{doc.dataDate|datetime}} — source : {{doc.dataSource}}.{{#if doc.demo}} **Données de démonstration.**{{/if}}

## Synthèse et recommandation

Ce rapport clôt les tests de la version **{{profile.versionProduit}}** de **{{profile.produit}}**. Critères de sortie : **{{calc.exitLabel}}**. Anomalies ouvertes : **{{calc.defectsCount.ouvertes}}** (dont {{calc.defectsCount.bloquante}} bloquante(s)).

{{#if facts.lastCampaign.simulated}}
La campagne de référence est **simulée** : ses résultats ne constituent pas une preuve d'exécution et doivent être confirmés par une campagne réelle avant toute décision.
{{/if}}

{{calc.recommendation}}

Décision du valideur ({{profile.valideur}}) : ☐ Mise en production acceptée ☐ Acceptée avec réserves ☐ Refusée

## Tests réalisés et métriques finales

{{#if facts.lastCampaign}}
Campagne de référence : **{{facts.lastCampaign.id}}** du {{facts.lastCampaign.at|datetime}}{{#if facts.lastCampaign.simulated}} (simulée){{/if}}, environnement {{facts.lastCampaign.env.baseUrl|—}} ({{facts.lastCampaign.env.browser|—}}), durée {{facts.lastCampaign.durationMs|duree}}.

| Total | Réussis | Échecs | Ignorés | Instables | Taux de réussite |
|---|---|---|---|---|---|
| {{facts.lastCampaign.total}} | {{facts.lastCampaign.passed}} | {{facts.lastCampaign.failed}} | {{facts.lastCampaign.skipped}} | {{facts.lastCampaign.flaky|0}} | {{calc.passRate|pct}} |
{{else}}
Aucune campagne d'exécution enregistrée.
{{/if}}

| Indicateur | Valeur |
|---|---|
| Campagnes exécutées | {{facts.campaigns|count}} (dont {{calc.campaignsReal}} réelle(s)) |
| Récits dans le périmètre | {{facts.coverage.stories}} |
| Récits avec scénario Gherkin | {{facts.coverage.withGherkin}} |
| Récits automatisés | {{facts.coverage.automated}} ({{facts.coverage.pctAutomated|pct}}) |
| Récits exécutés / réussis | {{facts.coverage.executed}} / {{facts.coverage.passed}} ({{facts.coverage.pctPassed|pct}}) |
| Anomalies détectées / ouvertes | {{calc.defectsCount.total}} / {{calc.defectsCount.ouvertes}} |
{{#if facts.perf.last}}
| Performance (dernier tir k6) | {{facts.perf.last.profile}} du {{facts.perf.last.at|date}} : verdict k6 « {{facts.perf.last.verdict}} », p95 {{facts.perf.last.p95}} ms, taux d'erreur {{facts.perf.last.errorRate}} |
{{/if}}

## Évaluation des critères de sortie

| Critère | Cible | Mesuré | Évaluation |
|---|---|---|---|
{{#each calc.exit}}
| {{this.critere}} | {{this.cible}} | {{this.mesure}} | **{{this.statut}}** |
{{else}}
| Aucun critère évaluable | — | — | — |
{{/each}}

Seuils fixés par le plan de test : taux de réussite ≥ {{profile.seuilReussite}} %, anomalies bloquantes ouvertes ≤ {{profile.maxAnomaliesBloquantes}}, anomalies majeures ouvertes ≤ {{profile.maxAnomaliesMajeures|non fixé}}, couverture des récits « À automatiser » ≥ {{profile.couvertureMin}} %.

## Écarts par rapport au plan

{{#each calc.storiesUncovered}}
- Récit **{{this.key}}** ({{this.summary}}) prévu « À automatiser » : Gherkin {{this.gherkin}}, scripts {{this.specs}}.
{{/each}}
{{#each facts.gaps}}
- {{this.message}}
{{else}}
- Aucun écart de traçabilité détecté.
{{/each}}
{{#if facts.triage.untriaged}}
- {{facts.triage.untriaged}} récit(s) non trié(s) en fin de campagne.
{{/if}}

Éléments exclus du périmètre (non testés) :

{{#each profile.horsPerimetre}}
- {{this}}
{{else}}
- Aucun.
{{/each}}

## Anomalies ouvertes

| Anomalie | Sévérité | Récit | Occurrences | Dernière détection |
|---|---|---|---|---|
{{#each calc.defectsOpen}}
| {{this.id}} — {{this.title}} | {{this.severity}} | {{this.storyKey|—}} | {{this.occurrences}} | {{this.lastSeen|date}} |
{{else}}
| Aucune anomalie ouverte | — | — | — | — |
{{/each}}

Anomalies corrigées pendant la campagne : {{calc.defectsClosed|count}}. Détail : document « Rapports d'anomalies ».

## Risques résiduels

| Risque | Niveau | Mesure de test |
|---|---|---|
{{#each profile.risquesProduit}}
| {{this.risque}} | {{this.niveau}} | {{this.attenuation}} |
{{else}}
| {{profile.risquesProduit}} | — | — |
{{/each}}

{{profile.risquesResiduels}}

## Livrables produits

| Document | Référence | Version | Statut |
|---|---|---|---|
{{#each calc.docs}}
| {{this.title}} | {{this.ref}} | {{this.version}} | {{this.status}} |
{{/each}}

## Leçons apprises

{{profile.leconsApprises}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
