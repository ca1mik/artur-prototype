# QA Hardening Log

## Context

- Project: `ARTUR PRO`
- Goal: full QA pass for `backend`, `Telegram bot`, `admin`, and `mobile`
- Started: `2026-05-17`
- Working mode: verify -> break -> fix -> retest -> document

## Baseline

- Root folders present: `backend/`, `admin/`, `mobile/`, `sales/`
- Existing build status before this pass:
  - `admin`: buildable
  - `backend`: buildable
  - `mobile`: exportable for web
- Security layer already present:
  - OTP login
  - revocable mobile sessions
  - biometric lock
  - admin security metrics

## Working Notes

### Pass 1: repo scan

- Confirmed local instructions in `mobile/AGENTS.md`: use exact Expo `v55` docs before mobile code changes.
- Confirmed repo is not a single root git repository.
- Found existing runtime logs inside `backend/`, which may help compare previous failures.

### Pass 2: current objective

- Build a persistent QA reference so future work can start from this file instead of rereading the codebase.
- Next step: enumerate scripts, launch commands, and existing tests for each app.

## Findings

- None recorded yet in this pass.

## Fixes

- None recorded yet in this pass.

## Verification

- Pending for this pass.

## Next Actions

1. Inspect app scripts and entrypoints.
2. Run backend and API smoke flows.
3. Validate Telegram bot runtime path.
4. Validate mobile flow against live backend.
5. Add or improve automated checks where coverage is weak.
