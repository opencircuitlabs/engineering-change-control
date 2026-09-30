import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalSummary, attachEvidence, compareChanges, createChange, effectivityApplies, impactClosure, recommendRevision, reportMarkdown, riskScore, rolloutReadiness, transition, validateChange, verifyEvidence } from '../src/index.js';

function base() {
  return createChange({ id: 'E1', title: 'Update regulator', reason: 'margin', requestedBy: 'eng', openedAt: '2026-10-01', product: 'board', changeClass: 'minor', currentRevision: '1.2.3', proposedRevision: '1.3.0' });
}
function ready() {
  let change = base();
  change.affectedArtifacts = [{ id: 'sch', type: 'design', fromVersion: 'A', toVersion: 'B', change: 'regulator', direct: true }, { id: 'pcb', type: 'design', fromVersion: 'A', toVersion: 'B', change: 'routing', direct: false }];
  change.dependencies = [{ from: 'sch', to: 'pcb', relation: 'implements' }]; change.impacts = { formFitFunction: 'unchanged', interchangeability: true, manufacturing: 'changed' }; change.risk = { severity: 7, likelihood: 3, detection: 3 };
  change.approvals = [{ role: 'hardware', required: true, status: 'approved', by: 'lead', at: '2026-10-02' }]; change.implementationTasks = [{ id: 'T1', description: 'update', owner: 'eng', status: 'complete' }]; change.verification = [{ id: 'V1', requirement: 'works', method: 'test', status: 'passed', evidenceIds: ['EV1'] }];
  change = attachEvidence(change, { id: 'EV1', title: 'test', source: 'lab', timestamp: '2026-10-03' }, 'pass'); change.effectivity = { type: 'serial', value: 'SN100', oldStockDisposition: 'rework' }; change.release = { approvedBy: 'quality', approvedAt: '2026-10-04' };
  return change;
}

