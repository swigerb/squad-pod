const assert = require('node:assert/strict');

const repositoryUrl = new URL(require('../package.json').repository.url);
const repositoryRoot = `${repositoryUrl.origin}${repositoryUrl.pathname.replace(/\.git$/, '')}`;
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

function validatePackagedMarkdown(markdown, filename) {
  const repositoryLinks = extractLinkTargets(markdown)
    .filter(target => target.startsWith(`${repositoryRoot}/`));
  for (const target of repositoryLinks) {
    assert(target.startsWith(masterBlobPrefix), `${filename} repository link must target master: ${target}`);
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
  masterBlobPrefix,
  repositoryRoot,
  validatePackagedMarkdown,
};
