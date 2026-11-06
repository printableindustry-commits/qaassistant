/**
 * Contenu détaillé du Wiki Wizard QA (chargé avant wiki.js).
 */
// eslint-disable-next-line no-var
var WikiSectionsCore = [
  {
    id: 'intro',
    title: '1. Introduction',
    body: `
      <p>Le <strong>Wizard QA Assistant</strong> est une extension Visual Studio Code développée pour <strong>Crédit Agricole Technologies &amp; Services (CA-TS)</strong>. Elle accompagne les équipes QA et développement dans la mise en place complète d'un environnement de tests automatisés sur poste Windows — quelle que soit la <strong>stack choisie</strong> (Cypress, Robot Framework, Playwright ou Postman) — depuis la configuration réseau jusqu'à la synchronisation avec JIRA / Xray lorsque votre projet l'utilise.</p>

      <h3 class="wiki-h3">À quoi sert cette application ?</h3>
      <p>Sur un poste CA-TS, installer et faire tourner une stack de tests n'est pas aussi simple que sur un poste personnel : proxy d'entreprise, registry npm interne (JFrog Artifactory), tokens, structure Git et outils JIRA/Xray imposent de nombreuses étapes. Le Wizard centralise tout dans une interface guidée VS Code.</p>
      <p>Concrètement, le Wizard permet de :</p>
      <ul class="wiki-steps">
        <li><strong>Qualifier le projet</strong> — tribu, squad, codes produit/solution, dépôt Git, plans JIRA, contacts métier (BA, PO, QA…).</li>
        <li><strong>Configurer le poste</strong> — <code>.npmrc</code> (stacks Node : Cypress, Playwright…) ou environnement Python (Robot), selon la stack retenue.</li>
        <li><strong>Choisir la bonne stack</strong> — questionnaire configurable recommandant Cypress, Robot Framework, Playwright ou Postman selon votre contexte.</li>
        <li><strong>Installer le Hook Git JIRA/Xray</strong> — optionnel ; synchronise les artefacts de test versionnés (souvent des <code>.feature</code> Gherkin sur projets Cypress) avec JIRA après chaque commit.</li>
        <li><strong>Synchroniser Local ↔ JIRA</strong> — analyse des écarts et réconciliation.</li>
        <li><strong>Produire la documentation QA</strong> — assistant guidé chapitre par chapitre avec prompts IA et injection dans les livrables Word.</li>
      </ul>

      <div class="wiki-callout wiki-callout--info">
        <strong>Stack recommandée</strong>
        Le résultat du questionnaire est enregistré dans votre profil et mis en avant sur l'accueil (halo sur la tuile concernée). Le parcours Wiki et l'étape « Initialiser la stack » s'adaptent au logo et au libellé de la stack que vous avez retenue.
      </div>

      <h3 class="wiki-h3">Pourquoi ce Wizard existe-t-il ?</h3>
      <p>Sur un dépôt de tests versionné dans Git, les scénarios automatisés (fichiers <code>.feature</code>, <code>.robot</code>, <code>.spec.ts</code>, collections Postman…) doivent souvent être <strong>tracés dans JIRA/Xray</strong>. Sans automatisation, chaque création ou renommage local impose une double saisie dans JIRA. Le hook Git (lorsqu'il est activé sur votre projet) fait de <strong>VS Code la source de vérité</strong> pour les formats qu'il prend en charge.</p>

      <h3 class="wiki-h3">Architecture globale</h3>
      <pre class="wiki-code"><code>Extension VS Code « Wizard QA Assistant »
    │
    ├─ Serveur local — pages web embarquées
    │     ├─ Accueil / Profil projet
    │     ├─ Assistant .npmrc (stacks Node)
    │     ├─ Pré-configuration poste (selon stack)
    │     ├─ Hook Git JIRA/Xray (optionnel)
    │     ├─ Sync JIRA
    │     ├─ Documentation QA
    │     └─ Wiki (ce guide)
    │
    ├─ .wizard-qa/conf/     ← profil &amp; stack recommandée
    │
    └─ &lt;dossier-hook&gt;/     ← synchro JIRA (si configuré)
          ├─ hook-run.mjs
          ├─ hooks.conf
          └─ .env</code></pre>

      <h3 class="wiki-h3">Principe fondamental : le dépôt Git = source de vérité</h3>
      <div class="wiki-callout wiki-callout--ok">
        <strong>Règle d'or (projets avec hook JIRA)</strong>
        Ce qui existe dans les dossiers de tests déclarés dans <code>hooks.conf</code> <em>doit</em> exister dans JIRA/Xray. Suppression ou renommage local → le hook répercute le changement. Modifier JIRA seul sans toucher le dépôt crée un écart visible dans Sync JIRA.
      </div>

      <h3 class="wiki-h3">À qui s'adresse ce wiki ?</h3>
      <table class="wiki-table">
        <tr><th>Profil</th><th>Ce que vous y trouverez</th></tr>
        <tr><td>Testeur fonctionnel / QA</td><td>Profil projet, questionnaire stack, Git de base, logs hook</td></tr>
        <tr><td>Développeur</td><td>npm, Node/Volta, configuration de la stack retenue, hooks.conf</td></tr>
        <tr><td>Référent technique</td><td>Installation manuelle du hook, debug, vérification des versions</td></tr>
        <tr><td>Nouveau collaborateur</td><td>Parcours recommandé en 7 étapes</td></tr>
      </table>

      <h3 class="wiki-h3">Parcours type d'un nouveau collaborateur</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Installer l'extension VSIX et recharger VS Code.</li>
        <li>Compléter le <strong>profil projet</strong> depuis l'accueil.</li>
        <li>Configurer le <code>.npmrc</code> si votre stack est Node (Cypress, Playwright).</li>
        <li>Installer <strong>Node et npm</strong> (Volta) — voir <a href="/wiki.html#node-npm-volta" data-wiki-nav="node-npm-volta">section Node, npm et Volta</a>.</li>
        <li>Répondre au <strong>questionnaire stack</strong> et noter la recommandation.</li>
        <li>Initialiser la stack choisie (assistant dédié sur l'accueil).</li>
        <li>Si besoin JIRA : configurer le <strong>Hook Git</strong> et valider un dry-run.</li>
        <li>Travailler : éditer les tests, <code>git commit</code>, vérifier JIRA si hook actif.</li>
      </ol>

      <h3 class="wiki-h3">Relation avec JIRA et Xray</h3>
      <table class="wiki-table">
        <tr><th>Élément</th><th>Rôle</th></tr>
        <tr><td>Fichiers de test (Git)</td><td>Scénarios versionnés — format selon stack (<code>.feature</code>, <code>.robot</code>, <code>.spec.ts</code>…)</td></tr>
        <tr><td>Ticket JIRA</td><td>Fiche de test (ex. <code>PRODUIT-12345</code>) — gérée par le hook si configuré</td></tr>
        <tr><td>Plan de test Xray</td><td>Regroupement de tests (ex. <code>PRODUIT-9235</code>)</td></tr>
        <tr><td>Suite de test</td><td>Conteneur de plans</td></tr>
        <tr><td>Testing Board</td><td>Arborescence Xray alignée sur les dossiers du dépôt</td></tr>
      </table>

      <div class="wiki-callout wiki-callout--info">
        <strong>Extension vs dépôt</strong>
        L'extension vit dans VS Code ; la configuration vit dans le <em>dépôt Git de votre application</em>. Chaque clone possède son <code>.wizard-qa/conf/</code>.
      </div>

      <details class="wiki-fold">
        <summary>Exemple concret — projet Cypress + Gherkin + JIRA (CA-TS)</summary>
        <p>Certains dépôts CA-TS (ex. tests UI d'une application métier) utilisent Cypress avec des <code>.feature</code> dans des dossiers <code>PRODUIT-XXXX_*</code> synchronisés via le hook. C'est un cas d'usage fréquent mais <em>pas le seul</em> : un autre projet peut retenir Playwright ou Postman via le questionnaire. Consultez les sections 10 à 13 selon votre stack.</p>
      </details>`,
  },
  {
    id: 'concepts',
    title: '2. Utilisation de Git',
    body: `
      <p>Cette section explique Git pour quelqu'un qui n'y connaît <strong>rien</strong>. Git est indispensable pour versionner vos scénarios de test, collaborer avec l'équipe et déclencher le hook de synchronisation JIRA.</p>

      <h3 class="wiki-h3">Qu'est-ce que Git ?</h3>
      <p><strong>Git</strong> est un système de gestion de versions distribué. Il enregistre l'historique de tous les fichiers d'un projet (code, scénarios <code>.feature</code>, configuration) sous forme de <strong>commits</strong> — des instantanés datés et commentés. Chaque développeur possède une copie complète de l'historique sur son poste ; un serveur distant (GitLab, GitHub, Azure DevOps…) centralise les échanges via <code>push</code> et <code>pull</code>.</p>
      <p>Dans le contexte d'un <strong>dépôt de tests automatisés</strong>, votre projet Git contient typiquement :</p>
      <ul class="wiki-steps">
        <li>Des dossiers de campagnes (ex. <code>PRODUIT-9235_Smoke_Tests/</code>) avec vos scénarios.</li>
        <li>Le code d'automatisation (<code>steps/</code>, <code>tests/</code>, <code>cypress/</code>… selon la stack).</li>
        <li>Le dossier du hook JIRA (si activé), ex. <code>0_Hook_Synchro_Ticket_Test_JIRA/</code>.</li>
        <li>La config Wizard <code>.wizard-qa/conf/</code>.</li>
      </ul>

      <h3 class="wiki-h3">Vocabulaire essentiel</h3>
      <table class="wiki-table">
        <tr><th>Terme</th><th>Signification</th></tr>
        <tr><td>Dépôt (repository)</td><td>Le projet Git dans son ensemble — dossier contenant un sous-dossier caché <code>.git/</code></td></tr>
        <tr><td>Working directory</td><td>Vos fichiers tels que vous les voyez dans l'Explorateur / VS Code</td></tr>
        <tr><td>Staging (index)</td><td>Zone intermédiaire : fichiers marqués pour le prochain commit (<code>git add</code>)</td></tr>
        <tr><td>Commit</td><td>Instantané validé avec un message — point de déclenchement du hook post-commit</td></tr>
        <tr><td>Branche (branch)</td><td>Ligne de développement indépendante (ex. <code>main</code>, <code>feature/SMK-042</code>)</td></tr>
        <tr><td>Remote</td><td>Serveur distant (ex. <code>origin</code>) où vous poussez vos commits</td></tr>
        <tr><td>HEAD</td><td>Le commit actuellement « checked out » sur votre branche</td></tr>
      </table>

      <h3 class="wiki-h3">Les commandes du quotidien</h3>
      <p>Ouvrez un terminal à la <strong>racine du dépôt</strong> (là où se trouve le dossier <code>.git</code>), pas dans un sous-dossier du hook.</p>

      <details class="wiki-fold" open>
        <summary><code>git status</code> — Où en suis-je ?</summary>
        <p>Affiche les fichiers modifiés, ajoutés ou non suivis. À lancer avant chaque commit pour vérifier ce qui partira dans l'instantané.</p>
        <pre class="wiki-code"><code>cd D:\\DEV\\mon-depot-tests
git status</code></pre>
      </details>

      <details class="wiki-fold">
        <summary><code>git add</code> — Préparer le commit</summary>
        <p>Ajoute des fichiers à la zone de staging. Sans <code>git add</code>, vos modifications ne seront pas dans le commit.</p>
        <pre class="wiki-code"><code>git add .                                    # tout le dépôt (depuis la racine !)
git add campagnes/Smoke/SCN_001.feature      # un fichier précis
git add campagnes/Smoke/                     # un dossier entier</code></pre>
        <div class="wiki-callout wiki-callout--warn">
          <strong>Piège fréquent</strong>
          Si vous êtes dans un sous-dossier (hook, scripts…) et faites <code>git add .</code>, seuls les fichiers de ce sous-dossier sont ajoutés — pas vos scénarios à la racine du dépôt.
        </div>
      </details>

      <details class="wiki-fold">
        <summary><code>git commit</code> — Créer l'instantané</summary>
        <p>Enregistre définitivement les fichiers stagés. C'est <strong>à ce moment</strong> que le hook <code>post-commit</code> se lance (pas au push).</p>
        <pre class="wiki-code"><code>git commit -m "feat(tests): ajout scénario smoke connexion"</code></pre>
        <p>Bonnes pratiques pour le message : verbe à l'impératif, contexte court, référence ticket JIRA si applicable.</p>
      </details>

      <details class="wiki-fold">
        <summary><code>git diff</code> — Voir les modifications</summary>
        <pre class="wiki-code"><code>git diff                    # modifications non stagées
git diff --staged           # modifications prêtes à commiter
git diff HEAD~1 HEAD        # différence avec le commit précédent</code></pre>
      </details>

      <details class="wiki-fold">
        <summary><code>git log</code> — Historique</summary>
        <pre class="wiki-code"><code>git log --oneline -15       # 15 derniers commits, une ligne chacun
git log --oneline --graph   # avec graphe des branches</code></pre>
      </details>

      <h3 class="wiki-h3">Les branches : à quoi ça sert ?</h3>
      <p>Une <strong>branche</strong> est une ligne de travail parallèle. La branche <code>main</code> (ou <code>master</code>) contient généralement le code stable. Pour développer une nouvelle fonctionnalité ou un lot de tests, on crée une branche dédiée, on y commit, puis on fusionne (<code>merge</code>) ou on ouvre une Pull Request.</p>
      <p><strong>Pourquoi utiliser des branches ?</strong></p>
      <ul class="wiki-steps">
        <li>Isoler votre travail sans impacter les collègues.</li>
        <li>Permettre la revue de code avant intégration.</li>
        <li>Associer une branche à un ticket JIRA (<code>feature/PRODUIT-12345-nom</code>).</li>
      </ul>

      <details class="wiki-fold" open>
        <summary>Créer, changer et lister les branches</summary>
        <pre class="wiki-code"><code>git branch                          # branches locales
git branch -a                       # locales + distantes
git checkout -b feature/SCN-042     # créer ET basculer
git switch -c feature/SCN-042       # équivalent moderne
git checkout main                   # revenir sur main
git switch main</code></pre>
      </details>

      <h3 class="wiki-h3">Fetch, pull et push : synchroniser avec le serveur</h3>
      <table class="wiki-table">
        <tr><th>Commande</th><th>Action</th><th>Quand l'utiliser</th></tr>
        <tr><td><code>git fetch</code></td><td>Télécharge les nouveautés du remote <em>sans</em> modifier vos fichiers</td><td>Avant de commencer la journée, pour voir ce que les autres ont poussé</td></tr>
        <tr><td><code>git pull</code></td><td><code>fetch</code> + fusion dans votre branche courante</td><td>Récupérer le travail des collègues sur votre branche</td></tr>
        <tr><td><code>git push</code></td><td>Envoyer vos commits locaux vers le remote</td><td>Partager votre travail — <em>n'active pas le hook JIRA</em></td></tr>
      </table>
      <pre class="wiki-code"><code>git fetch origin
git pull origin main
git push origin feature/SCN-042</code></pre>
      <div class="wiki-callout wiki-callout--info">
        <strong>Hook vs push</strong>
        Le hook JIRA/Xray se déclenche au <code>commit</code> local. Le <code>push</code> partage le code sur GitLab mais ne relance pas la synchro JIRA.
      </div>

      <h3 class="wiki-h3">Stash : mettre de côté temporairement</h3>
      <p><code>git stash</code> range vos modifications non commitées dans une pile temporaire — utile quand vous devez changer de branche sans commiter un travail incomplet.</p>
      <pre class="wiki-code"><code>git stash                    # mettre de côté
git stash list               # voir la pile
git stash pop                # réappliquer et retirer du stash
git stash apply stash@{0}    # réappliquer sans retirer
git stash drop               # supprimer le dernier stash</code></pre>
      <p><strong>Exemple :</strong> vous modifiez un scénario de test mais un collègue a besoin d'un correctif urgent sur <code>main</code> — <code>git stash</code>, <code>git switch main</code>, corriger, revenir, <code>git stash pop</code>.</p>

      <h3 class="wiki-h3">Annuler / corriger</h3>
      <pre class="wiki-code"><code>git restore fichier.feature       # annuler modifs non stagées
git restore --staged fichier      # retirer du staging
git reset --soft HEAD~1           # annuler le dernier commit (garde les fichiers)
git revert abc1234                # commit inverse (sûr sur branche partagée)</code></pre>

      <h3 class="wiki-h3">Fichiers ignorés (.gitignore)</h3>
      <p>Certains fichiers ne doivent <strong>jamais</strong> être commités : <code>.env</code> (tokens JIRA), <code>node_modules/</code>, rapports locaux. Ils sont listés dans <code>.gitignore</code>. Si <code>git status</code> ne les montre pas, c'est normal.</p>

      <h3 class="wiki-h3">Workflow recommandé avec le hook JIRA</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><code>git pull</code> — récupérer les dernières modifications.</li>
        <li>Éditer / créer des fichiers de test dans un dossier déclaré dans <code>hooks.conf</code> (si hook actif).</li>
        <li><code>git status</code> — vérifier la liste des fichiers.</li>
        <li><code>git add …</code> depuis la <strong>racine</strong> du dépôt.</li>
        <li><code>git commit -m "…"</code> — le hook post-commit synchronise JIRA en arrière-plan (projets configurés).</li>
        <li>Consulter <code>hook-debug.log</code> si besoin.</li>
        <li><code>git push</code> — partager avec l'équipe.</li>
      </ol>`,
  },
  {
    id: 'profil',
    title: '3. Profil projet',
    body: `
      <p>L'assistant <strong>Profil projet</strong> (écran d'accueil du Wizard, anciennement « prise de connaissance ») collecte les informations métier et techniques de votre application. Ces données alimentent les assistants Hook Git, Sync JIRA, Documentation QA et le questionnaire stack.</p>
      <p>Tout est persisté dans le dossier <code>.wizard-qa/conf/</code> à la racine du dépôt Git. Ce dossier est en général <strong>gitignoré</strong> car il peut contenir des secrets (tokens Xray).</p>

      <details class="wiki-fold" open>
        <summary><code>wizard.defaults.json</code> — Profil central</summary>
        <p><strong>Rôle :</strong> fichier maître du Wizard. Il contient l'état complet du profil projet : tribu, squad, noms BA/PO/QA/Scrum Master, codes produit et solution, libellé application, URL dépôt Git, URL JIRA, identifiants Xray, liste des plans de test, indicateur d'onboarding terminé, stack recommandée, chemins des autres fichiers de config.</p>
        <p><strong>Qui l'écrit ?</strong></p>
        <ul class="wiki-steps">
          <li>Fin de la prise de connaissance — <code>POST /api/project/onboarding/complete</code></li>
          <li>Mise à jour des paramètres projet depuis l'accueil</li>
          <li>Questionnaire stack — enregistrement de la recommandation</li>
          <li>Connexion JIRA — sauvegarde des tokens</li>
        </ul>
        <p><strong>Qui le lit ?</strong></p>
        <ul class="wiki-steps">
          <li>Accueil — état des tuiles (npmrc OK, hook OK…)</li>
          <li>Reprise du formulaire profil à l'ouverture</li>
          <li>Hook Git — repli des credentials si <code>.env</code> vide</li>
          <li>Sync JIRA — arborescences et métadonnées projet</li>
          <li>Wiki — stack recommandée pour le parcours</li>
        </ul>
        <p><strong>Pourquoi ?</strong> Un seul point de vérité évite de ressaisir tribu, codes JIRA et tokens dans chaque assistant.</p>
      </details>

      <details class="wiki-fold">
        <summary><code>project.variables.json</code> — Variables métier</summary>
        <p><strong>Rôle :</strong> dictionnaire de variables injectées dans les livrables Documentation QA et les prompts IA : <code>$PRODUIT</code>, <code>$SOLUTION</code>, <code>$GIT_REPOSITORY</code>, <code>$TRIBU</code>, noms des contacts, URL JIRA, secrets Xray, liste des plans, etc.</p>
        <p><strong>Qui l'écrit ?</strong> Régénéré automatiquement à chaque sauvegarde du profil ou de la connexion JIRA.</p>
        <p><strong>Qui le lit ?</strong> Module Documentation QA, export de configuration, contexte debug Copilot.</p>
        <p><strong>Pourquoi séparer de wizard.defaults ?</strong> Format stable orienté « template » pour la génération de documents ; les scripts de doc n'ont pas besoin de parser tout le schéma Wizard.</p>
        <div class="wiki-callout wiki-callout--warn"><strong>Secret</strong> — Ne pas partager ce fichier ; il peut contenir <code>XRAY_CLIENT_SECRET</code>.</div>
      </details>

      <details class="wiki-fold">
        <summary><code>doc-qa-templates.conf.json</code> — Gabarits livrables QA</summary>
        <p><strong>Rôle :</strong> décrit les 13 documents Word du pack Documentation QA, les champs d'identification, les titres de couverture, les sections assistant et les consignes de saisie affichées en italique gris dans les modèles.</p>
        <p><strong>Qui l'écrit ?</strong> Le script <code>00_Scripts_Implementation/02_documentation-qa/generate-doc-qa-templates-conf.py</code> régénère le fichier de référence avec des placeholders détaillés, génériques et compatibles avec plusieurs stacks de test.</p>
        <p><strong>Qui le lit ?</strong> <code>build-doc-qa-word-templates.py</code> pour reconstruire les modèles Word Documentation QA à partir du modèle CA-TS et des consignes structurées.</p>
        <p><strong>Pourquoi ?</strong> Centraliser la structure documentaire évite de modifier les 13 livrables à la main et garantit une consigne homogène : objectif de section, données à fournir, niveau de qualité attendu et exemples remplaçables entre crochets.</p>
      </details>

      <details class="wiki-fold">
        <summary><code>onboarding.snapshot.json</code> — Archive prise de connaissance</summary>
        <p><strong>Rôle :</strong> photographie complète de l'onboarding : réponses au questionnaire stack, scores par technologie, recommandation calculée, date de complétion, identifiants des questions au moment de la soumission.</p>
        <p><strong>Qui l'écrit ?</strong> Fin de prise de connaissance, soumission du questionnaire, choix manuel sur les camemberts de résultat.</p>
        <p><strong>Qui le lit ?</strong> Accueil (halo jaune sur la tuile stack recommandée), reprise des réponses si vous rouvrez le questionnaire, Wiki (logo stack du parcours).</p>
        <p><strong>Pourquoi ?</strong> Traçabilité des choix d'orientation et reprise sans tout recalculer.</p>
      </details>

      <details class="wiki-fold">
        <summary><code>stack-questionnaire.conf.json</code> — Configuration du questionnaire</summary>
        <p><strong>Rôle :</strong> définit toutes les pages du questionnaire stack : libellés, réponses possibles et pondérations par technologie (Cypress, Robot, Playwright, Postman). <strong>Chaque objet du tableau <code>questions</code> = une page</strong> affichée dans l'assistant.</p>
        <p><strong>Fichier à modifier :</strong> <code>.wizard-qa/conf/stack-questionnaire.conf.json</code> (lu à chaque lancement du questionnaire).</p>
        <p><strong>Modèle de référence :</strong> <code>stack-questionnaire.conf.reference.json</code> dans l'extension — copié une seule fois si votre fichier actif n'existe pas encore. Visible dans <strong>Paramétrage du Wizard</strong>.</p>
        <p><strong>Qui l'écrit ?</strong> Vous, par édition manuelle ; création initiale automatique depuis la référence extension.</p>
        <p><strong>Qui le lit ?</strong> <code>GET /api/project/stack-questionnaire</code>, écran questionnaire sur l'accueil (barre de progression et camemberts recalculés selon le nombre de questions).</p>
        <p class="wiki-next"><a href="/wiki.html#stack-questionnaire-guide" class="btn-primary btn-sm">→ Guide complet : ajouter une question</a></p>
      </details>

      <details class="wiki-fold">
        <summary><code>wizard.paths.json</code> — Chemins avancés (optionnel)</summary>
        <p><strong>Rôle :</strong> surcharge des chemins par défaut : dossier hook JIRA, scripts de réparation, documentation. Utile si votre dépôt n'a pas la structure standard <code>0_Hook_Synchro_Ticket_Test_JIRA/</code>.</p>
        <p><strong>Qui le lit ?</strong> <code>paths.mjs</code> côté serveur Wizard.</p>
        <p><strong>Qui l'écrit ?</strong> Configuration manuelle — la plupart des projets n'en ont pas besoin.</p>
      </details>

      <h3 class="wiki-h3">Synchronisation avec le Hook Git</h3>
      <p>À chaque enregistrement du profil, les URL JIRA et tokens Xray saisis sont <strong>recopiés automatiquement</strong> dans <code>0_Hook_Synchro_Ticket_Test_JIRA/.env</code>. Vous n'avez pas à maintenir deux fichiers en parallèle.</p>

      <p class="wiki-next"><a href="/" class="btn-primary btn-sm">→ Ouvrir l'accueil — Profil projet</a></p>`,
  },
  {
    id: 'npmrc',
    title: '4. Configuration .npmrc',
    body: `
      <h3 class="wiki-h3">Qu'est-ce que npm et le fichier .npmrc ?</h3>
      <p><strong>npm</strong> (Node Package Manager) est le gestionnaire de paquets JavaScript. Quand vous lancez <code>npm install</code> dans un projet Node (Cypress, Playwright, outils de build…), npm télécharge les bibliothèques depuis un <strong>registry</strong>.</p>
      <p>Sur Internet public, le registry par défaut est <code>registry.npmjs.org</code>. En entreprise CA-TS, l'accès direct est bloqué : tout passe par le <strong>proxy ZGIE</strong> et le registry interne <strong>JFrog Artifactory</strong>.</p>
      <p>Le fichier <code>.npmrc</code> (à la racine du profil utilisateur <code>%USERPROFILE%\\.npmrc</code> ou du projet) indique à npm <em>où</em> télécharger et <em>comment</em> s'authentifier.</p>

      <h3 class="wiki-h3">JFrog Artifactory : le registry npm CA-TS</h3>
      <p><strong>Artifactory</strong> est un dépôt binaire d'entreprise. Pour npm, CA-TS expose un registry virtuel qui agrège :</p>
      <ul class="wiki-steps">
        <li>Les paquets npm internes CA-TS (<code>@cats-cdf/*</code>, frameworks maison).</li>
        <li>Un miroir contrôlé des paquets publics (via des remotes configurés par l'infra).</li>
      </ul>
      <p>URL du registry npm CA-TS :</p>
      <pre class="wiki-code"><code>registry=https://registry.saas.cagip.group.gca/artifactory/api/npm/cats-npm-virtual/</code></pre>
      <p>Sans cette URL dans <code>.npmrc</code>, <code>npm install</code> tente d'atteindre npmjs.org et échoue derrière le proxy.</p>

      <h3 class="wiki-h3">Anatomie d'un .npmrc CA-TS</h3>
      <pre class="wiki-code"><code>email=votre.matricule@zgie.ztech
always-auth=true
registry=https://registry.saas.cagip.group.gca/artifactory/api/npm/cats-npm-virtual/
//registry.saas.cagip.group.gca/artifactory/api/npm/:_authToken=VOTRE_TOKEN_ICI
SASS_BINARY_SITE=https://repository.saas.cagip.group.gca/artifactory/npm-github-generic-remote/download
strict-ssl=false</code></pre>
      <table class="wiki-table">
        <tr><th>Directive</th><th>Rôle</th></tr>
        <tr><td><code>registry=…</code></td><td>Point d'entrée unique pour tous les <code>npm install</code></td></tr>
        <tr><td><code>always-auth=true</code></td><td>Envoie le token à chaque requête (obligatoire sur Artifactory)</td></tr>
        <tr><td><code>_authToken=…</code></td><td>Jeton d'identité généré dans Artifactory — <strong>ne jamais commiter</strong></td></tr>
        <tr><td><code>SASS_BINARY_SITE</code></td><td>Téléchargement des binaires node-sass via le miroir interne (évite GitHub direct)</td></tr>
        <tr><td><code>strict-ssl=false</code></td><td>Contourne les problèmes de certificats sur certains postes CA-TS — à utiliser tel que fourni par l'assistant</td></tr>
      </table>

      <h3 class="wiki-h3">Obtenir le token Artifactory</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Ouvrir le registry dans le navigateur (connexion <code>MATRICULE@ZGIE.ZTECH</code>).</li>
        <li>Cliquer sur votre profil → <strong>Set Me Up</strong> → sélectionner <strong>npm</strong>.</li>
        <li>Choisir le repository <code>cats-npm-virtual</code>.</li>
        <li>Cliquer <strong>Generate Token &amp; Create Instruction</strong>.</li>
        <li>Copier le token dans l'assistant Wizard .npmrc — il sera injecté dans <code>_authToken</code>.</li>
      </ol>
      <p>L'assistant Wizard encode aussi automatiquement le proxy ZGIE si nécessaire (<code>proxy=</code>, <code>https-proxy=</code>).</p>

      <h3 class="wiki-h3">Où est stocké le .npmrc ?</h3>
      <p>L'assistant écrit typiquement dans <code>%USERPROFILE%\\.npmrc</code> (configuration utilisateur Windows). C'est le fichier lu par npm pour <em>tous</em> vos projets Node sur ce poste. Un <code>.npmrc</code> à la racine du dépôt peut surcharger certaines valeurs pour ce projet uniquement.</p>

      <h3 class="wiki-h3">Vérifier que ça fonctionne</h3>
      <pre class="wiki-code"><code>npm config get registry
npm whoami --registry=https://registry.saas.cagip.group.gca/artifactory/api/npm/cats-npm-virtual/
cd D:\\DEV\\mon-depot-tests
npm install</code></pre>
      <p>Si <code>npm install</code> échoue avec <code>ECONNREFUSED</code>, <code>401 Unauthorized</code> ou <code>fetch failed</code> : token expiré, proxy manquant ou mauvaise URL registry — repassez par l'assistant .npmrc.</p>

      <div class="wiki-callout wiki-callout--info">
        <strong>Lien avec les stacks Node</strong>
        Cypress, Playwright et les outils npm associés s'installent via <code>npm install</code>. Sans .npmrc valide sur poste CA-TS, l'étape « Pré-configuration poste » échouera pour ces stacks.
      </div>

      <p class="wiki-next"><a href="/npmrc.html" class="btn-primary btn-sm">→ Assistant .npmrc</a>
        <a href="/node-install.html" class="btn-secondary btn-sm">→ Installation Node.js</a>
        <a href="/npm-install.html" class="btn-secondary btn-sm">→ Installer NPM</a>
        <a href="/wiki.html#node-npm-volta" class="btn-secondary btn-sm" data-wiki-nav="node-npm-volta">→ Node, npm et Volta</a></p>`,
  },
  {
    id: 'hook-archi',
    title: '5. Architecture Hook Git',
    body: `
        <pre class="wiki-code"><code>0_Hook_Synchro_Ticket_Test_JIRA/
├── hooks.conf          ← plans &amp; suites JIRA
├── hook-run.mjs        ← orchestrateur (point d'entrée unique)
├── hook-debug.log      ← journal d'exécution
├── .env                ← credentials (ne pas commiter)
├── install/
│   ├── post-commit.template
│   └── install-hook.ps1
└── scripts/
    ├── sync-jira.mjs
    ├── xray-sync.mjs
    └── sync-test-suite.mjs

.git/hooks/post-commit  ← copie du template (déclencheur Git)

.wizard-qa/conf/        ← profil Wizard (VS Code)</code></pre>
        <p>Le hook est un pipeline en trois temps : le script Git <code>post-commit</code> lance <code>hook-run.mjs</code> en arrière-plan, qui enchaîne la synchro JIRA, Xray Gherkin et rattachement des suites pour <strong>tous</strong> les plans déclarés dans <code>hooks.conf</code>.</p>
        <p>Depuis le Wizard VS Code, utilisez l'assistant <img src="/assets/logo-git-hook.png" alt="" class="wiki-inline-logo" width="14" height="14" /> <strong>Hook Git</strong> plutôt que la ligne de commande seule.</p>
        <p class="wiki-next"><a href="/hook-git.html" class="btn-primary btn-sm">→ Assistant Hook Git</a></p>`,
  },
  {
    id: 'hook-install',
    title: '6. Installation Hook Git',
    body: `
        <div class="wiki-callout wiki-callout--ok">
          <strong>Via le Wizard (recommandé)</strong>
          L'assistant Hook Git guide <code>.env</code>, <code>hooks.conf</code>, installation post-commit et dry-run.
        </div>

        <h3 class="wiki-h3">Installation standard</h3>
        <ol class="wiki-steps wiki-steps--numbered">
          <li>Configurer <code>.env</code> (JIRA, Xray, proxy HTTPS)</li>
          <li>Paramétrer <code>hooks.conf</code> (plans, dossiers de tests déclarés)</li>
          <li>Installer le hook : script <code>install-hook.ps1</code> ou copie manuelle (voir ci-dessous)</li>
          <li>Valider un <strong>dry-run</strong> favorable depuis le Wizard</li>
          <li>Premier <code>git commit</code> depuis la <em>racine</em> du dépôt</li>
        </ol>

        <h3 class="wiki-h3">Si install-hook.ps1 est bloqué par le SI</h3>
        <p>Le script PowerShell ne fait qu'<strong>une copie de fichier</strong>. Vous pouvez l'installer manuellement — méthode la plus simple quand l'exécution de <code>.ps1</code> est interdite.</p>

        <details class="wiki-fold" open>
          <summary>Méthode 1 — Copie manuelle (Explorateur ou Cmd)</summary>
          <p><strong>Étape 1 :</strong> Copier le template</p>
          <pre class="wiki-code"><code>Source :  …\\0_Hook_Synchro_Ticket_Test_JIRA\\install\\post-commit.template
Cible :   …\\.git\\hooks\\post-commit   (sans extension .template)</code></pre>
          <p>En Cmd (souvent moins bloqué que PowerShell) :</p>
          <pre class="wiki-code"><code>cd /d D:\\DEV\\mon-depot-tests
copy "0_Hook_Synchro_Ticket_Test_JIRA\\install\\post-commit.template" ".git\\hooks\\post-commit"</code></pre>
          <p><strong>Étape 2 :</strong> Vérifier le contenu dans Notepad — vous devez voir :</p>
          <pre class="wiki-code"><code>#!/bin/sh
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_DIR="$REPO_ROOT/0_Hook_Synchro_Ticket_Test_JIRA"
…
COMMIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
"$NODE" hook-run.mjs --commit "$COMMIT_SHA" >> hook-debug.log 2>&1 &</code></pre>
          <p><strong>Étape 3 :</strong> Vérifier l'installation</p>
          <pre class="wiki-code"><code>dir D:\\DEV\\mon-depot-tests\\.git\\hooks\\post-commit
# Git Bash :
test -f .git/hooks/post-commit && echo OK</code></pre>
        </details>

        <details class="wiki-fold">
          <summary>Méthode 2 — Sans hook Git : lancer à la main</summary>
          <p>Si même <code>.git\\hooks</code> est protégé en écriture, lancez la synchro après chaque commit :</p>
          <pre class="wiki-code"><code>cd /d D:\\DEV\\mon-depot-tests\\0_Hook_Synchro_Ticket_Test_JIRA
node hook-run.mjs --commit HEAD
# ou synchro complète :
node hook-run.mjs --force</code></pre>
        </details>

        <details class="wiki-fold">
          <summary>Méthode 3 — Raccourci sync-jira.bat</summary>
          <p>Créer à la racine du dépôt un fichier <code>sync-jira.bat</code> (souvent autorisé par le SI) :</p>
          <pre class="wiki-code"><code>@echo off
cd /d D:\\DEV\\mon-depot-tests\\0_Hook_Synchro_Ticket_Test_JIRA
node hook-run.mjs --force
pause</code></pre>
          <p>Double-clic après un commit → synchro complète.</p>
        </details>

        <h3 class="wiki-h3">Alternatives selon ce que bloque le SI</h3>
        <table class="wiki-table">
          <tr><th>Bloqué</th><th>Alternative</th></tr>
          <tr><td><code>*.ps1</code></td><td><code>copy</code> en Cmd ou copie Explorateur</td></tr>
          <tr><td>Écriture <code>.git\\hooks</code></td><td><code>node hook-run.mjs --force</code> manuel</td></tr>
          <tr><td>Exécution scripts</td><td>Fichier <code>.bat</code> ou <code>node</code> direct</td></tr>
          <tr><td><code>node</code> hors PATH dans Git Bash</td><td>Chemin complet : <code>"C:\\Program Files\\nodejs\\node.exe"</code> — trouver avec <code>where node</code></td></tr>
        </table>
        <p>Si Node n'est pas trouvé par le hook, remplacer dans <code>post-commit</code> la ligne <code>NODE=node</code> par :</p>
        <pre class="wiki-code"><code>NODE="/c/Program Files/nodejs/node.exe"</code></pre>

        <h3 class="wiki-h3">Vérifier la bonne version installée</h3>
        <p><strong>1. post-commit = template ?</strong></p>
        <pre class="wiki-code"><code>cd D:\\DEV\\mon-depot-tests
# PowerShell :
$installed = Get-Content ".git\\hooks\\post-commit" -Raw
$template  = Get-Content "0_Hook_Synchro_Ticket_Test_JIRA\\install\\post-commit.template" -Raw
$installed -eq $template   # True = bonne version</code></pre>
        <p>Lignes clés attendues : <code>HOOK_DIR="$REPO_ROOT/0_Hook_Synchro_Ticket_Test_JIRA"</code>, <code>COMMIT_SHA=…</code>, <code>hook-run.mjs --commit "$COMMIT_SHA"</code>, <code>>> hook-debug.log 2>&1 &amp;</code></p>

        <p><strong>2. hook-run.mjs valide ?</strong></p>
        <pre class="wiki-code"><code>node --check 0_Hook_Synchro_Ticket_Test_JIRA\\hook-run.mjs</code></pre>
        <p>Doit contenir : point d'entrée <code>--force</code>, boucle sur <code>config.plans</code>, <code>--delete-orphans</code> — pas l'ancien mode <code>--hook --files</code>.</p>

        <p><strong>3. Test fonctionnel</strong></p>
        <pre class="wiki-code"><code>node 0_Hook_Synchro_Ticket_Test_JIRA\\hook-run.mjs --commit HEAD
Get-Content 0_Hook_Synchro_Ticket_Test_JIRA\\hook-debug.log -Tail 10</code></pre>
        <p>Attendu : <code>hook-run déclenché</code>, <code>COMMIT=… | CHANGED=…</code>. Si <code>Aucun .feature configuré modifié</code> → le hook fonctionne mais le dernier commit ne touche pas un dossier déclaré dans <code>hooks.conf</code>.</p>

        <h3 class="wiki-h3">Checklist sans install-hook.ps1</h3>
        <ul class="wiki-steps">
          <li>□ <code>post-commit.template</code> copié → <code>.git\\hooks\\post-commit</code></li>
          <li>□ <code>hook-run.mjs</code> présent dans le dossier hook</li>
          <li>□ <code>.env</code> présent et rempli</li>
          <li>□ <code>node hook-run.mjs --commit HEAD</code> → log dans <code>hook-debug.log</code></li>
        </ul>

        <p class="wiki-next"><a href="/hook-git.html" class="btn-primary btn-sm">→ Assistant Hook Git</a>
        <a href="/hook-git.html#dry-run" class="btn-secondary btn-sm">→ Dry-run</a></p>`,
  },
  {
    id: 'hook-config',
    title: '7. hooks.conf & .env',
    body: `
        <h3 class="wiki-h3">Section [defaults]</h3>
        <pre class="wiki-code"><code>[defaults]
project=PRODUIT
label=TR_MonProjet
exclude_dirs=_legacy,_archive
jira_indexation_delay_sec=9</code></pre>
        <h3 class="wiki-h3">Section [plan]</h3>
        <pre class="wiki-code"><code>[plan]
folder=PRODUIT-9235_Smoke_Tests
plan_key=PRODUIT-9235
suite_key=PRODUIT-10655</code></pre>
        <table class="wiki-table">
          <tr><th>Clé</th><th>Description</th></tr>
          <tr><td><code>folder</code></td><td>Nom <strong>exact</strong> du dossier à la racine du dépôt</td></tr>
          <tr><td><code>plan_key</code></td><td>Clé JIRA du plan de test Xray</td></tr>
          <tr><td><code>suite_key</code></td><td>Suite parente déclarée dans <code>[suite]</code></td></tr>
        </table>
        <div class="wiki-callout wiki-callout--warn">
          <strong>Attention espaces</strong>
          Le nom <code>folder=</code> doit correspondre au disque au caractère près (casse, tirets, espaces). Vérifiez avec l'explorateur Windows ou <code>dir</code>.
        </div>
        <h3 class="wiki-h3">Variables .env</h3>
        <pre class="wiki-code"><code>JIRA_EMAIL=…
JIRA_TOKEN=…
HTTPS_PROXY=http://proxy…:8080
XRAY_CLIENT_ID=…
XRAY_CLIENT_SECRET=…</code></pre>
        <p>Les credentials saisis lors du profil projet sont recopiés automatiquement vers le <code>.env</code> du Hook Git.</p>`,
  },
  {
    id: 'hook-fonctionnement',
    title: '8. Fonctionnement du hook',
    body: `
        <pre class="wiki-code wiki-code--flow"><code>git commit -m "…"
    │
    ▼
.git/hooks/post-commit  (arrière-plan, silencieux)
    │
    ▼
hook-run.mjs --commit SHA
    ├─ sync-jira.mjs       → création / renommage / suppression tickets
    ├─ xray-sync.mjs       → Gherkin + Testing Board
    └─ sync-test-suite.mjs → rattachement suites</code></pre>
        <p>Le hook ne part que si le commit modifie au moins un fichier <code>.feature</code> dans un dossier déclaré dans <code>hooks.conf</code>. Sinon le log indique <code>Aucun .feature configuré modifié</code> — comportement normal.</p>
        <p>Pour forcer une réconciliation complète de tous les plans :</p>
        <pre class="wiki-code"><code>node hook-run.mjs --force
node hook-run.mjs --force --dry-run</code></pre>
        <div class="wiki-callout wiki-callout--info">
          <strong>Rien dans le terminal ?</strong>
          Le hook tourne en arrière-plan. Tout est dans <code>hook-debug.log</code>, pas dans la console du commit.
        </div>`,
  },
  {
    id: 'sync-jira',
    title: '9. Sync JIRA (Wizard)',
    body: `
        <p>La page <strong>Sync JIRA — Xray Cloud</strong> comporte deux étapes distinctes :</p>
        <ul class="wiki-steps">
          <li><strong>Étape 1 — Analyse des écarts</strong> — dry-run plan par plan, sans modification dans JIRA / Xray.</li>
          <li><strong>Étape 2 — Appliquer la synchronisation</strong> — écriture Local → JIRA / Xray après aperçu et confirmation.</li>
        </ul>
        <p>Hook Git configuré et dry-run Hook validé requis avant d'accéder à cette page.</p>
        <ol class="wiki-steps wiki-steps--numbered">
          <li>Configurer Hook Git (étapes précédentes)</li>
          <li>Ouvrir Sync JIRA depuis l'accueil</li>
          <li>Lancer l'analyse des écarts</li>
          <li>Synchroniser vers JIRA si nécessaire</li>
        </ol>
        <p class="wiki-next"><a href="/project.html" class="btn-primary btn-sm">→ Ouvrir Sync JIRA</a></p>`,
  },
]

