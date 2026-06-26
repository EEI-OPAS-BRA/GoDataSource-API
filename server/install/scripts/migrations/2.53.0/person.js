'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');
const AddressConstants = require('../../../../../components/baseModelOptions/address').constants;

// used in setNotificationLocationIdOnPerson function
const personsFindBatchSize = _.get(Config, 'jobSettings.setNotificationLocationIdOnPerson.batchSize', 1000);

// set how many person update actions to run in parallel
const personsUpdateBatchSize = 10;

/**
 * Set notificationLocationId for all person
 * @param callback
 */
const setNotificationLocationIdOnPerson = (callback) => {
  let personCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      personCollection = dbConn.collection('person');

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count persons
        return personCollection
          .countDocuments({});
      };

      const getBatchData = (batchNo, batchSize) => {
        // get persons for batch
        return personCollection
          .find({}, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1,
              _id: 1
            },
            projection: {
              addresses: 1
            }
          })
          .toArray();
      };

      const itemAction = (data) => {
        // get notification address
        let notificationAddress = data.addresses ?
          data.addresses.find(address => address.typeId === AddressConstants.notificationType) :
          null;

        // get locationId from notification address
        let notificationLocationId = notificationAddress && notificationAddress.locationId ?
          notificationAddress.locationId :
          null;

        // update person
        return personCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': {
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
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  setNotificationLocationIdOnPerson
};