test('creates normalized draft changes', () => { const change = base(); assert.equal(change.status, 'draft'); assert.deepEqual(change.history, []); });
test('validates required change and artifact fields', () => {
  const result = validateChange({ status: 'bad', affectedArtifacts: [{ id: 'x' }, { id: 'x' }], dependencies: [{ from: 'x', to: 'missing' }], approvals: [{ role: 'a', status: 'bad' }, { role: 'a', status: 'pending' }] }); assert.ok(result.issues.length >= 14);
});
test('accepts a structurally valid engineering change', () => assert.equal(validateChange(ready()).valid, true));
test('attaches and verifies content-addressed evidence', () => {
  const change = attachEvidence(base(), { id: 'EV', title: 'result', source: 'lab', timestamp: '2026-10-01' }, 'abc'); assert.equal(change.evidence[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); assert.equal(verifyEvidence(change, [{ id: 'EV', content: 'abc' }]).valid, true); assert.equal(verifyEvidence(change, [{ id: 'EV', content: 'bad' }]).differences[0].kind, 'changed');
});
test('rejects duplicate or empty evidence', () => {
  const change = attachEvidence(base(), { id: 'EV', title: 'x', source: 'a', timestamp: '2026-10-01' }, 'x'); assert.throws(() => attachEvidence(change, { id: 'EV', title: 'x', source: 'a', timestamp: '2026-10-01' }, 'x'), /duplicate/); assert.throws(() => attachEvidence(base(), { id: 'X', title: 'x', source: 'a', timestamp: '2026-10-01' }, ''), /empty/);
});
test('computes transitive impact closure', () => {
  const change = ready(); change.affectedArtifacts.push({ id: 'bom', type: 'manufacturing', fromVersion: '1', toVersion: '2', change: 'MPN', direct: false }); change.dependencies.push({ from: 'pcb', to: 'bom', relation: 'drives' }); const closure = impactClosure(change, ['sch']); assert.deepEqual(closure.impacted.map((item) => item.id), ['sch', 'pcb', 'bom']); assert.equal(closure.impacted[2].depth, 2);
});
test('reports dependency targets absent from artifact inventory', () => {
  const change = ready(); change.dependencies.push({ from: 'pcb', to: 'unknown', relation: 'drives' }); const closure = impactClosure(change, ['sch']); assert.deepEqual(closure.missing, ['unknown']); assert.equal(closure.complete, false);
});
test('recommends semantic major, minor, and patch revisions', () => {
  const minor = ready(); assert.equal(recommendRevision(minor).recommended, '1.3.0'); const major = ready(); major.affectedArtifacts[0].breaking = true; assert.equal(recommendRevision(major).recommended, '2.0.0'); const patch = base(); patch.changeClass = 'patch'; patch.proposedRevision = '1.2.4'; assert.equal(recommendRevision(patch).recommended, '1.2.4');
});
test('rejects malformed semantic versions', () => { const change = base(); change.currentRevision = 'A'; assert.throws(() => recommendRevision(change), /invalid semantic/); });
test('scores high, medium, and low change risks', () => {
  assert.equal(riskScore({ severity: 10, likelihood: 2, detection: 2 }).level, 'high'); assert.equal(riskScore({ severity: 5, likelihood: 5, detection: 4 }).level, 'medium'); assert.equal(riskScore({ severity: 2, likelihood: 2, detection: 2 }).level, 'low'); assert.throws(() => riskScore({ severity: 0, likelihood: 1, detection: 1 }), /1-10/);
});
test('summarizes pending, rejected, waived, and invalid approvals', () => {
  const change = base(); change.approvals = [{ role: 'a', status: 'approved', required: true }, { role: 'b', status: 'pending', required: true }, { role: 'c', status: 'rejected', required: true }, { role: 'd', status: 'waived', required: true }]; const result = approvalSummary(change); assert.deepEqual(result.pending, ['b']); assert.deepEqual(result.rejected, ['c']); assert.deepEqual(result.invalidApprovals, ['a']); assert.equal(result.complete, false);
});
test('evaluates date, serial, and lot effectivity', () => {
  assert.equal(effectivityApplies({ type: 'date', value: '2026-10-01' }, { builtAt: '2026-10-02' }), true); assert.equal(effectivityApplies({ type: 'serial', value: 'SN100' }, { serial: 'SN99' }), false); assert.equal(effectivityApplies({ type: 'lot', value: 'L1' }, { lot: 'L1' }), true); assert.throws(() => effectivityApplies({ type: 'bad' }, {}), /unsupported/);
});
test('gates impact review on artifacts and risk', () => {
  assert.throws(() => transition(base(), 'impact-review'), /affected-artifact-required/); const change = ready(); change.status = 'draft'; assert.equal(transition(change, 'impact-review').status, 'impact-review');
});
test('gates approval on impact closure, revision, and matrix', () => {
  const change = ready(); change.status = 'impact-review'; change.proposedRevision = '1.2.4'; assert.throws(() => transition(change, 'approval'), /revision-mismatch/); change.proposedRevision = '1.3.0'; change.approvals = []; assert.throws(() => transition(change, 'approval'), /approval-matrix-required/);
});
test('gates implementation on complete approvals and task plan', () => {
  const change = ready(); change.status = 'approval'; change.approvals[0].status = 'pending'; assert.throws(() => transition(change, 'implementation'), /approvals-incomplete/); change.approvals[0] = { role: 'hardware', required: true, status: 'approved', by: 'lead', at: '2026-10-02' }; change.implementationTasks = []; assert.throws(() => transition(change, 'implementation'), /implementation-plan-required/);
});
test('gates verification on completed implementation and plan', () => {
  const change = ready(); change.status = 'implementation'; change.implementationTasks[0].status = 'open'; assert.throws(() => transition(change, 'verification'), /implementation-incomplete/); change.implementationTasks[0].status = 'complete'; change.verification = []; assert.throws(() => transition(change, 'verification'), /verification-plan-required/);
});
test('gates release on passed evidence, effectivity, and approval', () => {
  const change = ready(); change.status = 'verification'; change.verification[0].status = 'failed'; assert.throws(() => transition(change, 'released'), /verification-incomplete/); change.verification[0].status = 'passed'; change.verification[0].evidenceIds = ['missing']; assert.throws(() => transition(change, 'released'), /verification-evidence-missing/); change.verification[0].evidenceIds = ['EV1']; assert.equal(transition(change, 'released').status, 'released');
});
test('records sequential transitions and controlled cancellation', () => {
  let change = ready(); change.status = 'draft'; change = transition(change, 'impact-review', { at: '2026-10-01', by: 'eng' }); change = transition(change, 'approval'); assert.equal(change.history.length, 2); const cancelled = transition(change, 'cancelled'); assert.equal(cancelled.status, 'cancelled'); assert.throws(() => transition(cancelled, 'cancelled'), /cannot cancel/);
});
test('calculates rollout readiness checks', () => {
  const complete = rolloutReadiness(ready()); assert.equal(complete.ready, true); assert.equal(complete.percent, 100); const incomplete = ready(); incomplete.approvals[0].status = 'pending'; assert.equal(rolloutReadiness(incomplete).ready, false); assert.equal(incomplete.status, 'draft');
});
test('compares field and artifact changes', () => {
  const before = ready(); const after = structuredClone(before); after.status = 'approval'; after.affectedArtifacts[0].toVersion = 'C'; after.affectedArtifacts.push({ id: 'bom', type: 'manufacturing', fromVersion: '1', toVersion: '2', change: 'x' }); const result = compareChanges(before, after); assert.ok(result.changes.some((item) => item.field === 'status')); assert.ok(result.changes.some((item) => item.kind === 'changed')); assert.ok(result.changes.some((item) => item.kind === 'added'));
});
test('renders revision, approvals, readiness, and artifacts', () => {
  const markdown = reportMarkdown(ready()); assert.match(markdown, /Engineering change order/); assert.match(markdown, /1.2.3 -> 1.3.0/); assert.match(markdown, /Rollout readiness: 100%/); assert.match(markdown, /\| sch \| design/);
});
