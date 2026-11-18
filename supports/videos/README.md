# Vidéos — fonctionnalités de Wizard QA

21 vidéos MP4 courtes (H.264, 1440 × 900, 30 i/s, sans son), une par fonctionnalité, dans l'ordre du parcours.
Elles sont enregistrées sur l'application réelle avec les **données de démonstration** (Banque Horizon, application
IRMA, personnes fictives). Chaque action est **entourée en rouge** : cadre arrondi, pastille numérotée et étiquette
« Étape n — ce qui est fait », reprises dans la légende du bas. Pour les refaire, voir `tools/supports/README.md`
(« Refaire les vidéos »).

| Vidéo | Fonctionnalité | Durée | Taille | Ce qu'on voit |
|---|---|---|---|---|
| `01-connexion-pilotage.mp4` | Connexion et Pilotage | 26,3 s | 0,76 Mo | Saisie de demo / demo, connexion, puis le Pilotage : indicateurs clés, Parcours QA, actions prioritaires et couverture par épopée |
| `02-prise-de-connaissance.mp4` | Prise de connaissance (scan par URL JIRA) | 26,0 s | 0,70 Mo | « Mon JIRA », l'URL du projet collée et reconnue, le jeu de démonstration IRMA scanné, la synthèse et les questions « À clarifier avec le PO » |
| `03-tri-des-recits.mp4` | Tri des récits | 25,5 s | 0,81 Mo | La file « Plus tard », un récit ouvert, le « pourquoi » de la suggestion, la décision changée avec sa raison, le récit dans « À automatiser » |
| `04-gherkin.mp4` | Scénarios Gherkin | 24,4 s | 1,53 Mo | Génération depuis les critères d'acceptation, relecture et complément à la main, contrôle en direct, validation |
| `05-exploration-autonome.mp4` | Automatisation — exploration autonome en direct | 26,9 s | 1,30 Mo | Session créée sur l'application de démo, plan déduit du Gherkin, lancement ; la capture du navigateur évolue, connexion par règle, « Heuristique (essai 1/4) », étape trouvée ; « Prenez la main » proposé pour une vérification ; le test généré (sources Règle / Heuristique) |
| `06-prise-de-main.mp4` | Prise de main | 27,7 s | 0,97 Mo | L'outil bloque, fenêtre « Prenez la main » ; « Agir ici, sur la capture » ; clic sur RSK-002 dans la capture, mode « Vérifier un élément », clic sur le titre ; actions enregistrées avec leur sélecteur ; « J'ai terminé » : l'étape passe « Testeur » |
| `07-rejeu-validation.mp4` | Rejeu et validation du test | 27,9 s | 1,14 Mo | Rejeu du test P0326-9310, une étape en échec, suppression de l'étape fautive, enregistrement, nouveau rejeu réussi, test validé (fichier `.spec.ts`) |
| `08-envoi-xray.mp4` | Envoi dans JIRA / Xray | 22,0 s | 0,53 Mo | La fenêtre d'envoi, le plan de test P0326-10528 choisi, l'aperçu, l'envoi simulé : ticket Test mis à jour sans doublon, lien et plan |
| `09-campagne-execution.mp4` | Campagne d'exécution | 20,2 s | 0,90 Mo | Campagne simulée suivie en direct, résultats par test, anomalies qui en découlent |
| `10-livrables-istqb.mp4` | Livrables ISTQB (génération, relecture, approbation) | 28,0 s | 1,28 Mo | Les documents ISO/IEC/IEEE 29119-3, un document actualisé depuis les faits, la relecture par l'agent (100/100), l'approbation confirmée |
| `11-export-word.mp4` | Export Word | 21,2 s | 1,96 Mo | Stratégie de test approuvée, formats d'export, clic sur Word : fichier `P0326-strategie-v1.docx` téléchargé ; le contenu du document exporté (version HTML) défile |
| `12-informations-projet.mp4` | Informations projet | 20,8 s | 0,98 Mo | L'assistant pas à pas : version du produit saisie, périmètre, risques produit préremplis, approche, environnements |
| `13-performance-k6.mp4` | Performance k6 | 22,2 s | 0,66 Mo | Profils de charge, simulation lancée et suivie en direct, historique des runs, comparaison de deux runs |
| `14-installation-poste.mp4` | Installation du poste | 25,5 s | 0,67 Mo | Stacks à installer, mode simulation, plan « Installer tout » confirmé, installation suivie composant par composant |
| `15-assistant-ia.mp4` | Assistant IA | 21,4 s | 0,66 Mo | Ordre de priorité des fournisseurs, « Brancher Copilot local », bac à sable, demande envoyée, mode copier-coller |
| `16-visite-guidee.mp4` | Mode démo (bouton « Démo ») | 16,8 s | 0,89 Mo | Le bouton « Démo » de l'en-tête lancé : le parcours rejoué seul, actions annotées, accéléré d'écran en écran (13 étapes sur 15) ; la visite commentée reste dans Ctrl K |
| `17-reglages-demo.mp4` | Réglages et données de démo | 26,7 s | 0,72 Mo | Onglet Démonstration (compteurs du jeu IRMA), rechargement confirmé, Réinitialiser, onglets Utilisateurs, JIRA / Xray, Configuration |
| `18-mon-projet.mp4` | Mon projet (écran historique) | 17,2 s | 0,42 Mo | Le profil du projet (tribu, squad, produit, PO, BA, QA, dépôt), « Paramètres projet », export de la configuration |
| `19-npmrc.mp4` | .npmrc (écran historique) | 12,1 s | 0,44 Mo | Registre, e-mail et jeton masqué, options, proxy encodé automatiquement ; « Générer npmrc » montré sans être lancé |
| `20-hook-git.mp4` | Hook Git (écran historique) | 14,7 s | 0,35 Mo | Hook Git configuré (hook, .env, conf, dry-run), passage à la synchronisation JIRA |
| `21-sync-xray.mp4` | Sync Xray (écran historique) | 19,7 s | 0,59 Mo | Analyse des écarts sans rien modifier, synchronisation confirmée (simulée) : tickets créés, mis à jour, supprimés, tests importés dans le plan |

Total : 21 vidéos, environ 18 Mo. Chaque vidéo dure moins de 30 s (12 à 28 s) et pèse au plus 2,0 Mo.
Les données sont 100 % fictives ; rien n'est envoyé à JIRA ni à Xray, les installations sont simulées et le modèle
Word de l'entreprise n'est jamais utilisé (export Word au format standard).

## Version GIF (pour PowerPoint)

Les 21 vidéos existent aussi en GIF dans [gif/](gif/), même nom de fichier (`gif/05-exploration-autonome.gif`…) :
960 px de large, 10 images/s, lecture en boucle, environ 44 Mo en tout (1,1 à 4,3 Mo par GIF). Dans PowerPoint :
**Insertion › Images › Cet appareil** ; le GIF s'anime en mode diaporama, sans réglage. Pour les refaire :

```
ffmpeg -i 05-exploration-autonome.mp4 -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" gif/05-exploration-autonome.gif
```
