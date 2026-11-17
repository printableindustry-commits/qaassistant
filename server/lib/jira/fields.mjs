/**
 * Découverte des champs personnalisés utiles au QA à partir de /rest/api/2/field :
 * critères d'acceptation, lien d'épopée (Server), story points.
 *   discoverFields(fieldList, { acceptanceField }) → { acceptance, epicLink, storyPoints } ({ id, name } | null)
 */

const AC_STRONG = /(acceptance\s*criteria|crit[eè]res?\s+d['’]\s?acceptation|crit[eè]res?\s+d['’]\s?acceptance)/i
const AC_WEAK = /(acceptance|acceptation|crit[eè]res?|^ac$|^ca$)/i
const EPIC_LINK = /^(epic link|lien d['’]\s?[ée]pop[ée]e|lien vers l['’]\s?[ée]pop[ée]e)$/i
const STORY_POINTS = /^(story points?|story point estimate|points? de r[ée]cit|points d['’]\s?histoire)$/i

const ref = (f) => (f ? { id: f.id, name: f.name } : null)

function findOverride(list, wanted) {
  if (!wanted) return null
  const w = wanted.toLowerCase()
  return list.find((f) => f.id.toLowerCase() === w || (f.name || '').toLowerCase() === w) || { id: wanted, name: wanted }
}

export function discoverFields(fieldList = [], { acceptanceField = '' } = {}) {
  const custom = fieldList.filter((f) => f && f.id)
  const acceptance = findOverride(custom, acceptanceField)
    || custom.find((f) => AC_STRONG.test(f.name || ''))
    || custom.find((f) => f.custom && AC_WEAK.test(f.name || ''))
  const epicLink = custom.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-epic-link')
    || custom.find((f) => EPIC_LINK.test(f.name || ''))
  const storyPoints = custom.find((f) => STORY_POINTS.test(f.name || ''))
  return { acceptance: ref(acceptance), epicLink: ref(epicLink), storyPoints: ref(storyPoints) }
}

/** Champs standard demandés à la recherche, complétés par les champs découverts. */
export function searchFields(map) {
  const base = ['summary', 'description', 'issuetype', 'status', 'priority', 'labels', 'components', 'fixVersions',
    'assignee', 'reporter', 'created', 'updated', 'parent', 'issuelinks', 'subtasks']
  for (const f of [map.acceptance, map.epicLink, map.storyPoints]) if (f?.id && !base.includes(f.id)) base.push(f.id)
  return base
}
