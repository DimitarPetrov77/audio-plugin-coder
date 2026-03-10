---
description: "Ship a new release — sync code to CI repo, push, and trigger build"
---

# Ship Workflow

Push the latest ModularRandomizer code to the CI repo and trigger a cross-platform build.

## Steps

1. Ask the user for a version number (e.g. "1.0.1") and a short description of changes.

// turbo
2. Stage all ModularRandomizer changes in the parent repo:
```powershell
git -C "c:\Users\dpetr\Desktop\Juce project\noizefield\audio-plugin-coder" add plugins/ModularRandomizer
```

3. Commit with the user's description:
```powershell
git -C "c:\Users\dpetr\Desktop\Juce project\noizefield\audio-plugin-coder" commit -m "release: v{VERSION} - {DESCRIPTION}"
```

4. Push to the fork:
```powershell
git -C "c:\Users\dpetr\Desktop\Juce project\noizefield\audio-plugin-coder" push fork main
```

5. Tag the release and push the tag (this auto-triggers the CI build):
```powershell
git -C "c:\Users\dpetr\Desktop\Juce project\noizefield\audio-plugin-coder" tag v{VERSION}
git -C "c:\Users\dpetr\Desktop\Juce project\noizefield\audio-plugin-coder" push fork v{VERSION}
```

6. Report success and provide the link:
```
🚀 Release v{VERSION} shipped!

Build running at: https://github.com/DimitarPetrov77/audio-plugin-coder/actions
Installers will be available in ~10 minutes.

When complete, download from:
  → Actions → latest run → Artifacts section
  → Or from the GitHub Release page (permanent links)
```
