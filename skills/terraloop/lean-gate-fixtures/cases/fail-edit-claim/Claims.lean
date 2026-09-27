def denied (status : Nat) : Bool :=
  status == 302 || status == 401 || status == 403

def Claim.denied_302 : Prop := True
