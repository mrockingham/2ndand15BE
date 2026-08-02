# Highlightly NFL provider evaluation

Generated: 2026-08-01T18:49:22.816Z

Official documentation: https://highlightly.net/nfl-api/documentation/ (version 8.1.5, OpenAPI 3.0.0)

This report contains sanitized aggregates and limited team identifiers only. It contains no raw payloads, account identifiers, credentials, or authorization headers.

## Findings

- **PASS - CURRENT_SEASON_SUITABILITY:** Highlightly returned 49 validated 2026 NFL schedule records.
- **PASS - TEAM_MAPPING:** 32 of 32 current NFL teams mapped deterministically.
- **PASS - SCHEDULE_PAGINATION:** The bounded schedule retrieval was complete.
- **PASS - RECORD_VALIDATION:** All inspected team and schedule records passed runtime validation.
- **WARNING - PRIMARY_PROVIDER_RECOMMENDATION:** Current-season technical suitability was classified as passed with warnings.
- **WARNING - LICENSING_CONFIRMATION_REQUIRED:** Published terms do not grant publication or logo rights; written rights confirmation is required.
- **WARNING - LIVE_LATENCY_UNVERIFIED:** Live latency and correction behavior were not directly tested.

## Final recommendation

Do not promote Highlightly to the primary provider yet. Technical schedule suitability is passed with warnings, Level 2 animation is partially supported, and published terms require written publication, storage, transformation, and logo-rights confirmation.

## Structured evidence

