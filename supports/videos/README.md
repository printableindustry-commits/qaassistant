# Vidéos — fonctionnalités de Wizard QA

21 vidéos MP4 courtes (H.264, 1440 × 900, 30 i/s, sans son), une par fonctionnalité, dans l'ordre du parcours.
Elles sont enregistrées sur l'application réelle avec les **données de démonstration** (Banque Horizon, application
IRMA, personnes fictives). Chaque action est **entourée en rouge** : cadre arrondi, pastille numérotée et étiquette
« Étape n — ce qui est fait », reprises dans la légende du bas. Pour les refaire, voir `tools/supports/README.md`
(« Refaire les vidéos »).

| Vidéo | Fonctionnalité | Durée | Taille | Ce qu'on voit |
|---|---|---|---|---|
| `01-connexion-pilotage.mp4` | Connexion et Pilotage | 24,4 s | 0,85 Mo | Saisie de demo / demo, connexion, puis le Pilotage : indicateurs clés, Parcours QA, actions prioritaires et couverture par épopée |
| `02-prise-de-connaissance.mp4` | Prise de connaissance (scan par URL JIRA) | 27,0 s | 0,64 Mo | « Mon JIRA », l'URL du projet collée et reconnue, le jeu de démonstration IRMA scanné, la synthèse et les questions « À clarifier avec le PO » |
| `03-tri-des-recits.mp4` | Tri des récits | 27,8 s | 0,78 Mo | La file « Plus tard », un récit ouvert, le « pourquoi » de la suggestion, la décision changée avec sa raison, le récit dans « À automatiser » |
| `04-gherkin.mp4` | Scénarios Gherkin | 26,8 s | 1,81 Mo | Génération depuis les critères d'acceptation, relecture et complément à la main, contrôle en direct, validation |
| `05-exploration-autonome.mp4` | Automatisation — exploration autonome en direct | 27,9 s | 1,25 Mo | Session créée sur l'application de démo, plan déduit du Gherkin, lancement ; la capture du navigateur évolue, connexion par règle, « Heuristique (essai 1/4) », étape trouvée ; « Prenez la main » proposé pour une vérification ; le test généré (sources Règle / Heuristique) |
| `06-prise-de-main.mp4` | Prise de main | 28,2 s | 0,96 Mo | L'outil bloque, fenêtre « Prenez la main » ; « Agir ici, sur la capture » ; clic sur RSK-002 dans la capture, mode « Vérifier un élément », clic sur le titre ; actions enregistrées avec leur sélecteur ; « J'ai terminé » : l'étape passe « Testeur » |
| `07-rejeu-validation.mp4` | Rejeu et validation du test | 28,6 s | 1,13 Mo | Rejeu du test P0326-9310, une étape en échec, suppression de l'étape fautive, enregistrement, nouveau rejeu réussi, test validé (fichier `.spec.ts`) |
| `08-envoi-xray.mp4` | Envoi dans JIRA / Xray | 27,2 s | 0,63 Mo | La fenêtre d'envoi, le plan de test P0326-10528 choisi, l'aperçu, l'envoi simulé : ticket Test mis à jour sans doublon, lien et plan |
| `09-campagne-execution.mp4` | Campagne d'exécution | 23,5 s | 1,02 Mo | Campagne simulée suivie en direct, résultats par test, anomalies qui en découlent |
| `10-livrables-istqb.mp4` | Livrables ISTQB (génération, relecture, approbation) | 27,8 s | 1,26 Mo | Les documents ISO/IEC/IEEE 29119-3, un document actualisé depuis les faits, la relecture par l'agent (100/100), l'approbation confirmée |
| `11-export-word.mp4` | Export Word | 23,9 s | 2,09 Mo | Stratégie de test approuvée, formats d'export, clic sur Word : fichier `P0326-strategie-v1.docx` téléchargé ; le contenu du document exporté (version HTML) défile |
| `12-informations-projet.mp4` | Informations projet | 28,1 s | 1,22 Mo | L'assistant pas à pas : version du produit saisie, périmètre, risques produit préremplis, approche, environnements |
| `13-performance-k6.mp4` | Performance k6 | 27,4 s | 0,80 Mo | Profils de charge, simulation lancée et suivie en direct, historique des runs, comparaison de deux runs |
| `14-installation-poste.mp4` | Installation du poste | 26,9 s | 0,78 Mo | Stacks à installer, mode simulation, plan « Installer tout » confirmé, installation suivie composant par composant |
| `15-assistant-ia.mp4` | Assistant IA | 22,0 s | 0,68 Mo | Ordre de priorité des fournisseurs, « Brancher Copilot local », bac à sable, demande envoyée, mode copier-coller |
| `16-visite-guidee.mp4` | Mode démo guidé (visite) | 22,1 s | 1,28 Mo | La visite guidée lancée puis accélérée, d'écran en écran (étapes choisies sur 25) |
| `17-reglages-demo.mp4` | Réglages et données de démo | 26,9 s | 0,72 Mo | Onglet Démonstration (compteurs du jeu IRMA), rechargement confirmé, Réinitialiser, onglets Utilisateurs, JIRA / Xray, Configuration |
| `18-mon-projet.mp4` | Mon projet (écran historique) | 19,5 s | 0,45 Mo | Le profil du projet (tribu, squad, produit, PO, BA, QA, dépôt), « Paramètres projet », export de la configuration |
| `19-npmrc.mp4` | .npmrc (écran historique) | 13,3 s | 0,50 Mo | Registre, e-mail et jeton masqué, options, proxy encodé automatiquement ; « Générer npmrc » montré sans être lancé |
| `20-hook-git.mp4` | Hook Git (écran historique) | 15,6 s | 0,38 Mo | Hook Git configuré (hook, .env, conf, dry-run), passage à la synchronisation JIRA |
| `21-sync-xray.mp4` | Sync Xray (écran historique) | 20,4 s | 0,60 Mo | Analyse des écarts sans rien modifier, synchronisation confirmée (simulée) : tickets créés, mis à jour, supprimés, tests importés dans le plan |

Total : 21 vidéos, environ 20 Mo. Chaque vidéo dure moins de 30 s (13 à 29 s) et pèse au plus 2,1 Mo.
Les données sont 100 % fictives ; rien n'est envoyé à JIRA ni à Xray, les installations sont simulées et le modèle
Word de l'entreprise n'est jamais utilisé (export Word au format standard).

## Version GIF (pour PowerPoint)

Les 21 vidéos existent aussi en GIF dans [gif/](gif/), même nom de fichier (`gif/05-exploration-autonome.gif`…) :
960 px de large, 10 images/s, lecture en boucle, environ 45 Mo en tout (1,3 à 4,5 Mo par GIF). Dans PowerPoint :
**Insertion › Images › Cet appareil** ; le GIF s'anime en mode diaporama, sans réglage. Pour les refaire :

```
ffmpeg -i 05-exploration-autonome.mp4 -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" gif/05-exploration-autonome.gif
```
