# Données de démonstration : 100 % fictives

Toutes les données de démonstration livrées avec Wizard QA sont **inventées**. Elles ne décrivent aucune personne,
entreprise, entité interne ni application réelle.

| Élément | Valeur fictive |
|---|---|
| Organisme | « Banque Horizon » (Direction des Risques) |
| Équipe | « Squad Qualité Risques » (tribu « Banque Horizon — Tribu Risques ») |
| Produit testé | « IRMA – Analyse des Risques Métier » (code produit P0326), application de démo servie par le portail sous `/demo-app/` |
| Entités | Horizon Paris, Horizon Lyon, Horizon Marseille |
| Personnes | Claire FONTAINE (PO), Hugo LAMBERT, Léa ROUSSEL, Bastien GIRARD, Nadia PERRIN, Inès CARON, Mathis BLANC, Olivier MERCIER, Julien ROCHE, Alex MARTIN, Camille DUBOIS |
| JIRA | `https://jira.demo.irma.local` (domaine local non résolu) ; clés de test simulées `P0326-T<n>`, plan `P0326-10528` |
| Comptes de l'application de démo | `agent` / `agent-demo-2026`, `gestionnaire` / `gestion-demo-2026` (publics, sans valeur) |

Seule exception : « Rémy VERGER » est le nom de l'utilisateur de l'application (compte `demo`), conservé volontairement.

Fichiers concernés : `server/conf/demo/irma-jira.json`, `server/conf/livrables/demo-profile.json`, `server/demo-app/`,
`server/lib/demo-defaults.mjs`, `server/lib/explore/targets.mjs` (comptes de démo) et le jeu chargé par
`server/lib/demo/seed.mjs`. Les envois Xray, campagnes d'exécution et runs k6 de la démo sont **simulés** (marqués ◇) :
rien n'est envoyé vers JIRA, Xray ou k6.

Toute ressemblance avec des personnes ou organisations existantes serait fortuite. Si vous ajoutez des données de
démonstration, gardez cette règle : noms au format Prénom NOM inventés, organisme « Banque Horizon », aucune donnée réelle.

Les captures `server/conf/demo/captures/*.jpg` montrent l’application de démonstration IRMA (fictive, servie par `/demo-app/`) : elles alimentent le cadre « Navigateur en direct » des deux sessions d’automatisation de la démo.
