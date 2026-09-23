# Contributing

Thank you for improving Avorythm. English and Persian issues are both welcome.

1. Search existing issues and open one before a large change.
2. Fork the repository and branch from `main`.
3. Keep changes focused. Preserve the module boundaries in `ARCHITECTURE.md`.
4. Add or update tests for behavior changes.
5. Run `pytest -q`, `ruff check src tests scripts/*.py`, `mypy src`, JavaScript syntax checks, and every `tests/*.test.mjs` test (the CI workflow contains the cross-platform command).
6. Submit a pull request using the template and explain user-visible impact, risks, and verification.

## Internationalization (i18n)

Avorythm supports multiple UI languages across four independent i18n entry points (desktop app, help page, audio guide, browser extension). When adding or changing user-visible strings:

- Add the new key to **every** locale block in each dictionary (`messages` in `app.js`; `copy` in `options.js`, `popup.js`, and `player.js`) and to every `data-*` attribute in `help.html` and `audio-guide.html`.
- When adding a new UI language, update all four entry points and create `extension/_locales/<lang>/messages.json`. Add the locale code to `EXPECTED_LOCALES` in `scripts/check_i18n.mjs`.
- Run `node scripts/check_i18n.mjs` before submitting. The CI runs this automatically — it verifies that all locale key sets are aligned, all `data-*` attributes are balanced, all `<select>` language menus offer every locale, and all manifest `__MSG_*__` keys exist in every `_locales` directory.

Use Conventional Commit subjects where practical, for example `fix(extension): restore source gain after ducking`.

Never commit API keys, recordings, generated builds, or third-party binaries without their license notice. By contributing, you agree that your contribution is licensed under the repository's MIT License.
