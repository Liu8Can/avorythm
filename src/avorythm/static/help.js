function detectSystemLocale() {
  const lang = (navigator.languages?.[0] || navigator.language || navigator.userLanguage || 'en').toLowerCase();
  if (lang.startsWith('zh')) return 'zh-Hans';
  if (lang.startsWith('fa')) return 'fa';
  return 'en';
}
function datasetKey(locale) {
  return locale.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
let locale = localStorage.getItem('avorythm.locale') || localStorage.getItem('lingora.locale') || localStorage.getItem('dubira.locale') || localStorage.getItem('voxilyra.locale') || detectSystemLocale();
const render = () => {
  const key = datasetKey(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-en]').forEach((node) => { node.textContent = node.dataset[key]; });
  document.querySelectorAll('[data-en-src]').forEach((node) => { node.src = node.dataset[`${key}Src`]; });
  document.querySelector('#localeToggle').value = locale;
};
document.querySelector('#localeToggle').addEventListener('change', () => {
  locale = document.querySelector('#localeToggle').value;
  localStorage.setItem('avorythm.locale', locale);
  render();
});
render();
