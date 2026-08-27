# API-Sports provider evaluation

Generated: 2026-08-21T19:13:45.512Z

This report contains sanitized summaries only. Values marked unavailable or untested are not verified provider capabilities.

## Findings

- **FAILURE — HISTORICAL_DATA_SUITABILITY:** No validated historical NFL game data was available.
- **FAILURE — CURRENT_SEASON_SUITABILITY:** Validated current-season NFL games are not available.
- **PASS — RECORD_VALIDATION:** No provider records failed normalization.
- **WARNING — PLAY_BY_PLAY_SUITABILITY:** Live play-by-play suitability was not evaluated.

## Structured evidence

```json
{
  "providerName": "API-Sports",
  "availableNflSeasons": {
    "state": "verified",
    "value": [],
    "note": "Evaluated candidate seasons: 2026."
  },
  "currentSeasonAvailability": {
    "state": "unavailable",
    "value": null,
    "note": "The configured current season could not be evaluated."
  },
  "teamCount": {
    "state": "unavailable",
    "value": null,
    "note": "The team endpoint could not be evaluated."
  },
  "gameCountBySeasonType": {
    "2026": {
      "PRE": {
        "state": "unavailable",
        "value": null,
        "note": "Season data was unavailable."
      },
      "REG": {
        "state": "unavailable",
        "value": null,
        "note": "Season data was unavailable."
      },
      "POST": {
        "state": "unavailable",
        "value": null,
        "note": "Season data was unavailable."
      }
    }
  },
  "earliestGameDate": {
    "state": "unavailable",
    "value": null,
    "note": "No validated game dates were available."
  },
  "latestGameDate": {
    "state": "unavailable",
    "value": null,
    "note": "No validated game dates were available."
  },
  "statusValuesObserved": {
    "state": "unavailable",
    "value": null,
    "note": "No validated games were available for status inspection."
  },
  "requiredFieldCoverage": {
    "state": "unavailable",
    "value": null,
    "note": "No validated games were available for field inspection."
  },
  "nullableFieldCoverage": {
    "state": "unavailable",
    "value": null,
    "note": "No validated games were available for nullable-field inspection."
  },
  "playByPlayEndpointAvailability": {
    "state": "untested",
    "value": null,
    "note": "Play-by-play was outside this evaluation and no endpoint call was made."
  },
  "playByPlayFieldCoverage": {
    "state": "untested",
    "value": null,
    "note": "Play-by-play fields were outside this evaluation."
  },
  "estimatedRequestCount": 2,
  "evaluationTimestamp": "2026-08-21T19:13:45.512Z",
  "findings": [
    {
      "level": "failure",
      "code": "HISTORICAL_DATA_SUITABILITY",
      "message": "No validated historical NFL game data was available.",
      "evidenceState": "verified"
    },
    {
      "level": "failure",
      "code": "CURRENT_SEASON_SUITABILITY",
      "message": "Validated current-season NFL games are not available.",
      "evidenceState": "unavailable"
    },
    {
      "level": "pass",
      "code": "RECORD_VALIDATION",
      "message": "No provider records failed normalization.",
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
