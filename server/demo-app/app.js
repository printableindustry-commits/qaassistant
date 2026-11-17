/*
 * Application de démonstration IRMA (Analyse des Risques Métier) servie par Wizard QA sous /demo-app/.
 * Données fictives conservées dans le navigateur (localStorage / sessionStorage).
 * Comptes de démonstration : agent (profil Analyste) et gestionnaire (profil Valideur).
 * Volontairement imparfaite pour l'exercice d'automatisation : boutons-icônes, champ sans libellé,
 * data-testid sur certains éléments seulement, menu déroulant, modale de confirmation.
 */
;(function () {
  'use strict'

  const COMPTES = {
    agent: { motDePasse: 'agent-demo-2026', nom: 'Alex MARTIN', profil: 'Analyste' },
    gestionnaire: { motDePasse: 'gestion-demo-2026', nom: 'Camille DUBOIS', profil: 'Valideur' },
  }
  const ENTITE = 'Horizon Paris'
  const NIVEAUX = ['Faible', 'Modéré', 'Élevé', 'Critique']

  const RISQUES_INITIAUX = [
    ['RSK-001', 'Concentration des expositions sur un même groupe', 'Critique', '2026-08-12', 'Léa ROUSSEL', 1450000],
    ['RSK-002', 'Défaut de contrôle des habilitations applicatives', 'Élevé', '2026-09-03', 'Hugo LAMBERT', 0],
    ['RSK-003', 'Retard de réconciliation des comptes de passage', 'Modéré', '2026-09-18', 'Bastien GIRARD', 120000],
    ['RSK-004', 'Erreur de saisie des taux dans l’outil de cotation', 'Élevé', '2026-10-01', 'Léa ROUSSEL', 380000],
    ['RSK-005', 'Indisponibilité du serveur d’import SFTP', 'Modéré', '2026-10-07', 'Bastien GIRARD', 0],
    ['RSK-006', 'Documentation de la procédure KYC incomplète', 'Faible', '2026-10-09', 'Claire FONTAINE', 0],
    ['RSK-007', 'Dépassement du seuil d’alerte du portefeuille PME', 'Critique', '2026-10-15', 'Nadia PERRIN', 1200000],
    ['RSK-008', 'Double saisie des expositions mensuelles', 'Modéré', '2026-10-21', 'Hugo LAMBERT', 45000],
    ['RSK-009', 'Absence de revue annuelle des seuils', 'Faible', '2026-10-28', 'Claire FONTAINE', 0],
    ['RSK-010', 'Fichier d’expositions transmis hors délai', 'Élevé', '2026-11-02', 'Bastien GIRARD', 250000],
    ['RSK-011', 'Accès partagé à un poste de saisie', 'Faible', '2026-11-05', 'Nadia PERRIN', 0],
    ['RSK-012', 'Écart de cotation entre deux comités', 'Modéré', '2026-11-10', 'Léa ROUSSEL', 90000],
  ].map(([ref, libelle, niveau, date, porteur, montant]) => ({
    ref, libelle, niveau, date, porteur, montant, entite: ENTITE, description: '',
    cotations: [
      { date: date, niveau, auteur: porteur, commentaire: 'Cotation initiale' },
    ],
  }))
  RISQUES_INITIAUX[0].cotations = [
    { date: '2026-11-04', niveau: 'Critique', auteur: 'Camille DUBOIS', commentaire: 'Hausse des expositions constatée au comité de novembre' },
    { date: '2026-09-30', niveau: 'Élevé', auteur: 'Léa ROUSSEL', commentaire: 'Nouvelles lignes de crédit accordées' },
    { date: '2026-08-12', niveau: 'Modéré', auteur: 'Léa ROUSSEL', commentaire: 'Cotation initiale' },
  ]

  function lire(cle, defaut) {
    try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut } catch (e) { return defaut }
  }
  function ecrire(cle, val) {
    try { localStorage.setItem(cle, JSON.stringify(val)) } catch (e) { /* stockage indisponible */ }
  }
  function risques() {
    return lire('irma.risques', null) || RISQUES_INITIAUX
  }
  function enregistrerRisques(liste) { ecrire('irma.risques', liste) }

  function session() {
    try { return JSON.parse(sessionStorage.getItem('irma.session') || 'null') } catch (e) { return null }
  }
  function ouvrirSession(identifiant) {
    const c = COMPTES[identifiant]
    sessionStorage.setItem('irma.session', JSON.stringify({ identifiant, nom: c.nom, profil: c.profil, entite: ENTITE }))
  }
  function fermerSession() { sessionStorage.removeItem('irma.session') }

  function exigerSession() {
    const s = session()
    if (!s) {
      const page = location.pathname.split('/').pop() + location.search
      location.replace('index.html?retour=' + encodeURIComponent(page))
      throw new Error('session requise')
    }
    return s
  }

  function el(tag, attrs, ...enfants) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
      else if (k === 'class') n.className = v
      else n.setAttribute(k, v === true ? '' : v)
    }
    for (const e of enfants.flat()) {
      if (e == null || e === false) continue
      n.append(e.nodeType ? e : document.createTextNode(String(e)))
    }
    return n
  }
  function icone(nom) {
    const chemins = {
      cloche: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z',
      oeil: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
      aide: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2zm2.1-7.7-.9.9A3.4 3.4 0 0 0 13 15h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3A2 2 0 1 0 10 9H8a4 4 0 1 1 7.1 2.3z',
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('fill', 'currentColor')
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', chemins[nom] || '')
    svg.append(p)
    return svg
  }

  function toast(texte) {
    const t = el('div', { class: 'toast', role: 'status' }, texte)
    document.body.append(t)
    setTimeout(() => t.remove(), 3500)
  }

  function entete(actif) {
    const s = session()
    const menu = el('div', { class: 'menu', role: 'menu', id: 'menu-utilisateur', hidden: true },
      el('button', { role: 'menuitem', type: 'button', onclick: () => toast(`Profil : ${s.profil} — entité ${s.entite}`) }, 'Mon profil'),
      el('button', { role: 'menuitem', type: 'button', onclick: () => { fermerSession(); location.href = 'index.html?deconnexion=1' } }, 'Se déconnecter'))
    const bouton = el('button', {
      class: 'menu-utilisateur', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'menu-utilisateur',
      onclick: (e) => {
        e.stopPropagation()
        const ouvert = menu.hidden
        menu.hidden = !ouvert
        bouton.setAttribute('aria-expanded', String(ouvert))
      },
    }, `${s.nom} (${s.profil}) ▾`)
    document.addEventListener('click', () => { menu.hidden = true; bouton.setAttribute('aria-expanded', 'false') })
    const lien = (href, texte, cle) => el('a', { href, 'aria-current': actif === cle ? 'page' : null }, texte)
    return el('header', { class: 'entete' },
      el('div', { class: 'logo' }, 'IRMA', el('small', {}, 'Analyse des Risques Métier')),
      el('nav', { 'aria-label': 'Navigation principale' },
        lien('tableau-de-bord.html', 'Tableau de bord', 'tdb'),
        lien('risques.html', 'Risques', 'risques'),
        lien('nouveau-risque.html', 'Déclarer un risque', 'nouveau')),
      el('div', { class: 'outils' },
        el('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Notifications', onclick: () => toast('Aucune nouvelle notification.') }, icone('cloche')),
        el('button', { class: 'btn-icone', type: 'button', title: 'Aide', onclick: () => toast('Aide : contactez l’équipe IRMA.') }, icone('aide')),
        bouton, menu))
  }

  function badgeNiveau(niveau) {
    return el('span', { class: 'niveau niveau-' + niveau }, niveau)
  }
  function dateFr(iso) {
    if (!iso) return ''
    const [a, m, j] = iso.split('-')
    return `${j}/${m}/${a}`
  }
  function prochaineReference(liste) {
    const max = liste.reduce((m, r) => Math.max(m, Number(r.ref.replace(/\D/g, '')) || 0), 0)
    return 'RSK-' + String(max + 1).padStart(3, '0')
  }
  function aujourdHui() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Modale de confirmation (promesse : true si confirmé)
  function confirmer(titre, texte, libelle) {
    return new Promise((resolve) => {
      const fermer = (v) => { fond.remove(); resolve(v) }
      const fond = el('div', { class: 'modale-fond' },
        el('div', { class: 'modale', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modale-titre' },
          el('h2', { id: 'modale-titre' }, titre),
          el('p', {}, texte),
          el('div', { class: 'actions' },
            el('button', { class: 'btn', type: 'button', onclick: () => fermer(false) }, 'Annuler'),
            el('button', { class: 'btn btn-principal', type: 'button', onclick: () => fermer(true) }, libelle || 'Confirmer'))))
      fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(false) })
      document.body.append(fond)
      fond.querySelector('.btn-principal').focus()
    })
  }

  window.IRMA = {
    COMPTES, ENTITE, NIVEAUX, risques, enregistrerRisques, session, ouvrirSession, fermerSession, exigerSession,
    el, icone, toast, entete, badgeNiveau, dateFr, prochaineReference, aujourdHui, confirmer,
  }
})()
