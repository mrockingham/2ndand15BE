# API-Sports provider evaluation

Generated: 2026-08-01T16:00:00.000Z

This report contains sanitized summaries only. Values marked unavailable or untested are not verified provider capabilities. No raw payloads, request headers, provider IDs, or credentials are included.

## Findings

- **PASS — HISTORICAL_DATA_SUITABILITY:** The configured access returned 32 mapped NFL teams and 256 validated 2024 regular-season games.
- **FAILURE — CURRENT_SEASON_SUITABILITY:** The configured access exposed no 2026 NFL games and is not suitable as the current-season provider.
- **WARNING — PLAN_ACCESS:** The configured plan rejected the 2025 NFL season.
- **WARNING — RECORD_VALIDATION:** Sixteen 2024 records were rejected because their short status values were blank.
- **WARNING — PLAY_BY_PLAY_SUITABILITY:** Live play-by-play endpoint and field coverage were not evaluated.
- **PASS — CREDENTIAL_SAFETY:** The report contains no credential, raw authorization data, or complete provider payload.

## Structured evidence

```json
{
  "providerName": "API-Sports",
  "availableNflSeasons": {
    "state": "verified",
    "value": [2024],
    "note": "2024 was the only verified accessible season in this evaluation."
  },
  "currentSeasonAvailability": {
    "state": "verified",
    "value": false,
    "note": "No 2026 games were exposed by the configured access."
  },
  "teamCount": {
    "state": "verified",
    "value": 32,
    "note": "Thirty-two provider teams matched the existing internal NFL catalog without duplication."
  },
  "gameCountBySeasonType": {
    "2024": {
      "PRE": {
        "state": "untested",
        "value": null,
        "note": "Preseason persistence was outside the limited hosted synchronization."
      },
      "REG": {
        "state": "verified",
        "value": 256,
        "note": "Validated and synchronized idempotently."
      },
      "POST": {
        "state": "untested",
        "value": null,
        "note": "Postseason persistence was outside the limited hosted synchronization."
      }
    },
    "2025": {
      "PRE": {
        "state": "unavailable",
        "value": null,
        "note": "The configured plan rejected this season."
      },
      "REG": {
        "state": "unavailable",
        "value": null,
        "note": "The configured plan rejected this season."
      },
      "POST": {
        "state": "unavailable",
        "value": null,
        "note": "The configured plan rejected this season."
      }
    },
    "2026": {
      "PRE": {
        "state": "verified",
        "value": 0,
        "note": "No games were exposed."
      },
      "REG": {
        "state": "verified",
        "value": 0,
        "note": "No games were exposed."
      },
      "POST": {
        "state": "verified",
        "value": 0,
        "note": "No games were exposed."
      }
    }
  },
  "earliestGameDate": {
    "state": "untested",
    "value": null,
    "note": "A sanitized date-range aggregate was not captured during the approved verification."
  },
  "latestGameDate": {
    "state": "untested",
    "value": null,
    "note": "A sanitized date-range aggregate was not captured during the approved verification."
  },
  "statusValuesObserved": {
    "state": "verified",
    "value": ["FINAL"],
    "note": "The 256 accepted 2024 regular-season records normalized to FINAL; 16 blank short statuses were rejected."
  },
  "requiredFieldCoverage": {
    "state": "verified",
    "value": {
      "providerGameId": { "present": 256, "total": 256, "percentage": 100 },
      "season": { "present": 256, "total": 256, "percentage": 100 },
      "seasonType": { "present": 256, "total": 256, "percentage": 100 },
      "startTime": { "present": 256, "total": 256, "percentage": 100 },
      "status": { "present": 256, "total": 256, "percentage": 100 },
      "homeProviderTeamId": { "present": 256, "total": 256, "percentage": 100 },
      "awayProviderTeamId": { "present": 256, "total": 256, "percentage": 100 }
    },
    "note": "Coverage reflects accepted normalized 2024 regular-season records before provider IDs are removed from public DTOs."
  },
  "nullableFieldCoverage": {
    "state": "untested",
    "value": null,
    "note": "Per-field nullable coverage totals were not retained during the approved verification."
  },
  "playByPlayEndpointAvailability": {
    "state": "untested",
    "value": null,
    "note": "No play-by-play endpoint request was made."
  },
  "playByPlayFieldCoverage": {
    "state": "untested",
    "value": null,
    "note": "No play-by-play fields were inspected."
  },
  "estimatedRequestCount": 4,
  "evaluationTimestamp": "2026-08-01T16:00:00.000Z",
  "findings": [
    {
      "level": "pass",
      "code": "HISTORICAL_DATA_SUITABILITY",
      "message": "Historical NFL data is suitable for development and historical queries.",
      "evidenceState": "verified"
    },
    {
      "level": "failure",
      "code": "CURRENT_SEASON_SUITABILITY",
      "message": "Current-season NFL game data is not available.",
      "evidenceState": "verified"
    },
    {
      "level": "warning",
      "code": "RECORD_VALIDATION",
      "message": "Sixteen provider records had blank short statuses and were rejected.",
      "evidenceState": "verified"
    },
    {
      "level": "warning",
      "code": "PLAY_BY_PLAY_SUITABILITY",
      "message": "Live play-by-play suitability was not evaluated.",
      "evidenceState": "untested"
    }
  ]
}
```

## Credential note

A real-looking API key previously appeared in `.env.example`. The example now contains only a blank placeholder and `.env` remains ignored. Rotate the provider key manually as a precaution; this repository does not attempt credential rotation.
