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
 * Create / Update Arabic language tokens
 */
const createUpdateArabicLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/arabic`, ['arabic'])
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Create / Update French language tokens
 */
const createUpdateFrenchLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/french`, ['french_fr'])
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Create / Update Portuguese language tokens
 */
const createUpdatePortugueseLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/portuguese`, ['portuguese_pt'])
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Create / Update Russian language tokens
 */
const createUpdateRussianLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/russian`, ['russian_ru'])
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Create / Update Spanish language tokens
 */
const createUpdateSpanishLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/spanish`, ['spanish_es'])
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateLanguageTokens,
  createUpdateArabicLanguageTokens,
  createUpdateFrenchLanguageTokens,
  createUpdatePortugueseLanguageTokens,
  createUpdateRussianLanguageTokens,
  createUpdateSpanishLanguageTokens,
};
