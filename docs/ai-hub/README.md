# AI Hub weekly predictions

Milestone 24 adds provider-neutral, versioned NFL game predictions. `baseline-v1` owns every probability, projected score, confidence level, and factor. OpenAI is optional and may only explain the fixed result; provider failure or rejected prose never invalidates the numerical prediction.

Public prediction routes are under `/api/v1/ai-hub`. They return only explicitly published, non-retrospective latest revisions. Feature snapshots, data-availability internals, actor data, AI provider/model/token/timing data, and audits remain private.

Milestone 24.1 adds the read-only `/weekly-insights` composition endpoint. It derives ranked game and team intelligence from those same public-eligible snapshots; see [weekly-insights.md](weekly-insights.md) for the contract and formulas.

Admin generation defaults to dry-run. A single game uses `gameId`; a bounded weekly run uses `season`, `seasonType`, and `week` (nullable for a special preseason game). Set `dryRun: false` to create a new immutable revision, then publish it explicitly. Generation after kickoff is rejected unless `retrospective: true`; retrospective records can never be published.

CLI examples:

```text
npm run predictions -- generate --game <uuid>
npm run predictions -- generate --game <uuid> --write
npm run predictions -- publish --prediction <prediction-uuid>
npm run predictions -- generate --season 2026 --type PRE --week 1
npm run predictions -- backtest --season 2025 --type REG
npm run predictions -- evaluate
```

No scheduler, queue, worker, provider call, betting input, injury input, weather input, or frontend behavior is included.
