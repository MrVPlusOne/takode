# `web/server/bridge/`

Extracted subsystems used by `ws-bridge.ts`.

This directory isolates high-churn logic from the main bridge file to keep
protocol routing readable and testable.

## Files

- [adapter-interface.ts](./adapter-interface.ts)
  - Shared backend adapter contract consumed by `ws-bridge`.
  - Defines optional capability interfaces (`TurnStartFailedAwareAdapter`,
    `CurrentTurnIdAwareAdapter`, `RateLimitsAwareAdapter`).

- [generation-lifecycle.ts](./generation-lifecycle.ts)
  - Focused helpers for turn lifecycle state:
    - `running`/`idle` transitions
    - optimistic running timeout behavior
    - interruption metadata
    - turn start/end Takode event emission

- [permission-pipeline.ts](./permission-pipeline.ts)
  - Permission request normalization and policy flow:
    - mode-based auto-approve rules
    - sensitive path/command guards
    - LLM auto-approval eligibility and queuing
    - human-review fallback path

- [quest-detector.ts](./quest-detector.ts)
  - Detects quest lifecycle signals from command text and tool result output.
  - Produces structured quest events used by bridge reconciliation code.

## How it fits with `ws-bridge.ts`

- `ws-bridge.ts` remains the orchestrator.
- Modules here provide deterministic, reusable logic blocks that operate on
  narrow interfaces rather than full bridge state.
- This lets bridge tests validate behavior at two levels:
  - subsystem-level tests for focused logic
  - end-to-end bridge tests for integration behavior

## Design intent

- Keep backend protocol adapters interchangeable via a stable interface.
- Keep lifecycle and permission policies centralized, not duplicated across adapters.
- Make future bridge refactors safer by reducing monolithic branching in `ws-bridge.ts`.

## Typical call paths

- Incoming backend message:
  - adapter parses backend payload
  - adapter emits `BrowserIncomingMessage` callback
  - `ws-bridge.ts` applies state changes and may call lifecycle/policy helpers here
  - bridge broadcasts authoritative event(s) to browser sessions

- Incoming permission request:
  - bridge normalizes backend payload
  - `permission-pipeline.ts` decides mode-auto-approve vs queue-human vs queue-LLM
  - bridge continues with approval or pending-permission updates

- Generation state update:
  - bridge calls `setGenerating`/`markRunningFromUserDispatch`
  - helper updates turn metadata and emits turn_start/turn_end side effects
  - bridge persists and broadcasts status changes

## Maintenance notes

- Keep these modules pure-ish where possible (small interfaces, explicit deps).
- Add focused tests near behavior changes before editing bridge integration code.
- If a helper needs wide bridge context, prefer adding a narrow interface instead.
