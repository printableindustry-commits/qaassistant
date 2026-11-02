/**
 * Wiki — section 11 : Robot Framework (guide complet).
 */
// eslint-disable-next-line no-var
var WikiStackRobot = {
  id: 'robot',
  title: '11. Robot Framework',
  body: `
      <div class="wiki-stack-hero">
        <img src="/assets/logo-robot.png" alt="Robot Framework" width="72" height="72" />
        <div>
          <p><strong>Robot Framework</strong> est un framework open source de tests d'acceptation et d'automatisation fonctionnelle. Il repose sur une approche <em>keyword-driven</em> : vos scénarios sont des suites de mots-clés lisibles, exécutés par un moteur Python extensible via des bibliothèques (SeleniumLibrary pour le web, RequestsLibrary pour les API, DatabaseLibrary pour les bases, etc.).</p>
          <p>Ce guide couvre l'installation Python, la structure d'un dépôt type <code>mon-projet-robot</code>, la syntaxe des fichiers <code>.robot</code>, les commandes CLI, le reporting et l'intégration CI — sans dépendre d'un projet métier particulier.</p>
        </div>
      </div>

      <h3 class="wiki-h3">Philosophie keyword-driven : comment Robot fonctionne</h3>
      <p>Robot Framework sépare clairement <strong>ce que l'on teste</strong> (Test Cases), <strong>comment on le teste</strong> (Keywords) et <strong>avec quels outils</strong> (Libraries). Un testeur fonctionnel peut lire un scénario sans connaître Python ; un développeur QA implémente les mots-clés réutilisables dans des fichiers dédiés ou en Python pur.</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>Parse</strong> — Robot lit les fichiers <code>.robot</code> ou <code>.resource</code> et construit un modèle interne (settings, variables, keywords, tests).</li>
        <li><strong>Résolution</strong> — Chaque mot-clé appelé est résolu : BuiltIn, bibliothèque importée, keyword utilisateur local ou distant (<code>Resource</code>).</li>
        <li><strong>Exécution</strong> — Les keywords s'enchaînent ; chaque appel produit des entrées dans <code>output.xml</code> et le log détaillé.</li>
        <li><strong>Reporting</strong> — À la fin, Robot génère <code>log.html</code>, <code>report.html</code> et <code>output.xml</code> ; <code>rebot</code> peut fusionner plusieurs exécutions.</li>
      </ol>
      <div class="wiki-callout wiki-callout--info">
        <strong>Langage naturel, moteur Python</strong>
        La syntaxe des fichiers <code>.robot</code> ressemble à du Gherkin structuré (sections en majuscules, indentation par espaces). Sous le capot, tout est Python : les bibliothèques sont des modules importables, et vous pouvez écrire des keywords en Python dans <code>custom_helpers.py</code> ou tout autre module.
      </div>
      <p>Comparé à Cypress ou Playwright (JavaScript/TypeScript), Robot privilégie la <strong>lisibilité métier</strong> et la <strong>modularité par keywords</strong>. Il excelle lorsque plusieurs profils (QA fonctionnel, automatisation, dev) coexistent sur le même dépôt.</p>

      <h3 class="wiki-h3">Installation Python et dépendances</h3>
      <p>Robot Framework s'installe via <strong>pip</strong> dans un environnement virtuel Python 3.8+ (3.10 ou 3.11 recommandés en entreprise). Sur un poste Windows, utilisez le Python officiel ou celui fourni par votre équipe ; activez toujours un venv pour isoler les versions.</p>
      <pre class="wiki-code"><code># Création de l'environnement (exemple Windows)
python -m venv .venv
.venv\\Scripts\\activate

# Installation minimale
pip install --upgrade pip
pip install robotframework
pip install robotframework-seleniumlibrary
pip install robotframework-requests
pip install pyyaml</code></pre>
      <p>Centralisez les versions dans un fichier <code>requirements.txt</code> à la racine de <code>mon-projet-robot</code> :</p>
      <pre class="wiki-code"><code># requirements.txt — mon-projet-robot
robotframework==7.1.1
robotframework-seleniumlibrary==6.6.1
robotframework-requests==0.9.7
robotframework-databaselibrary==2.0.4
robotframework-yaml==0.2.0
PyYAML==6.0.2
webdriver-manager==4.0.2</code></pre>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Proxy d'entreprise</strong>
        Si <code>pip install</code> échoue derrière un proxy, configurez <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code> et éventuellement <code>PIP_INDEX_URL</code> vers un miroir PyPI interne. Le Wizard QA propose un parcours poste dédié lorsque Robot est la stack retenue.
      </div>
      <p>Vérifiez l'installation :</p>
      <pre class="wiki-code"><code>robot --version
python -c "import SeleniumLibrary; print('SeleniumLibrary OK')"</code></pre>

      <h3 class="wiki-h3">Structure de projet recommandée</h3>
      <p>Un dépôt Robot maintenable se organise par <strong>couches</strong> : configuration, ressources partagées, tests par domaine, helpers Python.</p>
      <pre class="wiki-code"><code>mon-projet-robot/
├── requirements.txt
├── README.md
├── resources/
│   ├── common.resource          # keywords transverses
│   ├── variables.yaml           # variables d'environnement
│   └── locators/
│       └── login_page.resource  # sélecteurs UI
├── libraries/
│   └── custom_helpers.py        # keywords Python maison
├── tests/
│   ├── smoke/
│   │   └── login.robot
│   ├── regression/
│   │   └── checkout.robot
│   └── api/
│       └── healthcheck.robot
├── results/                     # sorties robot (gitignore)
└── ci/
    └── pipeline-robot.yml</code></pre>
      <ul class="wiki-steps">
        <li><code>resources/</code> — Fichiers <code>.resource</code> importés par les tests ; pas de section Test Cases ici.</li>
        <li><code>libraries/</code> — Modules Python décorés avec <code>@keyword</code> pour étendre Robot.</li>
        <li><code>tests/</code> — Un dossier par campagne (smoke, regression, api…) ; chaque <code>.robot</code> contient des Test Cases.</li>
        <li><code>results/</code> — Dossier de sortie (<code>--outputdir results</code>) ; à exclure du Git.</li>
      </ul>

      <h3 class="wiki-h3">Sections d'un fichier .robot</h3>
      <p>Chaque fichier Robot est découpé en sections obligatoires ou optionnelles. L'ordre recommandé facilite la relecture.</p>
      <table class="wiki-table">
        <tr><th>Section</th><th>Rôle</th><th>Exemple</th></tr>
        <tr><td><strong>Settings</strong></td><td>Documentation du fichier, imports (<code>Library</code>, <code>Resource</code>, <code>Variables</code>), setup/teardown globaux, tags par défaut.</td><td><code>Library    SeleniumLibrary</code></td></tr>
        <tr><td><strong>Variables</strong></td><td>Déclaration locale : scalaires <code>\${VAR}</code>, listes <code>@{LIST}</code>, dictionnaires <code>&amp;{DICT}</code>.</td><td><code>\${TIMEOUT}    10s</code></td></tr>
        <tr><td><strong>Test Cases</strong></td><td>Scénarios exécutables ; chaque test = suite de keywords + tags + setup/teardown propres.</td><td><code>Connexion utilisateur valide</code></td></tr>
        <tr><td><strong>Keywords</strong></td><td>Mots-clés définis dans ce fichier ; peuvent appeler BuiltIn, libraries et autres keywords.</td><td><code>Ouvrir page de connexion</code></td></tr>
      </table>
      <details class="wiki-fold">
        <summary>Section Settings — détail des directives courantes</summary>
        <table class="wiki-table">
          <tr><th>Directive</th><th>Description</th></tr>
          <tr><td><code>Documentation</code></td><td>Texte libre décrivant le fichier ; visible dans les rapports.</td></tr>
          <tr><td><code>Library</code></td><td>Import d'une bibliothèque Python (<code>SeleniumLibrary</code>, <code>RequestsLibrary</code>, chemin relatif…).</td></tr>
          <tr><td><code>Resource</code></td><td>Import d'un fichier <code>.resource</code> contenant keywords/variables partagés.</td></tr>
          <tr><td><code>Variables</code></td><td>Import d'un fichier de variables (<code>.yaml</code>, <code>.py</code>, <code>.robot</code>).</td></tr>
          <tr><td><code>Suite Setup / Suite Teardown</code></td><td>Keywords exécutés une fois avant/après toute la suite.</td></tr>
          <tr><td><code>Test Setup / Test Teardown</code></td><td>Keywords exécutés avant/après chaque test (sauf si overridé).</td></tr>
          <tr><td><code>Default Tags</code></td><td>Tags appliqués à tous les tests du fichier sauf exclusion.</td></tr>
          <tr><td><code>Force Tags</code></td><td>Tags forcés sur tous les tests, non retirables localement.</td></tr>
        </table>
      </details>
      <details class="wiki-fold">
        <summary>Section Variables — syntaxe et portée</summary>
        <p>Les variables déclarées dans un fichier sont visibles dans ce fichier et ses imports descendants. Pour partager entre suites, préférez <code>resources/variables.yaml</code> importé via <code>Variables    ../resources/variables.yaml</code>.</p>
        <pre class="wiki-code"><code>*** Variables ***
\${BASE_URL}       https://app.example.com
\${BROWSER}        chrome
\${USER}           demo_user
\${PASSWORD}       secret
@{TAGS_SMOKE}      smoke    critical
&amp;{CREDENTIALS}    user=\${USER}    pass=\${PASSWORD}</code></pre>
      </details>
      <details class="wiki-fold">
        <summary>Section Test Cases — anatomy d'un scénario</summary>
        <p>Un test commence par son nom (ligne non indentée), suivi de lignes indentées par au moins deux espaces : settings du test (<code>[Documentation]</code>, <code>[Tags]</code>, <code>[Setup]</code>…) puis les keywords.</p>
      </details>
      <details class="wiki-fold">
        <summary>Section Keywords — composition et arguments</summary>
        <p>Les keywords utilisateur acceptent des arguments positionnels (<code>[Arguments]    \${login}    \${pwd}</code>), des valeurs par défaut, et des variables de retour via <code>[Return]</code> ou assignment (<code>\${text}=    Get Text    id=title</code>).</p>
      </details>

      <h3 class="wiki-h3">Exemple complet — login.robot</h3>
      <p>Scénario smoke de connexion web réutilisant des resources et des variables externalisées :</p>
      <pre class="wiki-code"><code>*** Settings ***
Documentation     Smoke — connexion utilisateur sur l'application de démo
Library           SeleniumLibrary
Resource          ../resources/common.resource
Variables         ../resources/variables.yaml
Suite Setup       Ouvrir navigateur
Suite Teardown    Fermer navigateur
Test Setup        Aller sur la page de connexion
Default Tags      smoke    login

*** Variables ***
\${LOGIN_TIMEOUT}    15s

*** Test Cases ***
Connexion utilisateur valide
    [Documentation]    Vérifie qu'un utilisateur connu accède au tableau de bord
    [Tags]             critical
    Saisir identifiants    \${USER}    \${PASSWORD}
    Cliquer sur Se connecter
    Page Should Contain    Tableau de bord
    Location Should Contain    /dashboard

Connexion avec mot de passe invalide
    [Documentation]    Message d'erreur attendu
    [Tags]             negative
    Saisir identifiants    \${USER}    mauvais_mot_de_passe
    Cliquer sur Se connecter
    Page Should Contain    Identifiants incorrects

*** Keywords ***
Saisir identifiants
    [Arguments]    \${login}    \${password}
    Input Text     id=username    \${login}
    Input Text     id=password    \${password}

Cliquer sur Se connecter
    Click Button    id=submit-login</code></pre>
      <p>Le fichier <code>common.resource</code> compagnon pourrait contenir :</p>
      <pre class="wiki-code"><code>*** Settings ***
Library    SeleniumLibrary

*** Keywords ***
Ouvrir navigateur
    Open Browser    \${BASE_URL}    \${BROWSER}
    Maximize Browser Window
    Set Selenium Implicit Wait    5s

Fermer navigateur
    Close All Browsers

Aller sur la page de connexion
    Go To    \${BASE_URL}/login</code></pre>

      <h3 class="wiki-h3">BuiltIn — mots-clés essentiels (20+)</h3>
      <p>La bibliothèque <code>BuiltIn</code> est importée automatiquement. Elle couvre le contrôle de flux, les assertions génériques et la manipulation de données.</p>
      <table class="wiki-table">
        <tr><th>Mot-clé</th><th>Description</th><th>Exemple</th></tr>
        <tr><td><code>Log</code></td><td>Écrit un message dans le log (niveaux TRACE, DEBUG, INFO, WARN, ERROR).</td><td><code>Log    Valeur courante : \${x}</code></td></tr>
        <tr><td><code>Log To Console</code></td><td>Affiche sur stdout (utile en CI).</td><td><code>Log To Console    Démarrage smoke</code></td></tr>
        <tr><td><code>Should Be Equal</code></td><td>Échoue si les deux valeurs diffèrent.</td><td><code>Should Be Equal    \${status}    OK</code></td></tr>
        <tr><td><code>Should Not Be Equal</code></td><td>Inverse de Should Be Equal.</td><td><code>Should Not Be Equal    \${code}    404</code></td></tr>
        <tr><td><code>Should Be True</code></td><td>Condition booléenne vraie.</td><td><code>Should Be True    \${count} &gt; 0</code></td></tr>
        <tr><td><code>Should Contain</code></td><td>Chaîne ou liste contient la sous-valeur.</td><td><code>Should Contain    \${body}    success</code></td></tr>
        <tr><td><code>Should Not Contain</code></td><td>Vérifie l'absence d'une sous-chaîne.</td><td><code>Should Not Contain    \${msg}    error</code></td></tr>
        <tr><td><code>Should Match Regexp</code></td><td>Compare à une expression régulière.</td><td><code>Should Match Regexp    \${id}    ^[A-Z0-9-]+$</code></td></tr>
        <tr><td><code>Run Keyword If</code></td><td>Exécute un keyword conditionnellement.</td><td><code>Run Keyword If    '\${env}'=='prod'    Skip</code></td></tr>
        <tr><td><code>Run Keywords</code></td><td>Enchaîne plusieurs keywords (AND, THEN).</td><td><code>Run Keywords    Log    A    AND    Log    B</code></td></tr>
        <tr><td><code>Pass Execution</code></td><td>Marque le test comme PASS avec message (skip contrôlé).</td><td><code>Pass Execution    Non applicable sur cet env</code></td></tr>
        <tr><td><code>Fail</code></td><td>Échoue immédiatement le test.</td><td><code>Fail    Prérequis manquant</code></td></tr>
        <tr><td><code>Skip</code></td><td>Marque le test comme SKIP (RF 5+).</td><td><code>Skip    Feature désactivée</code></td></tr>
        <tr><td><code>Set Variable</code></td><td>Crée ou modifie une variable scalaire.</td><td><code>\${x}=    Set Variable    42</code></td></tr>
        <tr><td><code>Get Length</code></td><td>Longueur d'une liste ou chaîne.</td><td><code>\${n}=    Get Length    \${items}</code></td></tr>
        <tr><td><code>Create List</code></td><td>Construit une liste Robot.</td><td><code>@{L}=    Create List    a    b    c</code></td></tr>
        <tr><td><code>Create Dictionary</code></td><td>Construit un dictionnaire.</td><td><code>&amp;{D}=    Create Dictionary    k=v</code></td></tr>
        <tr><td><code>Append To List</code></td><td>Ajoute un élément en fin de liste.</td><td><code>Append To List    \${L}    new</code></td></tr>
        <tr><td><code>Get From Dictionary</code></td><td>Lit une clé d'un dict.</td><td><code>\${v}=    Get From Dictionary    \${D}    k</code></td></tr>
        <tr><td><code>Wait Until Keyword Succeeds</code></td><td>Répète un keyword jusqu'au succès ou timeout.</td><td><code>Wait Until Keyword Succeeds    30s    2s    Cliquer bouton</code></td></tr>
        <tr><td><code>Sleep</code></td><td>Pause explicite (à utiliser avec parcimonie).</td><td><code>Sleep    2s</code></td></tr>
        <tr><td><code>Comment</code></td><td>Commentaire visible dans le log.</td><td><code>Comment    Étape préparatoire</code></td></tr>
        <tr><td><code>Convert To String</code></td><td>Cast explicite en chaîne.</td><td><code>\${s}=    Convert To String    \${n}</code></td></tr>
        <tr><td><code>Get Time</code></td><td>Horodatage formaté.</td><td><code>\${ts}=    Get Time    epoch</code></td></tr>
      </table>

      <h3 class="wiki-h3">SeleniumLibrary — mots-clés web (20+)</h3>
      <p><code>SeleniumLibrary</code> pilote un navigateur via WebDriver (Chrome, Firefox, Edge…). Installez le driver correspondant ou utilisez <code>webdriver-manager</code> en Python.</p>
      <table class="wiki-table">
        <tr><th>Mot-clé</th><th>Description</th><th>Exemple</th></tr>
        <tr><td><code>Open Browser</code></td><td>Ouvre une session navigateur.</td><td><code>Open Browser    \${BASE_URL}    chrome</code></td></tr>
        <tr><td><code>Close Browser</code></td><td>Ferme le navigateur courant.</td><td><code>Close Browser</code></td></tr>
        <tr><td><code>Close All Browsers</code></td><td>Ferme toutes les sessions ouvertes.</td><td><code>Close All Browsers</code></td></tr>
        <tr><td><code>Go To</code></td><td>Navigation vers une URL.</td><td><code>Go To    \${BASE_URL}/home</code></td></tr>
        <tr><td><code>Reload Page</code></td><td>Recharge la page active.</td><td><code>Reload Page</code></td></tr>
        <tr><td><code>Click Element</code></td><td>Clic sur un élément (locator).</td><td><code>Click Element    id=submit</code></td></tr>
        <tr><td><code>Click Button</code></td><td>Clic sur un bouton.</td><td><code>Click Button    css=.btn-primary</code></td></tr>
        <tr><td><code>Click Link</code></td><td>Clic sur un lien par texte ou locator.</td><td><code>Click Link    Accueil</code></td></tr>
        <tr><td><code>Input Text</code></td><td>Saisie dans un champ texte (remplace le contenu).</td><td><code>Input Text    name=email    user@test.com</code></td></tr>
        <tr><td><code>Clear Element Text</code></td><td>Vide un champ.</td><td><code>Clear Element Text    id=search</code></td></tr>
        <tr><td><code>Press Keys</code></td><td>Envoie des touches clavier.</td><td><code>Press Keys    id=q    ENTER</code></td></tr>
        <tr><td><code>Get Text</code></td><td>Récupère le texte visible d'un élément.</td><td><code>\${t}=    Get Text    css=h1</code></td></tr>
        <tr><td><code>Get Element Attribute</code></td><td>Lit un attribut HTML.</td><td><code>\${href}=    Get Element Attribute    css=a.logo    href</code></td></tr>
        <tr><td><code>Page Should Contain</code></td><td>Assert texte présent dans la page.</td><td><code>Page Should Contain    Bienvenue</code></td></tr>
        <tr><td><code>Page Should Not Contain</code></td><td>Assert texte absent.</td><td><code>Page Should Not Contain    Erreur fatale</code></td></tr>
        <tr><td><code>Element Should Be Visible</code></td><td>Vérifie la visibilité.</td><td><code>Element Should Be Visible    id=menu</code></td></tr>
        <tr><td><code>Element Should Be Enabled</code></td><td>Vérifie qu'un élément est actif.</td><td><code>Element Should Be Enabled    id=save</code></td></tr>
        <tr><td><code>Wait Until Element Is Visible</code></td><td>Attente explicite sur visibilité.</td><td><code>Wait Until Element Is Visible    css=.spinner    10s</code></td></tr>
        <tr><td><code>Wait Until Page Contains</code></td><td>Attente sur contenu texte.</td><td><code>Wait Until Page Contains    Résultats    15s</code></td></tr>
        <tr><td><code>Select From List By Value</code></td><td>Sélection dans un &lt;select&gt;.</td><td><code>Select From List By Value    id=country    FR</code></td></tr>
        <tr><td><code>Checkbox Should Be Selected</code></td><td>Assert case cochée.</td><td><code>Checkbox Should Be Selected    id=terms</code></td></tr>
        <tr><td><code>Maximize Browser Window</code></td><td>Fenêtre plein écran.</td><td><code>Maximize Browser Window</code></td></tr>
        <tr><td><code>Set Selenium Implicit Wait</code></td><td>Timeout implicite global.</td><td><code>Set Selenium Implicit Wait    5s</code></td></tr>
        <tr><td><code>Location Should Contain</code></td><td>Assert sur l'URL courante.</td><td><code>Location Should Contain    /checkout</code></td></tr>
        <tr><td><code>Title Should Be</code></td><td>Assert sur le titre de la page.</td><td><code>Title Should Be    Mon application</code></td></tr>
      </table>
      <div class="wiki-callout wiki-callout--info">
        <strong>Locators</strong>
        Préfixez vos sélecteurs : <code>id=</code>, <code>name=</code>, <code>css=</code>, <code>xpath=</code>. Centralisez-les dans <code>resources/locators/</code> pour limiter la duplication et faciliter la maintenance UI.
      </div>

      <h3 class="wiki-h3">Variables : scalaires, listes, dictionnaires, fichiers YAML</h3>
      <p>Robot propose trois familles de variables, reconnaissables à leur préfixe :</p>
      <table class="wiki-table">
        <tr><th>Type</th><th>Syntaxe</th><th>Usage</th></tr>
        <tr><td>Scalaire</td><td><code>\${NAME}</code></td><td>Une valeur unique (chaîne, nombre, objet sérialisé).</td></tr>
        <tr><td>Liste</td><td><code>@{NAME}</code></td><td>Collection ordonnée ; expansion avec <code>@{NAME}</code> dans les arguments.</td></tr>
        <tr><td>Dictionnaire</td><td><code>&amp;{NAME}</code></td><td>Paires clé=valeur ; accès <code>\${DICT}[key]</code>.</td></tr>
      </table>
      <p>Exemple de fichier <code>resources/variables.yaml</code> :</p>
      <pre class="wiki-code"><code>BASE_URL: https://app.example.com
BROWSER: chrome
USER: demo_user
PASSWORD: secret
TIMEOUT: 15s
ENVIRONMENTS:
  - dev
  - staging
  - prod
API_HEADERS:
  Content-Type: application/json
  Accept: application/json</code></pre>
      <p>Import dans Settings : <code>Variables    ../resources/variables.yaml</code>. Les clés YAML deviennent des variables Robot (<code>\${BASE_URL}</code>, <code>\${API_HEADERS}[Content-Type]</code>…).</p>
      <details class="wiki-fold">
        <summary>Variables Python (libraries/custom_helpers.py)</summary>
        <pre class="wiki-code"><code>from robot.api.deco import keyword

ROBOT_VARIABLES = {
    'DEFAULT_TIMEOUT': '20s',
    'API_TOKEN': 'token-demo',
}

@keyword('Générer email aléatoire')
def generate_random_email(prefix='user'):
    import uuid
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"</code></pre>
        <p>Import : <code>Library    ../libraries/custom_helpers.py</code></p>
      </details>

      <h3 class="wiki-h3">Tags, setup, teardown et templates</h3>
      <p>Les <strong>tags</strong> filtrent l'exécution en CI ou en local. Ils s'ajoutent au niveau test (<code>[Tags]</code>), fichier (<code>Default Tags</code>) ou suite (<code>Force Tags</code>).</p>
      <pre class="wiki-code"><code># Exécuter uniquement les tests tagués smoke
robot --include smoke tests/

# Exclure les tests lents ou WIP
robot --exclude slow --exclude wip tests/

# Combinaison : smoke ET critical, sans negative
robot --include smokeANDcritical --exclude negative tests/</code></pre>
      <p><strong>Setup / Teardown</strong> — hiérarchie d'exécution :</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><code>Suite Setup</code> — une fois avant tous les tests du fichier.</li>
        <li><code>Test Setup</code> — avant chaque test (peut être overridé par <code>[Setup]</code> local ou <code>None</code>).</li>
        <li>Corps du test — keywords du scénario.</li>
        <li><code>Test Teardown</code> — après chaque test (capture screenshot en cas d'échec, logout…).</li>
        <li><code>Suite Teardown</code> — une fois à la fin (<code>Close All Browsers</code>).</li>
      </ol>
      <p>Les <strong>test templates</strong> répètent le même enchaînement de keywords avec des données différentes (data-driven) :</p>
      <pre class="wiki-code"><code>*** Settings ***
Library    Collections

*** Test Cases ***
Validation login — jeux de données
    [Template]    Vérifier login
    user_ok       pass_ok       Tableau de bord
    user_ok       pass_ko       Identifiants incorrects
    user_vide     pass_ok       Champ obligatoire

*** Keywords ***
Vérifier login
    [Arguments]    \${user}    \${pass}    \${expected}
    Input Text     id=username    \${user}
    Input Text     id=password    \${pass}
    Click Button   id=submit
    Page Should Contain    \${expected}</code></pre>

      <h3 class="wiki-h3">Commandes CLI Robot (15+)</h3>
      <p>L'exécutable <code>robot</code> (ou <code>python -m robot</code>) pilote l'exécution, le filtrage et les sorties.</p>
      <table class="wiki-table">
        <tr><th>Commande / option</th><th>Description</th></tr>
        <tr><td><code>robot tests/</code></td><td>Exécute toutes les suites sous <code>tests/</code>.</td></tr>
        <tr><td><code>robot tests/smoke/login.robot</code></td><td>Exécute un fichier précis.</td></tr>
        <tr><td><code>robot --outputdir results</code></td><td>Redirige log, report et output vers <code>results/</code>.</td></tr>
        <tr><td><code>robot --name "Smoke Nuit"</code></td><td>Nom affiché dans les rapports pour cette exécution.</td></tr>
        <tr><td><code>robot --include smoke</code></td><td>Filtre : exécute les tests avec le tag <code>smoke</code>.</td></tr>
        <tr><td><code>robot --exclude wip</code></td><td>Exclut les tests tagués <code>wip</code>.</td></tr>
        <tr><td><code>robot --variable BASE_URL:https://staging.example.com</code></td><td>Surcharge une variable en ligne de commande.</td></tr>
        <tr><td><code>robot --variablefile resources/variables.yaml</code></td><td>Charge un fichier de variables externe.</td></tr>
        <tr><td><code>robot -v USER:admin -v PASS:secret</code></td><td>Raccourci de <code>--variable</code> (plusieurs -v possibles).</td></tr>
        <tr><td><code>robot --loglevel DEBUG</code></td><td>Niveau de verbosité (TRACE, DEBUG, INFO, WARN, ERROR).</td></tr>
        <tr><td><code>robot --dryrun</code></td><td>Validation syntaxique sans exécuter les keywords.</td></tr>
        <tr><td><code>robot --exitonfailure</code></td><td>Arrêt dès le premier test en échec.</td></tr>
        <tr><td><code>robot --rerunfailed results/output.xml</code></td><td>Relance uniquement les tests échoués (Robot 6+).</td></tr>
        <tr><td><code>robot --listener allure_robotframework:results/allure</code></td><td>Brancher un listener (ex. Allure) si installé.</td></tr>
        <tr><td><code>robot --prerunmodifier tag_modifier.TagModifier</code></td><td>Modifier les tags avant exécution (scripts avancés).</td></tr>
        <tr><td><code>robot --console dotted</code></td><td>Affichage console compact (dots) en CI.</td></tr>
        <tr><td><code>robot --timestampoutputs</code></td><td>Ajoute un horodatage aux noms de fichiers de sortie.</td></tr>
        <tr><td><code>rebot --merge results/*/output.xml</code></td><td>Fusionne plusieurs exécutions en un rapport unique.</td></tr>
        <tr><td><code>rebot --log log.html --report report.html output.xml</code></td><td>Régénère HTML à partir d'un output.xml existant.</td></tr>
      </table>

      <h3 class="wiki-h3">Écosystème de bibliothèques</h3>
      <table class="wiki-table">
        <tr><th>Bibliothèque</th><th>Domaine</th><th>Installation pip</th></tr>
        <tr><td>SeleniumLibrary</td><td>Automatisation navigateur (WebDriver)</td><td><code>robotframework-seleniumlibrary</code></td></tr>
        <tr><td>Browser (Playwright)</td><td>Web moderne via Playwright</td><td><code>robotframework-browser</code></td></tr>
        <tr><td>RequestsLibrary</td><td>Tests API HTTP/REST</td><td><code>robotframework-requests</code></td></tr>
        <tr><td>DatabaseLibrary</td><td>Requêtes SQL (JDBC/ODBC selon driver)</td><td><code>robotframework-databaselibrary</code></td></tr>
        <tr><td>SSHLibrary</td><td>Commandes distantes SSH/SFTP</td><td><code>robotframework-sshlibrary</code></td></tr>
        <tr><td>FakerLibrary</td><td>Données de test aléatoires</td><td><code>robotframework-faker</code></td></tr>
        <tr><td>JSONLibrary</td><td>Manipulation JSON</td><td><code>robotframework-jsonlibrary</code></td></tr>
        <tr><td>ExcelLibrary</td><td>Lecture/écriture fichiers Excel</td><td><code>robotframework-excellibrary</code></td></tr>
        <tr><td>AppiumLibrary</td><td>Mobile Android/iOS</td><td><code>robotframework-appiumlibrary</code></td></tr>
        <tr><td>AutoItLibrary</td><td>Dialogs Windows natives (legacy)</td><td><code>robotframework-autoitlibrary</code></td></tr>
        <tr><td>Collections (BuiltIn)</td><td>Listes et dictionnaires</td><td>Inclus avec Robot</td></tr>
        <tr><td>OperatingSystem</td><td>Fichiers, chemins, processus OS</td><td>Inclus avec Robot</td></tr>
        <tr><td>String</td><td>Manipulation de chaînes</td><td>Inclus avec Robot</td></tr>
        <tr><td>DateTime</td><td>Dates et durées</td><td>Inclus avec Robot</td></tr>
      </table>

      <h3 class="wiki-h3">WebDriver en environnement d'entreprise (proxy, certificats)</h3>
      <p>Derrière un proxy HTTP ou avec inspection TLS, Selenium peut échouer à charger les pages. Configurez le navigateur via des capabilities ou des options Chrome :</p>
      <pre class="wiki-code"><code>*** Keywords ***
Ouvrir navigateur entreprise
    \${options}=    Evaluate    sys.modules['selenium.webdriver'].ChromeOptions()    sys, selenium.webdriver
    Call Method    \${options}    add_argument    --proxy-server=http://proxy.example.com:8080
    Call Method    \${options}    add_argument    --ignore-certificate-errors
    Open Browser    \${BASE_URL}    chrome    options=\${options}</code></pre>
      <p>Variables d'environnement utiles côté poste et CI :</p>
      <ul class="wiki-steps">
        <li><code>HTTP_PROXY</code> / <code>HTTPS_PROXY</code> — proxy système pour pip, requests et parfois WebDriver.</li>
        <li><code>NO_PROXY</code> — exclusions (localhost, registry interne).</li>
        <li><code>SE_BROWSER</code> — forcer <code>chrome</code> ou <code>edge</code> selon la politique IT.</li>
        <li><code>WEBDRIVER_PATH</code> — chemin explicite vers chromedriver/msedgedriver si non géré automatiquement.</li>
      </ul>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Mode headless en CI</strong>
        Ajoutez <code>headlesschrome</code> ou les arguments <code>--headless=new</code> sur les agents sans interface graphique. Validez d'abord en mode headed sur poste développeur : certains bugs UI n'apparaissent qu'avec rendu complet.
      </div>

      <h3 class="wiki-h3">Reporting : log.html, output.xml, rebot</h3>
      <p>Chaque exécution produit trois artefacts principaux dans <code>--outputdir</code> :</p>
      <table class="wiki-table">
        <tr><th>Fichier</th><th>Rôle</th></tr>
        <tr><td><code>log.html</code></td><td>Journal détaillé keyword par keyword — idéal pour déboguer un échec (screenshots SeleniumLibrary si configurés).</td></tr>
        <tr><td><code>report.html</code></td><td>Synthèse exécutive : statistiques, liste des tests PASS/FAIL/SKIP, liens vers le log.</td></tr>
        <tr><td><code>output.xml</code></td><td>Sortie machine (XML) — entrée de <code>rebot</code>, intégrations Xray, parsers CI.</td></tr>
      </table>
      <p>Fusionner plusieurs runs (matrices navigateur, shards parallèles) :</p>
      <pre class="wiki-code"><code>rebot --merge --name "Regression complète" ^
    --log merged_log.html --report merged_report.html ^
    results/chrome/output.xml results/firefox/output.xml</code></pre>
      <p>Publiez <code>report.html</code> et <code>log.html</code> comme artefacts de pipeline pour consultation post-exécution sans relancer les tests.</p>

      <h3 class="wiki-h3">Exemple d'intégration CI (GitLab CI)</h3>
      <pre class="wiki-code"><code># ci/pipeline-robot.yml — extrait
stages:
  - test

robot-smoke:
  stage: test
  image: python:3.11-slim
  before_script:
    - pip install -r requirements.txt
    - apt-get update && apt-get install -y chromium chromium-driver
  script:
    - robot --outputdir results
        --include smoke
        --variable BASE_URL:https://staging.example.com
        --variable BROWSER:headlesschrome
        --loglevel INFO
        tests/smoke/
  artifacts:
    when: always
    paths:
      - results/log.html
      - results/report.html
      - results/output.xml
    expire_in: 14 days</code></pre>
      <p>Adaptez l'image, le navigateur et les variables secrètes (<code>CI/CD variables</code>) selon votre forge. Le pattern reste identique sur GitHub Actions ou Azure Pipelines : install Python → pip → robot → publier artefacts.</p>

      <h3 class="wiki-h3">Bonnes pratiques (8 recommandations)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>Un keyword = une intention</strong> — évitez les keywords de 30 lignes ; décomposez en étapes nommées métier (<code>Saisir identifiants</code>, <code>Valider panier</code>).</li>
        <li><strong>Page Object via .resource</strong> — regroupez locators et actions par page dans <code>resources/locators/</code> plutôt que des sélecteurs en dur dans chaque test.</li>
        <li><strong>Variables externalisées</strong> — URLs, comptes, timeouts dans YAML ou variables CI ; jamais de secrets en clair dans Git.</li>
        <li><strong>Tags cohérents</strong> — convention d'équipe (<code>smoke</code>, <code>regression</code>, <code>api</code>, <code>wip</code>) documentée dans le README.</li>
        <li><strong>Teardown systématique</strong> — <code>Close All Browsers</code> en Suite Teardown ; screenshot on failure via keyword dédié.</li>
        <li><strong>Attentes explicites</strong> — préférez <code>Wait Until …</code> à <code>Sleep</code> fixe pour limiter les tests flaky.</li>
        <li><strong>Dry-run en PR</strong> — <code>robot --dryrun tests/</code> valide la syntaxe sans lancer Selenium (rapide en gate CI).</li>
        <li><strong>Versionner requirements.txt</strong> — figez les versions Robot et bibliothèques ; mettez à jour de façon contrôlée avec changelog.</li>
        <li><strong>Python helpers pour la logique complexe</strong> — calculs, parsing JSON, appels crypto → <code>libraries/custom_helpers.py</code> plutôt que des keywords Robot illisibles.</li>
      </ol>

      <h3 class="wiki-h3">Quand le Wizard recommande Robot Framework</h3>
      <p>Le questionnaire stack du Wizard QA pondère plusieurs critères. Robot est généralement recommandé lorsque :</p>
      <ul class="wiki-steps">
        <li>L'équipe compte des <strong>testeurs fonctionnels</strong> qui doivent lire ou contribuer aux scénarios sans maîtriser JavaScript.</li>
        <li>Le périmètre couvre <strong>plusieurs canaux</strong> (web + API + fichiers + base) avec un seul framework keyword-driven.</li>
        <li>La culture projet valorise le <strong>Gherkin / langage naturel</strong> et des keywords métier partagés.</li>
        <li>L'écosystème <strong>Python</strong> est déjà présent (data, scripts ops, ML) et doit rester homogène.</li>
        <li>Les campagnes sont orchestrées en CI avec des <strong>tags</strong> et des rapports XML exploitables par des outils ALM.</li>
      </ul>
      <div class="wiki-callout wiki-callout--ok">
        <strong>Stack retenue = parcours adapté</strong>
        Si Robot est votre recommandation, l'accueil Wizard met en avant la tuile Robot Framework et les étapes d'initialisation poste (Python, venv, requirements) remplacent le parcours <code>.npmrc</code> des stacks Node.
      </div>
      <p>Robot est moins prioritaire si vous visez une DX navigateur « tout intégré » (time-travel, preview Cypress) ou une parité multi-navigateurs moderne sans couche keyword — dans ce cas, comparez avec Playwright (section 12).</p>

      <h3 class="wiki-h3">Documentation officielle et ressources</h3>
      <table class="wiki-table">
        <tr><th>Ressource</th><th>URL</th></tr>
        <tr><td>Site Robot Framework</td><td><a href="https://robotframework.org/" target="_blank" rel="noopener">https://robotframework.org/</a></td></tr>
        <tr><td>User Guide (syntaxe, CLI, reporting)</td><td><a href="https://robotframework.org/robotframework/latest/RobotFrameworkUserGuide.html" target="_blank" rel="noopener">Robot Framework User Guide</a></td></tr>
        <tr><td>SeleniumLibrary</td><td><a href="https://robotframework.org/SeleniumLibrary/SeleniumLibrary.html" target="_blank" rel="noopener">SeleniumLibrary keywords</a></td></tr>
        <tr><td>RequestsLibrary</td><td><a href="https://marketsquare.github.io/robotframework-requests/doc/RequestsLibrary.html" target="_blank" rel="noopener">RequestsLibrary doc</a></td></tr>
        <tr><td>Robot Framework Browser (Playwright)</td><td><a href="https://robotframework-browser.org/" target="_blank" rel="noopener">https://robotframework-browser.org/</a></td></tr>
        <tr><td>PyPI — robotframework</td><td><a href="https://pypi.org/project/robotframework/" target="_blank" rel="noopener">pypi.org/project/robotframework</a></td></tr>
      </table>

      <p class="wiki-next">
        <a href="#cypress">→ Section 10 — Cypress</a>
        ·
        <a href="#playwright">→ Section 12 — Playwright</a>
      </p>`,
}
