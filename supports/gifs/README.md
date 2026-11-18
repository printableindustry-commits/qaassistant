# GIF animés — fonctionnalités de Wizard QA

13 GIF de 960 × 646 px, légendés en français. Ils sont enregistrés sur l'application réelle avec les **données de démonstration** (Banque Horizon, application IRMA, personnes fictives). Ils tournent en boucle et se terminent par une pause de 1,5 s.
Pour les refaire, voir `tools/supports/gifs/README.md`.

| GIF | Fonctionnalité | Durée | Taille | Ce qu'on voit |
|---|---|---|---|---|
| `01-connexion-pilotage.gif` | Connexion et Pilotage | 26,7 s | 1,1 Mo | Saisie de demo / demo, puis le Pilotage : indicateurs clés, Parcours QA (du poste installé aux tests reliés à Xray), actions prioritaires et couverture des récits par épopée |
| `02-scan-jira-par-url.gif` | Prise de connaissance (scan JIRA) | 19,5 s | 1,2 Mo | Une URL JIRA collée, d'où l'instance et le projet sont déduits ; le scan du jeu IRMA ; la synthèse (récits, critères, points à clarifier) ; les questions « À clarifier avec le PO » |
| `03-tri-des-recits.gif` | Tri des récits | 21,1 s | 1,2 Mo | Les files À automatiser, Plus tard et Ignoré ; les suggestions motivées des règles ; une décision changée en un clic avec sa raison ; le récit qui rejoint « À automatiser » |
| `04-gherkin.gif` | Scénarios Gherkin | 23,6 s | 2,3 Mo | Les critères d'acceptation du récit P0326-9311 ; la génération des scénarios, puis leur relecture avec contrôle syntaxique en direct ; la validation, prête à l'export `.feature` |
| `05-automatisation-exploration.gif` | Automatisation Playwright | 23,9 s | 2,0 Mo | Le plan de test déduit par l'IA ; l'exploration de l'application de démo dans le navigateur en direct ; « Prenez la main » ; le test généré (étapes et code Playwright) ; le rejeu avant validation |
| `06-envoi-xray.gif` | Envoi dans JIRA / Xray | 23,1 s | 0,8 Mo | La fenêtre d'envoi : aperçu, plan de test facultatif ; l'envoi simulé, avec le ticket Test mis à jour sans doublon, le lien vers le récit et l'ajout au plan |
| `07-campagne-execution.gif` | Campagne d'exécution | 18,8 s | 1,4 Mo | Une campagne simulée suivie en direct ; le résultat de chaque test (réussis, échecs avec leur message) ; les échecs qui deviennent des anomalies (rapports détaillés) |
| `08-livrables-istqb.gif` | Livrables ISTQB | 23,8 s | 2,4 Mo | Les documents rangés selon ISO/IEC/IEEE 29119-3 et générés à partir des données ; la relecture par l'agent (82/100) ; l'approbation par un humain ; l'export en Word (format standard), HTML / PDF ou Markdown |
| `09-informations-projet.gif` | Informations projet | 20,9 s | 1,1 Mo | L'assistant pas à pas : organisation, périmètre, risques produit préremplis, approche, environnements ; chaque réponse alimente les livrables concernés |
| `10-performance-k6.gif` | Performance k6 | 22,8 s | 1,3 Mo | Les profils de charge ; un run lancé en simulation et suivi en direct (utilisateurs virtuels, requêtes/s, p95, erreurs) ; l'historique des runs ; la comparaison A/B qui signale une régression |
| `11-installation-poste.gif` | Installation du poste | 22,1 s | 1,6 Mo | Le choix des stacks (Playwright, Gherkin, k6) ; le plan « Installer tout » ; l'installation simulée composant par composant, avec son journal en direct |
| `12-assistant-ia.gif` | Assistant IA | 21,4 s | 1,4 Mo | L'ordre de priorité des fournisseurs (Copilot local, Copilot CLI, API, copier-coller) ; la procédure « Brancher Copilot local » ; le bac à sable ; le mode copier-coller quand aucun fournisseur n'est branché |
| `13-visite-guidee.gif` | Visite guidée | 20,6 s | 2,2 Mo | La visite accélérée, de 13 étapes sur les 25 : Pilotage, Parcours QA, une URL JIRA suffit, tri, plan de test IA, Prenez la main, test généré, documents ISTQB, relecture, Performance k6, Assistant IA, puis « À vous de jouer » |

Total : 13 GIF, environ 20 Mo. Chaque GIF fait au plus 2,5 Mo et dure entre 18 et 27 s.
Les données sont 100 % fictives. Le modèle Word de l'entreprise n'est jamais utilisé : l'export Word se fait au format standard.
