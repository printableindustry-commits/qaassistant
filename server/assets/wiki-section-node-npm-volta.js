/**
 * Wiki — section Node.js, npm et Volta (installation poste CA-TS).
 */
// eslint-disable-next-line no-var
var WikiSectionNodeNpmVolta = {
  id: 'node-npm-volta',
  title: '4 bis. Node, npm et Volta',
  body: `
      <p>Cette section explique <strong>Node.js</strong>, <strong>npm</strong> et <strong>Volta</strong> — trois briques indispensables pour les stacks Node du Wizard (Cypress, Playwright, outils npm). Elle décrit comment les installer sur un poste CA-TS et liste les commandes usuelles avec leur rôle.</p>

      <div class="wiki-callout wiki-callout--info">
        <strong>Assistant Wizard</strong>
        Parcours en trois pages : <a href="/npmrc.html">Configuration .npmrc</a> → <a href="/node-install.html">Installation Node.js</a> → <a href="/npm-install.html">Installer NPM</a>. La <strong>pyramide sur l'accueil</strong> résume les dépendances et l'état de chaque étape.
      </div>

      <p class="wiki-next">
        <a href="/node-install.html" class="btn-primary btn-sm">→ Installation Node.js</a>
        <a href="/npm-install.html" class="btn-secondary btn-sm">→ Installer NPM</a>
        <a href="/npmrc.html" class="btn-secondary btn-sm">→ Assistant .npmrc</a>
      </p>

      <h3 class="wiki-h3">Node.js — qu'est-ce que c'est ?</h3>
      <p><strong>Node.js</strong> est un environnement d'exécution JavaScript <em>hors navigateur</em>. Il permet de lancer des outils en ligne de commande : Cypress, Playwright, scripts de build, le serveur du Wizard QA, le hook Git (<code>hook-run.mjs</code>), etc.</p>
      <p>Chaque version de Node est identifiée par un numéro semver (<code>22.12.0</code>, <code>20.18.0</code>…). Sur Windows, l'exécutable principal est <code>node.exe</code>. Vérifier la version installée :</p>
      <pre class="wiki-code"><code>node -v
node --version</code></pre>

      <h3 class="wiki-h3">npm — qu'est-ce que c'est ?</h3>
      <p><strong>npm</strong> (Node Package Manager) est le gestionnaire de paquets livré avec Node. Il télécharge les bibliothèques JavaScript listées dans <code>package.json</code> (Cypress, axios, <code>@cats-cdf/e2e</code>…) depuis un <strong>registry</strong>.</p>
      <ul class="wiki-steps">
        <li>Sur Internet : <code>registry.npmjs.org</code> par défaut.</li>
        <li>En entreprise CA-TS : registry interne <strong>JFrog Artifactory</strong> — configuré via <code>.npmrc</code> (voir section 4).</li>
      </ul>
      <p>Sans Node correctement installé et sans <code>.npmrc</code> valide, <code>npm install</code> échoue sur poste CA-TS.</p>
      <pre class="wiki-code"><code>npm -v
npm --version</code></pre>

      <h3 class="wiki-h3">Volta — qu'est-ce que c'est ?</h3>
      <p><strong>Volta</strong> est un gestionnaire de versions Node/npm pour Windows (et autres OS). Sur les postes CA-TS, il est souvent déployé dans :</p>
      <pre class="wiki-code"><code>%LOCALAPPDATA%\\Volta
ex. C:\\Users\\VotreMatricule\\AppData\\Local\\Volta</code></pre>
      <p>Volta permet de :</p>
      <ul class="wiki-steps">
        <li>Installer et basculer entre plusieurs versions de Node sans droits administrateur.</li>
        <li>Épingler une version par projet (<code>volta pin</code> / champ <code>volta</code> dans <code>package.json</code>).</li>
        <li>Exécuter <code>node</code> et <code>npm</code> via des shims dans <code>Volta\\bin</code>.</li>
      </ul>
      <p>Structure utile sur disque :</p>
      <pre class="wiki-code"><code>Volta/
├── bin/              ← node.exe, npm.cmd, volta.exe (shims)
└── tools/
    ├── inventory/node/   ← archives / dépôts Node (utilisé par le Wizard)
    └── image/node/       ← toolchains actives après volta install</code></pre>
      <p>Le Wizard peut télécharger un <code>node-vXX-win-x64.zip</code> depuis <a href="https://nodejs.org/dist" target="_blank" rel="noopener">nodejs.org/dist</a> (versions majeures 20 à 26) et le déposer dans <code>tools/inventory/node</code>, puis lancer la commande d'entreprise :</p>
      <pre class="wiki-code"><code>volta install node@22.12.0 &amp; setx VOLTA_NODE_VERSION 22.12.0 &amp; volta install npm@bundle</code></pre>
      <p>Cette commande est configurable dans <code>npm-install.conf.json</code> → <code>runtime.voltaInstallShell</code>.</p>

      <h3 class="wiki-h3">Configuration des versions (Wizard)</h3>
      <p>Fichier actif : <code>.wizard-qa/conf/npm-install.conf.json</code></p>
      <table class="wiki-table">
        <tr><th>Clé</th><th>Exemple</th><th>Rôle</th></tr>
        <tr><td><code>runtime.targetNodeVersion</code></td><td><code>22.12.0</code></td><td>Version Node cible — pop-up « mettre à jour »</td></tr>
        <tr><td><code>runtime.targetNpmVersion</code></td><td><code>10.9.0</code></td><td>Version npm cible affichée dans les pop-ups</td></tr>
        <tr><td><code>runtime.nodeMajorMin</code> / <code>Max</code></td><td><code>20</code> / <code>26</code></td><td>Plage proposée dans la liste déroulante nodejs.org</td></tr>
        <tr><td><code>runtime.voltaHome</code></td><td><code>%LOCALAPPDATA%\\Volta</code></td><td>Dossier Volta utilisateur</td></tr>
        <tr><td><code>runtime.voltaNodeInventoryRel</code></td><td><code>tools/inventory/node</code></td><td>Sous-dossier d'inventaire Node</td></tr>
        <tr><td><code>runtime.voltaInstallShell</code></td><td>voir ci-dessus</td><td>Commande exécutée après dépôt du zip</td></tr>
      </table>

      <h3 class="wiki-h3">Installation — parcours Wizard (recommandé)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Configurer <code>.npmrc</code> sur <a href="/npmrc.html">la page dédiée</a> — cliquer <strong>Générer npmrc</strong>.</li>
        <li>Pop-up <strong>Disposez-vous d'un package.json ?</strong> — si <strong>Non</strong> : redirection vers <a href="/node-install.html">Installation Node.js</a>.</li>
        <li>Sur <a href="/node-install.html">Installation Node.js</a> : pyramide des dépendances, Node/Volta, <code>package.json</code>, puis <strong>→ Installer les dépendances npm</strong>.</li>
        <li>Si <strong>Oui</strong> au package.json : pop-up <strong>Voulez-vous installer NPM ?</strong> — page <a href="/npm-install.html">Installer NPM</a>.</li>
        <li>Sur <strong>Installer NPM</strong> : bouton <strong>Installer NPM</strong> → <code>npm install</code> des paquets listés dans la config.</li>
      </ol>

      <h3 class="wiki-h3">Installation manuelle (hors Wizard)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Vérifier que Volta est présent : <code>volta --version</code> ou <code>dir "%LOCALAPPDATA%\\Volta\\bin"</code>.</li>
        <li>Installer Node via Volta : <code>volta install node@22.12.0</code>.</li>
        <li>Variable d'environnement entreprise : <code>setx VOLTA_NODE_VERSION 22.12.0</code> (nouveau terminal requis).</li>
        <li>Installer npm (bundle Volta) : <code>volta install npm@bundle</code> ou version précise <code>volta install npm@10.9.0</code>.</li>
        <li>Configurer <code>.npmrc</code> puis à la racine du dépôt : <code>npm install</code>.</li>
      </ol>
      <p>Alternative poste sans Volta : mode portable via <code>00_Scripts_Implementation/01_reparation-poste-travail/</code> (assistant Réparation / <code>repair.mjs --portable</code>) — voir page Réparation du Wizard.</p>

      <h3 class="wiki-h3">Commandes Node.js</h3>
      <p>Node n'a pas de sous-commandes comme npm : on invoque <code>node</code> avec des options et éventuellement un fichier <code>.js</code> / <code>.mjs</code>.</p>
      <table class="wiki-table">
        <tr><th>Commande / option</th><th>À quoi ça sert</th></tr>
        <tr><td><code>node -v</code> / <code>node --version</code></td><td>Affiche la version Node active</td></tr>
        <tr><td><code>node fichier.js</code> / <code>node fichier.mjs</code></td><td>Exécute un script (ex. <code>hook-run.mjs</code>, <code>repair.mjs</code>, <code>portail.mjs</code>)</td></tr>
        <tr><td><code>node fichier.js arg1 arg2</code></td><td>Passe des arguments au script (<code>process.argv</code>)</td></tr>
        <tr><td><code>node --check fichier.js</code> / <code>node -c fichier.js</code></td><td>Vérifie la syntaxe sans exécuter (diagnostic hook)</td></tr>
        <tr><td><code>node -e "code"</code> / <code>node --eval "code"</code></td><td>Exécute une ligne de JavaScript inline</td></tr>
        <tr><td><code>node -p "expr"</code> / <code>node --print "expr"</code></td><td>Évalue une expression et affiche le résultat</td></tr>
        <tr><td><code>node</code> (sans argument, terminal interactif)</td><td>REPL JavaScript — quitter avec <code>.exit</code> ou Ctrl+D</td></tr>
        <tr><td><code>node -</code></td><td>Lit le script depuis l'entrée standard (stdin)</td></tr>
        <tr><td><code>node --inspect fichier.js</code></td><td>Lance le débogueur V8 (Chrome DevTools, port 9229)</td></tr>
        <tr><td><code>node --inspect-brk fichier.js</code></td><td>Débogueur avec pause au premier ligne</td></tr>
        <tr><td><code>node inspect script.js</code></td><td>Débogueur en ligne de commande intégré</td></tr>
        <tr><td><code>node --help</code></td><td>Liste les options CLI de Node</td></tr>
        <tr><td><code>node --experimental-vm-modules</code></td><td>Active les modules ES natifs (selon version Node)</td></tr>
        <tr><td><code>node --trace-warnings</code></td><td>Affiche la pile des avertissements Node</td></tr>
        <tr><td><code>where node</code> (Cmd Windows)</td><td>Chemin de <code>node.exe</code> utilisé (Volta vs installation système)</td></tr>
        <tr><td><code>which node</code> (Git Bash)</td><td>Équivalent Unix de <code>where node</code></td></tr>
      </table>
      <p class="hint hint-tight">Pour l'aide détaillée : <code>node --help</code> ou <a href="https://nodejs.org/docs/latest/api/cli.html" target="_blank" rel="noopener">documentation CLI Node.js</a>.</p>

      <h3 class="wiki-h3">Commandes npm</h3>
      <p>Syntaxe générale : <code>npm &lt;commande&gt; [options]</code> — aide rapide : <code>npm &lt;commande&gt; -h</code>, liste complète : <code>npm -l</code>.</p>
      <table class="wiki-table">
        <tr><th>Commande</th><th>À quoi ça sert</th></tr>
        <tr><td><code>npm -v</code> / <code>npm --version</code></td><td>Version de npm</td></tr>
        <tr><td><code>npm access</code></td><td>Gère les niveaux d'accès des paquets publiés (public/privé, collaborateurs, MFA)</td></tr>
        <tr><td><code>npm adduser</code> (<code>add-user</code>)</td><td>Crée un compte utilisateur sur le registry</td></tr>
        <tr><td><code>npm audit</code></td><td>Analyse les vulnérabilités des dépendances ; <code>npm audit fix</code> tente des corrections</td></tr>
        <tr><td><code>npm bugs</code> (<code>issues</code>)</td><td>Ouvre la page de signalement de bugs d'un paquet dans le navigateur</td></tr>
        <tr><td><code>npm cache</code></td><td>Gère le cache local (<code>cache ls</code>, <code>cache clean</code>, <code>cache verify</code>)</td></tr>
        <tr><td><code>npm ci</code></td><td>Installation reproductible depuis <code>package-lock.json</code> (CI, sans modifier le lock)</td></tr>
        <tr><td><code>npm completion</code></td><td>Génère un script d'autocomplétion shell</td></tr>
        <tr><td><code>npm config</code></td><td>Configuration npm (<code>get</code>, <code>set</code>, <code>list</code>, <code>delete</code>) — voir aussi <code>npm get</code> / <code>npm set</code></td></tr>
        <tr><td><code>npm dedupe</code></td><td>Réduit les doublons dans l'arbre <code>node_modules</code></td></tr>
        <tr><td><code>npm deprecate</code></td><td>Marque une version de paquet comme dépréciée sur le registry</td></tr>
        <tr><td><code>npm diff</code></td><td>Compare le contenu d'un paquet installé avec une autre version</td></tr>
        <tr><td><code>npm dist-tag</code></td><td>Gère les tags de distribution (<code>latest</code>, <code>next</code>…)</td></tr>
        <tr><td><code>npm docs</code></td><td>Ouvre la documentation d'un paquet dans le navigateur</td></tr>
        <tr><td><code>npm doctor</code></td><td>Diagnostic de santé de l'environnement npm</td></tr>
        <tr><td><code>npm edit</code></td><td>Édite un paquet installé localement (avancé)</td></tr>
        <tr><td><code>npm exec</code></td><td>Exécute un binaire de paquet (successeur de <code>npx</code> pour certains cas)</td></tr>
        <tr><td><code>npm explain</code> (<code>why</code>)</td><td>Explique pourquoi un paquet est installé (dépendance transitive)</td></tr>
        <tr><td><code>npm explore</code></td><td>Ouvre un shell dans le dossier d'un paquet installé</td></tr>
        <tr><td><code>npm find-dupes</code></td><td>Liste les paquets en double dans l'arbre</td></tr>
        <tr><td><code>npm fund</code></td><td>Affiche les informations de financement des dépendances</td></tr>
        <tr><td><code>npm get</code></td><td>Lit une clé de configuration (<code>npm config get registry</code> équivalent ciblé)</td></tr>
        <tr><td><code>npm help</code></td><td>Aide sur une commande ; <code>npm help-search &lt;terme&gt;</code> recherche dans la doc</td></tr>
        <tr><td><code>npm hook</code></td><td>Gère les webhooks de publication sur le registry</td></tr>
        <tr><td><code>npm init</code></td><td>Crée un <code>package.json</code> (<code>npm init -y</code> : valeurs par défaut)</td></tr>
        <tr><td><code>npm install</code> (<code>npm i</code>)</td><td>Installe les dépendances du projet ou ajoute un paquet (<code>npm i cypress -D</code>)</td></tr>
        <tr><td><code>npm install-ci-test</code></td><td><code>npm ci</code> puis <code>npm test</code> (pipeline CI)</td></tr>
        <tr><td><code>npm install-test</code></td><td><code>npm install</code> puis <code>npm test</code></td></tr>
        <tr><td><code>npm link</code></td><td>Lie un paquet local en développement (symlink global / projet)</td></tr>
        <tr><td><code>npm ll</code></td><td>Alias de <code>npm ls --depth=0</code></td></tr>
        <tr><td><code>npm login</code></td><td>Authentification sur le registry (souvent remplacé par token Artifactory en CA-TS)</td></tr>
        <tr><td><code>npm logout</code></td><td>Déconnexion du registry</td></tr>
        <tr><td><code>npm ls</code> (<code>npm list</code>)</td><td>Arborescence des dépendances installées</td></tr>
        <tr><td><code>npm org</code></td><td>Administration d'organisations npm (comptes entreprise)</td></tr>
        <tr><td><code>npm outdated</code></td><td>Liste les paquets dont une version plus récente existe</td></tr>
        <tr><td><code>npm owner</code></td><td>Gère les propriétaires d'un paquet publié</td></tr>
        <tr><td><code>npm pack</code></td><td>Crée une archive <code>.tgz</code> du paquet courant</td></tr>
        <tr><td><code>npm ping</code></td><td>Test de connectivité vers le registry (<code>npm ping --registry=&lt;url&gt;</code>)</td></tr>
        <tr><td><code>npm pkg</code></td><td>Lit ou modifie des champs du <code>package.json</code> en CLI</td></tr>
        <tr><td><code>npm prefix</code></td><td>Affiche le dossier racine du projet npm courant</td></tr>
        <tr><td><code>npm profile</code></td><td>Modifie le profil utilisateur sur le registry</td></tr>
        <tr><td><code>npm prune</code></td><td>Supprime les paquets non listés dans <code>package.json</code></td></tr>
        <tr><td><code>npm publish</code></td><td>Publie un paquet sur le registry (mainteneurs de libs)</td></tr>
        <tr><td><code>npm query</code></td><td>Interroge l'arbre de dépendances via un sélecteur (CSS-like)</td></tr>
        <tr><td><code>npm rebuild</code></td><td>Recompile les binaires natifs des paquets installés</td></tr>
        <tr><td><code>npm repo</code></td><td>Ouvre le dépôt source d'un paquet dans le navigateur</td></tr>
        <tr><td><code>npm restart</code></td><td>Exécute le script <code>restart</code> du <code>package.json</code></td></tr>
        <tr><td><code>npm root</code></td><td>Chemin du dossier <code>node_modules</code> du projet</td></tr>
        <tr><td><code>npm run</code> (<code>run-script</code>)</td><td>Lance un script <code>package.json</code> → <code>scripts</code> (ex. <code>npm run cypress-run</code>)</td></tr>
        <tr><td><code>npm sbom</code></td><td>Génère un SBOM (inventaire logiciel) des dépendances</td></tr>
        <tr><td><code>npm search</code></td><td>Recherche des paquets sur le registry</td></tr>
        <tr><td><code>npm set</code></td><td>Écrit une clé de configuration (préférer <code>.npmrc</code> sur poste CA-TS)</td></tr>
        <tr><td><code>npm shrinkwrap</code></td><td>Génère un <code>npm-shrinkwrap.json</code> (legacy, remplacé par lock v2/v3)</td></tr>
        <tr><td><code>npm star</code> / <code>npm unstar</code></td><td>Ajoute ou retire une étoile sur un paquet du registry</td></tr>
        <tr><td><code>npm stars</code></td><td>Liste les paquets que vous avez étoilés</td></tr>
        <tr><td><code>npm start</code></td><td>Exécute le script <code>start</code> (défaut si présent)</td></tr>
        <tr><td><code>npm stop</code></td><td>Exécute le script <code>stop</code></td></tr>
        <tr><td><code>npm team</code></td><td>Gère les équipes d'une organisation npm</td></tr>
        <tr><td><code>npm test</code></td><td>Exécute le script <code>test</code> (alias fréquent en CI)</td></tr>
        <tr><td><code>npm token</code></td><td>Crée, liste ou révoque des tokens d'accès registry</td></tr>
        <tr><td><code>npm undeprecate</code></td><td>Retire le marquage « déprécié » d'une version</td></tr>
        <tr><td><code>npm uninstall</code> (<code>npm un</code>, <code>npm remove</code>, <code>npm rm</code>)</td><td>Retire un paquet du projet</td></tr>
        <tr><td><code>npm unpublish</code></td><td>Retire une version publiée du registry</td></tr>
        <tr><td><code>npm update</code> (<code>npm up</code>)</td><td>Met à jour les paquets selon les plages semver du <code>package.json</code></td></tr>
        <tr><td><code>npm version</code></td><td>Incrémente la version du paquet et crée un tag Git (libs)</td></tr>
        <tr><td><code>npm view</code> (<code>npm info</code>, <code>npm show</code>)</td><td>Affiche les métadonnées d'un paquet sur le registry</td></tr>
        <tr><td><code>npm whoami</code></td><td>Affiche l'utilisateur authentifié sur le registry</td></tr>
        <tr><td><code>npx &lt;cmd&gt;</code></td><td>Exécute un binaire sans installation globale (ex. <code>npx cypress open</code>)</td></tr>
      </table>
      <p class="hint hint-tight">Commandes les plus utilisées sur les projets QA CA-TS : <code>npm install</code>, <code>npm ci</code>, <code>npm run …</code>, <code>npm config get registry</code>, <code>npm whoami</code>, <code>npm ping</code>, <code>npx</code>.</p>

      <h3 class="wiki-h3">Commandes Volta</h3>
      <p>Syntaxe : <code>volta &lt;commande&gt;</code> — aide : <code>volta help</code> ou <code>volta &lt;commande&gt; -h</code>.</p>
      <table class="wiki-table">
        <tr><th>Commande</th><th>À quoi ça sert</th></tr>
        <tr><td><code>volta --version</code></td><td>Version de Volta installée</td></tr>
        <tr><td><code>volta help</code></td><td>Aide générale ou sur une sous-commande (<code>volta help install</code>)</td></tr>
        <tr><td><code>volta setup</code></td><td>Active Volta pour l'utilisateur et le shell courant (PATH, shims)</td></tr>
        <tr><td><code>volta install &lt;outil[@version]&gt;</code></td><td>Installe et définit la version par défaut d'un outil (<code>node@22.12.0</code>, <code>npm@10.9.0</code>, <code>yarn@1</code>, binaire npm global…)</td></tr>
        <tr><td><code>volta install node@&lt;version&gt;</code></td><td>Télécharge et active une version Node (ex. <code>node@22.12.0</code>, <code>node@lts</code>)</td></tr>
        <tr><td><code>volta install npm@&lt;version&gt;</code></td><td>Installe une version précise de npm</td></tr>
        <tr><td><code>volta install npm@bundle</code></td><td>Installe le npm « bundle » recommandé par Volta pour la Node active (commande entreprise CA-TS)</td></tr>
        <tr><td><code>volta fetch &lt;outil[@version]&gt;</code></td><td>Télécharge un outil en cache local <em>sans</em> le définir comme version par défaut</td></tr>
        <tr><td><code>volta uninstall &lt;outil[@version]&gt;</code></td><td>Retire une toolchain ou un binaire global géré par Volta</td></tr>
        <tr><td><code>volta pin &lt;outil[@version]&gt;</code></td><td>Épingle Node et/ou npm (ou Yarn) dans le <code>package.json</code> du dossier courant</td></tr>
        <tr><td><code>volta pin node@&lt;version&gt;</code></td><td>Écrit le champ <code>volta.node</code> dans <code>package.json</code></td></tr>
        <tr><td><code>volta pin npm@&lt;version&gt;</code></td><td>Écrit le champ <code>volta.npm</code> dans <code>package.json</code></td></tr>
        <tr><td><code>volta list</code></td><td>Liste les toolchains Node/npm installées et actives</td></tr>
        <tr><td><code>volta list all</code></td><td>Liste détaillée incluant les versions inactives</td></tr>
        <tr><td><code>volta which &lt;outil&gt;</code></td><td>Chemin du binaire réellement appelé (<code>volta which node</code>, <code>volta which npm</code>)</td></tr>
        <tr><td><code>volta run &lt;cmd&gt;</code></td><td>Exécute une commande avec la toolchain épinglée du projet</td></tr>
        <tr><td><code>volta completions</code></td><td>Génère les scripts d'autocomplétion shell pour Volta</td></tr>
        <tr><td><code>setx VOLTA_NODE_VERSION &lt;version&gt;</code></td><td>Variable Windows (politique entreprise CA-TS) — <strong>nouveau terminal</strong> requis après <code>setx</code></td></tr>
      </table>
      <p class="hint hint-tight">Sur CA-TS, la séquence type après dépôt du zip Node dans l'inventaire : <code>volta install node@{v} &amp; setx VOLTA_NODE_VERSION {v} &amp; volta install npm@bundle</code> (configurable via <code>runtime.voltaInstallShell</code>).</p>

      <h3 class="wiki-h3">Variables d'environnement utiles</h3>
      <table class="wiki-table">
        <tr><th>Variable</th><th>Rôle</th></tr>
        <tr><td><code>VOLTA_HOME</code></td><td>Dossier racine Volta (défaut : <code>%LOCALAPPDATA%\\Volta</code>)</td></tr>
        <tr><td><code>VOLTA_NODE_VERSION</code></td><td>Version Node imposée par la politique poste (via <code>setx</code>)</td></tr>
        <tr><td><code>PATH</code></td><td>Doit inclure <code>%VOLTA_HOME%\\bin</code> pour que <code>node</code> / <code>npm</code> pointent vers Volta</td></tr>
        <tr><td><code>HTTPS_PROXY</code> / <code>HTTP_PROXY</code></td><td>Proxy ZGIE — requis pour téléchargements npm et parfois nodejs.org</td></tr>
      </table>

      <h3 class="wiki-h3">Vérifications rapides</h3>
      <pre class="wiki-code"><code>node -v
npm -v
volta --version
volta list
npm config get registry
where node
dir "%LOCALAPPDATA%\\Volta\\tools\\inventory\\node"</code></pre>

      <h3 class="wiki-h3">Dépannage fréquent</h3>
      <table class="wiki-table">
        <tr><th>Symptôme</th><th>Piste</th></tr>
        <tr><td><code>node</code> introuvable</td><td>Volta non dans PATH — ouvrir un nouveau terminal après <code>setx</code></td></tr>
        <tr><td><code>spawn EINVAL</code> (Wizard)</td><td>Problème lancement npm sous Windows — mettre à jour l'extension Wizard</td></tr>
        <tr><td><code>401 Unauthorized</code> (npm)</td><td>Token Artifactory expiré — regénérer via assistant .npmrc</td></tr>
        <tr><td><code>ECONNREFUSED</code> / <code>fetch failed</code></td><td>Proxy ou registry manquant dans <code>.npmrc</code></td></tr>
        <tr><td>Mauvaise version Node</td><td><code>volta install node@X</code> + <code>volta pin</code> ou ajuster <code>targetNodeVersion</code> dans la config Wizard</td></tr>
        <tr><td>Pas de <code>package.json</code></td><td>Utiliser l'éditeur du Wizard ou <code>npm init -y</code> puis ajouter les dépendances Cypress</td></tr>
      </table>

      <div class="wiki-callout wiki-callout--ok">
        <strong>Ordre logique sur poste CA-TS</strong>
        1) <code>.npmrc</code> valide → 2) Node + npm (Volta) → 3) <code>package.json</code> → 4) <code>npm install</code> → 5) lancer Cypress / Playwright.
      </div>

      <p class="wiki-next">
        <a href="/npmrc.html" class="btn-primary btn-sm">→ Assistant .npmrc &amp; installation</a>
        <a href="/repair.html" class="btn-secondary btn-sm">→ Réparation poste (mode portable)</a>
      </p>`,
}
