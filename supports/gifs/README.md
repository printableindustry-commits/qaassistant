# GIF animés — fonctionnalités de Wizard QA

13 GIF de 960 × 646 px, légendés en français. Ils sont enregistrés sur l'application réelle avec les **données de démonstration** (Banque Horizon, application IRMA, personnes fictives). Chaque action est **entourée en rouge** (cadre arrondi, pastille numérotée, étiquette « Étape n — … » reprise dans la légende). Ils tournent en boucle et se terminent par une pause de 1,5 s.
Pour les refaire, voir `tools/supports/gifs/README.md`.

| GIF | Fonctionnalité | Durée | Taille | Ce qu'on voit |
|---|---|---|---|---|
| `01-connexion-pilotage.gif` | Connexion et Pilotage | 26,0 s | 1,3 Mo | Saisie de demo / demo, puis le Pilotage : indicateurs clés, Parcours QA (du poste installé aux tests reliés à Xray), actions prioritaires et couverture des récits par épopée |
| `02-scan-jira-par-url.gif` | Prise de connaissance (scan JIRA) | 23,2 s | 1,8 Mo | Une URL JIRA collée, d'où l'instance et le projet sont déduits ; le scan du jeu IRMA ; la synthèse (récits, critères, points à clarifier) ; les questions « À clarifier avec le PO » |
| `03-tri-des-recits.gif` | Tri des récits | 23,1 s | 2,3 Mo | Les files À automatiser, Plus tard et Ignoré ; les suggestions motivées des règles ; une décision changée en un clic avec sa raison ; le récit qui rejoint « À automatiser » |
| `04-gherkin.gif` | Scénarios Gherkin | 23,2 s | 2,5 Mo | Les critères d'acceptation du récit P0326-9311 ; la génération des scénarios, puis leur relecture avec contrôle syntaxique en direct ; la validation, prête à l'export `.feature` |
| `05-automatisation-exploration.gif` | Automatisation Playwright | 26,0 s | 2,3 Mo | Le plan de test déduit par l'IA ; l'exploration de l'application de démo dans le navigateur en direct ; « Prenez la main » ; le test généré (étapes et code Playwright) ; le rejeu avant validation |
| `06-envoi-xray.gif` | Envoi dans JIRA / Xray | 25,8 s | 1,2 Mo | La fenêtre d'envoi : aperçu, plan de test facultatif ; l'envoi simulé, avec le ticket Test mis à jour sans doublon, le lien vers le récit et l'ajout au plan |
| `07-campagne-execution.gif` | Campagne d'exécution | 26,1 s | 2,4 Mo | Une campagne simulée suivie en direct ; le résultat de chaque test (réussis, échecs avec leur message) ; les échecs qui deviennent des anomalies (rapports détaillés) |
| `08-livrables-istqb.gif` | Livrables ISTQB | 25,8 s | 2,3 Mo | Les documents rangés selon ISO/IEC/IEEE 29119-3 et générés à partir des données ; la relecture par l'agent (82/100) ; l'approbation par un humain ; l'export en Word (format standard), HTML / PDF ou Markdown |
| `09-informations-projet.gif` | Informations projet | 24,7 s | 1,3 Mo | L'assistant pas à pas : organisation, périmètre, risques produit préremplis, approche, environnements ; chaque réponse alimente les livrables concernés |
| `10-performance-k6.gif` | Performance k6 | 25,0 s | 2,1 Mo | Les profils de charge ; un run lancé en simulation et suivi en direct (utilisateurs virtuels, requêtes/s, p95, erreurs) ; l'historique des runs ; la comparaison A/B qui signale une régression |
| `11-installation-poste.gif` | Installation du poste | 24,1 s | 1,7 Mo | Le choix des stacks (Playwright, Gherkin, k6) ; le plan « Installer tout » ; l'installation simulée composant par composant, avec son journal en direct |
| `12-assistant-ia.gif` | Assistant IA | 23,2 s | 1,4 Mo | L'ordre de priorité des fournisseurs (Copilot local, Copilot CLI, API, copier-coller) ; la procédure « Brancher Copilot local » ; le bac à sable ; le mode copier-coller quand aucun fournisseur n'est branché |
| `13-visite-guidee.gif` | Démo (bouton « Démo ») | 16,9 s | 2,3 Mo | Le bouton « Démo » de l'en-tête : la démo accélérée, 13 étapes sur les 15 du rejeu (Pilotage, scan, tri, Gherkin, exploration, test généré, rejeu, envoi Xray, campagne, livrables, Performance k6, Assistant IA, « À vous de jouer »), actions annotées ; la visite commentée reste dans la palette Ctrl K |

Total : 13 GIF, environ 24 Mo. Chaque GIF fait au plus 2,5 Mo et dure entre 23 et 27 s.
Les données sont 100 % fictives. Le modèle Word de l'entreprise n'est jamais utilisé : l'export Word se fait au format standard.
