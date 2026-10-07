"""Check pinned installed research versions and recorded license/artifact hashes."""
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
inventory = json.loads((root / 'dependencies.json').read_text())['dependencies']
requirements = (root / 'requirements.txt').read_text().replace('\\\n', '')
requirements = [line.split() for line in requirements.splitlines() if line and not line.startswith('#')]
expected_requirements = {}
manifest = json.loads((root / 'package.json').read_text())['devDependencies']
lock = (root / 'pnpm-lock.yaml').read_text()
for item in inventory:
    name, version = item['name'], item['version']
    if name.startswith('@noble/'):
        assert manifest[name] == version
        installed = json.loads((root / 'node_modules' / name / 'package.json').read_text())
        assert installed['version'] == version
        assert f"'{name}@{version}':" in lock
        assert item['artifact']['integrity'] in lock
    else:
        assert importlib.metadata.version(name) == version, name
        expected_requirements[f'{name}=={version}'] = {f"--hash=sha256:{a['sha256']}" for a in item['artifacts']}
    assert item['notices'], name
    for notice in item['notices']:
        file = (root / notice['path']).resolve()
        assert file.is_relative_to(root / 'licenses')
        assert hashlib.sha256(file.read_bytes()).hexdigest() == notice['sha256'], file
assert len(requirements) == len(expected_requirements)
assert {parts[0]: set(parts[1:]) for parts in requirements} == expected_requirements
assert set(manifest) == {i['name'] for i in inventory if i['name'].startswith('@noble/')}
assert all(re.fullmatch(r'--hash=sha256:[0-9a-f]{64}', h) for hashes in expected_requirements.values() for h in hashes)
print(f'Checked {len(inventory)} dependency versions, pinned artifact hashes and license notices')
