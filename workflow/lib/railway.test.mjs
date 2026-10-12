import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { deploymentFrom, failedDeploys, logRequest, readPlan, TOKEN_HEADER } from './railway.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

// Verbatim from sydevs/SahajCloud#879's head on 2026-10-12: "Deployment failed".
const URL_879 = 'https://railway.com/project/bdff2c72-5af2-4da3-9e2c-913f5e9d1b0f/service/1edee955-6c1f-4d8e-9cef-41737f981187?id=963aac12-f6c4-4b6e-bc9a-9feac615c336&environmentId=a35269c7-37ba-4d31-af10-711c611c2056'
const RED = { name: 'sahajcloud - SahajCloud', kind: 'status', targetUrl: URL_879 }

test('a real Railway status link yields its deployment id', () => {
  assert.deepEqual(deploymentFrom(URL_879), {
    projectId: 'bdff2c72-5af2-4da3-9e2c-913f5e9d1b0f',
    serviceId: '1edee955-6c1f-4d8e-9cef-41737f981187',
    deploymentId: '963aac12-f6c4-4b6e-bc9a-9feac615c336',
    environmentId: 'a35269c7-37ba-4d31-af10-711c611c2056',
  })
})

test('anything but a Railway deployment link parses to null', () => {
  for (const url of [
    null,
    '',
    'not a url',
    URL_879.replace('https:', 'http:'),
    URL_879.replace('railway.com', 'evil.up.railway.app'),
    URL_879.replace('railway.com', 'railway.com.evil.example'),
    URL_879.replace('?id=963aac12-f6c4-4b6e-bc9a-9feac615c336&', '?'),
    URL_879.replace('id=963aac12-f6c4-4b6e-bc9a-9feac615c336', 'id=x%22%7D'),
    URL_879.replace('/service/', '/services/'),
    'https://dash.cloudflare.com/x/pages/view/sahajatlas/abc',
  ]) assert.equal(deploymentFrom(url), null, String(url))
})

test('an unparseable environment id is dropped, never guessed', () => {
  assert.equal(deploymentFrom(URL_879.replace(/&environmentId=.*$/, '')).environmentId, null)
})

test('only a listed status context is a deploy to read', () => {
  const advisory = [
    RED,
    { name: 'sahajcloud - SahajCloud', kind: 'check', targetUrl: URL_879 },
    { name: 'Cloudflare Pages: sahajatlas', kind: 'check', targetUrl: 'https://dash.cloudflare.com/x' },
    { name: 'some other - Railway', kind: 'status', targetUrl: URL_879 },
    { name: 'sahajcloud - SahajCloud', kind: 'status', targetUrl: null },
  ]
  assert.deepEqual(failedDeploys(advisory, config).map((d) => d.deploymentId), ['963aac12-f6c4-4b6e-bc9a-9feac615c336'])
  assert.deepEqual(failedDeploys(advisory, { ...config, railway: undefined }), [], 'no railway key, nothing to read')
})

test('the request reads both logs for that deployment, bounded by logLines', () => {
  const r = logRequest('963aac12-f6c4-4b6e-bc9a-9feac615c336', config.railway.logLines)
  assert.match(r.query, /buildLogs\(deploymentId: \$deploymentId, limit: \$limit\) \{ timestamp message severity \}/)
  assert.match(r.query, /deploymentLogs\(deploymentId: \$deploymentId, limit: \$limit\) \{ timestamp message severity \}/)
  assert.deepEqual(r.variables, { deploymentId: '963aac12-f6c4-4b6e-bc9a-9feac615c336', limit: config.railway.logLines })
})

test('with no token, the plan still names the deployment and says the token is unset', () => {
  const plan = readPlan({ ci: { green: true, reason: 'x', advisory: [RED] } }, config, {})
  assert.equal(plan.tokenSet, false)
  assert.equal(plan.tokenEnvVar, config.railway.tokenEnvVar)
  assert.equal(plan.tokenHeader, TOKEN_HEADER)
  assert.equal(plan.apiBase, 'https://backboard.railway.com/graphql/v2')
  assert.equal(plan.deployments[0].targetUrl, URL_879)
  const tuned = readPlan({ ci: { advisory: [RED] } }, { ...config, railway: { ...config.railway, logLines: 37 } }, {})
  assert.equal(tuned.deployments[0].request.variables.limit, 37, 'the bound is the config value, not a default')
})

test('the plan reports a set token without ever printing it', () => {
  const plan = readPlan({ ci: { advisory: [RED] } }, config, { [config.railway.tokenEnvVar]: 'secret-value' })
  assert.equal(plan.tokenSet, true)
  assert.doesNotMatch(JSON.stringify(plan), /secret-value/)
})

test('a record with no advisory, or none at all, reads nothing', () => {
  assert.deepEqual(readPlan({ ci: { green: false, reason: 'x' } }, config, {}).deployments, [])
  assert.deepEqual(readPlan(null, config, {}).deployments, [])
})

test('the CLI takes the wrapped record a session was fired with', () => {
  const block = `<routine-fire-payload>${JSON.stringify({ v: 1, ci: { green: true, reason: 'x', advisory: [RED] } })}</routine-fire-payload>`
  const out = execFileSync(process.execPath, [new URL('./railway.mjs', import.meta.url).pathname], { input: block, env: {} })
  const plan = JSON.parse(String(out))
  assert.equal(plan.deployments[0].deploymentId, '963aac12-f6c4-4b6e-bc9a-9feac615c336')
  assert.equal(plan.tokenSet, false)
})
