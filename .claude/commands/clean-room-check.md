---
description: Scan the branch diff for copied third-party material and print the clean-room attestation checklist
---

# /clean-room-check

Scan git diff for signs of third-party copyright, commercial competitor references, or unlicensed assets.

## Steps

1. Run `git diff main...HEAD`.
2. Check for mentions of competitor names, proprietary identifiers, or copied copywriting.
3. Check all new external dependencies against AGPL-3.0 compatibility.
4. Verify all asset files have license attributions in `NOTICE`.
5. Output the Clean-Room PR Attestation checklist from `CLEANROOM.md` section 5:
   - [ ] I wrote this code/text/design myself or generated it from this repository's requirements.
   - [ ] I did not copy or closely paraphrase code, copy, assets, or layouts from a commercial HR product.
   - [ ] I did not use scraping, reverse engineering, or credentials outside our terms.
   - [ ] Any third-party code or asset is listed in `NOTICE` with a compatible license.
   - [ ] I disclosed any prior exposure to a competing product's internals to a maintainer.
