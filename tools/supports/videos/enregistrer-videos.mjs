// Vidéos MP4 courtes (< 30 s) des fonctionnalités de Wizard QA, une par fonctionnalité, dans l'ordre du parcours.
// Usage : node enregistrer-videos.mjs <dossier-captures> <dossier-videos> [nom ...]   (sans nom : toutes ; préfixe accepté : 05)
// Chaque scénario recharge la démo (données fictives IRMA), enregistre des actions réelles à 15 images/s
// (page 1440×846 + bandeau de légende 54 px = 1440×900) avec les annotations rouges des étapes, puis encode en MP4.
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ouvrirNavigateur, Enregistreur, aller, naviguer, cliquer, taper, defiler, survoler, marquer, effacer, annoter,
  chargerDemo, parTexte, sleep, BASE, curseur, pretes,
} from '../gifs/enregistreur.mjs'
import { SCENARIOS as GIF } from '../gifs/scenarios.mjs'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const LARGEUR = 1440
const HAUTEUR = 846  // + bandeau de 54 px à l'encodage
const attendre = (page, sel, ms = 10000) => page.locator(sel).filter({ visible: true }).first().waitFor({ timeout: ms }).catch(() => {})
const visible = (page, sel) => page.locator(sel).filter({ visible: true }).first()

// Journal de l'exploration : attend une ligne qui correspond au motif (texte du journal).
const journal = (page, motif, ms = 120000) => page.waitForFunction((m) => new RegExp(m, 'i').test(document.querySelector('.au-log')?.innerText || ''),
  motif, { timeout: ms, polling: 250 }).then(() => true).catch(() => false)
const ligneJournal = (page, motif) => page.locator('.au-log > *').filter({ hasText: new RegExp(motif, 'i') }).last()

// Arrête les sessions d'exploration encore actives (une seule session active par application).
async function arreterSessions(context) {
  const r = await context.request.get(BASE + '/api/explore/sessions').catch(() => null)
  const l = r && r.ok() ? (await r.json()).sessions || [] : []
  for (const x of l.filter((x) => ['planning', 'exploring', 'needs-human', 'recording', 'replaying'].includes(x.status))) {
    await context.request.post(`${BASE}/api/explore/sessions/${encodeURIComponent(x.id)}/stop`, { headers: { Origin: BASE }, data: {} }).catch(() => {})
  }
}

// Session d'automatisation neuve sur l'application de démo (sans fenêtre), avant l'enregistrement.
async function nouvelleSession(page, cle) {
  await aller(page, '/automatisation.html?key=' + cle, 1200)
  const etape1 = parTexte(page, 'Application à tester', '.p-step')
  if (await etape1.count()) { await etape1.click(); await sleep(800) }
  const nv = parTexte(page, 'Nouvelle session')
  if (await nv.count()) { await nv.click(); await sleep(800) }
  const cb = page.locator('label.p-check').filter({ hasText: 'Afficher la fen' }).locator('input').first()
  if (await cb.isChecked({ timeout: 4000 }).catch(() => false)) await cb.uncheck()
}
async function continuer(page, opts) {
  await cliquer(page, parTexte(page, 'Continuer'), opts)
  await sleep(900)
  const arr = page.locator('.p-modal button').filter({ hasText: 'Arrêter l’autre' }).filter({ visible: true })
  if (await arr.count()) {
    await arr.first().click(); await sleep(1500)
    await cliquer(page, parTexte(page, 'Continuer'), { ...opts, etape: false })
  }
  await attendre(page, '.au-plan-sc', 15000)
  await sleep(600)
}

// Point d'un élément de l'application explorée, ramené aux pixels de la capture affichée dans Wizard QA.
// Une page annexe ouvre la même adresse (session de démo IRMA ouverte) à la taille du navigateur exploré
// (1280×800, server/lib/explore/agent.mjs) ; la capture en est une réduction homothétique.
async function pointSurCapture(page, img, url, cible, compte = 'agent') {
  const vue = { width: 1280, height: 800 }
  const r = await img.boundingBox()
  // contexte séparé : un nouvel onglet dans le même contexte masquerait la page enregistrée
  const ctx = await page.context().browser().newContext({ viewport: vue })
  const annexe = await ctx.newPage()
  try {
    await annexe.goto(BASE + '/demo-app/index.html')
    await annexe.evaluate((c) => window.IRMA.ouvrirSession(c), compte)
    await annexe.goto(url)
    await annexe.waitForLoadState('load')
    await sleep(500)
    const b = await cible(annexe).boundingBox()
    if (!b) return null
    const k = r.width / vue.width
    return { x: r.x + b.x * k, y: r.y + b.y * k, width: b.width * k, height: b.height * k }
  } finally { await ctx.close() }
}

