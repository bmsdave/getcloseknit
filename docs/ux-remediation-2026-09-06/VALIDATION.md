# Task-pack validation

Run from the repository root after generating or editing this documentation pack.

```sh
python3 - <<'PY'
from pathlib import Path
import re

root = Path("docs/ux-remediation-2026-09-06")
tasks = sorted((root / "tasks").glob("*.md"))
assert len(tasks) == 74, len(tasks)
ids = [int(path.name[:2]) for path in tasks]
assert ids == list(range(1, 75)), ids

required = [
    "## Product context", "## Current implementation",
    "## Required implementation", "## Test-first procedure",
    "## Acceptance criteria", "## Ownership and integration",
    "## Cleanup and handoff", "## References",
]
for path in tasks:
    text = path.read_text()
    assert all(section in text for section in required), path
    words = re.findall(r"\b[\w’-]+\b", text)
    assert len(words) >= 350, (path, len(words))

for path in [root / "README.md", root / "EXECUTION-WAVES.md", *tasks]:
    text = path.read_text()
    for target in re.findall(r"\[[^]]+\]\(<([^>]+)>\)|\[[^]]+\]\(([^)]+)\)", text):
        value = next((item for item in target if item), "")
        if not value or "://" in value or value.startswith("#"):
            continue
        assert (path.parent / value.split("#", 1)[0]).resolve().exists(), (path, value)

index = (root / "README.md").read_text()
for path in tasks:
    assert f"tasks/{path.name}" in index, path
print("task files: 74")
print("ids: continuous")
print("required sections: present")
print("word floor: >=350")
print("relative links: resolved")
print("index: complete")
PY
```

Also inspect `EXECUTION-WAVES.md` manually to confirm every task is scheduled, serial lanes remain serial, and concurrent lanes do not claim the same primary files. The expected Git diff contains only `docs/ux-remediation-2026-09-06/`.
