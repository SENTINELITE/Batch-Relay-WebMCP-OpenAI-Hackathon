# Creative submission checklist

The implementation baseline is `84ce0052474c011dcf8533a325cb17b3dc106a4d`.
Record new-work provenance, sample-asset permissions, the exact repository
URL, and the demo URL in a private evidence record before submitting.

Run:

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
node --test tests/creative-webmcp.test.mjs
```

Then verify in a fresh browser that `/creative` loads, all nine tools register
only on that route, ordinary controls still complete the flow, and a live
background proposal shows an estimate before any human approval. Confirm both
downloaded PNG dimensions: 1080 × 1350 and 1920 × 1080. Confirm a failed or
abandoned job leaves the last approved composition usable and that retrying a
browser request does not submit a second provider job.

The official references are the [event page](https://atumera.com/hackathon)
and [submission form](https://atumera.com/hackathon/submit). Eligibility and
submission status remain unverified until the organizer confirms reuse of the
existing project, minimum new work, repository visibility/licensing, judging
criteria, participant authentication, and the saved receipt. Do not place a
restricted participant endpoint or credentials in tracked files, screenshots,
video, or public issue text.
