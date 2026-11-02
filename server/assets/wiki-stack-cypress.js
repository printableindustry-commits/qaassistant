/**
 * Wiki — section 10 : Cypress (guide complet).
 */
// eslint-disable-next-line no-var
var WikiStackCypress = {
  id: 'cypress',
  title: '10. Cypress',
  body: `
      <div class="wiki-hero wiki-hero--stack">
        <img src="/assets/logo-cypress.png" alt="Logo Cypress" class="wiki-hero-logo" width="72" height="72" />
        <div>
          <h2>Cypress — tests end-to-end dans le navigateur</h2>
          <p>Ce guide couvre l'installation, la structure de projet, la configuration, les commandes <code>cy.*</code>, le BDD Gherkin, le mocking réseau, la CI/CD et le débogage. Il s'adresse aux équipes QA et développeurs qui démarrent ou consolident une stack Cypress sur un poste d'entreprise (registry npm CA-TS, proxy, certificats).</p>
        </div>
      </div>

      <div class="wiki-callout wiki-callout--info">
        <strong>Public visé</strong> — Débutants à intermédiaires. Aucune connaissance préalable de Selenium n'est requise : Cypress embarque son propre moteur d'exécution et une API fluide orientée développeur.
      </div>

      <h3 class="wiki-h3">Qu'est-ce que Cypress ?</h3>
      <p><strong>Cypress</strong> est un framework open source de tests end-to-end (E2E) exécutés dans un vrai navigateur (Chromium, Firefox, WebKit selon version). Contrairement aux outils « remote WebDriver », Cypress s'exécute <em>dans le même event loop</em> que votre application sous test (AUT — Application Under Test), ce qui permet des assertions fiables, un débogage visuel immédiat et une gestion native du réseau.</p>
      <p>Les tests Cypress sont écrits en JavaScript ou TypeScript. Ils simulent un utilisateur réel : navigation, clics, saisie clavier, lecture du DOM, vérification d'API REST, capture d'écran, etc. Le runner affiche chaque commande en direct avec time-travel (retour arrière sur l'état du DOM à n'importe quelle étape).</p>
      <ul class="wiki-steps">
        <li><strong>E2E</strong> — Parcours utilisateur complet, de la page de connexion au téléchargement d'un export.</li>
        <li><strong>Composant</strong> (optionnel) — Montage isolé d'un composant UI (React, Vue, Angular…) sans lancer toute l'application.</li>
        <li><strong>API</strong> — Tests HTTP purs via <code>cy.request()</code>, complémentaires aux scénarios UI.</li>
      </ul>

      <h3 class="wiki-h3">Architecture Cypress : runner, AUT, file de commandes, retry-ability</h3>
      <p>Comprendre l'architecture évite 80 % des erreurs « élément introuvable » ou « timed out retrying ».</p>
      <table class="wiki-table">
        <tr><th>Composant</th><th>Rôle</th><th>Remarque</th></tr>
        <tr><td><strong>Test Runner</strong></td><td>Interface graphique (Cypress App) ou mode headless (<code>cypress run</code>)</td><td>Affiche la spec, la liste des commandes, le DOM snapshot, la console réseau</td></tr>
        <tr><td><strong>AUT (Application Under Test)</strong></td><td>Page web chargée dans un iframe ou fenêtre dédiée</td><td>Ne partage pas le même contexte JS que le spec — communication via le proxy Cypress</td></tr>
        <tr><td><strong>Proxy réseau</strong></td><td>Intercepte XHR/fetch entre AUT et serveur</td><td>Permet <code>cy.intercept()</code>, stubbing, modification des réponses</td></tr>
        <tr><td><strong>File de commandes (command queue)</strong></td><td>Chaque <code>cy.*</code> est enfilée et exécutée séquentiellement</td><td>Les commandes ne s'exécutent pas « en parallèle » dans un même test — l'ordre compte</td></tr>
        <tr><td><strong>Retry-ability</strong></td><td>Assertions et queries réessayées automatiquement</td><td><code>cy.get()</code> + <code>.should()</code> attendent que le DOM se stabilise (timeout configurable)</td></tr>
      </table>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Piège fréquent</strong> — Mélanger du JavaScript « classique » (<code>setTimeout</code>, <code>async/await</code> hors commandes Cypress) avec la file de commandes provoque des race conditions. Préférez toujours enchaîner via <code>.then()</code> ou des commandes Cypress natives.
      </div>
      <p>Schéma simplifié du flux :</p>
      <pre class="wiki-code"><code>Spec (.cy.ts)  →  cy.visit('/login')
                      ↓
              Command Queue  →  cy.get('#user').type('demo')
                      ↓
              Proxy / Browser  →  AUT reçoit les événements
                      ↓
              Assertions  →  cy.get('h1').should('contain', 'Accueil')  [retry jusqu'à timeout]</code></pre>

      <h3 class="wiki-h3">Installation pas à pas</h3>
      <p>Sur un poste d'entreprise CA-TS, configurez d'abord le fichier <code>.npmrc</code> (registry Artifactory, token, proxy ZGIE). Sans registry interne, <code>npm install cypress</code> échouera derrière le proxy.</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Vérifier Node.js LTS (18 ou 20 recommandé) : <code>node -v</code> et <code>npm -v</code>.</li>
        <li>Configurer <code>%USERPROFILE%\\.npmrc</code> avec le registry CA-TS (voir section Wiki « Configuration .npmrc »).</li>
        <li>Créer ou ouvrir le dépôt de tests, par ex. <code>mon-projet-tests</code>.</li>
        <li>Initialiser npm si besoin : <code>npm init -y</code>.</li>
        <li>Installer Cypress en devDependency : <code>npm install cypress --save-dev</code>.</li>
        <li>Ouvrir le runner une première fois : <code>npx cypress open</code> — Cypress télécharge le binaire navigateur (peut prendre plusieurs minutes).</li>
        <li>Choisir E2E Testing, sélectionner un navigateur, laisser Cypress générer <code>cypress.config.ts</code> et un exemple <code>cypress/e2e/spec.cy.ts</code>.</li>
      </ol>
      <div class="wiki-callout wiki-callout--ok">
        <strong>Package interne optionnel</strong> — Certaines tribus utilisent <code>@cats-cdf/e2e</code> pour factoriser config, reporters et step definitions Cucumber. Voir le pli « Exemple concret CA-TS » en bas de page.
      </div>
      <pre class="wiki-code"><code># Exemple d'installation dans mon-projet-tests
cd D:\\DEV\\mon-projet-tests
npm install cypress --save-dev
npm install typescript @types/node --save-dev
npx cypress open</code></pre>

      <h3 class="wiki-h3">Structure de projet recommandée</h3>
      <p>Une arborescence claire facilite la maintenance quand le nombre de specs dépasse quelques dizaines.</p>
      <pre class="wiki-code"><code>mon-projet-tests/
├── cypress.config.ts          # Configuration globale Cypress
├── cypress.env.json           # Variables d'environnement (ne pas commiter de secrets)
├── package.json
├── tsconfig.json
├── cypress/
│   ├── e2e/
│   │   ├── auth/
│   │   │   └── login.cy.ts
│   │   ├── checkout/
│   │   │   └── panier.cy.ts
│   │   └── smoke/
│   │       └── accueil.cy.ts
│   ├── fixtures/
│   │   ├── users.json
│   │   └── commandes.json
│   ├── support/
│   │   ├── e2e.ts             # Hooks globaux, imports plugins
│   │   └── commands.ts        # Commandes personnalisées cy.login()
│   ├── downloads/             # Fichiers téléchargés (gitignore)
│   └── screenshots/           # Captures en cas d'échec (gitignore)
└── reports/                   # Sortie reporters (JUnit, Mochawesome…)</code></pre>
      <p>Pour du <strong>Gherkin / Cucumber</strong>, ajoutez typiquement :</p>
      <pre class="wiki-code"><code>cypress/
├── e2e/
│   └── features/
│       └── PRODUIT-XXXX/
│           └── connexion.feature
└── support/
    └── step_definitions/
        └── connexion.steps.ts</code></pre>

      <h3 class="wiki-h3">Exemple complet : cypress.config.ts</h3>
      <p>Le fichier de configuration centralise l'URL de base, les timeouts, les reporters et les options expérimentales.</p>
      <pre class="wiki-code"><code>import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'https://mon-application.example',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 30000,
    video: true,
    screenshotOnRunFailure: true,
    retries: {
      runMode: 2,    // CI headless
      openMode: 0,   // dev local
    },
    env: {
      apiUrl: 'https://api.mon-application.example',
      utilisateurDemo: 'demo@test.local',
    },
    setupNodeEvents(on, config) {
      // Plugins : preprocessor Cucumber, reporter JUnit, tâches Node…
      // on('task', { … })
      return config
    },
  },
})</code></pre>

      <h3 class="wiki-h3">Scripts package.json</h3>
      <p>Standardisez les commandes pour l'équipe et la CI.</p>
      <pre class="wiki-code"><code>{
  "name": "mon-projet-tests",
  "version": "1.0.0",
  "scripts": {
    "cy:open": "cypress open",
    "cy:run": "cypress run",
    "cy:run:chrome": "cypress run --browser chrome",
    "cy:run:smoke": "cypress run --spec 'cypress/e2e/smoke/**'",
    "cy:run:record": "cypress run --record --key \$CYPRESS_RECORD_KEY",
    "test:e2e": "npm run cy:run",
    "test:e2e:ci": "cypress run --browser chrome --headless --config video=false"
  },
  "devDependencies": {
    "cypress": "^13.0.0",
    "typescript": "^5.0.0"
  }
}</code></pre>
      <table class="wiki-table">
        <tr><th>Script</th><th>Usage</th></tr>
        <tr><td><code>npm run cy:open</code></td><td>Développement interactif, débogage visuel</td></tr>
        <tr><td><code>npm run cy:run</code></td><td>Exécution headless locale ou CI</td></tr>
        <tr><td><code>npm run cy:run:smoke</code></td><td>Sous-ensemble rapide avant merge</td></tr>
        <tr><td><code>--env TAG=@critique</code></td><td>Filtrage dynamique (avec plugin grep ou Cucumber tags)</td></tr>
      </table>

      <h3 class="wiki-h3">Exemple de test natif (.cy.ts)</h3>
      <p>Spec TypeScript classique, sans Cucumber — idéal pour smoke tests ou POC.</p>
      <pre class="wiki-code"><code>// cypress/e2e/auth/login.cy.ts
describe('Connexion — PRODUIT-XXXX', () => {
  beforeEach(() => {
    cy.visit('/login')
  })

  it('affiche le formulaire et connecte un utilisateur valide', () => {
    cy.get('[data-cy="input-email"]').type('demo@test.local')
    cy.get('[data-cy="input-password"]').type('MotDePasseSecurise1!', { log: false })
    cy.get('[data-cy="btn-submit"]').click()

    cy.url().should('include', '/dashboard')
    cy.get('[data-cy="welcome-message"]').should('be.visible')
      .and('contain.text', 'Bienvenue')
  })

  it('refuse un mot de passe incorrect', () => {
    cy.get('[data-cy="input-email"]').type('demo@test.local')
    cy.get('[data-cy="input-password"]').type('mauvais')
    cy.get('[data-cy="btn-submit"]').click()

    cy.get('[data-cy="error-banner"]').should('be.visible')
      .and('contain', 'Identifiants invalides')
  })
})</code></pre>

      <h3 class="wiki-h3">Gherkin : fichier .feature, step definitions, config Cucumber</h3>
      <p>Le BDD (Behavior-Driven Development) rapproche métier et QA via un langage Gherkin (<code>Given / When / Then</code>). Cypress ne lit pas nativement les <code>.feature</code> : un preprocessor (ex. <code>@badeball/cypress-cucumber-preprocessor</code>) compile les features en specs exécutables.</p>
      <p><strong>Fichier feature</strong> — <code>cypress/e2e/features/PRODUIT-XXXX/connexion.feature</code></p>
      <pre class="wiki-code"><code># language: fr
@PRODUIT-XXXX @connexion @smoke
Fonctionnalité: Connexion utilisateur
  En tant qu'utilisateur enregistré
  Je veux me connecter à mon-application.example
  Afin d'accéder à mon espace personnel

  @critique
  Scénario: Connexion réussie avec identifiants valides
    Étant donné que je suis sur la page de connexion
    Quand je saisis l'email "demo@test.local"
    Et je saisis le mot de passe "MotDePasseSecurise1!"
    Et je clique sur le bouton de connexion
    Alors je suis redirigé vers le tableau de bord
    Et le message de bienvenue est affiché

  Scénario: Échec avec mot de passe incorrect
    Étant donné que je suis sur la page de connexion
    Quand je saisis l'email "demo@test.local"
    Et je saisis le mot de passe "incorrect"
    Et je clique sur le bouton de connexion
    Alors un message d'erreur "Identifiants invalides" s'affiche</code></pre>
      <p><strong>Step definitions</strong> — <code>cypress/support/step_definitions/connexion.steps.ts</code></p>
      <pre class="wiki-code"><code>import { Given, When, Then } from '@badeball/cypress-cucumber-preprocessor'

Given('je suis sur la page de connexion', () => {
  cy.visit('/login')
})

When('je saisis l\'email {string}', (email: string) => {
  cy.get('[data-cy="input-email"]').clear().type(email)
})

When('je saisis le mot de passe {string}', (password: string) => {
  cy.get('[data-cy="input-password"]').type(password, { log: false })
})

When('je clique sur le bouton de connexion', () => {
  cy.get('[data-cy="btn-submit"]').click()
})

Then('je suis redirigé vers le tableau de bord', () => {
  cy.url().should('include', '/dashboard')
})

Then('le message de bienvenue est affiché', () => {
  cy.get('[data-cy="welcome-message"]').should('be.visible')
})

Then('un message d\'erreur {string} s\'affiche', (message: string) => {
  cy.get('[data-cy="error-banner"]').should('contain', message)
})</code></pre>
      <p><strong>Configuration Cucumber dans cypress.config.ts</strong> (extrait) :</p>
      <pre class="wiki-code"><code>import createBundler from '@bahmutov/cypress-esbuild-preprocessor'
import { addCucumberPreprocessorPlugin } from '@badeball/cypress-cucumber-preprocessor'
import createEsbuildPlugin from '@badeball/cypress-cucumber-preprocessor/esbuild'

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/features/**/*.feature',
    async setupNodeEvents(on, config) {
      await addCucumberPreprocessorPlugin(on, config)
      on('file:preprocessor', createBundler({
        plugins: [createEsbuildPlugin(config)],
      }))
      return config
    },
  },
})</code></pre>
      <div class="wiki-callout wiki-callout--info">
        <strong>Tags Gherkin</strong> — Filtrez en CI avec <code>--env tags="@smoke and not @wip"</code> (syntaxe selon version du preprocessor). Alignez les tags sur les clés JIRA (<code>@PRODUIT-XXXX</code>) pour la traçabilité.
      </div>

      <h3 class="wiki-h3">Table des commandes cy.* (référence)</h3>
      <p>Les commandes Cypress sont le cœur de l'API. Ci-dessous les plus utilisées en E2E — consultez la doc officielle pour la liste exhaustive.</p>
      <table class="wiki-table">
        <tr><th>Commande</th><th>Description</th><th>Exemple</th></tr>
        <tr><td><code>cy.visit()</code></td><td>Charge une URL (relative à baseUrl ou absolue)</td><td><code>cy.visit('/accueil')</code></td></tr>
        <tr><td><code>cy.get()</code></td><td>Query DOM (sélecteur CSS, alias…)</td><td><code>cy.get('[data-cy=btn]')</code></td></tr>
        <tr><td><code>cy.contains()</code></td><td>Trouve un élément par texte/contenu</td><td><code>cy.contains('button', 'Valider')</code></td></tr>
        <tr><td><code>cy.click()</code></td><td>Clic sur élément courant ou ciblé</td><td><code>cy.get('#ok').click()</code></td></tr>
        <tr><td><code>cy.dblclick()</code></td><td>Double-clic</td><td><code>cy.get('.row').dblclick()</code></td></tr>
        <tr><td><code>cy.rightclick()</code></td><td>Clic droit / menu contextuel</td><td><code>cy.get('.item').rightclick()</code></td></tr>
        <tr><td><code>cy.type()</code></td><td>Saisie clavier dans input/textarea</td><td><code>cy.get('input').type('hello{enter}')</code></td></tr>
        <tr><td><code>cy.clear()</code></td><td>Vide un champ de saisie</td><td><code>cy.get('input').clear()</code></td></tr>
        <tr><td><code>cy.check() / cy.uncheck()</code></td><td>Coche/décoche checkbox ou radio</td><td><code>cy.get('[type=checkbox]').check()</code></td></tr>
        <tr><td><code>cy.select()</code></td><td>Sélection option dans &lt;select&gt;</td><td><code>cy.get('select').select('France')</code></td></tr>
        <tr><td><code>cy.trigger()</code></td><td>Déclenche événement DOM (mouseover, etc.)</td><td><code>cy.get('.menu').trigger('mouseover')</code></td></tr>
        <tr><td><code>cy.focus() / cy.blur()</code></td><td>Focus / perte de focus</td><td><code>cy.get('#search').focus()</code></td></tr>
        <tr><td><code>cy.should()</code></td><td>Assertion chaînée (retry automatique)</td><td><code>cy.get('h1').should('be.visible')</code></td></tr>
        <tr><td><code>cy.and()</code></td><td>Assertion supplémentaire sur même sujet</td><td><code>.should('exist').and('have.text', 'OK')</code></td></tr>
        <tr><td><code>cy.intercept()</code></td><td>Stub/spy routes réseau XHR/fetch</td><td><code>cy.intercept('GET', '/api/user', fixture)</code></td></tr>
        <tr><td><code>cy.wait()</code></td><td>Attend alias intercept ou délai (ms)</td><td><code>cy.wait('@getUser')</code></td></tr>
        <tr><td><code>cy.request()</code></td><td>Requête HTTP hors navigateur (API pure)</td><td><code>cy.request('POST', '/api/login', body)</code></td></tr>
        <tr><td><code>cy.fixture()</code></td><td>Charge JSON depuis cypress/fixtures</td><td><code>cy.fixture('users').then(...)</code></td></tr>
        <tr><td><code>cy.readFile() / cy.writeFile()</code></td><td>Lecture/écriture fichier disque</td><td><code>cy.readFile('cypress/fixtures/data.json')</code></td></tr>
        <tr><td><code>cy.wrap()</code></td><td>Encapsule valeur non-Cypress dans chaîne</td><td><code>cy.wrap({ id: 1 }).its('id')</code></td></tr>
        <tr><td><code>cy.then()</code></td><td>Callback après résolution commande</td><td><code>cy.get('.x').then($el => ...)</code></td></tr>
        <tr><td><code>cy.as()</code></td><td>Crée alias (élément ou intercept)</td><td><code>cy.intercept(...).as('api')</code></td></tr>
        <tr><td><code>cy.url()</code></td><td>Assertion ou lecture URL courante</td><td><code>cy.url().should('include', '/home')</code></td></tr>
        <tr><td><code>cy.title()</code></td><td>Titre de la page</td><td><code>cy.title().should('eq', 'Accueil')</code></td></tr>
        <tr><td><code>cy.location()</code></td><td>Hash, hostname, pathname…</td><td><code>cy.location('pathname').should('eq', '/')</code></td></tr>
        <tr><td><code>cy.window()</code></td><td>Accès objet window de l'AUT</td><td><code>cy.window().its('localStorage')</code></td></tr>
        <tr><td><code>cy.document()</code></td><td>Document DOM racine</td><td><code>cy.document().its('readyState')</code></td></tr>
        <tr><td><code>cy.scrollTo()</code></td><td>Scroll viewport ou élément</td><td><code>cy.scrollTo('bottom')</code></td></tr>
        <tr><td><code>cy.screenshot()</code></td><td>Capture écran manuelle</td><td><code>cy.screenshot('etape-panier')</code></td></tr>
        <tr><td><code>cy.reload()</code></td><td>Recharge la page</td><td><code>cy.reload(true)</code></td></tr>
        <tr><td><code>cy.go()</code></td><td>Historique navigateur back/forward</td><td><code>cy.go('back')</code></td></tr>
        <tr><td><code>cy.session()</code></td><td>Cache session login entre specs</td><td><code>cy.session('user', () => { ... })</code></td></tr>
        <tr><td><code>cy.origin()</code></td><td>Tests cross-origin (autre domaine)</td><td><code>cy.origin('https://sso.example', () => ...)</code></td></tr>
        <tr><td><code>cy.task()</code></td><td>Exécute code Node via plugin</td><td><code>cy.task('readPdf', 'file.pdf')</code></td></tr>
        <tr><td><code>cy.exec()</code></td><td>Commande shell (avec précaution CI)</td><td><code>cy.exec('npm run seed-db')</code></td></tr>
      </table>

      <h3 class="wiki-h3">Table des assertions courantes</h3>
      <p>Les assertions s'appliquent via <code>.should()</code> ou <code>.and()</code>. Chainer de Chai est intégré ; Cypress réessaie jusqu'au timeout.</p>
      <table class="wiki-table">
        <tr><th>Assertion</th><th>Signification</th><th>Exemple</th></tr>
        <tr><td><code>exist</code></td><td>Élément présent dans le DOM</td><td><code>.should('exist')</code></td></tr>
        <tr><td><code>not.exist</code></td><td>Élément absent</td><td><code>.should('not.exist')</code></td></tr>
        <tr><td><code>be.visible</code></td><td>Visible (non display:none, dimensions &gt; 0)</td><td><code>.should('be.visible')</code></td></tr>
        <tr><td><code>not.be.visible</code></td><td>Caché ou hors écran</td><td><code>.should('not.be.visible')</code></td></tr>
        <tr><td><code>be.disabled</code></td><td>Champ/bouton désactivé</td><td><code>cy.get('button').should('be.disabled')</code></td></tr>
        <tr><td><code>be.enabled</code></td><td>Interactif</td><td><code>.should('be.enabled')</code></td></tr>
        <tr><td><code>have.text</code></td><td>Texte exact (normalisé)</td><td><code>.should('have.text', 'OK')</code></td></tr>
        <tr><td><code>contain</code></td><td>Sous-chaîne dans le texte</td><td><code>.should('contain', 'succès')</code></td></tr>
        <tr><td><code>have.value</code></td><td>Valeur input/textarea</td><td><code>cy.get('input').should('have.value', 'abc')</code></td></tr>
        <tr><td><code>have.attr</code></td><td>Attribut HTML</td><td><code>.should('have.attr', 'href', '/home')</code></td></tr>
        <tr><td><code>have.class</code></td><td>Classe CSS présente</td><td><code>.should('have.class', 'active')</code></td></tr>
        <tr><td><code>have.length</code></td><td>Nombre d'éléments dans collection</td><td><code>cy.get('li').should('have.length', 5)</code></td></tr>
        <tr><td><code>have.css</code></td><td>Propriété CSS calculée</td><td><code>.should('have.css', 'color', 'rgb(0, 0, 0)')</code></td></tr>
        <tr><td><code>be.checked</code></td><td>Checkbox/radio coché</td><td><code>cy.get('[type=checkbox]').should('be.checked')</code></td></tr>
        <tr><td><code>include</code></td><td>Sur strings, tableaux, objets</td><td><code>cy.wrap(['a','b']).should('include', 'a')</code></td></tr>
        <tr><td><code>eq</code></td><td>Égalité stricte</td><td><code>cy.wrap(42).should('eq', 42)</code></td></tr>
        <tr><td><code>match</code></td><td>Regex</td><td><code>cy.get('.ref').should('match', /^CMD-\\d+$/) </code></td></tr>
        <tr><td><code>satisfy</code></td><td>Prédicat custom</td><td><code>.should('satisfy', (txt) => txt.length &gt; 0)</code></td></tr>
      </table>

      <h3 class="wiki-h3">Sélecteurs : bonnes pratiques</h3>
      <p>Un sélecteur stable réduit la flakiness. Ordre de préférence recommandé par Cypress :</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong><code>data-cy</code>, <code>data-testid</code>, <code>data-test</code></strong> — Attributs dédiés aux tests, indépendants du style CSS.</li>
        <li><strong>Rôle ARIA + nom accessible</strong> — <code>cy.findByRole('button', { name: 'Valider' })</code> avec <code>@testing-library/cypress</code>.</li>
        <li><strong>Texte utilisateur visible</strong> — <code>cy.contains('Confirmer la commande')</code> (attention i18n).</li>
        <li><strong>ID stable</strong> — Uniquement si l'ID ne change pas entre builds.</li>
        <li><strong>Classes CSS / structure DOM profonde</strong> — À éviter : refactors UI cassent les tests.</li>
      </ol>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Anti-patterns</strong> — Sélecteurs du type <code>div &gt; div:nth-child(3) &gt; span.icon</code>, XPath fragile, ou dépendance à des libellés traduits sans stratégie i18n.
      </div>
      <pre class="wiki-code"><code>// Bon
cy.get('[data-cy="checkout-submit"]').click()

// Acceptable avec Testing Library
cy.findByRole('heading', { name: 'Mon panier' })

// À éviter
cy.get('.MuiButton-root-1847').click()</code></pre>

      <h3 class="wiki-h3">Fixtures, alias et commandes personnalisées</h3>
      <p><strong>Fixtures</strong> — Fichiers statiques JSON (ou images binaires) dans <code>cypress/fixtures/</code>. Idéal pour jeux de données réutilisables et réponses API mockées.</p>
      <pre class="wiki-code"><code>// cypress/fixtures/users.json
{
  "admin": { "email": "admin@test.local", "role": "ADMIN" },
  "client": { "email": "client@test.local", "role": "USER" }
}

// Dans un test
cy.fixture('users').then((users) => {
  cy.get('[data-cy="input-email"]').type(users.client.email)
})</code></pre>
      <p><strong>Alias</strong> — Nommer une requête interceptée ou un élément pour réutilisation.</p>
      <pre class="wiki-code"><code>cy.intercept('GET', '/api/produits', { fixture: 'produits.json' }).as('getProduits')
cy.visit('/catalogue')
cy.wait('@getProduits')
cy.get('[data-cy="product-card"]').should('have.length.greaterThan', 0)</code></pre>
      <p><strong>Commandes custom</strong> — Factoriser des séquences répétées dans <code>cypress/support/commands.ts</code>.</p>
      <pre class="wiki-code"><code>// commands.ts
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    cy.visit('/login')
    cy.get('[data-cy="input-email"]').type(email)
    cy.get('[data-cy="input-password"]').type(password, { log: false })
    cy.get('[data-cy="btn-submit"]').click()
    cy.url().should('include', '/dashboard')
  })
})

// e2e.ts — import './commands'

// spec
cy.login('demo@test.local', 'MotDePasseSecurise1!')
cy.visit('/mon-compte')</code></pre>

      <h3 class="wiki-h3">cy.intercept — mocking et espionnage réseau</h3>
      <p><code>cy.intercept()</code> remplace progressivement <code>cy.route()</code> (Cypress 6+). Il intercepte les requêtes HTTP de l'AUT avant qu'elles n'atteignent le serveur réel (ou les laisse passer tout en observant).</p>
      <ul class="wiki-steps">
        <li><strong>Stub</strong> — Réponse fictive pour isoler le front-end.</li>
        <li><strong>Spy</strong> — Laisser la requête partir mais compter les appels / inspecter le body.</li>
        <li><strong>Modifier</strong> — Changer status ou body d'une vraie réponse (<code>req.reply()</code>).</li>
      </ul>
      <pre class="wiki-code"><code>// Stub complet avec fixture
cy.intercept('GET', '/api/commandes/*', { fixture: 'commande-detail.json' }).as('getCommande')

// Forcer une erreur 500
cy.intercept('POST', '/api/paiement', {
  statusCode: 500,
  body: { error: 'Service indisponible' },
}).as('postPaiement')

// Modifier dynamiquement la réponse réelle
cy.intercept('GET', '/api/user', (req) => {
  req.reply((res) => {
    res.body.displayName = 'Utilisateur Test'
    res.send()
  })
}).as('getUser')

cy.visit('/commandes/123')
cy.wait('@getCommande')
cy.get('[data-cy="order-status"]').should('contain', 'Expédiée')</code></pre>
      <div class="wiki-callout wiki-callout--info">
        <strong>GraphQL</strong> — Interceptez <code>POST</code> vers <code>/graphql</code> et filtrez par <code>req.body.operationName</code> ou contenu de la query.
      </div>

      <h3 class="wiki-h3">Variables d'environnement</h3>
      <p>Cypress expose des variables via <code>Cypress.env('nom')</code> ou <code>cy.env('nom')</code> (v13+). Sources possibles :</p>
      <table class="wiki-table">
        <tr><th>Source</th><th>Fichier / mécanisme</th><th>Priorité</th></tr>
        <tr><td><code>cypress.env.json</code></td><td>Racine projet, committable sans secrets</td><td>Base</td></tr>
        <tr><td><code>config.env</code> dans cypress.config</td><td>Valeurs par défaut dans le code</td><td>Override json</td></tr>
        <tr><td><code>--env key=value</code></td><td>Ligne de commande</td><td>Override config</td></tr>
        <tr><td><code>CYPRESS_*</code></td><td>Variables OS en CI</td><td>Override tout (sauf config runtime)</td></tr>
      </table>
      <pre class="wiki-code"><code>// cypress.env.json (exemple — pas de mots de passe en clair)
{
  "baseApi": "https://api-recette.mon-application.example",
  "utilisateurDemo": "demo@test.local"
}

// Lecture dans un test
cy.request(Cypress.env('baseApi') + '/health').its('status').should('eq', 200)

// CI : pipeline injecte les secrets
// CYPRESS_apiToken=*** npm run cy:run</code></pre>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Sécurité</strong> — Ne commitez jamais tokens, mots de passe ou clés Cloud dans <code>cypress.env.json</code>. Utilisez les secrets du pipeline CI ou un fichier local gitignoré.
      </div>

      <h3 class="wiki-h3">Hooks : before, beforeEach, after, afterEach</h3>
      <p>Les hooks Mocha structurent le cycle de vie des tests. Ils s'exécutent dans le contexte Cypress (file de commandes respectée si vous n'utilisez pas de Promises non chaînées).</p>
      <table class="wiki-table">
        <tr><th>Hook</th><th>Portée</th><th>Usage typique</th></tr>
        <tr><td><code>before()</code></td><td>Une fois par bloc <code>describe</code></td><td>Seed base de données, connexion unique lourde</td></tr>
        <tr><td><code>beforeEach()</code></td><td>Avant chaque <code>it</code></td><td><code>cy.visit()</code>, reset cookies, intercept communs</td></tr>
        <tr><td><code>afterEach()</code></td><td>Après chaque <code>it</code></td><td>Capture log supplémentaire, cleanup UI</td></tr>
        <tr><td><code>after()</code></td><td>Fin du bloc <code>describe</code></td><td>Teardown global rare</td></tr>
      </table>
      <p>Hooks globaux dans <code>cypress/support/e2e.ts</code> :</p>
      <pre class="wiki-code"><code>beforeEach(() => {
  cy.log('Début test — ' + Cypress.currentTest.title)
  // Préserver cookies entre tests si cy.session utilisé
})

afterEach(function () {
  if (this.currentTest?.state === 'failed') {
    cy.screenshot(\`echec-\${this.currentTest.title}\`)
  }
})</code></pre>
      <p><code>Cypress.on('fail', …)</code> permet des actions globales en cas d'échec (attention à ne pas masquer l'erreur).</p>

      <h3 class="wiki-h3">Reporters et plugins</h3>
      <p>En mode <code>cypress run</code>, le reporter par défaut est Mocha « spec » (sortie console). En CI, on ajoute souvent JUnit XML pour intégration Jenkins, GitLab, Azure DevOps.</p>
      <pre class="wiki-code"><code>// cypress.config.ts — reporter intégré
export default defineConfig({
  reporter: 'junit',
  reporterOptions: {
    mochaFile: 'reports/junit/results-[hash].xml',
    toConsole: true,
  },
})</code></pre>
      <p>Plugins courants via <code>setupNodeEvents</code> :</p>
      <ul class="wiki-steps">
        <li><code>@badeball/cypress-cucumber-preprocessor</code> — Gherkin / BDD</li>
        <li><code>cypress-mochawesome-reporter</code> — Rapport HTML riche</li>
        <li><code>@cypress/grep</code> — Filtrage specs par titre ou tags</li>
        <li><code>cypress-real-events</code> — Événements pointer réalistes (hover précis)</li>
        <li><code>@testing-library/cypress</code> — Queries accessibles</li>
        <li><code>cypress-plugin-tab</code> — Navigation clavier Tab</li>
      </ul>
      <div class="wiki-callout wiki-callout--ok">
        <strong>Cypress Cloud (optionnel)</strong> — Enregistrement des runs (<code>--record</code>), parallélisation, analytics de flakiness. Nécessite compte et clé projet — souvent réservé aux pipelines officiels.
      </div>

      <h3 class="wiki-h3">Exemple CI/CD (pipeline générique)</h3>
      <p>Exemple GitLab CI — adaptez l'image Docker et les variables à votre infra.</p>
      <pre class="wiki-code"><code># .gitlab-ci.yml (extrait)
stages:
  - test

variables:
  CYPRESS_CACHE_FOLDER: "$CI_PROJECT_DIR/cache/Cypress"

e2e-cypress:
  stage: test
  image: cypress/browsers:node-20.11.0-chrome-121-ff-121
  cache:
    key: cypress-cache
    paths:
      - cache/Cypress
      - node_modules/
  before_script:
    - npm ci
  script:
    - npm run test:e2e:ci
  artifacts:
    when: always
    paths:
      - cypress/screenshots/
      - cypress/videos/
      - reports/junit/
    reports:
      junit: reports/junit/*.xml
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"</code></pre>
      <p>Points d'attention CI :</p>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Utiliser une image <code>cypress/browsers</code> ou installer Chrome/Firefox + dépendances système.</li>
        <li>Configurer <code>baseUrl</code> vers l'environnement de recette déployé par le pipeline (<code>CYPRESS_baseUrl</code>).</li>
        <li>Désactiver vidéo en CI si espace disque limité : <code>video: false</code>.</li>
        <li>Paralléliser avec Cypress Cloud ou split manuel des specs (<code>--spec</code> par dossier).</li>
        <li>Remonter JUnit/XML comme artifact pour le tableau de bord QA.</li>
      </ol>

      <h3 class="wiki-h3">Débogage</h3>
      <p>Cypress excelle en débogage interactif. Techniques par ordre d'efficacité :</p>
      <ul class="wiki-steps">
        <li><strong>Runner interactif</strong> — <code>npx cypress open</code>, clic sur une spec, time-travel sur chaque commande.</li>
        <li><strong>cy.pause()</strong> — Freeze l'exécution pour inspecter le DOM (retirer avant commit).</li>
        <li><strong>Debug mode</strong> — <code>cy.debug()</code> ou bouton DevTools dans le runner ; ouvrir Chrome DevTools sur le iframe AUT.</li>
        <li><strong>Logs</strong> — <code>cy.log('message')</code> visible dans le runner ; option <code>{ log: false }</code> sur <code>type()</code> pour masquer mots de passe.</li>
        <li><strong>Screenshots / vidéos</strong> — Automatiques en échec ; chemins <code>cypress/screenshots</code> et <code>cypress/videos</code>.</li>
        <li><strong>Verbose CI</strong> — <code>DEBUG=cypress:* npm run cy:run</code> pour traces détaillées.</li>
        <li><strong>Isoler un test</strong> — <code>it.only()</code> ou <code>describe.only()</code> (ne pas pousser en remote).</li>
      </ul>
      <pre class="wiki-code"><code>// Temporaire — inspection d'un élément
cy.get('[data-cy="panier"]').then(($el) => {
  debugger // eslint-disable-line no-debugger
  console.log($el.text())
})</code></pre>
      <div class="wiki-callout wiki-callout--warn">
        <strong>Tests flaky</strong> — Si un test passe en local et échoue en CI, vérifiez : timeouts trop courts, race conditions hors Cypress, dépendance à des données non reset, fuseau horaire, animations CSS.
      </div>

      <h3 class="wiki-h3">Bonnes pratiques (liste numérotée)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li>Utiliser des attributs <code>data-cy</code> dédiés plutôt que des sélecteurs CSS fragiles.</li>
        <li>Ne pas tester des détails d'implémentation internes — tester le comportement visible par l'utilisateur.</li>
        <li>Préférer <code>cy.session()</code> pour éviter de rejouer le login à chaque spec.</li>
        <li>Mock réseau (<code>cy.intercept</code>) pour stabiliser les scénarios dépendants d'API tierces ou indisponibles en recette.</li>
        <li>Isoler les données de test (comptes dédiés, prefix « test_ ») et nettoyer après scénarios destructifs.</li>
        <li>Limiter les <code>cy.wait(ms)</code> arbitraires — utiliser <code>cy.wait('@alias')</code> ou assertions avec retry.</li>
        <li>Versionner <code>cypress.config.ts</code>, specs, fixtures, support — gitignore screenshots/videos/downloads.</li>
        <li>Aligner tags Gherkin / titres de spec avec clés JIRA (<code>PRODUIT-XXXX</code>) pour traçabilité Xray.</li>
        <li>Exécuter smoke tests sur chaque MR ; suite complète nightly ou avant release.</li>
        <li>Documenter variables d'environnement requises dans le README du dépôt <code>mon-projet-tests</code>.</li>
      </ol>

      <details class="wiki-fold">
        <summary>Exemple concret CA-TS — package <code>@cats-cdf/e2e</code></summary>
        <p>Certaines tribus CA-TS mutualisent config Cypress, reporters JUnit, step definitions Cucumber et helpers Artifactory via le package npm interne <code>@cats-cdf/e2e</code>. Installation typique après configuration du <code>.npmrc</code> :</p>
        <pre class="wiki-code"><code>npm install @cats-cdf/e2e --save-dev</code></pre>
        <p>Le package peut exporter un preset de configuration :</p>
        <pre class="wiki-code"><code>// cypress.config.ts minimal dans mon-projet-tests
import cdfE2e from '@cats-cdf/e2e/config'

export default cdfE2e({
  baseUrl: 'https://recette.mon-application.example',
  env: { planJira: 'PRODUIT-XXXX' },
})</code></pre>
        <p>Consultez la documentation interne du package pour les conventions de dossiers <code>features/</code>, reporters Xray et intégration hook Git. Ce pli est optionnel — un projet peut rester 100 % Cypress open source standard.</p>
      </details>

      <h3 class="wiki-h3">Documentation officielle Cypress (par thème)</h3>
      <table class="wiki-table">
        <tr><th>Thème</th><th>Lien</th></tr>
        <tr><td>Introduction &amp; philosophie</td><td><a href="https://docs.cypress.io/guides/overview/why-cypress" target="_blank" rel="noopener">docs.cypress.io — Why Cypress</a></td></tr>
        <tr><td>Installation</td><td><a href="https://docs.cypress.io/guides/getting-started/installing-cypress" target="_blank" rel="noopener">Installing Cypress</a></td></tr>
        <tr><td>Configuration</td><td><a href="https://docs.cypress.io/guides/references/configuration" target="_blank" rel="noopener">Configuration reference</a></td></tr>
        <tr><td>Liste des commandes</td><td><a href="https://docs.cypress.io/api/table-of-contents" target="_blank" rel="noopener">API Table of Contents</a></td></tr>
        <tr><td>Best practices</td><td><a href="https://docs.cypress.io/guides/references/best-practices" target="_blank" rel="noopener">Best practices</a></td></tr>
        <tr><td>cy.intercept</td><td><a href="https://docs.cypress.io/api/commands/intercept" target="_blank" rel="noopener">intercept()</a></td></tr>
        <tr><td>Variables d'environnement</td><td><a href="https://docs.cypress.io/guides/guides/environment-variables" target="_blank" rel="noopener">Environment variables</a></td></tr>
        <tr><td>Hooks Mocha</td><td><a href="https://docs.cypress.io/guides/core-concepts/writing-and-organizing-tests#Hooks" target="_blank" rel="noopener">Writing and organizing tests</a></td></tr>
        <tr><td>Reporters</td><td><a href="https://docs.cypress.io/guides/tooling/reporters" target="_blank" rel="noopener">Reporters</a></td></tr>
        <tr><td>CI/CD</td><td><a href="https://docs.cypress.io/guides/continuous-integration/introduction" target="_blank" rel="noopener">Continuous integration</a></td></tr>
        <tr><td>Debugging</td><td><a href="https://docs.cypress.io/guides/references/troubleshooting" target="_blank" rel="noopener">Troubleshooting</a></td></tr>
        <tr><td>Custom commands</td><td><a href="https://docs.cypress.io/api/cypress-api/custom-commands" target="_blank" rel="noopener">Custom commands</a></td></tr>
        <tr><td>Component testing</td><td><a href="https://docs.cypress.io/guides/component-testing/overview" target="_blank" rel="noopener">Component testing</a></td></tr>
        <tr><td>cy.session</td><td><a href="https://docs.cypress.io/api/commands/session" target="_blank" rel="noopener">session()</a></td></tr>
      </table>

      <p class="wiki-next">
        <a href="/repair.html" class="btn-primary btn-sm">→ Assistant Stack — Réparation poste</a>
        &nbsp;
        <a href="/hook-git.html" class="btn-primary btn-sm">→ Assistant Hook Git</a>
        &nbsp;
        <a href="/wiki.html#robot" class="btn-primary btn-sm">→ Section Robot Framework</a>
      </p>`,
}
