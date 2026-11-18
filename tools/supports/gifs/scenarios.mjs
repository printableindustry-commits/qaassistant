// Scénarios des GIF animés de Wizard QA (un scénario = une fonctionnalité, 8 à 25 s).
// Usage : node scenarios.mjs <dossier-captures> <dossier-gifs> [nom ...]   (sans nom : tous ; préfixe accepté : 05)
// Chaque scénario recharge la démo (données fictives IRMA) puis enregistre des actions réelles.
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ouvrirNavigateur, Enregistreur, aller, naviguer, cliquer, taper, defiler, survoler, marquer, effacer, visite,
  chargerDemo, parTexte, sleep, BASE, curseur, pretes,
} from './enregistreur.mjs'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const attendre = (page, sel, ms = 10000) => page.locator(sel).filter({ visible: true }).first().waitFor({ timeout: ms }).catch(() => {})

export const SCENARIOS = {
  // ------------------------------------------------------------------------------------------
  '01-connexion-pilotage': { ips: 7, async jouer(page, rec) {
    await aller(page, '/login.html', 400)
    await attendre(page, '#demo:not(.p-hidden)', 8000)
    await sleep(400)
    await rec.demarrer('Connexion : chaque membre de l’équipe a son compte')
    await sleep(900)
    await taper(page, '#username', 'demo', { delai: 120 })
    await taper(page, '#password', 'demo', { delai: 120 })
    await cliquer(page, '#submit', { pause: 500 })
    rec.suspendre()  // pas d'écran de chargement entre la connexion et le pilotage
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 })
    await attendre(page, '.p-kpis')
    await pretes(page)
    await sleep(400)
    await curseur(page)
    rec.legender('Pilotage : où en est la campagne de test, en un coup d’œil')
    rec.reprendre()
    rec.legender('Pilotage : où en est la campagne de test, en un coup d’œil')
    await sleep(2200)
    rec.legender('Indicateurs clés : poste, récits, points à clarifier, couverture Gherkin')
    await marquer(page, '.p-kpis', 'Indicateurs clés', 'Poste de test, récits scannés, points à clarifier et couverture Gherkin.')
    await sleep(3000)
    rec.legender('Parcours QA : du poste installé aux tests reliés à Xray')
    await marquer(page, '.home-journey, .p-stepper', 'Parcours QA', 'Du poste installé aux tests reliés à Xray : chaque étape et son état.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Actions prioritaires et couverture des récits par épopée')
    await defiler(page, 420, { pas: 16, ms: 45 })
    await sleep(2200)
  } },

  // ------------------------------------------------------------------------------------------
  '02-scan-jira-par-url': { ips: 7, vitesse: 1.35, async jouer(page, rec) {
    await aller(page, '/connaissance.html#scan', 1200)
    await rec.demarrer('Prise de connaissance : une URL JIRA suffit')
    await cliquer(page, parTexte(page, 'Mon JIRA'), { pause: 700 })
    await taper(page, 'input[type=url], input.p-mono', 'https://jira.banque-horizon.example/jira/software/projects/P0326/boards/12', { delai: 35 })
    rec.legender('Instance et projet sont déduits de l’adresse collée')
    await sleep(600)
    await marquer(page, page.locator('text=Reconnu').first(), 'Une URL JIRA suffit', 'Collez l’adresse d’un tableau ou d’un ticket : instance et projet sont déduits.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Sans JIRA : le jeu de démonstration IRMA se scanne de la même façon')
    await cliquer(page, parTexte(page, 'Données de démonstration'), { pause: 700 })
    await cliquer(page, parTexte(page, 'Lancer le scan'), { pause: 200 })
    rec.legender('Scan : description, critères d’acceptation, épopées et liens extraits')
    await page.waitForFunction(() => location.hash === '#synthese', null, { timeout: 20000 }).catch(() => {})
    await attendre(page, '.p-kpis')
    await sleep(900)
    rec.legender('Synthèse du scan : récits, critères extraits, points à clarifier')
    await marquer(page, '.p-kpis', 'Synthèse du scan', 'Récits, critères d’acceptation extraits, points à clarifier et épopées.')
    await sleep(2600)
    await effacer(page)
    rec.legender('À clarifier avec le PO : les questions sont prêtes')
    await page.locator('.kn-issue').first().scrollIntoViewIfNeeded()
    await sleep(400)
    await marquer(page, '.kn-issue', 'À clarifier avec le PO', 'Récits sans critère, cas d’erreur absents : les questions sont prêtes.')
    await sleep(3000)
  } },

  // ------------------------------------------------------------------------------------------
  '03-tri-des-recits': { ips: 7, vitesse: 1.25, async jouer(page, rec) {
    await aller(page, '/recits.html', 1200)
    await rec.demarrer('Tri des récits : à automatiser, plus tard ou ignoré')
    await marquer(page, '.rc-tabs', 'Tri des récits', 'À automatiser, plus tard ou ignoré : chaque récit reçoit une décision.')
    await sleep(2400)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Plus tard', '.p-tab'), { pause: 1200 })
    rec.legender('Chaque décision garde sa raison')
    await cliquer(page, page.locator('.rc-list .rc-item, .rc-story, [data-key]').filter({ visible: true }).first(), { pause: 1200 }).catch(() => {})
    rec.legender('Suggestions motivées : l’assistant propose et explique, vous décidez')
    const pourquoi = page.locator('summary, button').filter({ hasText: /pourquoi/i }).filter({ visible: true }).first()
    await cliquer(page, pourquoi, { pause: 1400 }).catch(() => {})
    await marquer(page, '.rc-decision-card, .rc-decide', 'Suggestions motivées', 'L’assistant propose un tri et explique pourquoi ; vous gardez la décision.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Une décision se change en un clic, avec sa raison')
    await cliquer(page, page.locator('.rc-decide-btn.rc-decide--todo').first(), { pause: 900 })
    await taper(page, page.locator('.rc-decision-card input.p-input, .rc-decide input.p-input').first(), 'Parcours métier critique pour le comité des risques', { delai: 30, pause: 300 })
    await page.keyboard.press('Enter')
    await sleep(1400)
    rec.legender('Le récit rejoint la file « À automatiser »')
    await cliquer(page, parTexte(page, 'À automatiser', '.p-tab'), { pause: 2200 })
  } },

  // ------------------------------------------------------------------------------------------
  '04-gherkin': { ips: 7, vitesse: 1.2, async jouer(page, rec) {
    await aller(page, '/recits.html?key=P0326-9311', 1500)
    await rec.demarrer('Récit P0326-9311 : critères d’acceptation extraits de JIRA')
    await page.locator('.rc-detail').first().evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
    await defiler(page, 520, { pas: 14, ms: 45 })
    await sleep(1200)
    rec.legender('Scénarios Gherkin générés depuis les critères d’acceptation')
    await cliquer(page, parTexte(page, 'Générer (modèle)'), { pause: 900 })
    const confirmer = page.locator('.p-modal button.p-btn--primary').filter({ visible: true }).first()
    if (await confirmer.count()) await cliquer(page, confirmer, { pause: 1300 })
    await page.locator('.rc-source').first().evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await sleep(1200)
    rec.legender('Relecture : le testeur complète le scénario, contrôle syntaxique en direct')
    const src = page.locator('textarea.rc-source').first()
    await survoler(page, src, 300)
    await src.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await src.pressSequentially('    Et le nombre de risques affichés est mis à jour', { delay: 45 })
    await sleep(1300)
    rec.legender('Validé par le testeur, prêt à exporter en fichier .feature')
    await cliquer(page, parTexte(page, 'Valider'), { pause: 1500 })
    await page.locator('.p-stepper').filter({ hasText: 'Validé' }).first().scrollIntoViewIfNeeded().catch(() => {})
    await marquer(page, page.locator('.p-stepper').filter({ hasText: 'Validé' }).first(), 'Scénarios Gherkin', 'Générés depuis les critères d’acceptation, relus puis validés par le testeur.')
    await sleep(3000)
  } },

  // ------------------------------------------------------------------------------------------
  '05-automatisation-exploration': { ips: 6, vitesse: 1.45, async jouer(page, rec) {
    await aller(page, '/automatisation.html?key=P0326-9301', 1500)
    await rec.demarrer('Automatisation : du récit au test Playwright, sur l’application de démo')
    await sleep(800)
    await cliquer(page, parTexte(page, 'Expliquer le test', '.p-step'), { pause: 900, rec })
    rec.legender('Plan de test : l’IA déduit les étapes du Gherkin, le plan reste modifiable')
    await marquer(page, '.au-plan, .au-plan-sc', 'Plan de test IA', 'L’IA déduit les étapes du Gherkin ; le plan reste modifiable avant l’exploration.')
    await sleep(3000)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Exploration', '.p-step'), { pause: 1000, rec })
    rec.legender('Exploration : l’agent ouvre l’application, trouve les sélecteurs, capture chaque écran')
    await marquer(page, '.au-shot, .au-grid-explore', 'Exploration', 'L’agent ouvre l’application, trouve les sélecteurs et capture chaque écran.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Prenez la main : si l’IA bloque, vous montrez le geste, il est enregistré')
    await naviguer(page, rec, '/automatisation.html?key=P0326-9310', 600)
    await cliquer(page, parTexte(page, 'Exploration', '.p-step'), { pause: 900, rec })
    const main = page.locator('button:has-text("Prendre la main")').filter({ visible: true }).first()
    await main.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(500)
    await marquer(page, main, 'Prenez la main', 'Si l’IA bloque, vous montrez le geste : il est enregistré dans le test.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Test généré : étapes lisibles (règle, IA, humain) et code Playwright')
    await naviguer(page, rec, '/automatisation.html?key=P0326-9301', 600)
    await cliquer(page, parTexte(page, 'Test généré', '.p-step'), { pause: 1000, rec })
    rec.legender('Test généré : étapes lisibles (règle, IA, humain) et code Playwright')
    await sleep(1500)
    await defiler(page, 900, { pas: 18, ms: 50 })
    await sleep(800)
    const code = page.locator('.p-code, pre').filter({ visible: true }).first()
    await code.scrollIntoViewIfNeeded().catch(() => {})
    rec.legender('Code Playwright sans aucun mot de passe : comptes lus hors du code')
    await sleep(2200)
    rec.legender('Rejeu : le test est rejoué tel quel avant d’être validé')
    const rejouer = page.locator('button:has-text("Rejouer")').filter({ visible: true }).first()
    await rejouer.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(400)
    await marquer(page, rejouer, 'Rejeu', 'Le test est rejoué tel quel avant d’être validé : pas de test fragile en base.')
    await sleep(3000)
  } },

  // ------------------------------------------------------------------------------------------
  '06-envoi-xray': { ips: 7, async jouer(page, rec) {
    await aller(page, '/automatisation.html?key=P0326-9301', 1500)
    await cliquer(page, parTexte(page, 'Envoyer dans JIRA', '.p-step'), { pause: 300, rec })
    await rec.demarrer('Test validé : prêt à partir dans JIRA / Xray')
    await sleep(1500)
    await cliquer(page, parTexte(page, 'Envoyer dans JIRA / Xray'), { pause: 1400 })
    rec.legender('Aperçu avant tout envoi : ticket Test, lien vers le récit, étiquettes')
    await sleep(1500)
    rec.legender('Plan de test facultatif : une clé ou un mot suffit')
    await taper(page, '#xpPlan', 'P0326-10528', { delai: 90, pause: 1200 })
    const opt = page.locator('.xp-root [role=option], .xp-root li, .xp-plan-item, .xp-root button').filter({ hasText: 'P0326-10528' }).filter({ visible: true }).first()
    if (await opt.count()) await cliquer(page, opt, { pause: 1000 })
    await marquer(page, page.locator('.xp-root').locator('text=Aperçu').locator('xpath=ancestor::*[contains(@class,"p-card")][1]').first(), 'Envoi vers Xray', 'Un ticket Test relié au récit et au plan de test, aperçu avant tout envoi.').catch(() => {})
    await sleep(2600)
    await effacer(page)
    rec.legender('Envoi (simulé en démonstration) : ticket Test créé ou mis à jour, sans doublon')
    await cliquer(page, parTexte(page, 'Simuler l’envoi'), { pause: 3200 })
    rec.legender('Résultat : ticket Test, lien « tests » vers le récit et ajout au plan')
    await sleep(2500)
  } },

  // ------------------------------------------------------------------------------------------
  '07-campagne-execution': { ips: 6, async jouer(page, rec) {
    await aller(page, '/livrables.html', 1500)
    const carte = page.locator('.lv-camp-actions').first()
    await carte.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await rec.demarrer('Campagne d’exécution : les tests Playwright du projet, lancés depuis Wizard QA')
    await marquer(page, page.locator('.lv-camp-sum').first().locator('xpath=ancestor::*[contains(@class,"p-card")][1]'), 'Campagne d’exécution', 'Les résultats des campagnes nourrissent directement les livrables.')
    await sleep(2800)
    await effacer(page)
    rec.legender('Nouvelle campagne (simulée en démonstration) : suivi en direct')
    await cliquer(page, parTexte(page, 'Simuler'), { pause: 400 })
    await page.waitForFunction(() => !document.querySelector('.lv-camp-actions button[disabled]'), null, { timeout: 30000 }).catch(() => {})
    await sleep(1500)
    rec.legender('Résultat par test : réussis, échecs avec leur message')
    await cliquer(page, parTexte(page, 'Résultats par test'), { pause: 1800 })
    await defiler(page, 300, { pas: 10, ms: 50, selecteur: '.p-modal-body' })
    await sleep(1800)
    await page.keyboard.press('Escape'); await sleep(600)
    rec.legender('Les échecs deviennent des anomalies, le journal d’exécution se met à jour')
    await cliquer(page, parTexte(page, 'Anomalies'), { pause: 1600 })
    await sleep(2200)
  } },

  // ------------------------------------------------------------------------------------------
  '08-livrables-istqb': { ips: 6, vitesse: 1.55, async jouer(page, rec) {
    await aller(page, '/livrables.html', 1500)
    await rec.demarrer('Livrables ISTQB : la structure ISO/IEC/IEEE 29119-3')
    await marquer(page, '.lv-doclist', 'Documents ISTQB', 'Politique, stratégie, plan, rapports : la structure ISO/IEC/IEEE 29119-3.')
    await sleep(2600)
    await effacer(page)
    rec.legender('Généré à partir des données réelles : récits, tests, campagnes, Xray, k6')
    await cliquer(page, parTexte(page, 'Matrice de traçabilité', '.lv-docitem'), { pause: 1500 })
    await defiler(page, 420, { pas: 12, ms: 45 })
    await sleep(1200)
    await defiler(page, -420, { pas: 8, ms: 40 })
    rec.legender('Relu par l’agent : sections, chiffres et cohérence vérifiés')
    await cliquer(page, parTexte(page, 'Relire', '.lv-dochead-actions button'), { pause: 1500 })
    await cliquer(page, parTexte(page, 'Relecture', '.p-tab'), { pause: 2600 })
    rec.legender('Approuvé par un humain : la version est figée')
    await cliquer(page, parTexte(page, 'Approuver', '.lv-dochead-actions button'), { pause: 1000 })
    const ok = page.locator('.p-modal button.p-btn--primary').filter({ visible: true }).first()
    if (await ok.count()) await cliquer(page, ok, { pause: 1000 })
    await marquer(page, '.lv-dochead-actions', 'Relire et approuver', 'Chaque document est généré, relu par l’agent puis approuvé par un humain.')
    await sleep(2400)
    await effacer(page)
    rec.legender('Export Word (format standard), HTML / PDF ou Markdown, prêt à diffuser')
    await cliquer(page, parTexte(page, 'Word', '.lv-export button'), { pause: 1800 })
  } },

  '09-informations-projet': { ips: 6, vitesse: 1.25, async jouer(page, rec) {
    await aller(page, '/livrables.html', 1500)
    await rec.demarrer('Informations projet : un assistant pas à pas alimente tous les livrables')
    await cliquer(page, parTexte(page, 'Informations projet'), { pause: 1500 })
    rec.legender('Organisation : organisme, produit, parties prenantes et rôles')
    await taper(page, '#lv-f-versionProduit', '2.5 (release T2)', { delai: 80, pause: 900 })
    await defiler(page, 500, { pas: 14, ms: 45, selecteur: '.p-modal-body' })
    await sleep(1000)
    const suivant = () => parTexte(page, 'Enregistrer et continuer')
    const etapes = ['Périmètre : dans et hors périmètre, niveaux de test', 'Risques produit : préremplis depuis les récits à risque élevé',
      'Environnements : préremplis depuis les applications explorées']
    for (const [k, t] of etapes.entries()) {
      await cliquer(page, suivant(), { pause: 400 })
      if (k === 1) { await cliquer(page, suivant(), { pause: 300 }) }  // Approche : passée rapidement
      rec.legender(t)
      await sleep(1700)
    }
    rec.legender('Chaque réponse alimente les documents concernés, sans ressaisie')
    await sleep(1200)
  } },

  // ------------------------------------------------------------------------------------------
  '10-performance-k6': { ips: 6, vitesse: 1.2, async jouer(page, rec) {
    await aller(page, '/perf.html', 500)
    await attendre(page, '.p-kpis', 15000)
    await sleep(600)
    await rec.demarrer('Performance k6 : profils de charge, runs et seuils')
    await marquer(page, '.p-kpis', 'Performance k6', 'Profils de charge, runs et seuils : la performance suit les exigences des récits.')
    await sleep(2600)
    await effacer(page)
    rec.legender('Lancer un profil : simulation ou k6 réel, suivi en direct')
    await cliquer(page, parTexte(page, 'Lancer', '.p-tab'), { pause: 900 })
    const sim = parTexte(page, '◇ Simulation')
    if (await sim.count()) await cliquer(page, sim, { pause: 600 })
    await cliquer(page, parTexte(page, 'Lancer la simulation'), { pause: 500 })
    rec.legender('En direct : utilisateurs virtuels, requêtes / s, p95, erreurs')
    await sleep(6500)
    rec.legender('Historique des runs : p95, débit et erreurs, comparables')
    await cliquer(page, parTexte(page, 'Runs', '.p-tab'), { pause: 1500 })
    await sleep(2200)
    rec.legender('Comparer deux runs pour repérer une régression')
    await cliquer(page, parTexte(page, 'Comparer', '.p-tab'), { pause: 2500 })
  } },

  // ------------------------------------------------------------------------------------------
  '11-installation-poste': { ips: 6, vitesse: 1.1, async jouer(page, rec) {
    await aller(page, '/installation.html', 1500)
    await rec.demarrer('Installation du poste : Node, Playwright, Gherkin, k6 en une fois')
    await marquer(page, '.inst-stacks', 'Installation du poste', 'Node, Playwright, k6 : tout le poste QA s’installe en une fois.')
    await sleep(2600)
    await effacer(page)
    rec.legender('Ici en mode simulation : chaque étape est jouée, rien n’est installé')
    await survoler(page, page.locator('label').filter({ hasText: /^\s*Simulation/ }).first(), 1500)
    rec.legender('Chaque composant est détecté, installé s’il manque, puis vérifié')
    await cliquer(page, parTexte(page, 'Installer tout'), { pause: 600 })
    rec.legender('Le plan d’abord : ce qui est déjà en place, ce qui sera installé')
    await sleep(2200)
    rec.legender('Chaque composant est détecté, installé s’il manque, puis vérifié')
    await cliquer(page, page.locator('.p-modal button.p-btn--primary').filter({ visible: true }).first(), { pause: 600 })
    const run = page.locator('.p-meter, .inst-run').filter({ visible: true }).first()
    await run.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(6000)
    rec.legender('Suivi en direct et journal : relancer ne refait jamais ce qui est en place')
    await sleep(3000)
  } },

  // ------------------------------------------------------------------------------------------
  '12-assistant-ia': { ips: 6, vitesse: 1.35, async jouer(page, rec) {
    await aller(page, '/ia.html', 1500)
    const sousLesIndicateurs = () => page.evaluate(() => {
      const t = document.querySelector('.p-tabs'); if (t) window.scrollTo(0, t.getBoundingClientRect().top + scrollY - 70)
    })
    await page.evaluate(() => { const c = [...document.querySelectorAll('.p-card')].find((e) => e.textContent.includes('Ordre de priorité')); if (c) window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 80) })
    await sleep(300)
    await rec.demarrer('Assistant IA : Copilot local d’abord, puis Copilot CLI, API, copier-coller')
    await marquer(page, page.locator('.p-card').filter({ hasText: 'Ordre de priorité' }).first(), 'Ordre de priorité', 'Le premier fournisseur disponible répond ; le copier-coller reste en dernier recours.')
    await sleep(3000)
    await effacer(page)
    await sousLesIndicateurs(); await sleep(400)
    rec.legender('Brancher Copilot local : VS Code relaie GitHub Copilot, sans clé exposée')
    await cliquer(page, parTexte(page, 'Brancher Copilot local', '.p-tab'), { pause: 600 })
    await sousLesIndicateurs(); await sleep(400)
    await marquer(page, '.ia-steps, .ia-panel', 'Assistant IA', 'Copilot local via VS Code, ou un autre fournisseur : sans clé exposée.')
    await sleep(3000)
    await effacer(page)
    rec.legender('Bac à sable : essayer une demande avant de l’utiliser dans les écrans')
    await cliquer(page, parTexte(page, 'Bac à sable', '.p-tab'), { pause: 500 })
    await sousLesIndicateurs(); await sleep(400)
    await marquer(page, page.locator('.p-card').filter({ hasText: 'Demande' }).filter({ hasText: 'Prompt' }).first(), 'Bac à sable', 'Fournisseur, usage, consignes et prompt.')
    await page.locator('textarea[placeholder^="Votre demande"]').first().click()
    await page.locator('textarea[placeholder^="Votre demande"]').first().pressSequentially('Propose trois cas limites pour le filtre des risques par période.', { delay: 25 })
    await sleep(400)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Envoyer'), { pause: 1800 })
    rec.legender('Sans fournisseur branché, rien ne bloque : le prompt est prêt à copier')
    await marquer(page, page.locator('button:has-text("Copier le prompt")').first(), 'Mode copier-coller', 'Toujours disponible : le prompt est copié, la réponse collée.')
    await sleep(2800)
  } },

  '13-visite-guidee': { ips: 4, vitesse: 1.25, async jouer(page, rec) {
    await page.emulateMedia({ reducedMotion: 'reduce' })  // halo sans respiration : GIF plus léger
    await aller(page, '/', 1200)
    await rec.demarrer('Visite guidée : l’application se présente seule, étape par étape')
    await cliquer(page, page.locator('.p-tour-launch').first(), { pause: 300 })
    const etat = async (id) => {
      for (let k = 0; k < 40; k++) {
        try {
          const r = await page.evaluate((id) => {
            const t = window.Prisme?.tour; const st = t?.state?.(); const sc = t?.script?.()
            if (!st || !sc) return null
            const step = sc.etapes[st.idx]
            return { idx: st.idx, n: sc.etapes.length, titre: step?.titre, pret: document.documentElement.dataset.tourStep === step?.id && (!id || step?.id === id) }
          }, id)
          if (r && r.pret) return r
        } catch { /* changement de page */ }
        await sleep(250)
      }
      return null
    }
    // une sélection d'étapes (sur 25) : le GIF reste court, la barre montre tout le parcours
    const choix = [0, 2, 3, 6, 8, 9, 11, 12, 14, 16, 17, 19, 21, 22, 24]
    for (const [k, i] of choix.entries()) {
      if (k > 0) {
        rec.suspendre()
        await page.evaluate((i) => window.Prisme.tour.jump(i), i).catch(() => {})
        await sleep(300)
      }
      const id = await page.evaluate((i) => window.Prisme?.tour?.script?.()?.etapes?.[i]?.id, i).catch(() => null)
      const e = await etat(id)
      await pretes(page)  // l'écran de l'étape doit être chargé (pas de « Chargement de… » dans le GIF)
      await sleep(400)
      rec.reprendre()
      if (!e) continue
      if (k === 0) { const x2 = page.locator('.p-tour-speed button[data-speed="2"]').first(); if (await x2.count()) await x2.click().catch(() => {}) }
      rec.legender(`Visite guidée (accélérée) · étape ${e.idx + 1}/${e.n} · ${e.titre}`)
      await sleep(1300)
    }
    rec.legender('Relancez la visite à tout moment : bouton « Visite guidée » ou Ctrl K')
    await sleep(2200)
  } },
}

