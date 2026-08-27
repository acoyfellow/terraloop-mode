Feature: Terraloop turn exhaustion
  The heartbeat (loops_task) only runs while the Pi session is idle.
  Speed is the current turn plus Terrarium completion callbacks.
  Ending a turn so the heartbeat can continue is a dead spot.

  Background:
    Given terraloop is driving
    And a loops_task driver exists with a long interval

  Scenario: Callback arrives while the parent still has work
    Given a Terrarium child completed and a callback was delivered
    And an in-scope next step exists
    When the parent handles the callback
    Then the parent verifies that child by runId in this turn
    And the parent starts the next in-scope step in this turn
    And the parent does not end the turn to wait for the heartbeat

  Scenario: This turn never spawned Terrarium
    Given the parent is doing in-scope work with no live child
    When the parent finishes one cheap step
    And another in-scope step remains
    Then the parent continues in this turn
    And the parent does not yield to loops_task

  Scenario: Heartbeat is only the idle net
    Given no in-scope next step exists
    And no unverified completion callback is pending
    When the turn has nothing left to do
    Then the parent may end the turn
    And loops_task may fire later if the session is idle

  Scenario: Model says it will wait for the heartbeat
    Given an in-scope next step exists
    When the parent would reply that it will wait for the next driver tick
    Then that is a protocol violation
    And the required action is continue_turn

  Scenario: Spawn batch RPC times out
    Given terrarium_spawn_batch returned a request timeout
    Then the parent recovers run IDs in this turn
    And the parent does not spawn twins
    And the parent does not wait for the heartbeat to recover

  Scenario: Child log is banner plus hook-fail
    Given a live child log contains only the Terrarium banner and a session-start hook failure
    When the attention window has passed
    Then the parent cancels that child once in this turn
    And if the same stall already happened, the parent does the work itself in this turn

  Scenario: Cancelled callback with exit 143
    Given a Cancelled callback with exit 143
    Then the parent ignores it as a SIGTERM corpse
    And if in-scope work remains, the parent continues this turn

  Scenario: List-mode status times out
    Given terrarium_status without runId timed out
    Then the parent does not retry list-mode
    And the parent uses status by runId in this turn if an id is known

  Scenario: Scope block on parent write
    Given an edit path is outside locked scope
    Then the parent does not spawn a child at that cwd
    And the parent does not wait for the heartbeat
    And the parent stops or asks, still in this turn

  Scenario: Gate is met
    Given the stop gate proof succeeded
    Then the parent deletes the driver in this turn
    And the parent reports proven vs remaining
    And the parent does not leave the heartbeat running

  Scenario: Live children and parent work both exist
    Given one or more children are still running
    And an independent in-scope parent step exists
    Then the parent does the parent step in this turn
    And the parent rides child callbacks instead of polling
    And the parent does not idle until the heartbeat
