#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { approvalSummary, compareChanges, effectivityApplies, impactClosure, recommendRevision, reportMarkdown, riskScore, rolloutReadiness, transition, validateChange, verifyEvidence } from './index.js';
const raw = process.argv.slice(2); const [command, first, second] = raw; const option = (name) => { const index = raw.indexOf(`--${name}`); return index < 0 ? undefined : raw[index + 1]; }; const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const emit = async (value) => { const text = `${JSON.stringify(value, null, 2)}\n`; if (option('output')) await writeFile(option('output'), text); else process.stdout.write(text); };
try {
  if (!command || command === 'help') process.stdout.write('Usage: engineering-change-control <validate|impact|revision|risk|approvals|readiness|report> change.json | transition change.json status | effectivity effectivity.json unit.json | compare before.json after.json | verify-evidence change.json contents.json [--output file]\n');
  else if (command === 'validate' && first) { const result = validateChange(await load(first)); await emit(result); if (!result.valid) process.exitCode = 2; }
  else if (command === 'impact' && first) await emit(impactClosure(await load(first)));
  else if (command === 'revision' && first) await emit(recommendRevision(await load(first)));
  else if (command === 'risk' && first) await emit(riskScore((await load(first)).risk));
  else if (command === 'approvals' && first) await emit(approvalSummary(await load(first)));
  else if (command === 'readiness' && first) await emit(rolloutReadiness(await load(first)));
  else if (command === 'transition' && first && second) await emit(transition(await load(first), second, { at: option('at'), by: option('by'), note: option('note') }));
  else if (command === 'effectivity' && first && second) await emit({ applies: effectivityApplies(await load(first), await load(second)) });
  else if (command === 'compare' && first && second) await emit(compareChanges(await load(first), await load(second)));
  else if (command === 'verify-evidence' && first && second) await emit(verifyEvidence(await load(first), await load(second)));
  else if (command === 'report' && first) { const text = reportMarkdown(await load(first)); if (option('output')) await writeFile(option('output'), text); else process.stdout.write(text); }
  else throw new Error('invalid command or arguments');
} catch (error) { process.stderr.write(`engineering-change-control: ${error.message}\n`); process.exitCode = 1; }
