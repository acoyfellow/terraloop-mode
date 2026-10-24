import sys

note_path, image_markdown = sys.argv[1], sys.argv[2]
lines = open(note_path).read().split("\n")
caption = "Lantern steps, built from the diagram above:"
out, in_mermaid, placed = [], False, False
for line in lines:
    out.append(line)
    if line.startswith("```mermaid"):
        in_mermaid = True
    elif in_mermaid and line.startswith("```"):
        in_mermaid = False
        if not placed:
            out.extend(["", caption, "", image_markdown])
            placed = True
if not placed:
    raise SystemExit("note has no mermaid block to place the Lantern image under")
sys.stdout.write("\n".join(out))
