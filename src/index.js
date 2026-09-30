import { createHash } from 'node:crypto';

const STATUSES = ['draft', 'impact-review', 'approval', 'implementation', 'verification', 'released', 'cancelled'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const round = (value, places = 4) => Number(value.toFixed(places));

export function createChange(input) {
  return { schemaVersion: 1, status: 'draft', affectedArtifacts: [], dependencies: [], impacts: {}, risk: null, approvals: [], implementationTasks: [], verification: [], evidence: [], effectivity: null, history: [], ...structuredClone(input) };
}

export function validateChange(change) {
  const issues = [];
  for (const field of ['id', 'title', 'reason', 'requestedBy', 'openedAt', 'product', 'currentRevision', 'proposedRevision', 'changeClass']) if (!change?.[field]) issues.push({ path: field, message: 'is required' });
  if (!STATUSES.includes(change?.status)) issues.push({ path: 'status', message: 'is invalid' });
  if (change?.openedAt && !Number.isFinite(Date.parse(change.openedAt))) issues.push({ path: 'openedAt', message: 'must be parseable' });
  if (!['major', 'minor', 'patch', 'emergency'].includes(change?.changeClass)) issues.push({ path: 'changeClass', message: 'is invalid' });
  const artifacts = new Set(); for (const [index, artifact] of (change?.affectedArtifacts ?? []).entries()) { if (!artifact.id || !artifact.type || !artifact.fromVersion || !artifact.toVersion || !artifact.change) issues.push({ path: `affectedArtifacts.${index}`, message: 'id, type, versions, and change are required' }); if (artifacts.has(artifact.id)) issues.push({ path: `affectedArtifacts.${index}.id`, message: 'is duplicated' }); artifacts.add(artifact.id); }
  for (const [index, edge] of (change?.dependencies ?? []).entries()) if (!artifacts.has(edge.from) || !artifacts.has(edge.to) || !edge.relation) issues.push({ path: `dependencies.${index}`, message: 'must connect known artifacts with a relation' });
  const approvalRoles = new Set(); for (const [index, approval] of (change?.approvals ?? []).entries()) { if (!approval.role || !['pending', 'approved', 'rejected', 'waived'].includes(approval.status)) issues.push({ path: `approvals.${index}`, message: 'role and valid status are required' }); if (approvalRoles.has(approval.role)) issues.push({ path: `approvals.${index}.role`, message: 'is duplicated' }); approvalRoles.add(approval.role); }
  return { valid: issues.length === 0, issues };
}

export function attachEvidence(change, metadata, content) {
  if (!metadata?.id || !metadata.title || !metadata.source || !metadata.timestamp) throw new Error('evidence id, title, source, and timestamp are required');
  if (change.evidence.some((item) => item.id === metadata.id)) throw new Error(`duplicate evidence ${metadata.id}`);
  if (!Buffer.byteLength(content)) throw new Error('evidence cannot be empty');
  return { ...structuredClone(change), evidence: [...change.evidence, { ...structuredClone(metadata), bytes: Buffer.byteLength(content), sha256: hash(content) }] };
}

export function verifyEvidence(change, contents) {
  const lookup = new Map(contents.map((item) => [item.id, item.content])); const differences = [];
  for (const item of change.evidence) { const content = lookup.get(item.id); if (content == null) differences.push({ id: item.id, kind: 'missing' }); else if (Buffer.byteLength(content) !== item.bytes || hash(content) !== item.sha256) differences.push({ id: item.id, kind: 'changed' }); lookup.delete(item.id); }
  for (const id of lookup.keys()) differences.push({ id, kind: 'untracked' }); return { valid: differences.length === 0, differences };
}

export function impactClosure(change, seeds = change.affectedArtifacts.filter((artifact) => artifact.direct !== false).map((artifact) => artifact.id)) {
  const graph = new Map(); for (const edge of change.dependencies) { const values = graph.get(edge.from) ?? []; values.push({ id: edge.to, relation: edge.relation }); graph.set(edge.from, values); }
  const visited = new Map(seeds.map((id) => [id, { id, depth: 0, via: null }])); const queue = [...seeds];
  while (queue.length) { const current = queue.shift(); const depth = visited.get(current).depth; for (const next of graph.get(current) ?? []) if (!visited.has(next.id)) { visited.set(next.id, { id: next.id, depth: depth + 1, via: current, relation: next.relation }); queue.push(next.id); } }
  const known = new Set(change.affectedArtifacts.map((artifact) => artifact.id)); const missing = [...visited.keys()].filter((id) => !known.has(id));
  return { impacted: [...visited.values()].sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id)), missing, complete: missing.length === 0 };
}

