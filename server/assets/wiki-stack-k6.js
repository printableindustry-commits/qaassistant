/**
 * Wiki — section k6 (tests de performance Grafana k6)
 */
// eslint-disable-next-line no-var
var WikiStackK6 = {
  id: 'k6',
  title: 'k6 — tests de performance',
  body: `
    <div class="wiki-stack-hero">
      <img class="wiki-stack-hero-logo" src="/assets/logo-k6.png" alt="k6" width="48" height="48" />
      <p class="wiki-stack-hero-lead"><strong>k6</strong> (Grafana) exécute des campagnes de charge en JavaScript : utilisateurs virtuels (VUs), seuils p95, rapports JSON/HTML.</p>
        <p class="hint hint-tight"><a href="/k6-wizard.html" class="btn-primary btn-sm">→ Wizard k6 Performance</a></p>
    </div>

    <h3 class="wiki-h3">Quand utiliser k6 ?</h3>
    <ul class="wiki-steps">
      <li>Valider la <strong>tenue en charge</strong> d'une API ou d'une application web avant production.</li>
      <li>Mesurer temps de réponse, débit (req/s) et taux d'erreur sous charge progressive.</li>
      <li>Compléter Cypress / Playwright (fonctionnel) et Postman (contrats API) — pas les remplacer.</li>
    </ul>

    <h3 class="wiki-h3">Arborescence générée</h3>
    <pre class="wiki-code"><code>mon-projet/
  k6/
    scripts/smoke.js      # campagne smoke (VUs, durée, checks)
    lib/options.js        # seuils p95 partagés
    data/                 # jeux de données CSV (optionnel)
  reports/k6/             # sorties JSON / rapports
  package.json            # scripts npm test:perf:smoke</code></pre>

    <h3 class="wiki-h3">Installation du binaire k6</h3>
    <p>Le wizard installe <code>@types/k6</code> via npm. Le <strong>binaire Grafana k6</strong> s'installe séparément :</p>
    <pre class="wiki-code"><code>winget install -e --id Grafana.k6
choco install k6
k6 version</code></pre>
    <p class="hint hint-tight">Modifiez les commandes dans <code>.wizard-qa/conf/k6-install.conf.json</code> (étape winget optionnelle).</p>

    <h3 class="wiki-h3">Exemple de script smoke</h3>
    <pre class="wiki-code"><code>import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: { http_req_duration: ['p(95)&lt;500'] },
};

export default function () {
  const res = http.get(__ENV.BASE_URL + '/');
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}</code></pre>

    <h3 class="wiki-h3">Exécution</h3>
    <pre class="wiki-code"><code>npm run test:perf:smoke
k6 run k6/scripts/smoke.js -e BASE_URL=https://app-recette.example.com
k6 run k6/scripts/smoke.js --out json=reports/k6/smoke.json</code></pre>

    <p class="wiki-next"><a href="/k6-install.html" class="btn-secondary btn-sm">→ Initialiser k6</a> <a href="https://grafana.com/docs/k6/latest/" target="_blank" rel="noopener" class="btn-secondary btn-sm">Documentation Grafana k6</a></p>
  `,
}