```json
{
  "summary": {
    "providerName": "Highlightly",
    "availableNflSeasons": {
      "state": "verified",
      "value": [2025, 2026],
      "note": null
    },
    "currentSeasonAvailability": {
      "state": "verified",
      "value": true,
      "note": null
    },
    "teamCount": {
      "state": "verified",
      "value": 34,
      "note": null
    },
    "gameCountBySeasonType": {
      "2026": {
        "PRE": {
          "state": "verified",
          "value": 49,
          "note": null
        },
        "REG": {
          "state": "verified",
          "value": 0,
          "note": null
        },
        "POST": {
          "state": "verified",
          "value": 0,
          "note": null
        }
      }
    },
    "earliestGameDate": {
      "state": "verified",
      "value": "2026-08-07T00:00:00.000Z",
      "note": null
    },
    "latestGameDate": {
      "state": "verified",
      "value": "2026-08-29T22:00:00.000Z",
      "note": null
    },
    "statusValuesObserved": {
      "state": "verified",
      "value": ["Scheduled"],
      "note": null
    },
    "requiredFieldCoverage": {
      "state": "verified",
      "value": {
        "providerGameId": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "season": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "seasonType": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "startTime": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "status": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "homeTeam": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "awayTeam": {
          "present": 49,
          "total": 49,
          "percentage": 100
        }
      },
      "note": null
    },
    "nullableFieldCoverage": {
      "state": "verified",
      "value": {
        "scores": {
          "present": 0,
          "total": 49,
          "percentage": 0
        },
        "quarter": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "clock": {
          "present": 49,
          "total": 49,
          "percentage": 100
        },
        "venue": {
          "present": 1,
          "total": 1,
          "percentage": 100
        },
        "neutralSite": {
          "present": 0,
          "total": 1,
          "percentage": 0
        },
        "broadcast": {
          "present": 0,
          "total": 1,
          "percentage": 0
        },
        "providerLastUpdatedAt": {
          "present": 0,
          "total": 1,
          "percentage": 0
        }
      },
      "note": null
    },
    "playByPlayEndpointAvailability": {
      "state": "verified",
      "value": true,
      "note": null
    },
    "playByPlayFieldCoverage": {
      "state": "verified",
      "value": {
        "playId": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "playSequence": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "driveId": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "quarter": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "gameClock": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "down": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "distance": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "possession": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "yardLine": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "sideOfField": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "startPosition": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "endPosition": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "playType": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "description": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "yardsGained": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "firstDown": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "scoringResult": {
          "present": 201,
          "total": 201,
          "percentage": 100
        },
        "touchdown": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "passDirection": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "passDepth": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "rushDirection": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "passer": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "receiverOrTarget": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "rusher": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "tacklers": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "sackParticipants": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "interceptionParticipants": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "fumbleParticipants": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "recoveryParticipants": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "penalties": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "kickDetails": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "puntDetails": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "reviewsOrOverturns": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "correctionOrDeletion": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "teamStatistics": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "playerStatistics": {
          "present": 0,
          "total": 201,
          "percentage": 0
        },
        "trackingCoordinates": {
          "present": 0,
          "total": 201,
          "percentage": 0
        }
      },
      "note": null
    },
    "estimatedRequestCount": 26,
    "evaluationTimestamp": "2026-08-01T18:49:22.816Z",
    "findings": [
      {
        "level": "pass",
        "code": "CURRENT_SEASON_SUITABILITY",
        "message": "Highlightly returned 49 validated 2026 NFL schedule records.",
        "evidenceState": "verified"
      },
      {
        "level": "pass",
        "code": "TEAM_MAPPING",
        "message": "32 of 32 current NFL teams mapped deterministically.",
        "evidenceState": "verified"
      },
      {
        "level": "pass",
        "code": "SCHEDULE_PAGINATION",
        "message": "The bounded schedule retrieval was complete.",
        "evidenceState": "verified"
      },
      {
        "level": "pass",
        "code": "RECORD_VALIDATION",
        "message": "All inspected team and schedule records passed runtime validation.",
        "evidenceState": "verified"
      },
      {
        "level": "warning",
        "code": "PRIMARY_PROVIDER_RECOMMENDATION",
        "message": "Current-season technical suitability was classified as passed with warnings.",
        "evidenceState": "verified"
      },
      {
        "level": "warning",
        "code": "LICENSING_CONFIRMATION_REQUIRED",
        "message": "Published terms do not grant publication or logo rights; written rights confirmation is required.",
        "evidenceState": "verified"
      },
      {
        "level": "warning",
        "code": "LIVE_LATENCY_UNVERIFIED",
        "message": "Live latency and correction behavior were not directly tested.",
        "evidenceState": "untested"
      }
    ]
  },
  "documentation": {
    "version": "8.1.5",
    "openApiVersion": "3.0.0",
    "documentationUrl": "https://highlightly.net/nfl-api/documentation/",
    "evaluatedAt": "2026-08-01T18:49:22.816Z",
    "requiredEndpoints": [
      "/teams",
      "/matches",
      "/matches/{id}",
      "/standings",
      "/lineups/{matchId}",
      "/players",
      "/players/{id}/statistics",
      "/box-score/{matchId}"
    ]
  },
  "accountPlan": "BASIC",
  "requestCount": 26,
  "nflLeagueIdentifier": "NFL",
  "availableSeasons": [2025, 2026],
  "currentSeasonSuitability": "passed_with_warnings",
  "teams": {
    "returned": 34,
    "malformedRecords": 0,
    "uniqueIds": 34,
    "deterministicallyMapped": 32,
    "allCurrentTeamsMapped": true,
    "logoUrlPresent": 34,
    "cityAndNameSeparated": false,
    "conferenceAvailable": false,
    "divisionAvailable": false,
    "inactiveOrHistoricTeamsObserved": 2,
    "records": [
      {
        "providerTeamId": "92732",
        "fullName": "Kansas City Chiefs",
        "abbreviation": "KC",
        "mappedInternalAbbreviation": "KC",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92733",
        "fullName": "Chicago Bears",
        "abbreviation": "CHI",
        "mappedInternalAbbreviation": "CHI",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92735",
        "fullName": "Miami Dolphins",
        "abbreviation": "MIA",
        "mappedInternalAbbreviation": "MIA",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92738",
        "fullName": "Las Vegas Raiders",
        "abbreviation": "LV",
        "mappedInternalAbbreviation": "LV",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92739",
        "fullName": "San Francisco 49ers",
        "abbreviation": "SF",
        "mappedInternalAbbreviation": "SF",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92741",
        "fullName": "Carolina Panthers",
        "abbreviation": "CAR",
        "mappedInternalAbbreviation": "CAR",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92744",
        "fullName": "Seattle Seahawks",
        "abbreviation": "SEA",
        "mappedInternalAbbreviation": "SEA",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92745",
        "fullName": "Cleveland Browns",
        "abbreviation": "CLE",
        "mappedInternalAbbreviation": "CLE",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92748",
        "fullName": "Houston Texans",
        "abbreviation": "HOU",
        "mappedInternalAbbreviation": "HOU",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92749",
        "fullName": "Los Angeles Rams",
        "abbreviation": "LAR",
        "mappedInternalAbbreviation": "LAR",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92751",
        "fullName": "Minnesota Vikings",
        "abbreviation": "MIN",
        "mappedInternalAbbreviation": "MIN",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92753",
        "fullName": "New York Giants",
        "abbreviation": "NYG",
        "mappedInternalAbbreviation": "NYG",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92755",
        "fullName": "Pittsburgh Steelers",
        "abbreviation": "PIT",
        "mappedInternalAbbreviation": "PIT",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92765",
        "fullName": "Arizona Cardinals",
        "abbreviation": "ARI",
        "mappedInternalAbbreviation": "ARI",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92767",
        "fullName": "New England Patriots",
        "abbreviation": "NE",
        "mappedInternalAbbreviation": "NE",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92769",
        "fullName": "Tennessee Titans",
        "abbreviation": "TEN",
        "mappedInternalAbbreviation": "TEN",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92730",
        "fullName": "Cincinnati Bengals",
        "abbreviation": "CIN",
        "mappedInternalAbbreviation": "CIN",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92731",
        "fullName": "Indianapolis Colts",
        "abbreviation": "IND",
        "mappedInternalAbbreviation": "IND",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92734",
        "fullName": "Tampa Bay Buccaneers",
        "abbreviation": "TB",
        "mappedInternalAbbreviation": "TB",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92736",
        "fullName": "Atlanta Falcons",
        "abbreviation": "ATL",
        "mappedInternalAbbreviation": "ATL",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92737",
        "fullName": "Jacksonville Jaguars",
        "abbreviation": "JAX",
        "mappedInternalAbbreviation": "JAX",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92740",
        "fullName": "Buffalo Bills",
        "abbreviation": "BUF",
        "mappedInternalAbbreviation": "BUF",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92742",
        "fullName": "Green Bay Packers",
        "abbreviation": "GB",
        "mappedInternalAbbreviation": "GB",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92743",
        "fullName": "Baltimore Ravens",
        "abbreviation": "BAL",
        "mappedInternalAbbreviation": "BAL",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92746",
        "fullName": "Dallas Cowboys",
        "abbreviation": "DAL",
        "mappedInternalAbbreviation": "DAL",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92747",
        "fullName": "Los Angeles Chargers",
        "abbreviation": "LAC",
        "mappedInternalAbbreviation": "LAC",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92750",
        "fullName": "Philadelphia Eagles",
        "abbreviation": "PHI",
        "mappedInternalAbbreviation": "PHI",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92752",
        "fullName": "New York Jets",
        "abbreviation": "NYJ",
        "mappedInternalAbbreviation": "NYJ",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92754",
        "fullName": "Detroit Lions",
        "abbreviation": "DET",
        "mappedInternalAbbreviation": "DET",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92764",
        "fullName": "Denver Broncos",
        "abbreviation": "DEN",
        "mappedInternalAbbreviation": "DEN",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92766",
        "fullName": "Washington Commanders",
        "abbreviation": "WSH",
        "mappedInternalAbbreviation": "WAS",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "92768",
        "fullName": "New Orleans Saints",
        "abbreviation": "NO",
        "mappedInternalAbbreviation": "NO",
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "96664",
        "fullName": "AFC",
        "abbreviation": "AFC",
        "mappedInternalAbbreviation": null,
        "logoUrlPresent": true
      },
      {
        "providerTeamId": "96665",
        "fullName": "NFC",
        "abbreviation": "NFC",
        "mappedInternalAbbreviation": null,
        "logoUrlPresent": true
      }
    ]
  },
  "schedule": {
    "season": 2026,
    "totalReported": 49,
    "retrieved": 49,
    "malformedRecords": 0,
    "paginationRequired": false,
    "paginationComplete": true,
    "countsBySeasonType": {
      "PRE": 49,
      "REG": 0,
      "POST": 0,
      "OTHER": 0
    },
    "earliestKickoff": "2026-08-07T00:00:00.000Z",
    "latestKickoff": "2026-08-29T22:00:00.000Z",
    "allKickoffsValidUtc": true,
    "uniqueTeamsObserved": 32,
    "scheduledGamesWithNullableScore": 0,
    "statusesObserved": ["Scheduled"],
    "exceptionalStatusesObserved": [],
    "documentedExceptionalStatuses": ["Postponed", "Suspended", "Cancelled", "Abandoned"],
    "rescheduledStatusDocumented": false
  },
  "gameFieldCoverage": {
    "providerGameId": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "Provider match ID."
    },
    "season": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "Explicit season field."
    },
    "seasonType": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "Derived from the round string; no dedicated season-type field is documented."
    },
    "week": {
      "state": "absent",
      "populated": 0,
      "total": 49,
      "note": "No dedicated week field is documented; some round strings may encode a week."
    },
    "startTime": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "ISO kickoff timestamp."
    },
    "status": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "State description or report."
    },
    "homeTeam": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "Home team record."
    },
    "awayTeam": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "Away team record."
    },
    "homeScore": {
      "state": "absent",
      "populated": 0,
      "total": 49,
      "note": "The list response exposes a combined score string, not separate home and away fields."
    },
    "awayScore": {
      "state": "absent",
      "populated": 0,
      "total": 49,
      "note": "The list response exposes a combined score string, not separate home and away fields."
    },
    "quarter": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "State period field."
    },
    "gameClock": {
      "state": "present_populated",
      "populated": 49,
      "total": 49,
      "note": "State clock field."
    },
    "venue": {
      "state": "present_populated",
      "populated": 1,
      "total": 1,
      "note": "Detailed-match sample."
    },
    "neutralSite": {
      "state": "absent",
      "populated": 0,
      "total": 1,
      "note": "Not present in the documented list response."
    },
    "broadcast": {
      "state": "absent",
      "populated": 0,
      "total": 1,
      "note": "Not present in the documented list response."
    },
    "lastUpdated": {
      "state": "absent",
      "populated": 0,
      "total": 1,
      "note": "Not present in the documented list response."
    }
  },
  "playByPlay": {
    "sourceEndpoint": "/matches/{id}",
    "completedGameInspected": true,
    "eventCount": 28,
    "playCount": 201,
    "appearsToBeDetailedPlayByPlay": false,
    "fields": {
      "playId": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play ID."
      },
      "playSequence": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Array order exists, but this field measures an explicit provider sequence."
      },
      "driveId": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Explicit play or event identifier."
      },
      "quarter": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play or enclosing-event period."
      },
      "gameClock": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play or enclosing-event clock."
      },
      "down": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "distance": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "possession": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play possession or enclosing-event team."
      },
      "yardLine": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play or enclosing-event start yard line."
      },
      "sideOfField": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play or enclosing-event field."
      },
      "startPosition": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Structured value or enclosing-event start yard line."
      },
      "endPosition": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Structured value or enclosing-event end yard line."
      },
      "playType": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Structured play type or enclosing-event result."
      },
      "description": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play text."
      },
      "yardsGained": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "firstDown": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "scoringResult": {
        "state": "present_populated",
        "populated": 201,
        "total": 201,
        "note": "Play or enclosing-event scoring flag."
      },
      "touchdown": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "passDirection": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "passDepth": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "rushDirection": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "passer": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participant."
      },
      "receiverOrTarget": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participant."
      },
      "rusher": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participant."
      },
      "tacklers": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participants."
      },
      "sackParticipants": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participants."
      },
      "interceptionParticipants": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participants."
      },
      "fumbleParticipants": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participants."
      },
      "recoveryParticipants": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured participants."
      },
      "penalties": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "kickDetails": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "puntDetails": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "reviewsOrOverturns": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured play field."
      },
      "correctionOrDeletion": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Structured correction indicator."
      },
      "teamStatistics": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Statistics attached to an individual play."
      },
      "playerStatistics": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Statistics attached to an individual play."
      },
      "trackingCoordinates": {
        "state": "absent",
        "populated": 0,
        "total": 201,
        "note": "Time-series player or football coordinates."
      }
    }
  },
  "animationSuitability": {
    "level1BasicField": {
      "state": "supported",
      "evidence": "directly_verified",
      "note": "Classification uses possession, field position, result/type, array order, and description coverage."
    },
    "level2DetailedReconstruction": {
      "state": "partially_supported",
      "evidence": "directly_verified",
      "note": "Requires structured down, distance, direction, participants, penalties, turnovers, and positions."
    },
    "level3ExactReplay": {
      "state": "unsupported",
      "evidence": "directly_verified",
      "note": "Exact replay requires time-series X/Y coordinates for every player and the football."
    }
  },
  "liveUpdate": [
    {
      "topic": "polling frequency",
      "value": "Match lists document a one-minute refresh interval.",
      "evidence": "officially_documented"
    },
    {
      "topic": "live latency",
      "value": "Marketing says near real time; latency was not measured.",
      "evidence": "officially_documented"
    },
    {
      "topic": "delta updates",
      "value": "No delta cursor or revision stream appears in OpenAPI 8.1.5.",
      "evidence": "inferred"
    },
    {
      "topic": "push transport",
      "value": "No WebSocket, SSE, webhook, or push endpoint appears in OpenAPI 8.1.5.",
      "evidence": "inferred"
    },
    {
      "topic": "full-game polling",
      "value": "The REST match-detail endpoint returns the current full detail representation.",
      "evidence": "directly_verified"
    },
    {
      "topic": "completed-play corrections",
      "value": "The docs say match details may be updated, but play correction/replacement semantics are not documented.",
      "evidence": "unverified"
    }
  ],
  "capabilities": {
    "teamGameStatistics": {
      "endpoint": "/matches/{id}",
      "state": "accessible_validated",
      "evidence": "directly_verified",
      "note": "Team match statistics are documented in detailed match responses."
    },
    "playerGameStatistics": {
      "endpoint": "/matches/{id}",
      "state": "unavailable",
      "evidence": "directly_verified",
      "note": "Player box scores are documented in detailed matches and at /box-score/{matchId}."
    },
    "seasonTeamStatistics": {
      "endpoint": "/teams/statistics/{id}",
      "state": "documented_not_tested",
      "evidence": "officially_documented",
      "note": "Not called to conserve requests."
    },
    "seasonPlayerStatistics": {
      "endpoint": "/players/{id}/statistics",
      "state": "documented_not_tested",
      "evidence": "officially_documented",
      "note": "Not called to conserve requests."
    },
    "standings": {
      "endpoint": "/standings",
      "state": "accessible_validated",
      "evidence": "directly_verified",
      "note": "Runtime response validated."
    },
    "depthCharts": {
      "endpoint": null,
      "state": "unverified",
      "evidence": "officially_documented",
      "note": "Marketing and the docs introduction mention depth charts, but OpenAPI 8.1.5 has no depth-chart path."
    },
    "rosters": {
      "endpoint": "/lineups/{matchId}",
      "state": "documented_not_tested",
      "evidence": "officially_documented",
      "note": "Lineups are documented; full roster semantics are unverified."
    },
    "injuries": {
      "endpoint": "/matches/{id}",
      "state": "accessible_validated",
      "evidence": "directly_verified",
      "note": "Injuries are documented in detailed match responses."
    },
    "predictions": {
      "endpoint": "/matches/{id}",
      "state": "accessible_validated",
      "evidence": "directly_verified",
      "note": "Predictions are documented in detailed match responses."
    },
    "odds": {
      "endpoint": "/odds",
      "state": "documented_not_tested",
      "evidence": "officially_documented",
      "note": "The endpoint is documented as unavailable on the Basic/free plan and was not called."
    }
  },
  "rateLimit": {
    "limit": 100,
    "remaining": 70,
    "documentedPlanBehavior": "Official docs expose daily quota headers; published terms describe daily quotas and per-minute throttling. Match lists document a one-minute refresh interval."
  },
  "licensing": {
    "termsVersion": "July 24, 2026",
    "publishedFindings": [
      "Published terms (https://highlightly.net/terms/) say Highlightly does not grant a license to publish or redistribute API data.",
      "Published terms prohibit systematic extraction or reuse of the whole or a substantial part of the database without prior written authorization.",
      "Published terms state that team logos, league marks, player images, and other third-party assets are not licensed by the subscription.",
      "Published terms allow applications built with factual data but prohibit reselling or proxying direct API access.",
      "Published terms describe plan-specific daily quotas and per-minute throttling; overage behavior beyond blocking/throttling is not specified."
    ],
    "questionsRequiringWrittenConfirmation": [
      "Commercial public display and use behind paid subscriptions",
      "Caching and long-term storage of schedules, statistics, standings, and play descriptions",
      "Derived analytics and AI model training",
      "Team-logo display, caching, or CDN hosting and required NFL/team trademark permissions",
      "Transformation of play-by-play into generated play animations",
      "Republishing full play descriptions",
      "Video-highlight embedding, source-specific rights, and attribution",
      "Required provider attribution",
      "Rate-limit overages and higher-volume production polling terms"
    ]
  },
  "finalRecommendation": "Do not promote Highlightly to the primary provider yet. Technical schedule suitability is passed with warnings, Level 2 animation is partially supported, and published terms require written publication, storage, transformation, and logo-rights confirmation."
}
```
