def Claim.reverse_reverse : Prop := ∀ xs : List Nat, xs.reverse.reverse = xs
def Claim.append_length : Prop := ∀ xs ys : List Nat, (xs ++ ys).length = xs.length + ys.length
def Claim.sum_le : Prop := ∀ xs : List Nat, ∀ x ∈ xs, x ≤ xs.sum