// ----------------------------------------------------------------------------------------------
async function main() {
  const [dossier, sortie, ...noms] = process.argv.slice(2)
  if (!dossier || !sortie) { console.error('Usage : node scenarios.mjs <dossier-captures> <dossier-gifs> [nom ...]'); process.exit(2) }
  const liste = noms.length ? noms.map((n) => Object.keys(SCENARIOS).find((k) => k.startsWith(n)) || n) : Object.keys(SCENARIOS)
  fs.mkdirSync(sortie, { recursive: true })
  for (const nom of liste) {
    const sc = SCENARIOS[nom]
    if (!sc) { console.error('Scénario inconnu :', nom); continue }
    const { browser, context, page } = await ouvrirNavigateur({ connecte: true })
    await chargerDemo(context)
    if (nom === '01-connexion-pilotage') await context.clearCookies()
    const rec = new Enregistreur(page, path.join(dossier, nom), { ips: sc.ips || 7 })
    const t = Date.now()
    try {
      await sc.jouer(page, rec)
    } catch (e) {
      console.error(`[${nom}] erreur :`, e.message.split(String.fromCharCode(10))[0])
    }
    const r = await rec.arreter(400)
    console.log(`${nom} : ${r.images} captures, ${(r.duree / 1000).toFixed(1)} s (${((Date.now() - t) / 1000).toFixed(0)} s réels)`)
    await browser.close()
    const py = spawnSync('python', [path.join(ICI, 'assembler-gif.py'), path.join(dossier, nom), path.join(sortie, nom + '.gif'),
      '--vitesse', String(sc.vitesse || 1)], { encoding: 'utf8' })
    process.stdout.write(py.stdout || ''); process.stderr.write(py.stderr || '')
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
