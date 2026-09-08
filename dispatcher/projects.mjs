/**
 * The org Projects v2 board, written by the dispatcher only. Field and
 * option ids are resolved by name once per run; loop-config.json names the
 * vocabulary, never an id. (why: docs/why.md#the-board-is-a-lens)
 */

let cache = null

export async function projectIds(gh, config) {
  if (cache) return cache
  const q = `query($org:String!,$n:Int!){ organization(login:$org){ projectV2(number:$n){ id
    status: field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } } }`
  const d = await gh.graphql(q, { org: config.org, n: config.projects.number })
  const p = d.organization.projectV2
  const options = {}
  for (const o of p.status?.options || []) options[o.name] = o.id
  cache = { projectId: p.id, statusFieldId: p.status?.id || null, options }
  return cache
}

/** The item's project item id and current Status name, or nulls. */
export async function itemOf(gh, config, contentNodeId) {
  const q = `query($id:ID!,$n:Int!){ node(id:$id){
    ... on Issue { projectItems(first:10){ nodes { id project { number } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }
    ... on PullRequest { projectItems(first:10){ nodes { id project { number } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }`
  const d = await gh.graphql(q, { id: contentNodeId, n: config.projects.number })
  const item = (d.node?.projectItems?.nodes || []).find((i) => i.project?.number === config.projects.number)
  return item ? { itemId: item.id, status: item.fieldValueByName?.name || null } : { itemId: null, status: null }
}

export async function ensureItem(gh, config, contentNodeId) {
  const { itemId, status } = await itemOf(gh, config, contentNodeId)
  if (itemId) return { itemId, status }
  const ids = await projectIds(gh, config)
  const d = await gh.graphql(
    `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item { id } } }`,
    { p: ids.projectId, c: contentNodeId },
  )
  return { itemId: d.addProjectV2ItemById.item.id, status: null }
}

/** Set Status by vocabulary key (`proposed`…). Writes only on change. Returns the name written or null. */
export async function setStatus(gh, config, contentNodeId, key) {
  const name = config.projects.status?.[key]
  if (!name) throw new Error(`projects.status has no "${key}"`)
  const ids = await projectIds(gh, config)
  const optionId = ids.options[name]
  if (!optionId || !ids.statusFieldId) throw new Error(`Status option "${name}" not found on the board`)
  const { itemId, status } = await ensureItem(gh, config, contentNodeId)
  if (status === name) return null
  await gh.graphql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item { id } } }`,
    { p: ids.projectId, i: itemId, f: ids.statusFieldId, o: optionId },
  )
  return name
}

