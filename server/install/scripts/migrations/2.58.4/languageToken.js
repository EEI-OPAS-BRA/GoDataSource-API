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

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateLanguageTokens,
  createUpdatePortugueseLanguageTokens,
};