async function cliquerPoint(page, boite, etape, pause = 900) {
  await annoter(page, boite, etape)
  const x = boite.x + Math.min(boite.width / 2, 40), y = boite.y + boite.height / 2
  await curseur(page)
  await page.evaluate(([x, y]) => window.__gifPos && window.__gifPos(x, y), [x, y])
  await page.mouse.move(x, y, { steps: 8 })
  await sleep(450)
  await page.evaluate(() => window.__gifClic && window.__gifClic()).catch(() => {})
  await page.mouse.click(x, y)
  await sleep(pause)
  await effacer(page)
}

export const VIDEOS = {
  '01-connexion-pilotage': { gif: '01-connexion-pilotage', deconnecte: true },
  '02-prise-de-connaissance': { gif: '02-scan-jira-par-url' },
  '03-tri-des-recits': { gif: '03-tri-des-recits' },
  '04-gherkin': { gif: '04-gherkin' },

  // ------------------------------------------------------------------------------------------
  '05-exploration-autonome': { async preparer(page) {
    await nouvelleSession(page, 'P0326-9311')
  }, async jouer(page, rec) {
    await rec.demarrer('Automatisation du récit P0326-9311 : l’outil explore seul l’application de démo')
    await sleep(600)
    await continuer(page, { pause: 600, etape: 'Créer la session sur l’application de démo IRMA' })
    rec.legender('Plan de test déduit du Gherkin : une étape du plan = un objectif à atteindre')
    await marquer(page, '.au-plan-sc', 'Plan déduit du Gherkin', 'Chaque étape est un objectif : l’outil cherche seul comment l’atteindre.')
    await sleep(1800)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Lancer l’exploration'), { pause: 300, etape: 'Lancer l’exploration autonome' })
    rec.legender('Ouverture du navigateur sans fenêtre…')
    await sleep(900)
    rec.suspendre()
    await journal(page, 'Application ouverte')
    await sleep(300)
    rec.reprendre()
    rec.legender('Le navigateur est ouvert : la capture évolue à chaque action de l’outil')
    await marquer(page, '.au-shot', 'Navigateur en direct', 'La capture du navigateur exploré, mise à jour à chaque action.')
    await sleep(1800)
    rec.suspendre()
    await journal(page, 'Connexion réussie', 60000)
    rec.reprendre()
    await sleep(400)
    await effacer(page)
    await marquer(page, ligneJournal(page, 'Connexion réussie'), 'Connexion par règle', 'Compte de démonstration « agent » : le mot de passe n’apparaît jamais.')
    rec.suspendre()
    await journal(page, 'essai 1/', 30000)
    rec.reprendre()
    await effacer(page)
    await marquer(page, ligneJournal(page, 'essai 1/'), 'L’outil essaie seul : Heuristique (essai 1/4)', 'Il note les éléments de la page et tente le meilleur candidat.')
    await sleep(1500)
    await effacer(page)
    rec.legender('L’outil juge le progrès : la page atteinte correspond-elle à l’objectif ?')
    await marquer(page, '.au-shot', 'Capture après l’essai', 'Le clic a ouvert la liste des risques.')
    rec.suspendre()
    await journal(page, 'Étape trouvée', 40000)
    await sleep(200)
    rec.reprendre()
    await effacer(page)
    await marquer(page, ligneJournal(page, 'Étape trouvée'), 'Étape trouvée par l’heuristique', 'Sélecteurs retenus, l’étape est ajoutée au test.')
    await sleep(1400)
    await effacer(page)
    rec.legender('L’outil enchaîne les étapes suivantes du plan…')
    rec.suspendre()
    await attendre(page, '.p-modal .au-tk-why', 60000)  // scénario 2 : vérification introuvable sans IA
    await sleep(400)
    rec.reprendre()
    const fenetre = visible(page, '.p-modal button:has-text("Plus tard")')
    if (await fenetre.count()) {
      rec.legender('Une vérification n’est pas trouvée : l’outil propose de prendre la main')
      await sleep(1600)
      await cliquer(page, fenetre, { pause: 600, etape: 'Plus tard : regarder d’abord le test généré' })
    } else {
      await marquer(page, ligneJournal(page, 'Vérification trouvée'), 'Vérification trouvée', 'Le texte attendu est bien affiché : scénario 1 couvert.')
      await sleep(1500)
      await effacer(page)
    }
    rec.legender('Test généré : les étapes trouvées et le code Playwright')
    const voir = visible(page, 'button:has-text("Voir le test")')
    await voir.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await cliquer(page, voir, { pause: 1200, etape: 'Voir le test généré' })
    await sleep(600)
    await marquer(page, '.au-steps', 'Étapes du test', 'Source de chaque étape : Règle, Heuristique, IA ou Testeur.')
    await sleep(2200)
  } },

  // ------------------------------------------------------------------------------------------
  '06-prise-de-main': { async preparer(page) {
    await nouvelleSession(page, 'P0326-9302')
    await parTexte(page, 'Continuer').click(); await sleep(1200)
    const arr = page.locator('.p-modal button').filter({ hasText: 'Arrêter l’autre' }).filter({ visible: true })
    if (await arr.count()) { await arr.first().click(); await sleep(1500); await parTexte(page, 'Continuer').click() }
    await attendre(page, '.au-plan-sc', 15000)
    await parTexte(page, 'Lancer l’exploration').click()
    await attendre(page, '.p-modal .au-tk-why', 150000)  // l'outil bloque : fenêtre « Prenez la main »
    await sleep(800)
  }, async jouer(page, rec) {
    await rec.demarrer('Prise de main : l’outil bloque sur une étape, le testeur montre le geste')
    await sleep(700)
    await marquer(page, '.p-modal .au-tk-why', 'L’outil bloque sur cette étape', 'Sans IA, l’heuristique n’a pas trouvé : la fenêtre « Prenez la main » s’ouvre.')
    await sleep(2400)
    await effacer(page)
    await cliquer(page, page.locator('.p-modal button.au-tk-choice').nth(1), { pause: 600, etape: 'Choisir « Agir ici, sur la capture »' })
    const img = page.locator('.p-modal img.au-shot-img').first()
    await page.waitForFunction(() => { const i = document.querySelector('.p-modal img.au-shot-img'); return i && i.naturalWidth > 0 }, null, { timeout: 30000 }).catch(() => {})
    await sleep(800)
    rec.legender('Le testeur agit sur la capture : chaque clic est joué dans le navigateur exploré')
    const url = (await page.locator('.p-modal .au-urlbar').first().innerText().catch(() => '')).trim() || BASE + '/demo-app/tableau-de-bord.html'
    const lien = await pointSurCapture(page, img, url, (p) => p.getByText('RSK-002', { exact: true }).first())
    if (lien) await cliquerPoint(page, lien, 'Cliquer le risque RSK-002 sur la capture', 1800)
    await page.locator('.p-modal .au-rec').first().waitFor({ timeout: 15000 }).catch(() => {})
    await sleep(800)
    await marquer(page, '.p-modal .au-rec-list', 'Action enregistrée', 'Le clic devient une étape du test, sélecteur compris.')
    await sleep(1800)
    await effacer(page)
    await cliquer(page, page.locator('.p-modal .p-seg button').filter({ hasText: 'Vérifier' }).first(), { pause: 500, etape: 'Passer en mode « Vérifier un élément »' })
    await page.waitForFunction(() => { const i = document.querySelector('.p-modal img.au-shot-img'); return i && i.naturalWidth > 0 }, null, { timeout: 15000 }).catch(() => {})
    const url2 = (await page.locator('.p-modal .au-urlbar').first().innerText().catch(() => '')).trim()
    const titre = url2 && await pointSurCapture(page, page.locator('.p-modal img.au-shot-img').first(), url2, (p) => p.locator('h1').first())
    if (titre) await cliquerPoint(page, titre, 'Cliquer le titre à vérifier', 1800)
    await sleep(600)
    await marquer(page, '.p-modal .au-rec-list', 'Enregistrement', 'Un clic et une vérification « visible » : lisibles, avec leur sélecteur.')
    await sleep(2000)
    await effacer(page)
    await cliquer(page, visible(page, '.p-modal button:has-text("J’ai terminé")'), { pause: 400, etape: 'Terminer : l’enregistrement est interprété' })
    rec.legender('Les gestes enregistrés deviennent des étapes « Testeur » ; l’exploration reprend')
    await sleep(1500)
    const fen = visible(page, '.p-modal button:has-text("Plus tard")')
    if (await fen.count()) await fen.click().catch(() => {})
    await sleep(500)
    await marquer(page, '.au-progress', 'Étapes du plan', 'L’étape réalisée par le testeur est marquée, l’outil reprend la suite.')
    await sleep(2400)
  } },

  // ------------------------------------------------------------------------------------------
  '07-rejeu-validation': { async preparer(page) {
    await aller(page, '/automatisation.html?key=P0326-9310', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Test généré : il est rejoué tel quel avant d’être validé')
    await sleep(600)
    await marquer(page, '.au-steps', 'Étapes du test', 'Règle, Testeur : chaque étape garde sa source et son sélecteur.')
    await sleep(1800)
    await effacer(page)
    const rejouer = () => visible(page, 'button:has-text("Rejouer")')
    await rejouer().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(400)
    await cliquer(page, rejouer(), { pause: 300, etape: 'Rejouer le test' })
    rec.legender('Rejeu dans un navigateur sans fenêtre…')
    await sleep(1200)
    rec.suspendre()
    await page.waitForFunction(() => /Rejeu (en échec|réussi)/.test(document.body.innerText), null, { timeout: 150000 }).catch(() => {})
    await sleep(500)
    const ko = page.locator('.au-steps tr').filter({ hasText: 'absent de la page' }).first()
    await ko.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(400)
    rec.reprendre()
    await marquer(page, ko, 'Rejeu : une étape en échec', 'Le texte attendu n’apparaît pas : l’étape est à corriger ou à supprimer.')
    await sleep(2400)
    await effacer(page)
    await cliquer(page, ko.locator('button[aria-label="Supprimer l’étape"]'), { pause: 700, etape: 'Supprimer l’étape fautive' })
    const enr = visible(page, 'button:has-text("Enregistrer les modifications")')
    await enr.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await cliquer(page, enr, { pause: 800, etape: 'Enregistrer les modifications' })
    await cliquer(page, rejouer(), { pause: 300, etape: 'Rejouer le test corrigé' })
    rec.legender('Nouveau rejeu…')
    await sleep(1000)
    rec.suspendre()
    await page.waitForFunction(() => /Rejeu réussi|Rejeu en échec/.test(document.querySelector('.au-steps')?.closest('section')?.innerText || document.body.innerText) && !/Rejeu en cours/.test(document.body.innerText), null, { timeout: 150000 }).catch(() => {})
    await sleep(600)
    const ok = page.locator('.p-banner').filter({ hasText: 'Rejeu réussi' }).first()
    await ok.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await sleep(300)
    rec.reprendre()
    await marquer(page, ok, 'Rejeu réussi', 'Toutes les étapes passent : le test peut être validé.')
    await sleep(2000)
    await effacer(page)
    const valider = visible(page, 'button:has-text("Valider le test")')
    await valider.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await cliquer(page, valider, { pause: 1500, etape: 'Valider le test' })
    rec.legender('Test validé : fichier tests/e2e/P0326-9310.spec.ts écrit, prêt pour Xray')
    await marquer(page, '.au-main .p-banner, .p-banner', 'Test validé', 'Le fichier .spec.ts est écrit dans le projet, sans aucun mot de passe.')
    await sleep(2400)
  } },

  '08-envoi-xray': { gif: '06-envoi-xray' },
  '09-campagne-execution': { gif: '07-campagne-execution' },

  // ------------------------------------------------------------------------------------------
  '10-livrables-istqb': { async preparer(page) {
    await aller(page, '/livrables.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Livrables ISTQB : onze documents ISO/IEC/IEEE 29119-3 tirés des données réelles')
    await marquer(page, '.lv-doclist', 'Documents ISTQB', 'Politique, stratégie, plan, rapports : statut de chaque document.')
    await sleep(2200)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Rapport d’avancement', '.lv-docitem'), { pause: 1200, etape: 'Ouvrir le rapport d’avancement' }).catch(async () => {
      await cliquer(page, page.locator('.lv-docitem').nth(5), { pause: 1200, etape: 'Ouvrir un rapport' })
    })
    const gen = parTexte(page, /^\s*(Actualiser|Générer)/, '.lv-dochead-actions button')
    await cliquer(page, gen, { pause: 600, etape: 'Générer depuis les faits collectés' })
    const conf = visible(page, '.p-modal button.p-btn--primary')
    if (await conf.count()) await cliquer(page, conf, { pause: 600, etape: 'Confirmer la génération' })
    await pretes(page)
    await sleep(1200)
    rec.legender('Chiffres tirés des récits, tests, campagnes, envois Xray et runs k6')
    await defiler(page, 380, { pas: 12, ms: 45 })
    await sleep(900)
    await defiler(page, -380, { pas: 8, ms: 40 })
    await cliquer(page, parTexte(page, 'Relire', '.lv-dochead-actions button'), { pause: 1500, etape: 'Faire relire par l’agent' })
    await cliquer(page, parTexte(page, 'Relecture', '.p-tab'), { pause: 1500, etape: 'Lire le rapport de relecture' })
    await marquer(page, '.lv-tabbody', 'Relecture', 'Sections, « À compléter », chiffres écartés des faits : verdict et score.')
    await sleep(2200)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Approuver', '.lv-dochead-actions button'), { pause: 900, etape: 'Approuver le document' })
    const ok = visible(page, '.p-modal button.p-btn--primary')
    if (await ok.count()) await cliquer(page, ok, { pause: 1200, etape: 'Confirmer l’approbation' })
    await marquer(page, '.lv-dochead', 'Approuvé', 'Généré, relu par l’agent puis approuvé par un humain : la version est figée.')
    await sleep(2400)
  } },

  // ------------------------------------------------------------------------------------------
  '11-export-word': { async preparer(page) {
    await aller(page, '/livrables.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Export Word : chaque livrable part en .docx, HTML / PDF ou Markdown')
    await cliquer(page, parTexte(page, 'Stratégie de test', '.lv-docitem'), { pause: 1200, etape: 'Ouvrir la stratégie de test (approuvée)' })
    await marquer(page, '.lv-export', 'Formats d’export', 'Word (mise en forme standard en démonstration), HTML / PDF, Markdown.')
    await sleep(2000)
    await effacer(page)
    const attente = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
    await cliquer(page, parTexte(page, 'Word', '.lv-export button'), { pause: 300, etape: 'Exporter en Word', garder: true })
    const dl = await attente
    const nom = dl ? dl.suggestedFilename() : 'document.docx'
    await effacer(page)
    await marquer(page, '.lv-export', `Fichier téléchargé : ${nom}`, 'Cartouche, sommaire, chapitres et tableaux du document.')
    await sleep(2400)
    await effacer(page)
    rec.legender('Le même document, version HTML imprimable (PDF)')
    if (dl) {
      // l'export HTML est servi en pièce jointe : son contenu est affiché dans la page
      const r = await page.context().request.get(dl.url().replace(/format=docx/, 'format=html'))
      rec.suspendre()
      await page.setContent(await r.text(), { waitUntil: 'load' })
      await curseur(page)
      await sleep(500)
      rec.reprendre()
      await marquer(page, 'body > *:first-child, h1', 'Document exporté', 'Le contenu du fichier Word : identification, objet, sections ISO 29119-3.')
      await sleep(1600)
      await effacer(page)
      await defiler(page, 900, { pas: 24, ms: 50 })
      await sleep(900)
      await defiler(page, 900, { pas: 24, ms: 50 })
      await sleep(1200)
    }
  } },

  '12-informations-projet': { gif: '09-informations-projet' },
  '13-performance-k6': { gif: '10-performance-k6' },
  '14-installation-poste': { gif: '11-installation-poste' },
  '15-assistant-ia': { gif: '12-assistant-ia' },
  '16-visite-guidee': { gif: '13-visite-guidee', ips: 10 },

  // ------------------------------------------------------------------------------------------
  '17-reglages-demo': { async preparer(page) {
    await aller(page, '/reglages.html', 1200)
  }, async jouer(page, rec) {
    await rec.demarrer('Réglages : comptes, configuration et données de démonstration')
    await cliquer(page, parTexte(page, 'Démonstration'), { pause: 1200, etape: 'Ouvrir l’onglet « Démonstration »' })
    await marquer(page, page.locator('section.p-card').filter({ hasText: /démo/i }).first(), 'Jeu de démonstration IRMA', 'Projet fictif complet : récits, Gherkin, sessions, Xray, campagnes, k6, livrables.')
    await sleep(2400)
    await effacer(page)
    await cliquer(page, '#demoLoad', { pause: 300, etape: 'Recharger la démo' })
    const conf = visible(page, '.p-modal button.p-btn--primary')
    if (await conf.count()) await cliquer(page, conf, { pause: 300, etape: 'Confirmer le rechargement' })
    rec.legender('Chargement : dates recalculées à partir de maintenant')
    await page.waitForFunction(() => !document.querySelector('#demoLoad[disabled], #demoLoad .p-spinner'), null, { timeout: 60000 }).catch(() => {})
    await sleep(1800)
    await marquer(page, '#demoReset', 'Réinitialiser', 'Efface uniquement ce que la démo a créé et restaure « Mon projet ».')
    await sleep(2000)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Utilisateurs'), { pause: 1600, etape: 'Ouvrir l’onglet « Utilisateurs »' })
    await cliquer(page, parTexte(page, 'JIRA / Xray'), { pause: 1600, etape: 'Ouvrir l’onglet « JIRA / Xray »' })
    await cliquer(page, parTexte(page, 'Configuration'), { pause: 1800, etape: 'Ouvrir l’onglet « Configuration »' })
  } },

  // ------------------------------------------------------------------------------------------
  '18-mon-projet': { async preparer(page) {
    await aller(page, '/projet.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Mon projet : l’équipe, le produit et l’application testée, une seule fois')
    await marquer(page, page.locator('text=TRIBU').first().locator('xpath=ancestor::*[count(.//*[contains(text(),"Squad")])>0][1]'), 'Profil du projet', 'Tribu, squad, produit, PO, BA, QA, application et dépôt Git : fictifs ici.')
    await sleep(2600)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Paramètres projet'), { pause: 1600, etape: 'Ouvrir « Paramètres projet »' })
    rec.legender('Ces informations préremplissent tous les autres écrans')
    await sleep(1600)
    await defiler(page, 360, { pas: 12, ms: 45 })
    await sleep(1400)
    await page.keyboard.press('Escape'); await sleep(600)
    await naviguer(page, rec, '/projet.html', 600)
    await cliquer(page, parTexte(page, 'Exporter'), { pause: 1600, etape: 'Exporter la configuration du projet' })
    await sleep(800)
  } },

  // ------------------------------------------------------------------------------------------
  '19-npmrc': { async preparer(page) {
    await aller(page, '/npmrc.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('.npmrc : accès du poste au dépôt interne (Artifactory), sans secret affiché')
    await marquer(page, page.locator('input').filter({ visible: true }).first().locator('xpath=ancestor::*[.//*[contains(text(),"registry")]][1]'), 'Registre et identité', 'E-mail, adresse du registre npm et jeton d’accès masqué.')
    await sleep(2600)
    await effacer(page)
    await defiler(page, 420, { pas: 14, ms: 45 })
    await marquer(page, page.locator('text=Proxy entreprise').first().locator('xpath=ancestor::div[1]'), 'Proxy encodé automatiquement', 'Matricule et mot de passe proxy encodés dans les variables http(s)-proxy.')
    await sleep(2400)
    await effacer(page)
    await survoler(page, parTexte(page, 'Générer npmrc'), 1800, { etape: 'Générer le fichier .npmrc (non lancé en démonstration)' })
    await effacer(page)
    await sleep(500)
  } },

  // ------------------------------------------------------------------------------------------
  '20-hook-git': { async preparer(page) {
    await aller(page, '/hook-git.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Hook Git : les tests enregistrés dans Git suivis automatiquement dans JIRA / Xray')
    await marquer(page, page.locator('text=Hook Git déjà configuré').first().locator('xpath=ancestor::*[contains(@class,"card") or self::section][1]'), 'Hook Git configuré', '.env, hooks.conf, installation et vérification à blanc (dry-run) : tout est vert.')
    await sleep(2600)
    await effacer(page)
    await marquer(page, page.locator('text=Hook OK').first().locator('xpath=..'), 'État du hook', 'Hook, .env, configuration et dry-run vérifiés.')
    await sleep(2000)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Se rendre sur la section Sync JIRA'), { pause: 1600, rec, etape: 'Aller à la synchronisation JIRA' })
    rec.legender('Débloquée par le hook : la synchronisation compare le local et JIRA')
    await sleep(2200)
  } },

  // ------------------------------------------------------------------------------------------
  '21-sync-xray': { async preparer(page) {
    await aller(page, '/project.html', 1500)
  }, async jouer(page, rec) {
    await rec.demarrer('Sync Xray : comparer les tests locaux et JIRA / Xray, puis synchroniser')
    await cliquer(page, parTexte(page, 'Lancer l\'analyse'), { pause: 2200, etape: 'Lancer l’analyse des écarts (sans rien modifier)' })
    await marquer(page, page.locator('pre, .p-log, code').filter({ hasText: 'ÉCART' }).first(), 'Écarts détectés', '2 scénarios locaux sans ticket Test, 1 ticket orphelin.')
    await sleep(2800)
    await effacer(page)
    await cliquer(page, parTexte(page, 'Synchroniser vers JIRA'), { pause: 600, etape: 'Synchroniser vers JIRA (simulé en démonstration)' })
    const conf = page.locator('button').filter({ hasText: /Lancer la synchro/ }).filter({ visible: true }).first()
    if (await conf.count()) await cliquer(page, conf, { pause: 600, etape: 'Confirmer la synchronisation' })
    await sleep(2400)
    await marquer(page, page.locator('pre, .p-log, code').filter({ hasText: /Synchronisation/ }).last(), 'Synchronisation', 'Tickets créés, mis à jour ou supprimés ; tests importés dans le plan.')
    await sleep(2600)
  } },
}