function semver(value) { const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/); if (!match) throw new Error(`invalid semantic version ${value}`); return match.slice(1).map(Number); }
export function recommendRevision(change) {
  const [major, minor, patch] = semver(change.currentRevision); const majorImpact = change.changeClass === 'major' || change.affectedArtifacts.some((artifact) => artifact.breaking) || change.impacts?.formFitFunction === 'changed' || change.impacts?.interchangeability === false;
  const minorImpact = change.changeClass === 'minor' || change.impacts?.manufacturing === 'changed' || change.impacts?.firmware === 'feature';
  const recommended = majorImpact ? `${major + 1}.0.0` : minorImpact ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  return { current: change.currentRevision, proposed: change.proposedRevision, recommended, matches: change.proposedRevision === recommended, reason: majorImpact ? 'breaking-or-form-fit-function' : minorImpact ? 'compatible-feature-or-process' : 'compatible-fix' };
}

export function riskScore(risk) {
  for (const field of ['severity', 'likelihood', 'detection']) if (!Number.isInteger(risk?.[field]) || risk[field] < 1 || risk[field] > 10) throw new Error(`${field} must be an integer 1-10`);
  const score = risk.severity * risk.likelihood * risk.detection; return { ...structuredClone(risk), score, level: score >= 200 || risk.severity >= 9 ? 'high' : score >= 80 ? 'medium' : 'low' };
}

export function approvalSummary(change) {
  const required = change.approvals.filter((approval) => approval.required !== false); const rejected = required.filter((approval) => approval.status === 'rejected'); const pending = required.filter((approval) => approval.status === 'pending'); const invalidApprovals = required.filter((approval) => approval.status === 'approved' && (!approval.by || !approval.at));
  return { required: required.length, approved: required.filter((approval) => approval.status === 'approved').length, waived: required.filter((approval) => approval.status === 'waived').length, pending: pending.map((item) => item.role), rejected: rejected.map((item) => item.role), invalidApprovals: invalidApprovals.map((item) => item.role), complete: !pending.length && !rejected.length && !invalidApprovals.length };
}

export function effectivityApplies(effectivity, unit) {
  if (!effectivity) return false;
  if (effectivity.type === 'date') return Date.parse(unit.builtAt) >= Date.parse(effectivity.value);
  if (effectivity.type === 'serial') return String(unit.serial).localeCompare(String(effectivity.value), undefined, { numeric: true }) >= 0;
  if (effectivity.type === 'lot') return (effectivity.lots ?? [effectivity.value]).includes(unit.lot);
  throw new Error(`unsupported effectivity type ${effectivity.type}`);
}

