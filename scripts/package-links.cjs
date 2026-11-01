const assert = require('node:assert/strict');

const repositoryUrl = new URL(require('../package.json').repository.url);
const repositoryRoot = `${repositoryUrl.origin}${repositoryUrl.pathname.replace(/\.git$/, '')}`;
const repositoryPath = repositoryUrl.pathname.replace(/\.git$/, '').replace(/\/$/, '');
const masterBlobPrefix = `${repositoryRoot}/blob/master/`;

function extractLinkTargets(markdown) {
  return [...markdown.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))/g)]
    .map(match => match[1] || match[2]);
}

function extractImageUrls(markdown) {
  const markdownImages = [...markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/g)]
    .map(match => match[1] || match[2]);
  const htmlImages = [...markdown.matchAll(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi)]
    .map(match => match[1] || match[2]);
  return [...markdownImages, ...htmlImages];
}

function isMainBranchContentUrl(target) {
  const url = new URL(target);
  if (url.hostname === repositoryUrl.hostname) {
    return ['/blob/main', '/raw/main'].some(route =>
      url.pathname === `${repositoryPath}${route}` || url.pathname.startsWith(`${repositoryPath}${route}/`));
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    return url.pathname === `${repositoryPath}/main` || url.pathname.startsWith(`${repositoryPath}/main/`);
  }
  return false;
}

function validatePackagedMarkdown(markdown, filename) {
  const targets = [...extractLinkTargets(markdown), ...extractImageUrls(markdown)];
  for (const target of targets) {
    if (/^https?:/i.test(target)) {
      assert(!isMainBranchContentUrl(target), `${filename} content URL must not target main: ${target}`);
    }
  }

  const unresolvedLinks = extractLinkTargets(markdown)
    .filter(target => !/^(?:https?:|mailto:|#)/i.test(target) && !target.startsWith(`${repositoryRoot}/`));
  assert.deepEqual(unresolvedLinks, [], `${filename} must not retain relative links: ${unresolvedLinks.join(', ')}`);

  for (const imageUrl of extractImageUrls(markdown)) {
    assert(imageUrl.startsWith('https://'), `${filename} images must use HTTPS: ${imageUrl}`);
  }
}

module.exports = {
  extractImageUrls,
  isMainBranchContentUrl,
  masterBlobPrefix,
  repositoryRoot,
  validatePackagedMarkdown,
};
