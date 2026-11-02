'use strict';

const languageMigrator = require('../../languageMigrator');

/**
 * Create / Update language tokens for all languages (default English values)
 */
const createUpdateLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/english`)
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Replace the English default with the translated text for the languages that have one
 */
const createUpdateTranslatedLanguageTokens = (callback) => {
  [
    ['spanish', 'spanish_es'],
    ['french', 'french_fr'],
    ['russian', 'russian_ru'],
    ['arabic', 'arabic']
  ]
    .reduce(
      (promise, [folder, languageId]) => promise.then(() => languageMigrator.createUpdateLanguageTokens(`${__dirname}/data/${folder}`, [languageId])),
      Promise.resolve()
    )
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateLanguageTokens,
  createUpdateTranslatedLanguageTokens
};
