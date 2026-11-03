'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');
const AddressConstants = require('../../../../../components/baseModelOptions/address').constants;

// canonical (system) notification address type
const canonicalNotificationType = AddressConstants.notificationType;

// address type reference data category
const addressTypeCategory = 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE';

// normalized labels that identify a "Notification" address type (accents removed, lowercase)
// covers English ("Notification") and Portuguese ("Notificação" -> "notificacao")
const notificationLabels = ['notification', 'notificacao'];

// batch sizes for re-pointing persons (mirrors setNotificationLocationIdOnPerson)
const personsFindBatchSize = _.get(Config, 'jobSettings.consolidateNotificationAddressType.batchSize', 1000);
const personsUpdateBatchSize = 10;

/**
 * Normalize a label for comparison: remove accents, trim, lowercase
 * @param value
 * @returns {string}
 */
const normalizeLabel = (value) => _.deburr(value || '').trim().toLowerCase();

/**
 * Check whether a label identifies a notification address type (English or Portuguese)
 * @param value
 * @returns {boolean}
 */
const isNotificationLabel = (value) => notificationLabels.indexOf(normalizeLabel(value)) !== -1;

/**
 * Consolidate manually-created "Notification" address types into the system one.
 *
 * Some servers created a "Notificação" address type by hand before the system shipped its
 * default one. A manually-created item gets a different id (e.g. ..._NOTIFICACAO) derived from
 * the typed value, so cases/contacts using it never get notificationLocationId computed and
 * stay invisible to the notification-location feature. This re-points those addresses to the
 * canonical type, recomputes notificationLocationId, and deactivates the now-redundant manual
 * item so it stops showing as a duplicate in the dropdown. No address or record is deleted.
 *
 * @param callback
 */
const consolidateLegacyNotificationAddressType = (callback) => {
  let referenceDataCollection, personCollection, languageTokenCollection;
  let legacyTypeIds = [];

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      referenceDataCollection = dbConn.collection('referenceData');
      personCollection = dbConn.collection('person');
      languageTokenCollection = dbConn.collection('languageToken');

      // find candidate address types created by users (not the system default, not the canonical one)
      return referenceDataCollection
        .find({
          categoryId: addressTypeCategory,
          _id: {$ne: canonicalNotificationType},
          isDefaultReferenceData: {$ne: true},
          deleted: {$ne: true}
        }, {
          projection: {
            _id: 1
          }
        })
        .toArray();
    })
    .then(candidates => {
      // nothing created by users; nothing to consolidate
      if (!candidates.length) {
        return [];
      }

      // get the translations for the candidate tokens (the value token equals the item id for user-created items)
      const candidateIds = candidates.map(candidate => candidate._id);
      return languageTokenCollection
        .find({
          token: {$in: candidateIds}
        }, {
          projection: {
            token: 1,
            translation: 1
          }
        })
        .toArray()
        .then(tokens => {
          // group translations by token
          const translationsByToken = {};
          tokens.forEach(tokenModel => {
            translationsByToken[tokenModel.token] = translationsByToken[tokenModel.token] || [];
            translationsByToken[tokenModel.token].push(tokenModel.translation);
          });

          // keep only the candidates that look like a notification type
          // double validation: by translation (English + Portuguese) or, as a safety net, by the id suffix
          return candidateIds.filter(candidateId => {
            // match by any translation
            const translations = translationsByToken[candidateId] || [];
            if (translations.some(isNotificationLabel)) {
              return true;
            }

            // match by id suffix (e.g. ..._NOTIFICACAO)
            const idSuffix = candidateId.replace(`${addressTypeCategory}_`, '');
            return isNotificationLabel(idSuffix);
          });
        });
    })
    .then(matchedIds => {
      legacyTypeIds = matchedIds;

      // no manually-created notification type found
      if (!legacyTypeIds.length) {
        console.log('No legacy "Notification" address type found; nothing to consolidate');
        return;
      }

      console.log(`Found legacy "Notification" address type(s) to consolidate: ${legacyTypeIds.join(', ')}`);

      // snapshot the persons that still reference a legacy notification type
      // (stable id list avoids skip-based pagination issues while the match filter shrinks)
      return personCollection
        .find({
          'addresses.typeId': {$in: legacyTypeIds}
        }, {
          projection: {
            _id: 1
          }
        })
        .toArray()
        .then(persons => {
          const personIds = persons.map(person => person._id);
          console.log(`Persons to re-point from legacy "Notification" type: ${personIds.length}`);

          // nothing to re-point
          if (!personIds.length) {
            return;
          }

          // re-point addresses (legacy -> canonical) and recompute notificationLocationId, in batches
          const getActionsCount = () => Promise.resolve(personIds.length);

          const getBatchData = (batchNo, batchSize) => {
            const batchIds = personIds.slice((batchNo - 1) * batchSize, (batchNo - 1) * batchSize + batchSize);
            return personCollection
              .find({
                _id: {$in: batchIds}
              }, {
                projection: {
                  addresses: 1
                }
              })
              .toArray();
          };

          const itemAction = (data) => {
            // re-point every legacy notification address to the canonical type
            const addresses = (data.addresses || []).map(address => {
              if (legacyTypeIds.indexOf(address.typeId) !== -1) {
                return Object.assign({}, address, {typeId: canonicalNotificationType});
              }
              return address;
            });

            // recompute notificationLocationId from the (now canonical) notification address
            const notificationAddress = addresses.find(address => address.typeId === canonicalNotificationType);
            const notificationLocationId = notificationAddress && notificationAddress.locationId ?
              notificationAddress.locationId :
              null;

            // update person
            return personCollection
              .updateOne({
                _id: data._id
              }, {
                '$set': {
                  addresses: addresses,
                  notificationLocationId: notificationLocationId
                }
              });
          };

          return Helpers.handleActionsInBatches(
            getActionsCount,
            getBatchData,
            null,
            itemAction,
            personsFindBatchSize,
            personsUpdateBatchSize,
            console
          );
        });
    })
    .then(() => {
      // nothing matched; skip deactivation
      if (!legacyTypeIds.length) {
        return;
      }

      // deactivate the now-redundant legacy items (kept in DB, just hidden from the dropdown)
      const now = new Date();
      return referenceDataCollection
        .updateMany({
          _id: {$in: legacyTypeIds}
        }, {
          '$set': {
            active: false,
            updatedAt: now,
            dbUpdatedAt: now,
            updatedBy: 'system'
          }
        })
        .then(() => {
          console.log(`Deactivated legacy "Notification" address type(s): ${legacyTypeIds.join(', ')}`);
        });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  consolidateLegacyNotificationAddressType
};
