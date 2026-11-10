'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Convert the single recipient team ( teamId ) of existing team notifications & occurrences into the recipient teams list ( teamIds )
 * Legacy notifications don't have an outbreak, so they keep being visible to their team members regardless of the outbreak
 * @param callback
 */
const migrateTeamIdToTeamIds = (callback) => {
  let dbConnection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      dbConnection = dbConn;

      // convert collections one after another
      const convert = (collectionName, extraSet) => {
        const collection = dbConnection.collection(collectionName);
        return collection
          .find({
            teamId: {
              $exists: true,
              $ne: null
            },
            $or: [{
              teamIds: {
                $exists: false
              }
            }, {
              teamIds: {
                $size: 0
              }
            }]
          }, {
            projection: {
              _id: 1,
              teamId: 1
            }
          })
          .toArray()
          .then((records) => {
            // nothing to convert
            if (!records.length) {
              return;
            }

            // convert
            return collection.bulkWrite(records.map((record) => ({
              updateOne: {
                filter: {
                  _id: record._id
                },
                update: {
                  $set: Object.assign({
                    teamIds: [record.teamId]
                  }, extraSet)
                }
              }
            })));
          });
      };

      // notifications & their occurrences
      return convert('teamNotification', {
        targetType: 'team'
      })
        .then(() => convert('teamNotificationOccurrence', {}));
    })
    .then(() => callback())
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  migrateTeamIdToTeamIds
};
