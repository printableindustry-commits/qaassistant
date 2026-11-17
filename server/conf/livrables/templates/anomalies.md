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

## Synthèse des anomalies

Anomalies dérivées des échecs de test des campagnes d'exécution (regroupées par test). Seuils fixés par le plan de test : au plus {{profile.maxAnomaliesBloquantes|0}} anomalie(s) bloquante(s) et {{profile.maxAnomaliesMajeures|—}} majeure(s) à la clôture.

Nombre d'anomalies recensées : **{{facts.defects|count}}**.

## Rapports détaillés

{{#each facts.defects}}
### {{this.id}} — {{this.title}}

| Rubrique | Valeur |
|---|---|
| Récit concerné | {{this.storyKey|—}} |
| Test en échec | {{this.testTitle}} ({{this.file|—}}) |
| Sévérité | {{this.severity}} |
| État | {{this.status}} |
| Première détection | {{this.firstSeen|datetime}} |
| Dernière détection | {{this.lastSeen|datetime}} |
| Occurrences | {{this.occurrences}} |

**Résultat observé :** {{this.error|—}}

**Résultat attendu :** comportement décrit par les critères d'acceptation du récit {{this.storyKey|—}}.

{{else}}
Aucune anomalie détectée par les campagnes d'exécution.
{{/each}}

## Processus de traitement

{{profile.gestionAnomalies}}

## Historique des versions

| Version | Date | Auteur | Nature |
|---|---|---|---|
{{#each doc.history}}
| {{this.n}} | {{this.date|datetime}} | {{this.by}} | {{this.kind}} |
{{/each}}
