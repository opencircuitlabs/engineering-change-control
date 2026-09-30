# Engineering Change Control

`engineering-change-control` is an auditable ECO workflow for electronics products. It traces direct and transitive artifact impact, recommends revision level, scores change risk, enforces approval and implementation gates, verifies objective evidence, and defines exactly which units receive a released change.

## Capabilities

- Structured product, reason, requester, revision, and change classification
- Affected schematic, PCB, BOM, firmware, test, manufacturing, and document artifacts
- Directed dependency graph and transitive impact closure
- Semantic major/minor/patch recommendation from compatibility impacts
- Severity/likelihood/detection risk scoring
- Required approval matrix with identity and timestamp checks
- Sequential draft-to-release state machine and controlled cancellation
- Implementation task completion gate
- Verification requirement, result, and content-addressed evidence gate
- Serial-, date-, or lot-based effectivity evaluation
- Old-stock disposition and release approval requirements
- Rollout readiness score and ECO revision comparison
- JSON and Markdown outputs with no runtime dependencies

## Quick start

```bash
npm install
npm test
node src/cli.js validate examples/change.json
node src/cli.js impact examples/change.json
node src/cli.js revision examples/change.json
node src/cli.js approvals examples/change.json
node src/cli.js readiness examples/change.json
node src/cli.js report examples/change.json --output eco-report.md
```

After global installation, use `engineering-change-control` instead of `node src/cli.js`.

## Workflow

```text
draft -> impact-review -> approval -> implementation -> verification -> released
```

Each forward transition is gated. Approval requires complete impact closure, the recommended revision, and a required approval matrix. Implementation requires signed approvals and owned tasks. Release requires completed implementation, passed verification linked to known evidence, effectivity, old-stock disposition, and release approval.

```js
import { impactClosure, recommendRevision, transition, effectivityApplies } from '@opencircuitlabs/engineering-change-control';

const impact = impactClosure(change, ['schematic']);
const revision = recommendRevision(change);
const released = transition(verifiedChange, 'released', { by: 'quality-manager' });
```

## Governance scope

The engine enforces declared relationships and approvals; it cannot discover an artifact omitted from the dependency graph or judge whether verification is technically sufficient. Maintain the graph, apply safety/regulatory configuration controls, obtain appropriate domain approvals, and retain signed records in the system of record.

## License

MIT. See [LICENSE](LICENSE).
