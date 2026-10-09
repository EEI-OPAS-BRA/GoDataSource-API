'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const localizationHelper = require('../../../components/localizationHelper');

const languageId = 'portuguese_pt';
const canonicalFiles = [
  require('./languages/portuguese_pt/system.json'),
  require('./languages/portuguese_pt/templates.json')
];

/**
 * Write the canonical portuguese_pt text over the existing tokens
 * Runs after the model migrations, which may have written english text into portuguese_pt
 * Only updates existing, non-deleted tokens; token creation stays with the migrations
 * @param callback
 */
function run(callback) {
  const translations = {};
  canonicalFiles.forEach((file) => {
    Object.keys(file.tokens).forEach((token) => {
      translations[token] = file.tokens[token].translation;
    });
  });
  const tokens = Object.keys(translations);

  const foundTokens = new Set();
  let languageToken, updated = 0;
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      languageToken = dbConn.collection('languageToken');
      return languageToken
        .find({
          languageId: languageId,
          deleted: {
            $ne: true
          },
          token: {
            $in: tokens
          }
        }, {
          projection: {
            _id: 1,
            token: 1,
            translation: 1
          }
        })
        .toArray();
    })
    .then((records) => {
      // updatedAt must move forward, otherwise browsers with cached tokens never fetch the new text
      const now = localizationHelper.now().toDate();
      const operations = [];
      records.forEach((record) => {
        foundTokens.add(record.token);
        if (record.translation === translations[record.token]) {
          return;
        }

        operations.push({
          updateOne: {
            filter: {
              _id: record._id
            },
            update: {
              $set: {
                translation: translations[record.token],
                updatedAt: now,
                dbUpdatedAt: now,
                updatedBy: 'system'
              }
            }
          }
        });
      });

      updated = operations.length;
      return operations.length ?
        languageToken.bulkWrite(operations, {ordered: false}) :
        null;
    })
    .then(() => {
      console.info(`Portuguese translations: ${tokens.length} checked, ${updated} updated, ${tokens.length - foundTokens.size} absent or deleted`);
      callback();
    })
    .catch(callback);
}

module.exports = run;
