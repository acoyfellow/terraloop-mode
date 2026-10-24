set -eu
iid="$1"
recipe="${REVIEW_RECIPE_DIR:-$HOME/cloudflare/.context/reviews/recipe}"
lantern="${LANTERN_DIR:-/tmp/rv/lantern}"
spec="$recipe/$iid/lantern.json"
out="$recipe/$iid/lantern"
[ -f "$spec" ] || { echo "missing $spec" >&2; exit 2; }
mkdir -p "$out"
cp "$recipe/lantern/review-scene.ts" "$lantern/scenes/review-scene.ts"
cp "$spec" "$lantern/scenes/review-$iid.json"
node "$recipe/lantern/register.mjs" "$lantern/scenes/index.ts" "$iid"
cd "$lantern"
npm run --silent see -- "review-$iid" > "$out/see.txt"
npm run --silent verify:motion -- "review-$iid" > "$out/motion.txt" 2>&1
node tools/build.ts --only="review-$iid" > /dev/null
cp "out/review-$iid.html" "$out/review-$iid.html"
npm run --silent trace -- "review-$iid" > "$out/trace.txt" 2>&1 || true
echo "built $out/review-$iid.html"
