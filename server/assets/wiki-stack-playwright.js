/**
 * Wiki — section 12 : Playwright (stack tests web multi-navigateurs).
 * Documentation détaillée en français pour les équipes QA CA-TS.
 */
// eslint-disable-next-line no-var
var WikiStackPlaywright = {
  id: 'playwright',
  title: '12. Playwright',
  body: `
      <div class="wiki-stack-hero">
        <img src="/assets/logo-playwright.png" alt="Playwright" width="48" height="48" class="wiki-stack-hero-logo" />
        <div>
          <p class="wiki-stack-hero-lead">
            <strong>Playwright</strong> est un framework open source de tests de bout en bout (E2E) développé par Microsoft.
            Il pilote Chrome, Firefox, Safari (WebKit) et Edge via une API unique en TypeScript ou JavaScript.
            Idéal pour des campagnes <em>multi-navigateurs</em>, parallèles en CI/CD, avec auto-attente intégrée,
            traces vidéo, interception réseau et tests API dans le même outillage.
          </p>
          <p class="hint">
            Site officiel :
            <a href="https://playwright.dev" target="_blank" rel="noopener noreferrer">playwright.dev</a>
            — Documentation complète, exemples et API reference.
          </p>
        </div>
      </div>

      <h3 class="wiki-h3">Pourquoi choisir Playwright ?</h3>
      <p>
        Dans un dépôt de tests générique comme <code>mon-depot-tests</code>, Playwright répond aux besoins des équipes
        qui doivent valider une application web (<code>mon-application-web</code>) sur plusieurs navigateurs,
        avec une exécution rapide en pipeline et une fiabilité élevée sur les interfaces dynamiques (SPA React, Angular, Vue).
      </p>
      <ul class="wiki-steps">
        <li><strong>Multi-navigateurs natif</strong> — un seul script, exécution sur Chromium, Firefox et WebKit sans duplication.</li>
        <li><strong>Auto-attente (auto-wait)</strong> — Playwright attend automatiquement que les éléments soient visibles, activés et stables avant chaque action ; moins de <code>sleep</code> artificiels.</li>
        <li><strong>Parallélisme</strong> — les tests tournent en parallèle par défaut (workers), avec sharding pour répartir la charge en CI.</li>
        <li><strong>Outillage intégré</strong> — codegen (enregistrement), UI Mode (débogage visuel), Trace Viewer (analyse post-mortem), screenshots et vidéos.</li>
        <li><strong>Tests API</strong> — la fixture <code>request</code> permet de tester des endpoints REST sans ouvrir de navigateur.</li>
        <li><strong>Isolation</strong> — chaque test obtient un contexte navigateur propre ; pas de fuite d'état entre scénarios.</li>
        <li><strong>Interception réseau</strong> — mock, stub ou modification des requêtes HTTP pour des scénarios déterministes.</li>
        <li><strong>Authentification réutilisable</strong> — <code>storageState</code> pour réutiliser une session connectée sans relogin à chaque test.</li>
      </ul>

      <div class="wiki-callout wiki-callout--info">
        <strong>Quand privilégier Playwright plutôt qu'un autre outil ?</strong>
        Campagnes multi-navigateurs, exécution massive en CI, applications très dynamiques, besoin de tests API + UI dans le même framework.
        Pour des parcours Gherkin orientés métier, voir la section <a href="#robot">Robot Framework</a>.
        Pour des collections API collaboratives, voir <a href="#postman">Postman</a>.
      </div>

      <h3 class="wiki-h3">Fonctionnalités clés</h3>
      <table class="wiki-table">
        <tr><th>Domaine</th><th>Capacité</th><th>Intérêt QA</th></tr>
        <tr><td>Navigateurs</td><td>Chromium, Firefox, WebKit, Edge channel</td><td>Couverture réelle multi-moteurs sans Selenium Grid complexe</td></tr>
        <tr><td>Appareils</td><td>Émulation mobile, tablette, viewport personnalisé</td><td>Responsive et parcours mobile sans device farm</td></tr>
        <tr><td>Locators</td><td>getByRole, getByLabel, getByTestId…</td><td>Sélecteurs résilients, alignés accessibilité</td></tr>
        <tr><td>Réseau</td><td>route, fulfill, abort, HAR</td><td>Scénarios déterministes, tests hors ligne partiels</td></tr>
        <tr><td>Fichiers</td><td>upload, download, readFile</td><td>Parcours export/import CSV, PDF, pièces jointes</td></tr>
        <tr><td>Multi-onglets</td><td>context.pages(), popup, nouvel onglet</td><td>Flux OAuth, liens externes, impression</td></tr>
        <tr><td>Iframes</td><td>frameLocator</td><td>Widgets embarqués, paiement tiers</td></tr>
        <tr><td>Accessibilité</td><td>Intégration axe (via @axe-core/playwright)</td><td>Non-régression a11y en complément E2E</td></tr>
        <tr><td>Reporting</td><td>HTML, JUnit, JSON, blob reporter</td><td>Intégration Jenkins, GitHub Actions, Azure DevOps</td></tr>
        <tr><td>Composants</td><td>Component testing (expérimental)</td><td>Tests isolés de composants React/Vue/Svelte</td></tr>
      </table>

      <h3 class="wiki-h3">Installation dans un dépôt de tests</h3>
      <p>
        Depuis la racine de votre dépôt (<code>D:\\DEV\\mon-depot-tests</code>), lancez l'assistant officiel.
        Il crée l'arborescence <code>tests/</code>, <code>playwright.config.ts</code> et installe les navigateurs.
      </p>
      <pre class="wiki-code"><code>cd D:\\DEV\\mon-depot-tests
npm init playwright@latest

# Réponses typiques de l'assistant :
# - TypeScript ou JavaScript : TypeScript (recommandé)
# - Dossier des tests : tests
# - Ajouter GitHub Actions workflow : oui (optionnel)
# - Installer les navigateurs Playwright : oui</code></pre>
      <p>Installation manuelle équivalente :</p>
      <pre class="wiki-code"><code>npm install -D @playwright/test
npx playwright install</code></pre>
      <p>Scripts npm usuels à ajouter dans <code>package.json</code> :</p>
      <pre class="wiki-code"><code>{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:report": "playwright show-report",
    "test:e2e:codegen": "playwright codegen https://mon-app-recette.example.com"
  }
}</code></pre>

      <div class="wiki-callout wiki-callout--warn">
        <strong>Proxy d'entreprise</strong>
        Si <code>npx playwright install</code> échoue derrière le proxy CA-TS, configurez
        <code>HTTPS_PROXY</code> et éventuellement <code>NODE_EXTRA_CA_CERTS</code> avant l'installation des binaires navigateurs.
      </div>

      <h3 class="wiki-h3">Arborescence type du projet</h3>
      <pre class="wiki-code"><code>mon-depot-tests/
├── playwright.config.ts      # Configuration globale
├── package.json
├── tests/
│   ├── e2e/
│   │   ├── login.spec.ts
│   │   ├── dashboard.spec.ts
│   │   └── export-csv.spec.ts
│   ├── api/
│   │   └── users-api.spec.ts
│   ├── fixtures/
│   │   └── auth.fixture.ts
│   └── pages/
│       ├── LoginPage.ts
│       └── DashboardPage.ts
├── playwright/
│   └── .auth/
│       └── user.json         # storageState (session sauvegardée)
└── test-results/             # Traces, screenshots (gitignore)</code></pre>

      <h3 class="wiki-h3">Fichier playwright.config.ts — exemple commenté</h3>
      <p>Configuration complète pour un projet générique <code>mon-application-web</code> en recette :</p>
      <pre class="wiki-code"><code>import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright — dépôt mon-depot-tests
 * URL cible : application web de recette (adapter selon l'environnement)
 */
export default defineConfig({
  // Dossier racine des tests (fichiers *.spec.ts)
  testDir: './tests/e2e',

  // Timeout par test (30 s — ajuster si parcours longs)
  timeout: 30_000,

  // Timeout des assertions expect()
  expect: {
    timeout: 5_000,
  },

  // Échouer si test.only ou describe.only laissé par erreur en CI
  forbidOnly: !!process.env.CI,

  // Nombre de tentatives en CI uniquement (flaky mitigation)
  retries: process.env.CI ? 2 : 0,

  // Workers parallèles : auto en local, 2 en CI pour stabilité
  workers: process.env.CI ? 2 : undefined,

  // Rapport HTML + JUnit pour intégration pipeline
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
  ],

  use: {
    // URL de base — préfixe pour page.goto('/login')
    baseURL: process.env.BASE_URL ?? 'https://mon-app-recette.example.com',

    // Trace conservée en cas d'échec (analyse via Trace Viewer)
    trace: 'on-first-retry',

    // Capture d'écran à l'échec
    screenshot: 'only-on-failure',

    // Vidéo conservée en cas d'échec
    video: 'retain-on-failure',

    // Locale et fuseau pour formats dates/montants
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',

    // Délai entre actions (0 = vitesse max ; augmenter si app lente)
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  // Projets = combinaisons navigateur / appareil
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'authenticated',
      use: {
        ...devices['Desktop Chrome'],
        // Réutilise une session pré-authentifiée (voir section Fixtures)
        storageState: 'playwright/.auth/user.json',
      },
      // Dépend du setup qui génère le storageState
      dependencies: ['setup'],
    },
    {
      name: 'setup',
      testMatch: /auth\\.setup\\.ts/,
    },
  ],

  // Serveur local optionnel (si l'app est lancée depuis le dépôt)
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});</code></pre>

      <h3 class="wiki-h3">Structure des tests : describe, test, hooks</h3>
      <p>
        Playwright s'appuie sur un runner inspiré de Jest. Chaque fichier <code>*.spec.ts</code> contient
        un ou plusieurs blocs <code>test.describe</code> regroupant des scénarios liés.
      </p>
      <pre class="wiki-code"><code>import { test, expect } from '@playwright/test';

test.describe('Connexion — mon-application-web', () => {
  // Exécuté avant chaque test du groupe
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('affiche le formulaire de connexion', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await expect(page.getByLabel('Identifiant')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
  });

  test('refuse un mot de passe invalide', async ({ page }) => {
    await page.getByLabel('Identifiant').fill('utilisateur.test');
    await page.getByLabel('Mot de passe').fill('mauvais');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toHaveText(/identifiants incorrects/i);
  });

  test('redirige vers le tableau de bord après connexion valide', async ({ page }) => {
    await page.getByLabel('Identifiant').fill(process.env.TEST_USER ?? 'qa.user');
    await page.getByLabel('Mot de passe').fill(process.env.TEST_PASSWORD ?? 'secret');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  });

  // Exécuté après chaque test du groupe
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log('Échec sur : ' + testInfo.title);
    }
  });
});</code></pre>

      <details class="wiki-fold">
        <summary>Organisation recommandée des fichiers spec</summary>
        <table class="wiki-table">
          <tr><th>Fichier</th><th>Contenu</th></tr>
          <tr><td><code>login.spec.ts</code></td><td>Authentification, déconnexion, mot de passe oublié</td></tr>
          <tr><td><code>dashboard.spec.ts</code></td><td>Widgets, navigation menu, filtres</td></tr>
          <tr><td><code>export-csv.spec.ts</code></td><td>Téléchargement, validation contenu fichier</td></tr>
          <tr><td><code>users-api.spec.ts</code></td><td>Tests API REST (fixture request)</td></tr>
          <tr><td><code>auth.setup.ts</code></td><td>Génération storageState (setup projet)</td></tr>
        </table>
      </details>

      <h3 class="wiki-h3">Locators — tableau de référence (15+ méthodes)</h3>
      <p>
        Privilégiez les locators orientés utilisateur (rôle, label, texte) plutôt que les sélecteurs CSS fragiles.
        Playwright effectue des auto-retries sur les locators jusqu'au timeout configuré.
      </p>
      <table class="wiki-table">
        <tr><th>Méthode</th><th>Exemple</th><th>Quand l'utiliser</th></tr>
        <tr><td><code>getByRole</code></td><td><code>page.getByRole('button', { name: 'Valider' })</code></td><td>Boutons, liens, champs — aligné accessibilité ARIA</td></tr>
        <tr><td><code>getByLabel</code></td><td><code>page.getByLabel('Adresse e-mail')</code></td><td>Champs de formulaire avec &lt;label&gt; associé</td></tr>
        <tr><td><code>getByPlaceholder</code></td><td><code>page.getByPlaceholder('Rechercher…')</code></td><td>Input sans label visible mais avec placeholder</td></tr>
        <tr><td><code>getByText</code></td><td><code>page.getByText('Commande confirmée')</code></td><td>Texte visible, messages, libellés statiques</td></tr>
        <tr><td><code>getByAltText</code></td><td><code>page.getByAltText('Logo entreprise')</code></td><td>Images avec attribut alt</td></tr>
        <tr><td><code>getByTitle</code></td><td><code>page.getByTitle('Aide contextuelle')</code></td><td>Éléments avec attribut title ou tooltip</td></tr>
        <tr><td><code>getByTestId</code></td><td><code>page.getByTestId('submit-order')</code></td><td>Attribut <code>data-testid</code> — contrat QA/dev</td></tr>
        <tr><td><code>locator (CSS)</code></td><td><code>page.locator('.order-row').first()</code></td><td>Sélecteur CSS/XPath quand aucun locator sémantique</td></tr>
        <tr><td><code>getByRole('combobox')</code></td><td><code>page.getByRole('combobox', { name: 'Pays' })</code></td><td>Listes déroulantes natives ou ARIA combobox</td></tr>
        <tr><td><code>getByRole('checkbox')</code></td><td><code>page.getByRole('checkbox', { name: 'J\\'accepte' })</code></td><td>Cases à cocher</td></tr>
        <tr><td><code>getByRole('radio')</code></td><td><code>page.getByRole('radio', { name: 'Standard' })</code></td><td>Boutons radio</td></tr>
        <tr><td><code>getByRole('tab')</code></td><td><code>page.getByRole('tab', { name: 'Historique' })</code></td><td>Onglets d'interface</td></tr>
        <tr><td><code>getByRole('row')</code></td><td><code>page.getByRole('row', { name: 'REF-2024-001' })</code></td><td>Lignes de tableau data grid</td></tr>
        <tr><td><code>filter</code></td><td><code>page.getByRole('listitem').filter({ hasText: 'Urgent' })</code></td><td>Affiner un locator parmi plusieurs matches</td></tr>
        <tr><td><code>nth</code></td><td><code>page.getByRole('listitem').nth(2)</code></td><td>Sélection par index (0-based) — à utiliser avec parcimonie</td></tr>
        <tr><td><code>first / last</code></td><td><code>page.locator('.card').first()</code></td><td>Premier ou dernier élément d'une série</td></tr>
        <tr><td><code>frameLocator</code></td><td><code>page.frameLocator('#iframe-paiement').getByLabel('CB')</code></td><td>Éléments à l'intérieur d'une iframe</td></tr>
        <tr><td><code>locator('xpath=…')</code></td><td><code>page.locator('xpath=//div[@data-id="x"]')</code></td><td>Dernier recours — XPath explicite</td></tr>
      </table>

      <div class="wiki-callout wiki-callout--ok">
        <strong>Bonne pratique locator</strong>
        Ordre de préférence : <code>getByRole</code> → <code>getByLabel</code> → <code>getByTestId</code> → CSS.
        Évitez les XPath absolus et les index de colonnes qui cassent à chaque refonte UI.
      </div>

      <h3 class="wiki-h3">Actions courantes</h3>
      <table class="wiki-table">
        <tr><th>Action</th><th>Syntaxe</th><th>Description</th></tr>
        <tr><td>Navigation</td><td><code>await page.goto('/accueil')</code></td><td>Ouvre une URL (relative à baseURL ou absolue)</td></tr>
        <tr><td>Clic</td><td><code>await locator.click()</code></td><td>Clic gauche ; options : button, clickCount, force, position</td></tr>
        <tr><td>Double-clic</td><td><code>await locator.dblclick()</code></td><td>Double-clic sur l'élément</td></tr>
        <tr><td>Saisie</td><td><code>await locator.fill('texte')</code></td><td>Remplace le contenu d'un input ou contenteditable</td></tr>
        <tr><td>Frappe clavier</td><td><code>await locator.press('Enter')</code></td><td>Touche ou combinaison (Control+A…)</td></tr>
        <tr><td>Case à cocher</td><td><code>await locator.check()</code> / <code>uncheck()</code></td><td>Coche ou décoche</td></tr>
        <tr><td>Sélection</td><td><code>await locator.selectOption('valeur')</code></td><td>Option d'un &lt;select&gt;</td></tr>
        <tr><td>Survol</td><td><code>await locator.hover()</code></td><td>Menu déroulant au survol</td></tr>
        <tr><td>Glisser-déposer</td><td><code>await locator.dragTo(cible)</code></td><td>Drag and drop entre deux éléments</td></tr>
        <tr><td>Upload</td><td><code>await locator.setInputFiles('chemin/fichier.csv')</code></td><td>Envoi de fichier via input type=file</td></tr>
        <tr><td>Attente navigation</td><td><code>await page.waitForURL('**/confirmation')</code></td><td>Attend une URL ou un pattern</td></tr>
        <tr><td>Attente réseau</td><td><code>await page.waitForResponse('**/api/orders')</code></td><td>Attend une réponse HTTP spécifique</td></tr>
        <tr><td>Scroll</td><td><code>await locator.scrollIntoViewIfNeeded()</code></td><td>Scroll jusqu'à visibilité de l'élément</td></tr>
        <tr><td>Focus</td><td><code>await locator.focus()</code></td><td>Donne le focus clavier</td></tr>
        <tr><td>Capture</td><td><code>await page.screenshot({ path: 'capture.png' })</code></td><td>Screenshot pleine page ou viewport</td></tr>
      </table>

      <h3 class="wiki-h3">Assertions (expect)</h3>
      <table class="wiki-table">
        <tr><th>Assertion</th><th>Exemple</th><th>Usage</th></tr>
        <tr><td>Visible</td><td><code>await expect(locator).toBeVisible()</code></td><td>Élément affiché et non masqué</td></tr>
        <tr><td>Masqué</td><td><code>await expect(locator).toBeHidden()</code></td><td>display:none, detached ou invisible</td></tr>
        <tr><td>Activé</td><td><code>await expect(locator).toBeEnabled()</code></td><td>Élément interactif non disabled</td></tr>
        <tr><td>Désactivé</td><td><code>await expect(locator).toBeDisabled()</code></td><td>Bouton grisé, champ readonly</td></tr>
        <tr><td>Texte</td><td><code>await expect(locator).toHaveText('OK')</code></td><td>Texte exact ou regex</td></tr>
        <tr><td>Contient</td><td><code>await expect(locator).toContainText('partiel')</code></td><td>Sous-chaîne dans le texte</td></tr>
        <tr><td>Valeur</td><td><code>await expect(locator).toHaveValue('abc')</code></td><td>Valeur d'un input</td></tr>
        <tr><td>Attribut</td><td><code>await expect(locator).toHaveAttribute('href', '/aide')</code></td><td>Attribut HTML</td></tr>
        <tr><td>Classe CSS</td><td><code>await expect(locator).toHaveClass(/active/)</code></td><td>Classes présentes sur l'élément</td></tr>
        <tr><td>Comptage</td><td><code>await expect(locator).toHaveCount(3)</code></td><td>Nombre d'éléments matchés</td></tr>
        <tr><td>URL page</td><td><code>await expect(page).toHaveURL(/dashboard/)</code></td><td>URL courante</td></tr>
        <tr><td>Titre page</td><td><code>await expect(page).toHaveTitle('Accueil')</code></td><td>document.title</td></tr>
        <tr><td>Checked</td><td><code>await expect(locator).toBeChecked()</code></td><td>Checkbox ou radio coché</td></tr>
        <tr><td>Focus</td><td><code>await expect(locator).toBeFocused()</code></td><td>Élément ayant le focus</td></tr>
        <tr><td>API response</td><td><code>await expect(response).toBeOK()</code></td><td>Statut HTTP 2xx ou 3xx</td></tr>
        <tr><td>JSON API</td><td><code>await expect(response).toMatchObject({ id: 1 })</code></td><td>Corps JSON partiel</td></tr>
        <tr><td>Non</td><td><code>await expect(locator).not.toBeVisible()</code></td><td>Négation de toute assertion</td></tr>
      </table>

      <h3 class="wiki-h3">Tests API avec la fixture request</h3>
      <p>
        Playwright Test fournit une fixture <code>request</code> indépendante du navigateur pour valider
        les endpoints REST de <code>mon-application-web</code> sans surcoût de lancement de page.
      </p>
      <pre class="wiki-code"><code>import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL ?? 'https://api-mon-app-recette.example.com';

test.describe('API Utilisateurs', () => {
  test('GET /users retourne une liste paginée', async ({ request }) => {
    const response = await request.get(\`\${API_BASE}/users?page=1&limit=10\`);
    await expect(response).toBeOK();
    const body = await response.json();
    expect(body.items).toHaveLength(10);
    expect(body.total).toBeGreaterThan(0);
  });

  test('POST /users crée un utilisateur', async ({ request }) => {
    const response = await request.post(\`\${API_BASE}/users\`, {
      data: {
        login: 'nouveau.qa',
        email: 'nouveau.qa@example.com',
        role: 'LECTEUR',
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${process.env.API_TOKEN}\`,
      },
    });
    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.id).toBeDefined();
  });

  test('DELETE /users/:id retourne 404 si inexistant', async ({ request }) => {
    const response = await request.delete(\`\${API_BASE}/users/00000000-0000-0000-0000-000000000000\`);
    expect(response.status()).toBe(404);
  });
});</code></pre>

      <h3 class="wiki-h3">Page Object Model (POM) — exemple complet</h3>
      <p>
        Le pattern POM encapsule les sélecteurs et actions d'une page dans une classe réutilisable.
        Réduit la duplication entre scénarios et facilite la maintenance quand l'UI évolue.
      </p>
      <pre class="wiki-code"><code>// tests/pages/LoginPage.ts
import { type Page, type Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly inputLogin: Locator;
  readonly inputPassword: Locator;
  readonly btnSubmit: Locator;
  readonly alertError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.inputLogin = page.getByLabel('Identifiant');
    this.inputPassword = page.getByLabel('Mot de passe');
    this.btnSubmit = page.getByRole('button', { name: 'Se connecter' });
    this.alertError = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto('/login');
    await expect(this.inputLogin).toBeVisible();
  }

  async login(identifiant: string, motDePasse: string) {
    await this.inputLogin.fill(identifiant);
    await this.inputPassword.fill(motDePasse);
    await this.btnSubmit.click();
  }

  async expectErrorMessage(message: string | RegExp) {
    await expect(this.alertError).toHaveText(message);
  }
}

// tests/pages/DashboardPage.ts
import { type Page, type Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly btnExport: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Tableau de bord' });
    this.btnExport = page.getByRole('button', { name: 'Exporter CSV' });
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\\/dashboard/);
    await expect(this.heading).toBeVisible();
  }

  async exportCsv() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.btnExport.click();
    return downloadPromise;
  }
}

// tests/e2e/login-pom.spec.ts
import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

test('connexion via Page Objects', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);

  await loginPage.goto();
  await loginPage.login('qa.user', process.env.TEST_PASSWORD ?? 'secret');
  await dashboardPage.expectLoaded();
});</code></pre>

      <h3 class="wiki-h3">Fixtures personnalisées et authentification (storageState)</h3>
      <p>
        Les <strong>fixtures</strong> injectent des dépendances (page pré-connectée, données de test) dans chaque scénario.
        <code>storageState</code> sauvegarde cookies et localStorage après un login pour éviter de répéter l'authentification.
      </p>
      <pre class="wiki-code"><code>// tests/auth.setup.ts — exécuté une fois par le projet "setup"
import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'playwright/.auth/user.json';

setup('authentification utilisateur standard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Identifiant').fill(process.env.TEST_USER ?? 'qa.user');
  await page.getByLabel('Mot de passe').fill(process.env.TEST_PASSWORD ?? 'secret');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\\/dashboard/);
  // Sauvegarde la session pour les projets "authenticated"
  await page.context().storageState({ path: AUTH_FILE });
});

// tests/fixtures/auth.fixture.ts — fixture réutilisable
import { test as base } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';

type AuthFixtures = {
  dashboardPage: DashboardPage;
};

export const test = base.extend&lt;AuthFixtures&gt;({
  dashboardPage: async ({ page }, use) => {
    const dashboard = new DashboardPage(page);
    await page.goto('/dashboard');
    await dashboard.expectLoaded();
    await use(dashboard);
  },
});

export { expect } from '@playwright/test';</code></pre>

      <div class="wiki-callout wiki-callout--info">
        <strong>Sécurité storageState</strong>
        Le fichier <code>playwright/.auth/user.json</code> contient des tokens de session.
        Ajoutez-le au <code>.gitignore</code> ; régénérez-le en CI via des secrets (<code>TEST_USER</code>, <code>TEST_PASSWORD</code>).
      </div>

      <h3 class="wiki-h3">Interception réseau : route, mock et stub</h3>
      <p>
        <code>page.route()</code> intercepte les requêtes sortantes pour mock, retarder ou bloquer des appels.
        Utile pour tester des cas d'erreur API sans dépendre du backend réel.
      </p>
      <pre class="wiki-code"><code>import { test, expect } from '@playwright/test';

test('affiche un message si l\\'API commandes est en erreur', async ({ page }) => {
  // Intercepte toutes les requêtes vers l'API commandes
  await page.route('**/api/orders**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Service indisponible' }),
    });
  });

  await page.goto('/commandes');
  await expect(page.getByRole('alert')).toHaveText(/indisponible/i);
});

test('mock une réponse API avec données fictives', async ({ page }) => {
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'CMD-001', statut: 'VALIDEE', montant: 1500 }],
          total: 1,
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/commandes');
  await expect(page.getByRole('row', { name: 'CMD-001' })).toBeVisible();
});

test('bloque les requêtes analytics tierces', async ({ page }) => {
  await page.route('**/*analytics.example.com/**', (route) => route.abort());
  await page.goto('/');
  // La page charge sans appels analytics
});</code></pre>

      <h3 class="wiki-h3">Trace Viewer, Codegen et UI Mode</h3>
      <table class="wiki-table">
        <tr><th>Outil</th><th>Commande</th><th>Description détaillée</th></tr>
        <tr><td><strong>Trace Viewer</strong></td><td><code>npx playwright show-trace trace.zip</code></td><td>Replay interactif d'un test : DOM, réseau, console, screenshots pas à pas. Activé via <code>trace: 'on-first-retry'</code> ou <code>'on'</code>. Indispensable pour analyser les échecs CI.</td></tr>
        <tr><td><strong>Codegen</strong></td><td><code>npx playwright codegen URL</code></td><td>Enregistre vos actions dans le navigateur et génère le code Playwright correspondant. Point de départ rapide ; à refactorer ensuite (POM, locators sémantiques).</td></tr>
        <tr><td><strong>UI Mode</strong></td><td><code>npx playwright test --ui</code></td><td>Interface graphique locale : liste des tests, exécution pas à pas, time travel, inspection des locators en direct.</td></tr>
        <tr><td><strong>Debug</strong></td><td><code>npx playwright test --debug</code></td><td>Ouvre Playwright Inspector : exécution pas à pas, pause sur chaque action, console de test.</td></tr>
        <tr><td><strong>HTML Report</strong></td><td><code>npx playwright show-report</code></td><td>Rapport HTML agrégé après une campagne : filtres par statut, navigateur, pièces jointes.</td></tr>
      </table>
      <pre class="wiki-code"><code># Enregistrer un parcours sur l'application de recette
npx playwright codegen https://mon-app-recette.example.com/login

# Lancer tous les tests avec l'UI Mode (débogage local)
npx playwright test --ui

# Ouvrir la trace d'un test échoué (fichier dans test-results/)
npx playwright show-trace test-results/e2e-login-chromium-retry1/trace.zip</code></pre>

      <h3 class="wiki-h3">Commandes CLI — tableau complet (15+)</h3>
      <table class="wiki-table">
        <tr><th>Commande</th><th>Description</th></tr>
        <tr><td><code>npx playwright test</code></td><td>Exécute toute la campagne (tous projets configurés)</td></tr>
        <tr><td><code>npx playwright test login.spec.ts</code></td><td>Exécute un fichier spec précis</td></tr>
        <tr><td><code>npx playwright test -g "connexion"</code></td><td>Filtre par titre de test (regex)</td></tr>
        <tr><td><code>npx playwright test --project=chromium</code></td><td>Limite à un projet navigateur</td></tr>
        <tr><td><code>npx playwright test --headed</code></td><td>Affiche le navigateur (mode non headless)</td></tr>
        <tr><td><code>npx playwright test --debug</code></td><td>Mode inspecteur pas à pas</td></tr>
        <tr><td><code>npx playwright test --ui</code></td><td>UI Mode interactif</td></tr>
        <tr><td><code>npx playwright test --workers=4</code></td><td>Force 4 workers parallèles</td></tr>
        <tr><td><code>npx playwright test --shard=1/3</code></td><td>Exécute le 1er tiers (sharding CI)</td></tr>
        <tr><td><code>npx playwright test --retries=2</code></td><td>2 nouvelles tentatives en cas d'échec</td></tr>
        <tr><td><code>npx playwright test --reporter=line</code></td><td>Reporter minimal en console</td></tr>
        <tr><td><code>npx playwright test --trace on</code></td><td>Trace activée pour tous les tests</td></tr>
        <tr><td><code>npx playwright test --update-snapshots</code></td><td>Met à jour les snapshots visuels</td></tr>
        <tr><td><code>npx playwright show-report</code></td><td>Ouvre le dernier rapport HTML</td></tr>
        <tr><td><code>npx playwright show-trace &lt;fichier&gt;</code></td><td>Ouvre le Trace Viewer</td></tr>
        <tr><td><code>npx playwright codegen &lt;url&gt;</code></td><td>Enregistreur de scripts</td></tr>
        <tr><td><code>npx playwright install</code></td><td>Télécharge les navigateurs Playwright</td></tr>
        <tr><td><code>npx playwright install-deps</code></td><td>Dépendances système Linux (CI Docker)</td></tr>
        <tr><td><code>npx playwright --version</code></td><td>Affiche la version installée</td></tr>
      </table>

      <h3 class="wiki-h3">Parallélisme, workers et sharding</h3>
      <p>
        Par défaut, Playwright exécute les fichiers spec en parallèle. Le nombre de <strong>workers</strong>
        correspond au nombre de processus isolés (chacun avec son propre navigateur).
      </p>
      <ul class="wiki-steps">
        <li><strong>workers: undefined</strong> (défaut local) — utilise ~50 % des cœurs CPU disponibles.</li>
        <li><strong>workers: 1</strong> — séquentiel, utile pour déboguer ou tests partageant une ressource externe.</li>
        <li><strong>fullyParallel: true</strong> — parallélise aussi les tests <em>à l'intérieur</em> d'un même fichier (attention aux collisions de données).</li>
        <li><strong>Sharding</strong> — divise la campagne en N morceaux pour N jobs CI : <code>--shard=1/4</code>, <code>--shard=2/4</code>, etc.</li>
      </ul>
      <pre class="wiki-code"><code># Exemple : 3 agents CI, chacun exécute un shard
npx playwright test --shard=1/3
npx playwright test --shard=2/3
npx playwright test --shard=3/3

# Variable d'environnement pour la base URL selon l'environnement
set BASE_URL=https://mon-app-integ.example.com
npx playwright test --project=chromium --workers=2</code></pre>

      <h3 class="wiki-h3">Intégration CI — GitHub Actions</h3>
      <p>Workflow type pour le dépôt <code>mon-depot-tests</code> avec sharding sur 3 jobs parallèles :</p>
      <pre class="wiki-code"><code># .github/workflows/playwright.yml
name: Playwright E2E
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    timeout-minutes: 60
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Installer les dépendances
        run: npm ci

      - name: Installer les navigateurs Playwright
        run: npx playwright install --with-deps

      - name: Exécuter les tests (shard \${{ matrix.shard }}/3)
        run: npx playwright test --shard=\${{ matrix.shard }}/3
        env:
          BASE_URL: https://mon-app-integ.example.com
          TEST_USER: \${{ secrets.TEST_USER }}
          TEST_PASSWORD: \${{ secrets.TEST_PASSWORD }}

      - name: Publier le rapport HTML
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-shard-\${{ matrix.shard }}
          path: playwright-report/
          retention-days: 14

      - name: Publier JUnit (intégration Xray / Jenkins)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: junit-shard-\${{ matrix.shard }}
          path: test-results/junit.xml</code></pre>

      <div class="wiki-callout wiki-callout--info">
        <strong>Artifacts CI</strong>
        Téléchargez le rapport HTML et les traces depuis les artifacts GitHub Actions pour analyser
        les échecs sans reproduire localement l'environnement d'intégration.
      </div>

      <h3 class="wiki-h3">Bonnes pratiques (8+ recommandations)</h3>
      <ol class="wiki-steps wiki-steps--numbered">
        <li><strong>Locators résilients</strong> — préférez <code>getByRole</code> et <code>getByLabel</code> ; convenez avec les devs d'un préfixe <code>data-testid</code> stable.</li>
        <li><strong>Pas de waits arbitraires</strong> — bannissez <code>page.waitForTimeout(5000)</code> ; utilisez <code>expect</code>, <code>waitForResponse</code> ou <code>waitForURL</code>.</li>
        <li><strong>Isolation des données</strong> — chaque test crée ses propres données (utilisateur, commande) ou utilise un bac à sable dédié.</li>
        <li><strong>Page Object Model</strong> — centralisez sélecteurs et actions ; les specs restent lisibles par les QA métier.</li>
        <li><strong>storageState pour l'auth</strong> — un seul login dans <code>auth.setup.ts</code>, réutilisé par tous les tests « connectés ».</li>
        <li><strong>Traces et screenshots en CI</strong> — configurez <code>trace: 'on-first-retry'</code> et <code>screenshot: 'only-on-failure'</code>.</li>
        <li><strong>Variables d'environnement</strong> — URLs, identifiants et tokens via <code>process.env</code>, jamais en dur dans le code versionné.</li>
        <li><strong>Tests API séparés</strong> — placez les specs <code>request</code> dans <code>tests/api/</code> pour des cycles plus rapides sans navigateur.</li>
        <li><strong>Éviter test.only en CI</strong> — activez <code>forbidOnly: !!process.env.CI</code> pour bloquer les commits accidentels.</li>
        <li><strong>Mock réseau ciblé</strong> — mockez uniquement les appels nécessaires ; laissez passer le reste pour détecter les régressions d'intégration.</li>
        <li><strong>Revues de flakiness</strong> — un test flaky en CI est pire qu'aucun test ; analysez les traces et corrigez avant d'augmenter <code>retries</code>.</li>
      </ol>

      <h3 class="wiki-h3">Playwright vs Cypress — comparaison</h3>
      <table class="wiki-table">
        <tr><th>Critère</th><th>Playwright</th><th>Cypress</th></tr>
        <tr><td>Navigateurs</td><td>Chromium, Firefox, WebKit natifs</td><td>Chromium principalement ; Firefox/WebKit expérimental</td></tr>
        <tr><td>Parallélisme</td><td>Workers multi-process natif, sharding intégré</td><td>Parallèle via Cypress Cloud ou plugins</td></tr>
        <tr><td>Multi-onglets</td><td>Support natif (popups, nouvelles pages)</td><td>Limité — un seul onglet par défaut</td></tr>
        <tr><td>Tests API</td><td>Fixture <code>request</code> intégrée</td><td><code>cy.request</code> — moins central dans l'écosystème</td></tr>
        <tr><td>Iframes</td><td><code>frameLocator</code> fluide</td><td>Support mais syntaxe plus lourde</td></tr>
        <tr><td>Auto-attente</td><td>Sur locators et assertions</td><td>Sur commandes et assertions</td></tr>
        <tr><td>Interface debug</td><td>UI Mode, Trace Viewer, Inspector</td><td>Test Runner graphique très visuel</td></tr>
        <tr><td>Langage</td><td>TypeScript / JavaScript (Node)</td><td>JavaScript (Node)</td></tr>
        <tr><td>Codegen</td><td><code>playwright codegen</code></td><td>Extension Studio</td></tr>
        <tr><td>Intégration Wizard QA</td><td>Stack supportée — initialisation via Wizard</td><td>Stack historique CA-TS, hook JIRA mature</td></tr>
        <tr><td>Courbe d'apprentissage</td><td>Config initiale plus dense, doc excellente</td><td>Démarrage très rapide pour profils QA</td></tr>
        <tr><td>CI / performance</td><td>Très rapide, léger en ressources par worker</td><td>Correct ; parallélisme souvent payant (Cloud)</td></tr>
      </table>

      <h3 class="wiki-h3">Documentation officielle par thème</h3>
      <table class="wiki-table">
        <tr><th>Thème</th><th>Lien</th></tr>
        <tr><td>Introduction &amp; installation</td><td><a href="https://playwright.dev/docs/intro" target="_blank" rel="noopener noreferrer">playwright.dev/docs/intro</a></td></tr>
        <tr><td>Configuration (playwright.config)</td><td><a href="https://playwright.dev/docs/test-configuration" target="_blank" rel="noopener noreferrer">playwright.dev/docs/test-configuration</a></td></tr>
        <tr><td>Écriture des tests</td><td><a href="https://playwright.dev/docs/writing-tests" target="_blank" rel="noopener noreferrer">playwright.dev/docs/writing-tests</a></td></tr>
        <tr><td>Locators</td><td><a href="https://playwright.dev/docs/locators" target="_blank" rel="noopener noreferrer">playwright.dev/docs/locators</a></td></tr>
        <tr><td>Assertions</td><td><a href="https://playwright.dev/docs/test-assertions" target="_blank" rel="noopener noreferrer">playwright.dev/docs/test-assertions</a></td></tr>
        <tr><td>Fixtures</td><td><a href="https://playwright.dev/docs/test-fixtures" target="_blank" rel="noopener noreferrer">playwright.dev/docs/test-fixtures</a></td></tr>
        <tr><td>Authentification</td><td><a href="https://playwright.dev/docs/auth" target="_blank" rel="noopener noreferrer">playwright.dev/docs/auth</a></td></tr>
        <tr><td>API Testing</td><td><a href="https://playwright.dev/docs/api-testing" target="_blank" rel="noopener noreferrer">playwright.dev/docs/api-testing</a></td></tr>
        <tr><td>Mock &amp; route</td><td><a href="https://playwright.dev/docs/mock" target="_blank" rel="noopener noreferrer">playwright.dev/docs/mock</a></td></tr>
        <tr><td>Trace Viewer</td><td><a href="https://playwright.dev/docs/trace-viewer" target="_blank" rel="noopener noreferrer">playwright.dev/docs/trace-viewer</a></td></tr>
        <tr><td>Codegen</td><td><a href="https://playwright.dev/docs/codegen" target="_blank" rel="noopener noreferrer">playwright.dev/docs/codegen</a></td></tr>
        <tr><td>UI Mode</td><td><a href="https://playwright.dev/docs/test-ui-mode" target="_blank" rel="noopener noreferrer">playwright.dev/docs/test-ui-mode</a></td></tr>
        <tr><td>CI GitHub Actions</td><td><a href="https://playwright.dev/docs/ci-intro" target="_blank" rel="noopener noreferrer">playwright.dev/docs/ci-intro</a></td></tr>
        <tr><td>Sharding</td><td><a href="https://playwright.dev/docs/test-sharding" target="_blank" rel="noopener noreferrer">playwright.dev/docs/test-sharding</a></td></tr>
        <tr><td>Best practices</td><td><a href="https://playwright.dev/docs/best-practices" target="_blank" rel="noopener noreferrer">playwright.dev/docs/best-practices</a></td></tr>
        <tr><td>Page Object Model</td><td><a href="https://playwright.dev/docs/pom" target="_blank" rel="noopener noreferrer">playwright.dev/docs/pom</a></td></tr>
      </table>

      <p class="wiki-next">
        <a href="#robot" class="btn-primary btn-sm">→ Section suivante : Robot Framework</a>
        <a href="#postman" class="btn-secondary btn-sm">→ Postman (tests API)</a>
      </p>`,
}
