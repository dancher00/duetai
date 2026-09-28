# Contributing to DuetAI

Useful contributions start with a task someone actually tried: a setup failure, a review that caught a bug, or a case where the second agent added no value. [Share your experience](https://github.com/dancher00/duetai/issues/new?template=feedback.yml).

For code changes, open an issue for a large feature first. Keep smaller fixes focused, preserve the single-command workflow, and add a regression test when fixing behavior.

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:install
```

When changing packaged files, regenerate the download before the installation check:

```bash
npm pack --pack-destination docs
```

The installation check verifies that the served archive matches the source.

These checks need no agent accounts. `duet --demo` uses scripted agents and real tests in a temporary directory. Real benchmarks consume model usage and are not part of CI.

Please label scripted demonstrations as scripted, keep unsuccessful benchmark runs in reports, and do not claim quality or cost improvements without evidence. Never include `.duet/`, credentials, or private project files in a contribution.
