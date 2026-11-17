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

Anomalies dérivées des échecs de test des campagnes d'exécution, une par test en échec. Seuils de clôture fixés par le plan de test : au plus {{profile.maxAnomaliesBloquantes}} anomalie(s) bloquante(s) et {{profile.maxAnomaliesMajeures|non fixé}} majeure(s) ouvertes.

| Sévérité | Ouvertes |
|---|---|
| Bloquante | {{calc.defectsCount.bloquante}} |
| Majeure | {{calc.defectsCount.majeure}} |
| Mineure | {{calc.defectsCount.mineure}} |
| **Total ouvertes** | **{{calc.defectsCount.ouvertes}}** |
| Corrigées | {{calc.defectsClosed|count}} |

## Rapports détaillés

{{#each facts.defects}}
### {{this.id}} — {{this.title}}

| Rubrique | Valeur |
|---|---|
| Identifiant | {{this.id}} |
| Version testée | {{profile.versionProduit}} |
| Récit concerné | {{this.storyKey|non rattaché}} |
| Test en échec | {{this.testTitle}} |
| Fichier de test | {{this.file|—}} |
| Environnement (dernière campagne) | {{facts.lastCampaign.env.baseUrl|—}} ({{facts.lastCampaign.env.browser|—}}) |
| Origine | {{#if this.simulated}}campagne simulée{{else}}campagne réelle{{/if}} |
| Sévérité | {{this.severity}} |
| Priorité | {{profile.prioriteAnomalies}} |
| État | {{this.status}} |
| Première / dernière détection | {{this.firstSeen|datetime}} / {{this.lastSeen|datetime}} |
| Occurrences | {{this.occurrences}} |

**Reproduction :** sur l'environnement indiqué, exécuter le test « {{this.testTitle}} » du fichier {{this.file|—}}.

**Résultat attendu :** comportement décrit par les critères d'acceptation du récit {{this.storyKey|concerné}} et par son scénario Gherkin.

**Résultat obtenu :** {{this.error|aucun message d'erreur enregistré}}

**Impact :** fonctionnalité du récit {{this.storyKey|concerné}} non conforme ; sévérité « {{this.severity}} » au sens du processus ci-dessous.

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
