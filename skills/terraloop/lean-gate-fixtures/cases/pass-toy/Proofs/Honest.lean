import Claims
theorem reverse_reverse : Claim.reverse_reverse := by
  intro xs
  simp
theorem append_length : Claim.append_length := by
  intro xs ys
  simp
theorem sum_le : Claim.sum_le := by
  intro xs x hx
  induction xs with
  | nil => simp at hx
  | cons y ys ih =>
    simp only [List.mem_cons] at hx
    simp only [List.sum_cons]
    rcases hx with rfl | h
    · omega
    · have := ih h
      omega
