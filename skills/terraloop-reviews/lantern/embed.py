import sys

note_path, image_markdown = sys.argv[1], sys.argv[2]
out, in_mermaid, placed = [], False, False
for line in open(note_path).read().split("\n"):
    if not in_mermaid and line.startswith("```mermaid"):
        in_mermaid = True
        continue
    if in_mermaid:
        if line.startswith("```"):
            in_mermaid = False
            if not placed:
                out.append(image_markdown)
                placed = True
        continue
    out.append(line)
if not placed:
    raise SystemExit("note has no mermaid block to replace with the Lantern animation")
sys.stdout.write("\n".join(out))
