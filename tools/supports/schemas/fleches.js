// Flèches entre éléments : fleche('#a', '#b', { de: 'r', vers: 'l', texte, tir, double, decal, coude })
// Côtés : r (droite), l (gauche), t (haut), b (bas). Le tracé est droit ou à angle droit.
(function () {
  const NS = 'http://www.w3.org/2000/svg'
  let svg
  function init () {
    svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'fleches')
    svg.innerHTML = '<defs>' +
      '<marker id="pv" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#00694D"/></marker>' +
      '<marker id="pg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7C8A84"/></marker></defs>'
    document.body.appendChild(svg)
  }
  function point (el, cote, decal = 0, pos = 0.5) {
    const r = el.getBoundingClientRect()
    if (cote === 'r') return [r.right, r.top + r.height * pos + decal]
    if (cote === 'l') return [r.left, r.top + r.height * pos + decal]
    if (cote === 't') return [r.left + r.width * pos + decal, r.top]
    return [r.left + r.width * pos + decal, r.bottom]
  }
  window.fleche = function (a, b, o = {}) {
    if (!svg) init()
    const ea = document.querySelector(a); const eb = document.querySelector(b)
    if (!ea || !eb) { console.warn('flèche : élément absent', a, b); return }
    const de = o.de || 'r'; const vers = o.vers || 'l'
    const p1 = point(ea, de, o.decal || 0, o.posDe ?? 0.5); const p2 = point(eb, vers, o.decalVers ?? o.decal ?? 0, o.posVers ?? 0.5)
    const g = 6 // écart avant la pointe
    if (vers === 'l') p2[0] -= g; if (vers === 'r') p2[0] += g; if (vers === 't') p2[1] -= g; if (vers === 'b') p2[1] += g
    if (o.double) { if (de === 'r') p1[0] += g; if (de === 'l') p1[0] -= g; if (de === 't') p1[1] -= g; if (de === 'b') p1[1] += g }
    let d
    const horiz = (de === 'r' || de === 'l')
    if (horiz && (vers === 'l' || vers === 'r')) {
      if (Math.abs(p1[1] - p2[1]) < 2) d = `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]}`
      else { const mx = o.coude ?? (p1[0] + p2[0]) / 2; d = `M${p1[0]},${p1[1]} L${mx},${p1[1]} L${mx},${p2[1]} L${p2[0]},${p2[1]}` }
    } else if (!horiz && (vers === 't' || vers === 'b')) {
      if (Math.abs(p1[0] - p2[0]) < 2) d = `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]}`
      else { const my = o.coude ?? (p1[1] + p2[1]) / 2; d = `M${p1[0]},${p1[1]} L${p1[0]},${my} L${p2[0]},${my} L${p2[0]},${p2[1]}` }
    } else if (horiz) d = `M${p1[0]},${p1[1]} L${p2[0]},${p1[1]} L${p2[0]},${p2[1]}`
    else d = `M${p1[0]},${p1[1]} L${p1[0]},${p2[1]} L${p2[0]},${p2[1]}`
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d); path.setAttribute('fill', 'none')
    path.setAttribute('stroke', o.tir ? '#7C8A84' : '#00694D'); path.setAttribute('stroke-width', o.tir ? 2.2 : 2.6)
    if (o.tir) path.setAttribute('stroke-dasharray', '7 6')
    const m = o.tir ? 'url(#pg)' : 'url(#pv)'
    path.setAttribute('marker-end', m); if (o.double) path.setAttribute('marker-start', m)
    svg.appendChild(path)
    if (o.texte) {
      const l = path.getTotalLength(); const pt = path.getPointAtLength(l * (o.texteA ?? 0.5))
      const t = document.createElement('div'); t.className = 'etq' + (o.tir ? ' tir' : ''); t.textContent = o.texte
      t.style.left = (pt.x + (o.tx || 0)) + 'px'; t.style.top = (pt.y + (o.ty || 0)) + 'px'
      document.body.appendChild(t)
    }
  }
})()