// ----------------------------------------------------------------------------------------------
async function main() {
  const [dossier, sortie, ...noms] = process.argv.slice(2)
  if (!dossier || !sortie) { console.error('Usage : node enregistrer-videos.mjs <dossier-captures> <dossier-videos> [nom ...]'); process.exit(2) }
  const liste = noms.length ? noms.map((n) => Object.keys(VIDEOS).find((k) => k.startsWith(n)) || n) : Object.keys(VIDEOS)
  fs.mkdirSync(sortie, { recursive: true })
  for (const nom of liste) {
    const v = VIDEOS[nom]
    if (!v) { console.error('Vidéo inconnue :', nom); continue }
    const sc = v.gif ? GIF[v.gif] : v
    const { browser, context, page } = await ouvrirNavigateur({ connecte: true, largeur: LARGEUR, hauteur: HAUTEUR })
    await chargerDemo(context)
    await arreterSessions(context)
    if (v.deconnecte) await context.clearCookies()
    const dossierNom = path.join(dossier, nom)
    const rec = new Enregistreur(page, dossierNom, { ips: v.ips || 15, qualite: 88, largeur: LARGEUR, hauteur: HAUTEUR })
    const t = Date.now()
    try {
      if (v.preparer) await v.preparer(page)
      await sc.jouer(page, rec)
    } catch (e) {
      console.error(`[${nom}] erreur :`, e.message.split(String.fromCharCode(10))[0])
      await page.screenshot({ path: dossierNom + '-erreur.png' }).catch(() => {})
    }
    const r = await rec.arreter(500)
    console.log(`${nom} : ${r.images} captures, ${(r.duree / 1000).toFixed(1)} s (${((Date.now() - t) / 1000).toFixed(0)} s réels)`)
    await browser.close()
    const py = spawnSync('python', [path.join(ICI, 'encoder-video.py'), dossierNom, path.join(sortie, nom + '.mp4'),
      '--vitesse', String(v.vitesse || sc.vitesse || 1)], { encoding: 'utf8' })
    process.stdout.write(py.stdout || ''); process.stderr.write(py.stderr || '')
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
