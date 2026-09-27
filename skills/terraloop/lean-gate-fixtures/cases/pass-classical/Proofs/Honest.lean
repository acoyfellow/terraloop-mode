import Claims
theorem denied_302 : Claim.denied_302 := by
  unfold Claim.denied_302
  exact Classical.byContradiction (fun h => h (by decide))