function gates(change, target) {
  const failures = [];
  if (target === 'impact-review') { if (!change.affectedArtifacts.length) failures.push('affected-artifact-required'); if (!change.risk) failures.push('risk-assessment-required'); else try { riskScore(change.risk); } catch { failures.push('risk-assessment-invalid'); } }
  if (target === 'approval') { if (!impactClosure(change).complete) failures.push('impact-closure-incomplete'); if (!recommendRevision(change).matches) failures.push('revision-mismatch'); if (!change.approvals.some((approval) => approval.required !== false)) failures.push('approval-matrix-required'); }
  if (target === 'implementation') { const summary = approvalSummary(change); if (!summary.complete) failures.push('approvals-incomplete'); if (!change.implementationTasks.length) failures.push('implementation-plan-required'); }
  if (target === 'verification') { if (change.implementationTasks.some((task) => task.status !== 'complete')) failures.push('implementation-incomplete'); if (!change.verification.length) failures.push('verification-plan-required'); }
  if (target === 'released') {
    if (change.verification.some((item) => item.status !== 'passed')) failures.push('verification-incomplete');
    const evidenceIds = new Set(change.evidence.map((item) => item.id)); if (change.verification.some((item) => !(item.evidenceIds?.length) || item.evidenceIds.some((id) => !evidenceIds.has(id)))) failures.push('verification-evidence-missing');
    if (!change.effectivity?.type || !change.effectivity?.value || !change.effectivity?.oldStockDisposition) failures.push('effectivity-required');
    if (!change.release?.approvedBy || !change.release?.approvedAt) failures.push('release-approval-required');
  }
  return failures;
}

export function transition(change, target, metadata = {}) {
  if (!STATUSES.includes(target)) throw new Error(`invalid target ${target}`); const current = STATUSES.indexOf(change.status); const next = STATUSES.indexOf(target);
  if (target !== 'cancelled' && next !== current + 1) throw new Error(`cannot transition ${change.status} to ${target}`); if (target === 'cancelled' && ['released', 'cancelled'].includes(change.status)) throw new Error(`cannot cancel ${change.status}`);
  const failures = gates(change, target); if (failures.length) throw new Error(`transition blocked: ${failures.join(', ')}`);
  return { ...structuredClone(change), status: target, history: [...change.history, { from: change.status, to: target, at: metadata.at ?? new Date().toISOString(), by: metadata.by ?? change.requestedBy, note: metadata.note ?? null }] };
}

export function rolloutReadiness(change) {
  const checks = { approvals: approvalSummary(change).complete, implementation: change.implementationTasks.length > 0 && change.implementationTasks.every((task) => task.status === 'complete'), verification: change.verification.length > 0 && change.verification.every((item) => item.status === 'passed'), effectivity: Boolean(change.effectivity?.type && change.effectivity?.value && change.effectivity?.oldStockDisposition), revision: recommendRevision(change).matches };
  return { ready: Object.values(checks).every(Boolean), checks, percent: round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100) };
}

export function compareChanges(before, after) {
  const fields = ['status', 'proposedRevision', 'effectivity']; const changes = fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
  const oldArtifacts = new Map(before.affectedArtifacts.map((item) => [item.id, item])); for (const item of after.affectedArtifacts) { if (!oldArtifacts.has(item.id)) changes.push({ field: 'artifact', id: item.id, kind: 'added' }); else if (JSON.stringify(oldArtifacts.get(item.id)) !== JSON.stringify(item)) changes.push({ field: 'artifact', id: item.id, kind: 'changed' }); oldArtifacts.delete(item.id); } for (const id of oldArtifacts.keys()) changes.push({ field: 'artifact', id, kind: 'removed' });
  return { changed: changes.length > 0, changes };
}

export function reportMarkdown(change) {
  const readiness = rolloutReadiness(change); const approvals = approvalSummary(change);
  const lines = ['# Engineering change order', '', `ECO: ${change.id} | Product: ${change.product} | Status: ${change.status}`, '', `Revision: ${change.currentRevision} -> ${change.proposedRevision} | Rollout readiness: ${readiness.percent}%`, '', `Approvals: ${approvals.approved}/${approvals.required} approved | Pending: ${approvals.pending.join(', ') || 'none'}`, '', '| Artifact | Type | From | To | Breaking | Change |', '| --- | --- | --- | --- | --- | --- |'];
  for (const item of change.affectedArtifacts) lines.push(`| ${item.id} | ${item.type} | ${item.fromVersion} | ${item.toVersion} | ${Boolean(item.breaking)} | ${item.change} |`);
  return `${lines.join('\n')}\n`;
}
