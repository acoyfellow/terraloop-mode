import Claims
set_option maxHeartbeats 400000
theorem denied_302 : Claim.denied_302 := by
  unfold Claim.denied_302
  decide
