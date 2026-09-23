import assert from 'node:assert/strict';
import test from 'node:test';

import {findHtmlDataAttributeIssues, parseDictionary} from '../scripts/check_i18n.mjs';

test('i18n checker validates standalone locale assignments', () => {
  const source = `
const messages = {
  fa: {base: 'fa'},
  en: {base: 'en'},
  'zh-Hans': {base: 'zh'}
};
messages.fa.projectHomepage = 'fa';
messages.en.projectHomepage = 'en';
messages['zh-Hans'].projectHomepage = 'zh';
`;
  const dictionaries = parseDictionary(source, 'messages');
  for (const locale of ['fa', 'en', 'zh-Hans']) {
    assert.ok(dictionaries.get(locale)?.has('projectHomepage'), `${locale} assignment should be detected`);
  }

  const missingChinese = parseDictionary(source.replace("messages['zh-Hans'].projectHomepage = 'zh';", ''), 'messages');
  assert.equal(missingChinese.get('zh-Hans')?.has('projectHomepage'), false);
  assert.ok(missingChinese.get('fa')?.has('projectHomepage'));
});

test('i18n checker validates each translated HTML element, not aggregate counts', () => {
  const issues = findHtmlDataAttributeIssues(
    '<p data-en="one" data-fa="یک">one</p><span data-zh-hans="孤立">孤立</span>'
  );
  assert.equal(issues.length, 2);
  assert.deepEqual(issues[0].missing, ['data-zh-hans']);
  assert.deepEqual(issues[1].missing, ['data-en', 'data-fa']);
});