var WikiSectionsTail = [
  {
    id: 'stack-questionnaire-guide',
    title: '14. Questionnaire stack — personnaliser les questions',
    body: `
        <p>Le questionnaire « Définir votre application de test automatisée » est entièrement piloté par un fichier JSON dans votre dépôt. Vous pouvez <strong>ajouter, modifier ou retirer des questions</strong> sans recompiler l'extension.</p>

        <h3 class="wiki-h3">Fichiers concernés</h3>
        <table class="wiki-table">
          <tr><th>Fichier</th><th>Emplacement</th><th>Usage</th></tr>
          <tr>
            <td><code>stack-questionnaire.conf.json</code></td>
            <td><code>.wizard-qa/conf/</code></td>
            <td><strong>Fichier actif</strong> — seul fichier lu par le wizard à chaque lancement. C'est celui que vous éditez.</td>
          </tr>
          <tr>
            <td><code>stack-questionnaire.conf.reference.json</code></td>
            <td>Extension (<code>server/conf/</code>)</td>
            <td><strong>Référence versionnée</strong> — modèle commenté ; copié une fois si le fichier actif est absent. Ouvrable depuis <strong>Paramétrage du Wizard</strong>.</td>
          </tr>
        </table>

        <h3 class="wiki-h3">Chaîne de fonctionnement</h3>
        <pre class="wiki-code"><code>stack-questionnaire.conf.json
  → serveur (parse JSONC + balises @wizard-qa)
  → GET /api/project/stack-questionnaire
  → accueil : une entrée "questions[]" = une page du wizard
  → POST /api/project/stack-recommendation → camemberts Cypress / Robot / Playwright / Postman</code></pre>
        <p>La barre de progression et le décompte des étapes s'adaptent automatiquement au nombre d'entrées dans <code>questions</code>.</p>

        <h3 class="wiki-h3">Ajouter une question — pas à pas</h3>
        <ol class="wiki-steps wiki-steps--numbered">
          <li>Ouvrez <code>.wizard-qa/conf/stack-questionnaire.conf.json</code> (accueil → <strong>Paramétrage du Wizard</strong> → <em>Ouvrir dans VS Code</em>, ou copiez la structure depuis la référence extension).</li>
          <li>Dans le tableau <code>questions</code>, entre les balises <code>// @wizard-qa:questions-debut</code> et <code>// @wizard-qa:questions-fin</code>, ajoutez un nouvel objet <strong>après la virgule</strong> de la question précédente.</li>
          <li>Attribuez un <code>id</code> unique (camelCase, sans espace) — il sert de clé pour les réponses enregistrées.</li>
          <li>Renseignez <code>title</code>, <code>question</code>, optionnellement <code>hint</code>, puis le tableau <code>options</code>.</li>
          <li>Pour chaque option : <code>id</code>, <code>label</code> et <code>weights</code> (points par stack : <code>cypress</code>, <code>robot</code>, <code>playwright</code>, <code>postman</code>).</li>
          <li>Enregistrez, rechargez la fenêtre VS Code si besoin, relancez le questionnaire depuis l'accueil.</li>
        </ol>

        <h3 class="wiki-h3">Exemple — nouvelle question</h3>
        <pre class="wiki-code"><code>// ========== Page de question N° 16 — Charge applicative (id: perfLoad) ==========
{
  "id": "perfLoad",
  "title": "Charge et performance",
  "question": "Devez-vous valider le comportement sous forte charge ?",
  "hint": "Tests de charge lourds orientent plutôt vers des outils dédiés ; ici on parle d'intégration dans la stack QA.",
  "options": [
    {
      "id": "yes",
      "label": "Oui, des scénarios de montée en charge font partie du périmètre",
      "weights": { "playwright": 2, "robot": 2 }
    },
    {
      "id": "no",
      "label": "Non, tests fonctionnels classiques uniquement",
      "weights": { "cypress": 1, "postman": 1 }
    }
  ]
}</code></pre>

        <h3 class="wiki-h3">Commentaires et formatage</h3>
        <ul class="wiki-steps">
          <li>Le fichier accepte le <strong>JSONC</strong> : commentaires <code>//</code> et virgules finales tolérées.</li>
          <li>Balises réservées : <code>// @wizard-qa:configuration-debut/fin</code> (métadonnées) et <code>// @wizard-qa:questions-debut/fin</code> (tableau des pages).</li>
          <li>Convention : <code>// ========== Page de question N° X — Titre (id: monId) ==========</code> avant chaque objet.</li>
          <li>Depuis le dossier extension : <code>npm run format-stack-questionnaire</code> (ou avec chemin explicite vers votre fichier) pour réindenter et réinjecter les balises.</li>
        </ul>

        <div class="wiki-callout wiki-callout--warn">
          <strong>Erreurs fréquentes</strong>
          <ul class="wiki-steps">
            <li><code>id</code> dupliqué dans deux questions → comportement imprévisible.</li>
            <li>Virgule manquante entre deux objets du tableau <code>questions</code> → JSON invalide, questionnaire non chargé.</li>
            <li>Modifier uniquement la référence extension sans toucher <code>.wizard-qa/conf/</code> → aucun effet sur votre dépôt.</li>
          </ul>
        </div>

        <h3 class="wiki-h3">Vérifier que le wizard a bien pris en compte vos changements</h3>
        <p>Après édition, le questionnaire sur l'accueil doit afficher le nouveau nombre d'étapes. En diagnostic, l'API locale expose <code>questionCount</code> et la liste des <code>questionIds</code> :</p>
        <pre class="wiki-code"><code>curl http://127.0.0.1:3920/api/project/stack-questionnaire</code></pre>

        <p class="wiki-next">
          <a href="/" class="btn-primary btn-sm">→ Accueil — lancer le questionnaire</a>
          <a href="/wiki.html#fichiers" class="btn-secondary btn-sm">→ Fichiers .wizard-qa/conf</a>
        </p>`,
  },
  {
    id: 'doc-qa-assistant',
    title: '15. Documentation QA — assistant guidé',
    body: `
        <p>La page <strong>Documentation QA</strong> (<code>/doc-qa.html</code>) est un assistant pas à pas pour produire les livrables Word du pack CA-TS. Elle s'adresse aux profils QA, PO, BA, Scrum Master ou développeur — sans expertise IA requise.</p>

        <h3 class="wiki-h3">Parcours en 4 zones</h3>
        <ol class="wiki-steps wiki-steps--numbered">
          <li><strong>Choisir le document</strong> — carte avec objectif, statut global et progression (chapitres complétés / total).</li>
          <li><strong>Liste des chapitres</strong> — chaque ligne affiche le statut (à compléter, prompt généré, réponse collée, appliqué, à relire…).</li>
          <li><strong>Détail du chapitre</strong> — objectif, données attendues, sources utilisées, informations manquantes ; les détails techniques sont repliés.</li>
          <li><strong>Assistant IA</strong> — workflow en 5 étapes : générer le prompt → copier dans Copilot → coller la réponse → extraire le bloc → appliquer au document Word.</li>
        </ol>

        <h3 class="wiki-h3">Prompt IA et format de réponse</h3>
        <p>Le prompt généré impose à l'agent IA :</p>
        <ul class="wiki-steps">
          <li>un rôle de <strong>consultant QA senior</strong> ;</li>
          <li>l'interdiction d'inventer une information projet absente ;</li>
          <li>le marqueur <code>[À COMPLÉTER]</code> pour toute donnée manquante ;</li>
          <li>une réponse <strong>uniquement</strong> entre <code>&lt;!-- DOC_QA_BLOCK_START --&gt;</code> et <code>&lt;!-- DOC_QA_BLOCK_END --&gt;</code>.</li>
        </ul>
        <p>L'assistant extrait automatiquement le contenu entre ces marqueurs avant injection dans le fichier <code>.docx</code>. Un aperçu est affiché avant application.</p>

        <h3 class="wiki-h3">Fichiers de progression (v1.33+)</h3>
        <table class="wiki-table">
          <tr><th>Fichier / dossier</th><th>Rôle</th></tr>
          <tr><td><code>.wizard-qa/doc-qa-progress.json</code></td><td>Statut par chapitre (prompt généré, réponse collée, appliqué…), dates, champs manquants</td></tr>
          <tr><td><code>.wizard-qa/doc-qa-prompts/</code></td><td>Archives des prompts générés (un fichier <code>.md</code> par génération)</td></tr>
          <tr><td><code>wizard.defaults.json</code> → <code>docQa</code></td><td>Scans Word, injections chapitre, chemins des derniers prompts</td></tr>
        </table>
        <p>Ces éléments sont inclus dans l'<strong>export / import</strong> de l'accueil (bundle <code>wizard-qa-bundle</code> v3).</p>

        <p class="wiki-next"><a href="/doc-qa.html" class="btn-primary btn-sm">→ Ouvrir Documentation QA</a></p>`,
  },
  {
    id: 'fichiers',
    title: '16. Fichiers Wizard (.wizard-qa/conf)',
    body: `
        <p>Vue d'ensemble des fichiers de configuration — détail par fichier dans la section <strong>3. Profil projet</strong>.</p>
        <table class="wiki-table">
          <tr><th>Fichier</th><th>Rôle</th></tr>
          <tr><td><code>wizard.defaults.json</code></td><td>État global Wizard (profil, npmrc, hook, stack)</td></tr>
          <tr><td><code>project.variables.json</code></td><td>Variables projet pour livrables (secrets)</td></tr>
          <tr><td><code>doc-qa-templates.conf.json</code></td><td>Structure des 13 livrables Word Documentation QA, régénérable via <code>generate-doc-qa-templates-conf.py</code></td></tr>
          <tr><td><code>onboarding.snapshot.json</code></td><td>Prise de connaissance + questionnaire stack</td></tr>
          <tr><td><code>stack-questionnaire.conf.json</code></td><td>Pages du questionnaire stack (éditable — voir section 14)</td></tr>
          <tr><td><code>stack-questionnaire.conf.reference.json</code></td><td>Modèle extension (référence, copie initiale)</td></tr>
          <tr><td><code>npm-install.conf.json</code></td><td>Versions Node/npm, paquets npm, commande Volta</td></tr>
          <tr><td><code>cypress-install.conf.json</code></td><td>Commandes npm de l'assistant Installer Cypress</td></tr>
          <tr><td><code>playwright-install.conf.json</code></td><td>Commandes npm/npx Playwright + extension VS Code</td></tr>
          <tr><td><code>robot-install.conf.json</code></td><td>Commandes pip/python Robot Framework</td></tr>
          <tr><td><code>postman-init.conf.json</code></td><td>Nom projet API, baseUrl — scaffold collections Postman</td></tr>
          <tr><td><code>postman-install.conf.json</code></td><td>Scaffold postman/ + installation Newman (CLI)</td></tr>
          <tr><td><code>k6-init.conf.json</code></td><td>URL cible, VUs, durée — scaffold k6/</td></tr>
          <tr><td><code>k6-install.conf.json</code></td><td>Scaffold k6/ + @types/k6 + binaire Grafana k6</td></tr>
          <tr><td><code>k6-perf-questionnaire.conf.json</code></td><td>Wizard performance — 40+ questions (10 sections)</td></tr>
          <tr><td><code>k6-profiles/</code></td><td>Profils de campagne sauvegardés (export/import)</td></tr>
          <tr><td><code>k6-history/runs.json</code></td><td>Historique des exécutions k6</td></tr>
          <tr><td><code>ui-wording.conf.json</code></td><td>Textes des pop-ups Wizard (disclaimers, intros stacks)</td></tr>
          <tr><td><code>ui-wording.preferences.json</code></td><td>Pop-ups masqués via « Ne plus afficher » — le pop-up d'accueil (<code>launchDisclaimer</code>) réapparaît automatiquement à chaque nouvelle version VSIX</td></tr>
          <tr><td><code>wizard.paths.json</code></td><td>Chemins avancés (optionnel)</td></tr>
          <tr><td><code>.wizard-qa/doc-qa-progress.json</code></td><td>Progression Documentation QA par chapitre (v1.33+)</td></tr>
          <tr><td><code>.wizard-qa/doc-qa-prompts/</code></td><td>Archives des prompts Documentation QA générés</td></tr>
        </table>
        <p>Accédez au paramétrage depuis l'accueil : tuile <strong>Paramétrage Wizard</strong> ou bouton homonyme — boutons <em>Ouvrir dans VS Code</em> pour chaque fichier.</p>
        <p><strong>Export / import (accueil)</strong> : le bouton <em>Exporter</em> produit un bundle <code>wizard-qa-bundle</code> (v3) contenant <code>wizard.defaults.json</code>, les fichiers présents dans <code>.wizard-qa/conf/</code>, la progression Documentation QA (<code>doc-qa-progress.json</code>) et les prompts archivés (<code>doc-qa-prompts/</code>). L'<em>Importer</em> restaure ces fichiers ; cochez <em>Appliquer après import</em> pour réinjecter npmrc / hook si besoin ; décochez <em>Secrets</em> pour anonymiser tokens JIRA/npm avant partage.</p>
        <p class="wiki-next"><a href="/cypress-install.html" class="btn-secondary btn-sm">→ Installer Cypress</a> <a href="/playwright-install.html" class="btn-secondary btn-sm">→ Playwright</a> <a href="/robot-install.html" class="btn-secondary btn-sm">→ Robot</a> <a href="/postman-install.html" class="btn-secondary btn-sm">→ Postman</a> <a href="/k6-install.html" class="btn-secondary btn-sm">→ k6</a></p>
        <p class="wiki-next"><a href="/wiki.html#stack-questionnaire-guide" class="btn-primary btn-sm">→ Personnaliser le questionnaire stack</a></p>`,
  },
  {
    id: 'debug',
    title: '17. Debug & dépannage',
    body: `
        <h3 class="wiki-h3">Prompt DEBUG Copilot (v1.17.4+)</h3>
        <p>Sur les pages <strong>Hook Git</strong>, <strong>Sync JIRA</strong>, <strong>Node</strong>, <strong>.npmrc</strong>, <strong>Installer NPM</strong>, les assistants <strong>Cypress / Playwright / Robot / Postman</strong> et <strong>Documentation QA</strong>, le bouton <em>Prompt DEBUG Copilot</em> (en bas de la colonne nav, sous Accueil et les liens secondaires) lance le parcours suivant :</p>
        <ol class="wiki-steps wiki-steps--numbered">
          <li><strong>Loader</strong> — logo QA animé, génération des logs verbeux puis du prompt</li>
          <li><strong>Modale prompt</strong> — estimation <strong>tokens</strong>, badges pré-vol, copie, sauvegarde <code>.md</code>, dossier logs ; sous le bandeau vert « Prompt enrichi », une consigne indique de <strong>fermer la fenêtre (×)</strong> pour passer à l'étape suivante</li>
          <li><strong>Contrôle DEBUG IA</strong> — après fermeture du prompt (ou clic sur le bouton si une session est encore ouverte) :
            <ul class="wiki-steps">
              <li><strong>Étape 1</strong> : « Le prompt précédent… a-t-il permis à l'agent de réparer la fonctionnalité ? » — boutons <strong>OUI</strong> / <strong>NON</strong> + texte en gras expliquant que <strong>NON</strong> relance les logs de la dernière exécution et permet d'enrichir le prompt jusqu'à résolution</li>
              <li><strong>Étape 2</strong> (après <strong>NON</strong> uniquement) : zone d'enrichissement optionnel + bouton <em>Générer le prompt avec les logs de la dernière exécution</em></li>
              <li><strong>OUI</strong> : clôture la session et enregistre la mémoire agent projet</li>
            </ul>
          </li>
        </ol>
        <p><strong>Navigation :</strong> quitter la page supprime les modales DEBUG de l'interface (pas de pop-up « fantôme » au retour). La session serveur reste active : rouvrir <em>Prompt DEBUG Copilot</em> sur la même page reprend le contrôle. Aucun pop-up automatique au simple chargement de la page.</p>

        <h3 class="wiki-h3">Journaux capturés par page (console / terminal)</h3>
        <table class="wiki-table">
          <tr><th>Page (scope)</th><th>Sources lues pour le prompt</th></tr>
          <tr><td>Hook Git (<code>hook-git</code>)</td><td>Console dry-run (<code>#exitDryRunConsole</code>)</td></tr>
          <tr><td>Sync JIRA (<code>sync-jira</code>)</td><td>Consoles analyse + sync local</td></tr>
          <tr><td>Installation Node.js (<code>node-install</code>)</td><td><code>#nodeInstallLog</code> (sortie Volta), <code>#packageJsonLog</code>, <code>#status</code></td></tr>
          <tr><td>Configuration .npmrc (<code>npmrc</code>)</td><td><code>#diffBanner</code>, <code>#status</code> (pas de terminal dédié sur cette page)</td></tr>
          <tr><td>Installer NPM (<code>npm-install</code>)</td><td><code>#npmInstallLog</code> (sortie <code>npm install</code>), panneau <code>#npmInstallPanel</code>, <code>#status</code></td></tr>
          <tr><td>Installer Cypress (<code>cypress-install</code>)</td><td><code>#cypressInstallLog</code>, <code>#status</code></td></tr>
          <tr><td>Installer Playwright (<code>playwright-install</code>)</td><td><code>#playwrightInstallLog</code>, <code>#status</code></td></tr>
          <tr><td>Installer Robot (<code>robot-install</code>)</td><td><code>#robotInstallLog</code>, <code>#status</code></td></tr>
          <tr><td>Postman / Newman (<code>postman-install</code>)</td><td><code>#postmanInstallLog</code>, <code>#status</code></td></tr>
          <tr><td>k6 performance (<code>k6-install</code>)</td><td><code>#k6InstallLog</code>, <code>#status</code></td></tr>
          <tr><td>Documentation QA (<code>doc-qa</code>)</td><td>Console page (<code>#console</code>)</td></tr>
        </table>
        <p>Les logs verbeux persistants sont aussi écrits dans <code>.wizard-qa/logs/debug/&lt;scope&gt;/</code>.</p>

        <h3 class="wiki-h3">Fichiers et script CLI</h3>
        <ul class="wiki-steps">
          <li>Sessions actives : <code>.wizard-qa/conf/debug-sessions/</code></li>
          <li>Mémoire agent (résolutions) : <code>.wizard-qa/conf/debug-agent-memory/</code></li>
          <li>Régénération hors UI :</li>
        </ul>
        <pre class="wiki-code"><code>node server/scripts/regen-debug-prompt.mjs --scope hook-git --last --write
node server/scripts/regen-debug-prompt.mjs --session &lt;id&gt;</code></pre>

        <h3 class="wiki-h3">Bouton Accueil (nouvelles pages)</h3>
        <p>Pour tout retour au catalogue depuis une page compacte (npm, Node, hook…), utilisez le <strong>modèle standard</strong> — la mise en page pleine largeur est gérée par <code>wizard-home-shell.js</code> (v1.16.8+) :</p>
        <pre class="wiki-code"><code>&lt;a href="/" class="btn-hub-home" title="Retour au catalogue"&gt;Accueil&lt;/a&gt;</code></pre>
        <p>En JavaScript : <code>Portail.navigateHome()</code> ou <code>Portail.navigateTo('/')</code>. Ne pas utiliser <code>window.location.href = '/'</code> dans l'extension VS Code (perd le shell <code>vscode-app</code>).</p>

        <h3 class="wiki-h3">Le hook ne se lance pas après commit</h3>
        <ol class="wiki-steps wiki-steps--numbered">
          <li><strong>Hook installé ?</strong> <code>Test-Path ".git\\hooks\\post-commit"</code> → si False, copie manuelle (section 6).</li>
          <li><strong>Log vide ?</strong> Le hook Git ne s'est pas exécuté — vérifier Node, PATH, contenu <code>post-commit</code>.</li>
          <li><strong>Commit touche un .feature ?</strong> <code>git diff-tree --name-status -r HEAD</code> doit lister un <code>.feature</code> dans un dossier <code>hooks.conf</code>.</li>
        </ol>

        <table class="wiki-table">
          <tr><th>Message dans hook-debug.log</th><th>Signification</th></tr>
          <tr><td>(vide après commit)</td><td>Hook non exécuté — installation ou Node</td></tr>
          <tr><td><code>hook-run déclenché</code></td><td>OK — hook démarré</td></tr>
          <tr><td><code>Aucun .feature configuré modifié</code></td><td>Normal si le commit ne touche pas un dossier du hook</td></tr>
          <tr><td><code>CHANGED=(vide)</code></td><td>Commiter depuis la racine, pas depuis le sous-dossier hook</td></tr>
          <tr><td><code>ERREUR hooks.conf</code></td><td>Syntaxe ou chemin invalide dans hooks.conf</td></tr>
        </table>

        <h3 class="wiki-h3">3 commandes de diagnostic</h3>
        <pre class="wiki-code"><code>cd D:\\DEV\\mon-depot-tests
# 1. Hook = template ?
(Compare-Object (Get-Content ".git\\hooks\\post-commit") (Get-Content "0_Hook_Synchro_Ticket_Test_JIRA\\install\\post-commit.template")) -eq $null
# 2. hook-run.mjs valide ?
node --check 0_Hook_Synchro_Ticket_Test_JIRA\\hook-run.mjs
# 3. Fonctionne ?
node 0_Hook_Synchro_Ticket_Test_JIRA\\hook-run.mjs --commit HEAD
Get-Content 0_Hook_Synchro_Ticket_Test_JIRA\\hook-debug.log -Tail 5</code></pre>

        <table class="wiki-table">
          <tr><th>Symptôme</th><th>Action</th></tr>
          <tr><td><code>fetch failed</code></td><td>Vérifier <code>.env</code> et <code>HTTPS_PROXY</code></td></tr>
          <tr><td>Dossier introuvable</td><td>Aligner <code>folder=</code> dans hooks.conf avec le disque</td></tr>
          <tr><td>Sync JIRA bloquée</td><td>Hook Git + dry-run OK requis</td></tr>
          <tr><td>npm install échoue</td><td>Reconfigurer .npmrc / token Artifactory — puis Node/Volta (section 4 bis)</td></tr>
          <tr><td>Accueil sans mise en page (extension)</td><td>v1.16.8+ : <code>wizard-home-shell.js</code> réapplique <code>page-home</code> / pleine largeur après chaque navigation — bouton standard <code>&lt;a href="/" class="btn-hub-home"&gt;</code> ; recharger VS Code après installation du VSIX</td></tr>
          <tr><td>Pop-up d'introduction absent</td><td>Normal si « Ne plus afficher » a été coché sur la <em>même</em> version VSIX — une <strong>nouvelle version</strong> (ex. 1.16.6+) réaffiche <code>launchDisclaimer</code> une fois ; sinon supprimer <code>launchDisclaimer</code> dans <code>.wizard-qa/conf/ui-wording.preferences.json</code></td></tr>
        </table>`,
  },
  {
    id: 'pieges',
    title: '17. Pièges connus',
    body: `
        <div class="wiki-callout wiki-callout--warn">
          <strong>Commiter depuis la racine</strong>
          <code>git add .</code> depuis un sous-dossier du dépôt n'ajoute pas les campagnes de tests à la racine.
        </div>
        <div class="wiki-callout wiki-callout--warn">
          <strong>Ne pas commiter .env</strong>
          Fichier listé dans <code>.gitignore</code> — contient tokens JIRA et Xray.
        </div>
        <div class="wiki-callout wiki-callout--warn">
          <strong>Anciens dossiers non synchronisés</strong>
          Les dossiers <code>_legacy_*</code> ou anciennes arborescences non déclarées dans <code>hooks.conf</code> sont ignorés par le hook.
        </div>
        <p>Le hook ne remplace pas <code>git push</code> : il synchronise JIRA/Xray localement après le commit.</p>`,
  },
  {
    id: 'glossaire',
    title: '18. Glossaire',
    body: `
        <table class="wiki-table">
          <tr><th>Terme</th><th>Définition</th></tr>
          <tr><td>Commit</td><td>Instantané versionné Git — déclenche le hook post-commit</td></tr>
          <tr><td>post-commit</td><td>Hook Git exécuté après commit réussi</td></tr>
          <tr><td>Test ID</td><td>Identifiant du scénario (ex. SCN_001.01) — clé de correspondance JIRA</td></tr>
          <tr><td>dry-run</td><td>Simulation sans appel API JIRA/Xray</td></tr>
          <tr><td>Orphelin</td><td>Ticket JIRA sans .feature correspondant → supprimé par le hook</td></tr>
          <tr><td>Artifactory</td><td>Registry binaire JFrog — héberge le npm virtuel CA-TS</td></tr>
          <tr><td>Node.js</td><td>Moteur JavaScript — exécute Cypress, scripts .mjs, outils CLI</td></tr>
          <tr><td>npm</td><td>Gestionnaire de paquets Node — <code>npm install</code>, scripts <code>npm run</code></td></tr>
          <tr><td>Volta</td><td>Gestionnaire de versions Node/npm sur poste Windows (%LOCALAPPDATA%\\Volta)</td></tr>
          <tr><td>package.json</td><td>Manifeste du projet Node — dépendances et scripts npm</td></tr>
          <tr><td>Gherkin</td><td>Langage Given/When/Then des fichiers .feature</td></tr>
          <tr><td>Stash</td><td>Pile Git de modifications temporairement rangées</td></tr>
        </table>`,
  },
]

function wikiInsertAfterSection(sections, afterId, insert) {
  if (!insert?.length) return sections
  const idx = sections.findIndex((s) => s.id === afterId)
  if (idx === -1) return sections.concat(insert)
  return [
    ...sections.slice(0, idx + 1),
    ...insert,
    ...sections.slice(idx + 1),
  ]
}

var WikiSectionsNodeInsert = typeof WikiSectionNodeNpmVolta !== 'undefined'
  ? [WikiSectionNodeNpmVolta]
  : []

var WikiSections = wikiInsertAfterSection(
  WikiSectionsCore,
  'npmrc',
  WikiSectionsNodeInsert,
).concat(
  typeof WikiStackSections !== 'undefined' ? WikiStackSections : [],
  WikiSectionsTail,
)
