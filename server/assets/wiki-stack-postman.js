/**
 * Wiki — section 13 : Postman & Newman (tests API).
 */
// eslint-disable-next-line no-var
var WikiStackPostman = {
  id: 'postman',
  title: '13. Postman',
  body: `
      <div class="wiki-hero-head">
        <img src="/assets/logo-postman.png" alt="Postman" width="40" height="40" />
        <h1>Postman &amp; Newman — Tests d'API REST</h1>
      </div>
      <p class="hub-hero-lead">Guide exhaustif pour concevoir, automatiser et intégrer des tests de services HTTP/REST avec <strong>Postman</strong> (interface graphique, collaboration) et <strong>Newman</strong> (exécution en ligne de commande, CI/CD). Exemples génériques : projet <code>MonApp-API</code>, domaine <code>mon-app.example</code>, environnements <code>dev</code> / <code>recette</code> / <code>prod</code>.</p>

      <div class="wiki-callout wiki-callout--info">
        <strong>Public visé</strong>
        Testeurs QA orientés API, développeurs backend, référents d'intégration et équipes DevOps qui souhaitent industrialiser des campagnes de smoke, régression ou contrôle de non-régression sur des microservices, gateways ou backends sans interface graphique.
      </div>

      <h3 class="wiki-h3">Concepts fondamentaux Postman</h3>
      <p>Postman organise le travail autour de quatre notions imbriquées. Les maîtriser évite les erreurs de variables, les fuites de secrets et les collections non reproductibles en CI.</p>

      <table class="wiki-table">
        <tr><th>Concept</th><th>Définition détaillée</th><th>Exemple MonApp-API</th></tr>
        <tr>
          <td><strong>Workspace</strong> (espace de travail)</td>
          <td>Conteneur collaboratif Postman (cloud ou local). Regroupe collections, environnements, mock servers et membres d'équipe. Un workspace « MonApp-API — QA » peut être partagé en lecture seule aux testeurs et en écriture aux devs.</td>
          <td><code>WS-MonApp-API-QA</code></td>
        </tr>
        <tr>
          <td><strong>Collection</strong></td>
          <td>Ensemble versionnable de requêtes HTTP, dossiers, scripts Pre-request / Tests et documentation intégrée. Exportable en JSON pour Git. C'est l'unité exécutée par le Collection Runner et Newman.</td>
          <td><code>MonApp-API.postman_collection.json</code></td>
        </tr>
        <tr>
          <td><strong>Environment</strong> (environnement)</td>
          <td>Fichier de paires clé/valeur (<code>baseUrl</code>, <code>apiKey</code>, <code>token</code>…) sélectionnable à la volée. Permet de rejouer la même collection contre dev, recette ou prod sans dupliquer les requêtes.</td>
          <td><code>MonApp-API.recette.postman_environment.json</code></td>
        </tr>
        <tr>
          <td><strong>Globals</strong></td>
          <td>Variables globales au workspace (legacy) — préférez les variables de collection ou d'environnement pour limiter les collisions entre projets.</td>
          <td><code>correlationId</code> partagé entre deux collections (usage rare)</td>
        </tr>
      </table>

      <h3 class="wiki-h3">Hiérarchie des variables — ordre de résolution</h3>
      <p>Lorsqu'une requête référence <code>{{baseUrl}}</code> ou <code>{{authToken}}</code>, Postman résout la valeur selon un ordre de priorité strict (du plus spécifique au plus général) :</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>Variables locales</strong> — définies dans l'onglet Params ou via script (<code>pm.variables.set</code>) ; valables uniquement pour la requête en cours.</li>
        <li><strong>Variables de requête</strong> — portée de la requête individuelle (URL, headers, body).</li>
        <li><strong>Variables de dossier</strong> — héritées par toutes les requêtes du dossier (ex. <code>/auth/</code>, <code>/orders/</code>).</li>
        <li><strong>Variables de collection</strong> — communes à toute la collection ; idéales pour <code>apiVersion</code>, chemins relatifs.</li>
        <li><strong>Variables d'environnement</strong> — liées à l'environnement actif (<code>dev</code>, <code>recette</code>).</li>
        <li><strong>Globals</strong> — dernier recours ; à éviter sur les projets multi-équipes.</li>
      </ol>
      <pre class="wiki-code"><code>// Exemple : {{baseUrl}}/v1/customers/{{customerId}}
// baseUrl     → environnement MonApp-API.recette
// customerId  → variable de collection ou résultat d'une requête précédente (set via script)</code></pre>

      <div class="wiki-callout wiki-callout--warn">
        <strong>Secrets CA-TS</strong>
        Ne commitez jamais de tokens OAuth, mots de passe ou clés API en clair dans les fichiers JSON exportés. Utilisez des placeholders (<code>REPLACE_ME</code>) et injectez les valeurs via variables d'environnement locales non versionnées ou via le secret store de votre pipeline CI.
      </div>

      <h3 class="wiki-h3">Structure de projet recommandée dans Git</h3>
      <p>Versionner les exports Postman dans le dépôt de tests garantit la traçabilité, la revue de code et l'exécution Newman reproductible. Structure type pour <strong>MonApp-API</strong> :</p>
      <pre class="wiki-code"><code>MonApp-API-tests/
├── postman/
│   ├── collections/
│   │   └── MonApp-API.postman_collection.json
│   ├── environments/
│   │   ├── MonApp-API.dev.postman_environment.json
│   │   ├── MonApp-API.recette.postman_environment.json
│   │   └── MonApp-API.local.postman_environment.json   ← gitignore si secrets
│   ├── data/
│   │   ├── customers-create.csv
│   │   └── orders-scenarios.csv
│   └── globals/                                        ← optionnel, déconseillé
│       └── MonApp-API.postman_globals.json
├── reports/
│   └── .gitkeep                                        ← sorties Newman HTML/JUnit
├── package.json
├── newman.config.json                                  ← optionnel
├── .gitignore
└── README.md</code></pre>
      <p>Fichiers à exclure du dépôt (<code>.gitignore</code>) :</p>
      <ul class="wiki-steps">
        <li>Environnements contenant des secrets réels (<code>*.local.postman_environment.json</code>).</li>
        <li>Rapports générés (<code>reports/*.html</code>, <code>reports/*.xml</code>).</li>
        <li>Caches Postman locaux (hors scope Git — restent sur le poste).</li>
      </ul>

      <h3 class="wiki-h3">Création et configuration des requêtes HTTP</h3>
      <p>Chaque requête Postman modélise un appel HTTP vers <code>https://api.mon-app.example</code> (ou <code>{{baseUrl}}</code>). Configurez méthode, URL, headers, corps et authentification de façon explicite pour que Newman rejoue exactement le même scénario.</p>

      <h3 class="wiki-h3">Méthodes HTTP courantes</h3>
      <table class="wiki-table">
        <tr><th>Méthode</th><th>Usage typique MonApp-API</th><th>Corps de requête</th><th>Idempotence</th></tr>
        <tr><td><code>GET</code></td><td>Lire un client, lister des commandes, healthcheck <code>/actuator/health</code></td><td>Non</td><td>Oui</td></tr>
        <tr><td><code>POST</code></td><td>Créer un client, passer une commande, obtenir un token OAuth</td><td>Oui (JSON, form-data)</td><td>Non</td></tr>
        <tr><td><code>PUT</code></td><td>Remplacement complet d'une ressource client</td><td>Oui</td><td>Oui</td></tr>
        <tr><td><code>PATCH</code></td><td>Mise à jour partielle (ex. changement d'adresse)</td><td>Oui</td><td>Non</td></tr>
        <tr><td><code>DELETE</code></td><td>Suppression logique ou physique d'une commande</td><td>Rare</td><td>Oui</td></tr>
        <tr><td><code>HEAD</code></td><td>Vérifier l'existence sans corps de réponse</td><td>Non</td><td>Oui</td></tr>
        <tr><td><code>OPTIONS</code></td><td>Découverte CORS (souvent proxy/gateway)</td><td>Non</td><td>Oui</td></tr>
      </table>

      <h3 class="wiki-h3">Headers HTTP fréquents</h3>
      <table class="wiki-table">
        <tr><th>Header</th><th>Valeur exemple</th><th>Rôle</th></tr>
        <tr><td><code>Content-Type</code></td><td><code>application/json</code></td><td>Format du corps envoyé</td></tr>
        <tr><td><code>Accept</code></td><td><code>application/json</code></td><td>Format de réponse attendu</td></tr>
        <tr><td><code>Authorization</code></td><td><code>Bearer {{authToken}}</code></td><td>Jeton OAuth2 / JWT après login</td></tr>
        <tr><td><code>X-Request-Id</code></td><td><code>{{$guid}}</code></td><td>Corrélation logs distribués</td></tr>
        <tr><td><code>X-Api-Key</code></td><td><code>{{apiKey}}</code></td><td>Clé applicative gateway</td></tr>
        <tr><td><code>User-Agent</code></td><td><code>MonApp-API-Newman/1.0</code></td><td>Identification des campagnes automatisées</td></tr>
      </table>

      <h3 class="wiki-h3">Types d'authentification Postman</h3>
      <table class="wiki-table">
        <tr><th>Type</th><th>Quand l'utiliser</th><th>Configuration MonApp-API</th><th>Remarque CA-TS</th></tr>
        <tr><td><strong>No Auth</strong></td><td>Endpoints publics, healthcheck</td><td><code>GET {{baseUrl}}/health</code></td><td>Vérifier qu'aucune donnée sensible n'est exposée</td></tr>
        <tr><td><strong>API Key</strong></td><td>Gateway interne, partenaires</td><td>Header <code>X-Api-Key</code> = <code>{{apiKey}}</code></td><td>Clé fournie par l'équipe sécurité — hors Git</td></tr>
        <tr><td><strong>Bearer Token</strong></td><td>API OAuth2 / JWT</td><td>Token obtenu via requête <code>POST /oauth/token</code></td><td>Rafraîchir via Pre-request script</td></tr>
        <tr><td><strong>Basic Auth</strong></td><td>Legacy, outils internes</td><td><code>{{serviceUser}}</code> / <code>{{servicePassword}}</code></td><td>Préférer OAuth2 pour les nouveaux services</td></tr>
        <tr><td><strong>OAuth 2.0</strong></td><td>Flux authorization code, client credentials</td><td>Client ID/Secret en variables d'environnement</td><td>Adapter au SSO entreprise si applicable</td></tr>
        <tr><td><strong>Digest Auth</strong></td><td>Systèmes anciens</td><td>Rare sur MonApp-API</td><td>Postman gère le challenge automatiquement</td></tr>
        <tr><td><strong>AWS Signature</strong></td><td>API Gateway AWS</td><td>Access Key / Secret Key</td><td>Peu fréquent en contexte CA-TS on-prem</td></tr>
        <tr><td><strong>NTLM</strong></td><td>Services Windows legacy</td><td>Identifiants domaine</td><td>Tester depuis poste joint au domaine</td></tr>
      </table>

      <h3 class="wiki-h3">Scripts Pre-request — préparation dynamique</h3>
      <p>Les scripts Pre-request s'exécutent <em>avant</em> l'envoi HTTP. Ils servent à obtenir un token, calculer une signature, injecter un horodatage ou chaîner des variables depuis une requête précédente.</p>

      <details class="wiki-fold" open>
        <summary>Exemple 1 — Obtention et cache d'un token Bearer (client credentials)</summary>
        <pre class="wiki-code"><code>// Pre-request Script — dossier « Auth » ou collection entière
const tokenUrl = pm.environment.get('tokenUrl');
const clientId = pm.environment.get('clientId');
const clientSecret = pm.environment.get('clientSecret');
const cachedToken = pm.environment.get('authToken');
const expiry = pm.environment.get('authTokenExpiry');
const now = Date.now();

if (cachedToken &amp;&amp; expiry &amp;&amp; now &lt; Number(expiry)) {
    // Token encore valide — réutilisation
    return;
}

pm.sendRequest({
    url: tokenUrl,
    method: 'POST',
    header: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: {
        mode: 'urlencoded',
        urlencoded: [
            { key: 'grant_type', value: 'client_credentials' },
            { key: 'client_id', value: clientId },
            { key: 'client_secret', value: clientSecret },
        ],
    },
}, (err, res) =&gt; {
    if (err || res.code !== 200) {
        throw new Error('Échec OAuth MonApp-API : ' + (err || res.status));
    }
    const json = res.json();
    pm.environment.set('authToken', json.access_token);
    pm.environment.set('authTokenExpiry', String(now + (json.expires_in - 60) * 1000));
});</code></pre>
      </details>

      <details class="wiki-fold">
        <summary>Exemple 2 — Horodatage, correlation ID et signature HMAC simplifiée</summary>
        <pre class="wiki-code"><code>// Pre-request Script — requête « POST /orders »
const timestamp = new Date().toISOString();
const correlationId = pm.variables.replaceIn('{{$guid}}');
pm.variables.set('requestTimestamp', timestamp);
pm.variables.set('correlationId', correlationId);

const payload = pm.request.body &amp;&amp; pm.request.body.raw
    ? pm.request.body.raw
    : '';
const secret = pm.environment.get('hmacSecret') || '';
const CryptoJS = require('crypto-js');
const signature = CryptoJS.HmacSHA256(payload + timestamp, secret).toString();
pm.variables.set('requestSignature', signature);

// Headers injectés : X-Timestamp, X-Correlation-Id, X-Signature</code></pre>
        <div class="wiki-callout wiki-callout--info">
          <strong>CryptoJS</strong>
          Postman embarque CryptoJS pour HMAC, SHA, AES. Pour des signatures métier complexes, centralisez la logique dans un module partagé ou un service dédié.
        </div>
      </details>

      <h3 class="wiki-h3">Scripts de test — pm.test, pm.expect et assertions</h3>
      <p>L'onglet <strong>Tests</strong> (Postman) ou <strong>Test</strong> exécute du JavaScript après la réponse. Newman échoue si un <code>pm.test</code> retourne false ou si une assertion Chai lève une erreur — c'est le cœur de l'automatisation.</p>

      <pre class="wiki-code"><code>// Tests — GET {{baseUrl}}/v1/customers/{{customerId}}
pm.test('Status 200 OK', function () {
    pm.response.to.have.status(200);
});

pm.test('Content-Type JSON', function () {
    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');
});

const body = pm.response.json();
pm.test('Customer id cohérent', function () {
    pm.expect(body.id).to.eql(pm.environment.get('customerId'));
    pm.expect(body.email).to.match(/^[^@]+@[^@]+\\.example$/);
});

pm.test('Temps de réponse acceptable (&lt; 2s)', function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});</code></pre>

      <h3 class="wiki-h3">Référence API pm.test / pm.expect / pm.response (extrait)</h3>
      <table class="wiki-table">
        <tr><th>API / assertion</th><th>Description</th><th>Exemple MonApp-API</th></tr>
        <tr><td><code>pm.test(name, fn)</code></td><td>Déclare un cas de test nommé ; échec si exception ou assertion false</td><td><code>pm.test('Création client 201', …)</code></td></tr>
        <tr><td><code>pm.expect(value)</code></td><td>Assertion style Chai (BDD)</td><td><code>pm.expect(x).to.eql(42)</code></td></tr>
        <tr><td><code>pm.response.to.have.status(code)</code></td><td>Vérifie le code HTTP</td><td><code>.to.have.status(201)</code></td></tr>
        <tr><td><code>pm.response.to.be.ok</code></td><td>Status 2xx</td><td>Smoke healthcheck</td></tr>
        <tr><td><code>pm.response.to.be.success</code></td><td>Alias 2xx</td><td>Idem</td></tr>
        <tr><td><code>pm.response.to.be.error</code></td><td>Status 4xx ou 5xx</td><td>Tests négatifs</td></tr>
        <tr><td><code>pm.response.to.be.json</code></td><td>Corps JSON valide</td><td>Toutes les API REST</td></tr>
        <tr><td><code>pm.response.to.have.header(name)</code></td><td>Présence d'un header</td><td><code>'X-Request-Id'</code></td></tr>
        <tr><td><code>pm.response.to.have.body()</code></td><td>Corps non vide</td><td>POST création</td></tr>
        <tr><td><code>pm.response.json()</code></td><td>Parse JSON (throw si invalide)</td><td><code>const o = pm.response.json()</code></td></tr>
        <tr><td><code>pm.response.responseTime</code></td><td>Durée en ms</td><td>SLA &lt; 500 ms</td></tr>
        <tr><td><code>pm.response.code</code></td><td>Code numérique HTTP</td><td><code>pm.expect(pm.response.code).to.equal(404)</code></td></tr>
        <tr><td><code>pm.environment.set(key, val)</code></td><td>Persiste pour requêtes suivantes</td><td><code>customerId</code> après POST</td></tr>
        <tr><td><code>pm.environment.get(key)</code></td><td>Lit une variable d'environnement</td><td><code>{{baseUrl}}</code></td></tr>
        <tr><td><code>pm.collectionVariables.set/get</code></td><td>Variables de collection</td><td><code>apiVersion</code></td></tr>
        <tr><td><code>pm.variables.set/get</code></td><td>Variables locales de requête</td><td>ID temporaire</td></tr>
        <tr><td><code>pm.globals.set/get</code></td><td>Globals (legacy)</td><td>À éviter</td></tr>
        <tr><td><code>pm.sendRequest(options, cb)</code></td><td>Appel HTTP depuis un script</td><td>Setup token, cleanup</td></tr>
        <tr><td><code>pm.execution.setNextRequest(name)</code></td><td>Chaînage conditionnel (Runner)</td><td>Branche erreur métier</td></tr>
        <tr><td><code>pm.iterationData.get(key)</code></td><td>Donnée CSV courante (data-driven)</td><td><code>email</code>, <code>sku</code></td></tr>
        <tr><td><code>pm.info.requestName</code></td><td>Nom de la requête en cours</td><td>Logs custom</td></tr>
        <tr><td><code>pm.expect().to.include()</code></td><td>Sous-chaîne / sous-ensemble</td><td>Message d'erreur API</td></tr>
        <tr><td><code>pm.expect().to.have.property()</code></td><td>Propriété objet JSON</td><td><code>body.orderId</code></td></tr>
        <tr><td><code>pm.expect().to.be.oneOf([…])</code></td><td>Valeur dans une liste</td><td>Statuts métier autorisés</td></tr>
      </table>

      <h3 class="wiki-h3">Exemple de fichier Environment JSON</h3>
      <p>Export Postman v2.1 — environnement <strong>recette</strong> pour MonApp-API. Les valeurs sensibles sont des placeholders ; le pipeline CI injecte les secrets via variables masquées.</p>
      <pre class="wiki-code"><code>{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "MonApp-API — Recette",
  "values": [
    { "key": "baseUrl", "value": "https://api-recette.mon-app.example", "type": "default", "enabled": true },
    { "key": "tokenUrl", "value": "https://auth-recette.mon-app.example/oauth/token", "type": "default", "enabled": true },
    { "key": "clientId", "value": "monapp-api-newman", "type": "default", "enabled": true },
    { "key": "clientSecret", "value": "REPLACE_ME_IN_CI", "type": "secret", "enabled": true },
    { "key": "authToken", "value": "", "type": "default", "enabled": true },
    { "key": "authTokenExpiry", "value": "", "type": "default", "enabled": true },
    { "key": "apiKey", "value": "REPLACE_ME", "type": "secret", "enabled": true },
    { "key": "customerId", "value": "cust-smoke-001", "type": "default", "enabled": true },
    { "key": "defaultTimeoutMs", "value": "30000", "type": "default", "enabled": true }
  ],
  "_postman_variable_scope": "environment",
  "_postman_exported_at": "2026-06-19T10:00:00.000Z",
  "_postman_exported_using": "Postman/11.x"
}</code></pre>

      <h3 class="wiki-h3">Collection Runner vs Newman CLI</h3>
      <table class="wiki-table">
        <tr><th>Critère</th><th>Collection Runner (Postman GUI)</th><th>Newman (CLI)</th></tr>
        <tr><td>Contexte</td><td>Poste développeur / testeur, exploration interactive</td><td>Serveur CI, pipeline, cron, poste sans GUI</td></tr>
        <tr><td>Installation</td><td>Application Postman Desktop ou Web</td><td><code>npm install -g newman</code> ou dépendance projet</td></tr>
        <tr><td>Entrée</td><td>Collection + environnement sélectionnés dans l'UI</td><td>Fichiers JSON exportés depuis Git</td></tr>
        <tr><td>Rapports</td><td>Résultats visuels dans Postman</td><td>CLI, HTML, JUnit, JSON — intégration Jenkins/GitLab</td></tr>
        <tr><td>Data-driven</td><td>Import CSV via interface</td><td><code>newman run -d data/file.csv</code></td></tr>
        <tr><td>Parallélisation</td><td>Limitée (itérations séquentielles par défaut)</td><td>Séquentiel ; scale horizontal via sharding CI</td></tr>
        <tr><td>Proxy CA-TS</td><td>Paramètres Postman → Proxy</td><td>Variables <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code>, <code>NODE_EXTRA_CA_CERTS</code></td></tr>
        <tr><td>Recommandation Wizard</td><td>Conception, debug, démo métier</td><td>Smoke nightly, gate merge request, release</td></tr>
      </table>

      <h3 class="wiki-h3">Newman — commandes CLI (référence complète)</h3>
      <p>Exécuter depuis la racine du dépôt <code>MonApp-API-tests</code> après <code>npm ci</code>. Adapter les chemins et l'environnement.</p>
      <pre class="wiki-code"><code>cd D:\\DEV\\MonApp-API-tests
npx newman run postman/collections/MonApp-API.postman_collection.json \\
  -e postman/environments/MonApp-API.recette.postman_environment.json</code></pre>

      <table class="wiki-table">
        <tr><th>Commande / option</th><th>Description détaillée</th><th>Exemple MonApp-API</th></tr>
        <tr><td><code>newman run &lt;collection.json&gt;</code></td><td>Exécute toute la collection</td><td>Campagne smoke complète</td></tr>
        <tr><td><code>-e, --environment &lt;file&gt;</code></td><td>Charge un environnement exporté</td><td><code>MonApp-API.recette.postman_environment.json</code></td></tr>
        <tr><td><code>-g, --globals &lt;file&gt;</code></td><td>Charge des globals (legacy)</td><td>Éviter si possible</td></tr>
        <tr><td><code>-d, --iteration-data &lt;file&gt;</code></td><td>Fichier CSV/JSON data-driven</td><td><code>postman/data/customers-create.csv</code></td></tr>
        <tr><td><code>-n, --iteration-count &lt;n&gt;</code></td><td>Nombre d'itérations sans fichier data</td><td>Stress léger x10</td></tr>
        <tr><td><code>--folder &lt;name&gt;</code></td><td>Exécute un dossier uniquement</td><td><code>Smoke</code>, <code>Regression/Orders</code></td></tr>
        <tr><td><code>--bail [true|false|folder]</code></td><td>Arrêt au premier échec</td><td><code>--bail true</code> en CI gate</td></tr>
        <tr><td><code>--delay-request &lt;ms&gt;</code></td><td>Pause entre requêtes</td><td>500 ms anti rate-limit</td></tr>
        <tr><td><code>--timeout &lt;ms&gt;</code></td><td>Timeout global collection</td><td>300000 (5 min)</td></tr>
        <tr><td><code>--timeout-request &lt;ms&gt;</code></td><td>Timeout par requête HTTP</td><td>30000</td></tr>
        <tr><td><code>--timeout-script &lt;ms&gt;</code></td><td>Timeout scripts Pre-request/Tests</td><td>5000</td></tr>
        <tr><td><code>--ignore-redirects</code></td><td>Ne pas suivre les redirections 3xx</td><td>Tests explicites 301/302</td></tr>
        <tr><td><code>--insecure</code></td><td>Désactive vérification SSL (dev uniquement)</td><td>Certificats auto-signés locaux</td></tr>
        <tr><td><code>--ssl-extra-ca-certs &lt;file&gt;</code></td><td>Ajoute un CA corporate au trust store</td><td>Certificat racine CA-TS</td></tr>
        <tr><td><code>-r, --reporters &lt;list&gt;</code></td><td>cli, json, junit, html, htmlextra…</td><td><code>-r cli,htmlextra,junit</code></td></tr>
        <tr><td><code>--reporter-html-export &lt;path&gt;</code></td><td>Export rapport HTML</td><td><code>reports/newman.html</code></td></tr>
        <tr><td><code>--reporter-junit-export &lt;path&gt;</code></td><td>Export JUnit pour Jenkins/GitLab</td><td><code>reports/junit.xml</code></td></tr>
        <tr><td><code>--reporter-json-export &lt;path&gt;</code></td><td>Export JSON machine-readable</td><td>Dashboard qualité</td></tr>
        <tr><td><code>--export-environment &lt;path&gt;</code></td><td>Sauve variables modifiées en fin de run</td><td>Debug token refresh</td></tr>
        <tr><td><code>--export-globals &lt;path&gt;</code></td><td>Sauve globals modifiés</td><td>Rare</td></tr>
        <tr><td><code>--env-var &quot;key=value&quot;</code></td><td>Surcharge une variable sans éditer le JSON</td><td><code>--env-var "clientSecret=$SECRET"</code></td></tr>
        <tr><td><code>--global-var &quot;key=value&quot;</code></td><td>Surcharge globale ponctuelle</td><td>Feature flag</td></tr>
        <tr><td><code>--color off</code></td><td>Désactive couleurs CLI (logs CI)</td><td>Pipelines Windows</td></tr>
        <tr><td><code>--verbose</code></td><td>Logs détaillés</td><td>Diagnostic proxy SSL</td></tr>
        <tr><td><code>newman run --help</code></td><td>Aide complète des options</td><td>Référence locale</td></tr>
      </table>

      <h3 class="wiki-h3">package.json — scripts npm pour CI et poste local</h3>
      <pre class="wiki-code"><code>{
  "name": "monapp-api-tests",
  "version": "1.0.0",
  "private": true,
  "description": "Campagnes Postman/Newman — MonApp-API",
  "scripts": {
    "test:api:smoke": "newman run postman/collections/MonApp-API.postman_collection.json -e postman/environments/MonApp-API.recette.postman_environment.json --folder Smoke --reporters cli,htmlextra,junit --reporter-htmlextra-export reports/smoke.html --reporter-junit-export reports/smoke-junit.xml --bail true",
    "test:api:regression": "newman run postman/collections/MonApp-API.postman_collection.json -e postman/environments/MonApp-API.recette.postman_environment.json --folder Regression --reporters cli,htmlextra --reporter-htmlextra-export reports/regression.html",
    "test:api:data": "newman run postman/collections/MonApp-API.postman_collection.json -e postman/environments/MonApp-API.recette.postman_environment.json -d postman/data/customers-create.csv --reporters cli,junit --reporter-junit-export reports/data-driven.xml",
    "test:api:ci": "cross-env HTTP_PROXY=%HTTPS_PROXY% HTTPS_PROXY=%HTTPS_PROXY% npm run test:api:smoke",
    "postman:lint": "node scripts/validate-collection.mjs",
    "reports:clean": "node -e \"require('fs').rmSync('reports',{recursive:true,force:true}); require('fs').mkdirSync('reports')\""
  },
  "devDependencies": {
    "newman": "^6.2.0",
    "newman-reporter-htmlextra": "^1.23.0",
    "cross-env": "^7.0.3"
  },
  "engines": {
    "node": ">=18"
  }
}</code></pre>
      <p>Intégration pipeline GitLab CI (extrait) :</p>
      <pre class="wiki-code"><code>api-smoke:
  stage: test
  image: node:20
  variables:
    HTTPS_PROXY: "http://proxy.intra.ca-ts.example:8080"
    NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/ca-ts-root.pem"
  script:
    - npm ci
    - npm run test:api:smoke
  artifacts:
    when: always
    paths:
      - reports/
    reports:
      junit: reports/smoke-junit.xml</code></pre>

      <h3 class="wiki-h3">Tests data-driven (fichier CSV)</h3>
      <p>Newman peut itérer sur un fichier CSV : chaque ligne alimente une itération complète de la collection (ou du dossier ciblé). Les colonnes sont accessibles via <code>pm.iterationData.get('nomColonne')</code>.</p>
      <p>Fichier <code>postman/data/customers-create.csv</code> :</p>
      <pre class="wiki-code"><code>email,firstName,lastName,expectedStatus
alice@mon-app.example,Alice,Dupont,201
invalid-email,Bob,Martin,400
charlie@mon-app.example,Charlie,Bernard,201</code></pre>
      <pre class="wiki-code"><code>// Tests — POST /v1/customers (data-driven)
const expected = pm.iterationData.get('expectedStatus');
pm.test('Status attendu pour ' + pm.iterationData.get('email'), function () {
    pm.response.to.have.status(Number(expected));
});</code></pre>
      <pre class="wiki-code"><code>npx newman run postman/collections/MonApp-API.postman_collection.json \\
  -e postman/environments/MonApp-API.recette.postman_environment.json \\
  -d postman/data/customers-create.csv \\
  --folder "Customers / Create"</code></pre>

      <h3 class="wiki-h3">Chaînage de requêtes (workflow)</h3>
      <p>Les parcours API métier (créer un client → créer une commande → payer → vérifier le statut) s'enchaînent en propagant des variables entre requêtes.</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>01 — POST /oauth/token</strong> — Pre-request ou Tests : <code>pm.environment.set('authToken', …)</code></li>
        <li><strong>02 — POST /v1/customers</strong> — Tests : <code>pm.environment.set('customerId', pm.response.json().id)</code></li>
        <li><strong>03 — POST /v1/orders</strong> — Body JSON : <code>"customerId": "{{customerId}}"</code> ; Tests : sauve <code>orderId</code></li>
        <li><strong>04 — POST /v1/orders/{{orderId}}/pay</strong> — Utilise token + orderId</li>
        <li><strong>05 — GET /v1/orders/{{orderId}}</strong> — Assert <code>status === 'PAID'</code></li>
        <li><strong>06 — DELETE /v1/orders/{{orderId}}</strong> (teardown) — Nettoyage données de test</li>
      </ol>
      <pre class="wiki-code"><code>// Tests — POST /v1/orders (étape 3)
pm.test('Commande créée', function () {
    pm.response.to.have.status(201);
    const orderId = pm.response.json().id;
    pm.environment.set('orderId', orderId);
    pm.collectionVariables.set('lastOrderId', orderId);
});

// Chaînage conditionnel (Collection Runner uniquement)
if (pm.response.code !== 201) {
    pm.execution.setNextRequest('Cleanup — Log failure');
} else {
    pm.execution.setNextRequest('04 — Pay order');
}</code></pre>
      <div class="wiki-callout wiki-callout--info">
        <strong>Ordre d'exécution Newman</strong>
        Newman exécute les requêtes dans l'ordre de l'arborescence de la collection sauf si <code>setNextRequest</code> redirige (support partiel — tester en Runner avant CI).
      </div>

      <h3 class="wiki-h3">Mock servers et monitors (aperçu)</h3>
      <table class="wiki-table">
        <tr><th>Fonctionnalité</th><th>Usage MonApp-API</th><th>Limite</th></tr>
        <tr><td><strong>Mock Server</strong> (Postman Cloud)</td><td>Simuler <code>GET /v1/customers/:id</code> quand le backend recette est indisponible ; contrats API-first</td><td>Nécessite compte Postman ; pas de substitute Newman natif</td></tr>
        <tr><td><strong>Monitor</strong></td><td>Exécution planifiée cloud sur collection (smoke toutes les 15 min)</td><td>Trafic sortant — vérifier conformité proxy CA-TS</td></tr>
      </table>
      <p>Pour l'industrialisation CA-TS, privilégiez Newman en CI plutôt que les Monitors cloud si les politiques réseau restreignent les appels sortants vers Postman SaaS.</p>

      <h3 class="wiki-h3">Import OpenAPI (Swagger)</h3>
      <p>Si MonApp-API publie une spec <code>openapi.yaml</code> :</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Postman → <strong>Import</strong> → glisser <code>openapi.yaml</code> ou URL <code>https://api.mon-app.example/v3/api-docs</code>.</li>
        <li>Postman génère une collection brouillon avec une requête par endpoint.</li>
        <li>Enrichir manuellement : exemples de body, tests <code>pm.test</code>, variables <code>{{baseUrl}}</code>.</li>
        <li>Exporter la collection enrichie vers <code>postman/collections/</code> et versionner dans Git.</li>
        <li>Re-importer uniquement lors des évolutions majeures d'API — fusionner avec prudence pour ne pas écraser les scripts.</li>
      </ol>

      <h3 class="wiki-h3">Configuration proxy et certificats CA-TS</h3>
      <p>Sur poste et agents CI CA-TS, le trafic HTTPS transite souvent par un proxy HTTP et des autorités de certification internes.</p>

      <h3 class="wiki-h3">Postman Desktop</h3>
      <ul class="wiki-steps">
        <li><strong>Settings → Proxy</strong> : activer « Use system proxy » ou renseigner <code>http://proxy.intra.ca-ts.example:8080</code>.</li>
        <li><strong>Settings → Certificates</strong> : ajouter le certificat client si mutual TLS requis par l'API gateway.</li>
        <li><strong>Settings → General → SSL certificate verification</strong> : laisser activé en recette/prod ; désactiver uniquement en dev local avec certificats auto-signés.</li>
      </ul>

      <h3 class="wiki-h3">Newman / Node.js</h3>
      <pre class="wiki-code"><code># PowerShell — session de test
$env:HTTP_PROXY  = "http://proxy.intra.ca-ts.example:8080"
$env:HTTPS_PROXY = "http://proxy.intra.ca-ts.example:8080"
$env:NO_PROXY    = "localhost,127.0.0.1,.intra.ca-ts.example"
$env:NODE_EXTRA_CA_CERTS = "D:\\certs\\ca-ts-root.pem"

npm run test:api:smoke</code></pre>
      <pre class="wiki-code"><code># Alternative : option Newman explicite
npx newman run postman/collections/MonApp-API.postman_collection.json \\
  -e postman/environments/MonApp-API.recette.postman_environment.json \\
  --ssl-extra-ca-certs D:/certs/ca-ts-root.pem</code></pre>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Ne pas utiliser --insecure en recette/prod</strong>
        Désactiver la vérification SSL masque des problèmes de certificats et expose à des attaques MITM — réservé au dev local contrôlé.
      </div>

      <h3 class="wiki-h3">Intégration JIRA / Xray — note Wizard</h3>
      <p>Le <strong>Hook Git JIRA/Xray</strong> du Wizard QA est principalement conçu pour les scénarios Gherkin (<code>.feature</code>) et fichiers Robot. Les collections Postman exportées en JSON <em>peuvent</em> être versionnées et tracées manuellement dans Xray (Tests de type Manual ou Generic) mais ne sont pas synchronisées automatiquement par le hook post-commit standard.</p>
      <ul class="wiki-steps">
        <li>Associer une campagne Newman à un <strong>Test Execution</strong> Xray via import JUnit (<code>reports/smoke-junit.xml</code>) dans le pipeline CI.</li>
        <li>Nommer les dossiers Postman selon les IDs JIRA (<code>PRODUIT-12345_Smoke_API</code>) pour faciliter la correspondance documentaire.</li>
        <li>Documenter dans le ticket JIRA le lien vers la collection Git et la commande <code>npm run test:api:smoke</code>.</li>
        <li>Pour une traçabilité bidirectionnelle avancée, envisager un export périodique des résultats vers Xray API ou un plugin CI dédié — hors scope du hook Git natif.</li>
      </ul>

      <h3 class="wiki-h3">Bonnes pratiques (8+ recommandations)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>Une collection par bounded context</strong> — ex. <code>MonApp-Customers</code>, <code>MonApp-Orders</code> — plutôt qu'un monolithe ingérable.</li>
        <li><strong>Nommer les requêtes avec un préfixe ordonné</strong> — <code>01 —</code>, <code>02 —</code> — pour garantir l'ordre Newman et la lisibilité métier.</li>
        <li><strong>Séparer données et secrets</strong> — environnements committés sans secrets ; injection CI via <code>--env-var</code> ou fichiers <code>.local</code> gitignorés.</li>
        <li><strong>Assertions explicites sur chaque requête</strong> — au minimum status + schema JSON ; éviter les collections « sans tests » qui ne détectent pas les régressions.</li>
        <li><strong>Idempotence et teardown</strong> — créer puis supprimer les données de test ; utiliser des IDs uniques (<code>{{$guid}}</code>) pour éviter les collisions.</li>
        <li><strong>Dossier Smoke minimal</strong> — 5 à 15 requêtes critiques exécutées à chaque merge ; régression complète en nightly.</li>
        <li><strong>Rapports JUnit archivés</strong> — artifacts CI pour historique et import Xray.</li>
        <li><strong>Revues de code sur les exports JSON</strong> — pull requests sur <code>postman/collections/*.json</code> comme sur le code applicatif.</li>
        <li><strong>Versionner la spec OpenAPI</strong> à côté de la collection pour détecter les dérives contrat/tests.</li>
        <li><strong>Documenter les prérequis réseau</strong> — proxy, whitelist URLs, certificats — dans le README du dépôt de tests.</li>
        <li><strong>Limiter les scripts complexes</strong> — logique métier lourde dans le backend ou helpers Node testables ; Postman pour orchestration HTTP.</li>
      </ol>

      <h3 class="wiki-h3">Quand le Wizard recommande Postman</h3>
      <p>Le questionnaire stack (15 questions) pondère Cypress, Robot Framework, Playwright et Postman. Postman ressort en tête lorsque :</p>
      <table class="wiki-table">
        <tr><th>Contexte projet</th><th>Signal questionnaire</th><th>Pourquoi Postman</th></tr>
        <tr><td>Tests API sans UI</td><td>Objectif « services ou API » (poids fort Postman)</td><td>Outil natif REST, pas de navigateur</td></tr>
        <tr><td>Descriptions via formulaires/collections</td><td>Style « formulaires ou collections simples »</td><td>UI Postman accessible aux profils peu codeurs</td></tr>
        <tr><td>Pas de parcours web</td><td>« Pas de navigateur / écrans »</td><td>Évite la complexité Cypress/Playwright</td></tr>
        <tr><td>Smoke backend rapide</td><td>Contrôles fumée microservices</td><td>Exécution Newman en quelques secondes</td></tr>
        <tr><td>Documentation API vivante</td><td>Besoin doc + test unifiés</td><td>Documentation intégrée Postman</td></tr>
        <tr><td>Équipe QA fonctionnelle</td><td>Auteurs testeurs métier</td><td>Courbe d'apprentissage douce vs code</td></tr>
        <tr><td>Complément UI existant</td><td>Projet déjà couvert en E2E ailleurs</td><td>Postman en complément, pas remplacement UI</td></tr>
      </table>
      <div class="wiki-callout wiki-callout--ok">
        <strong>Stack complémentaire</strong>
        Postman excelle sur la couche HTTP/REST. Pour les parcours utilisateur complets (login web, navigation, PDF…), combinez avec Playwright ou Cypress — le questionnaire peut orienter vers une stack UI si l'objectif principal est l'interface graphique.
      </div>

      <h3 class="wiki-h3">Centre de ressources — liens officiels Postman</h3>
      <details class="wiki-fold" open>
        <summary>Démarrage et fondamentaux</summary>
        <ul class="wiki-steps">
          <li><a href="https://learning.postman.com/docs/getting-started/overview/" target="_blank" rel="noopener">Vue d'ensemble Postman Learning Center</a></li>
          <li><a href="https://learning.postman.com/docs/sending-requests/create-requests/create-requests/" target="_blank" rel="noopener">Créer des requêtes HTTP</a></li>
          <li><a href="https://learning.postman.com/docs/sending-requests/variables/variables/" target="_blank" rel="noopener">Variables — guide complet</a></li>
          <li><a href="https://learning.postman.com/docs/collections/collections-overview/" target="_blank" rel="noopener">Collections — organisation et partage</a></li>
        </ul>
      </details>
      <details class="wiki-fold">
        <summary>Scripts, tests et assertions</summary>
        <ul class="wiki-steps">
          <li><a href="https://learning.postman.com/docs/tests-and-scripts/write-scripts/intro-to-scripts/" target="_blank" rel="noopener">Introduction aux scripts</a></li>
          <li><a href="https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/" target="_blank" rel="noopener">Écrire des tests automatisés</a></li>
          <li><a href="https://learning.postman.com/docs/tests-and-scripts/test-examples/test-examples/" target="_blank" rel="noopener">Exemples de tests (status, schema, timing)</a></li>
          <li><a href="https://learning.postman.com/docs/tests-and-scripts/scripts/test-scripts/" target="_blank" rel="noopener">Référence pm.* et snippets</a></li>
        </ul>
      </details>
      <details class="wiki-fold">
        <summary>Newman, CI/CD et data files</summary>
        <ul class="wiki-steps">
          <li><a href="https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman/" target="_blank" rel="noopener">Intégration CLI Newman</a></li>
          <li><a href="https://github.com/postmanlabs/newman" target="_blank" rel="noopener">Dépôt GitHub newman</a></li>
          <li><a href="https://learning.postman.com/docs/collections/running-collections/working-with-data-files/" target="_blank" rel="noopener">Fichiers de données CSV/JSON</a></li>
          <li><a href="https://www.npmjs.com/package/newman-reporter-htmlextra" target="_blank" rel="noopener">Reporter htmlextra (rapports enrichis)</a></li>
        </ul>
      </details>
      <details class="wiki-fold">
        <summary>OpenAPI, mocks, collaboration</summary>
        <ul class="wiki-steps">
          <li><a href="https://learning.postman.com/docs/integrations/available-integrations/working-with-openAPI/" target="_blank" rel="noopener">Importer OpenAPI / Swagger</a></li>
          <li><a href="https://learning.postman.com/docs/designing-and-developing-your-api/mocking-data/setting-up-mock/" target="_blank" rel="noopener">Configurer un Mock Server</a></li>
          <li><a href="https://learning.postman.com/docs/collections/testing-for-performance/performance-test-overview/" target="_blank" rel="noopener">Tests de performance (option avancée)</a></li>
          <li><a href="https://learning.postman.com/docs/collaborating-in-postman/working-with-your-team/collaboration-overview/" target="_blank" rel="noopener">Collaboration en équipe</a></li>
        </ul>
      </details>

      <p class="wiki-next">
        <a href="#playwright" data-wiki-nav="playwright" class="btn-primary btn-sm">← Section 12 — Playwright</a>
        <a href="/" class="btn-primary btn-sm">→ Retour accueil Wizard</a>
      </p>`,
}
