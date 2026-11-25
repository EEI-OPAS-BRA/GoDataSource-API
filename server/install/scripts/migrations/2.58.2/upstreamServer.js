'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Sync on every change is no longer used (it sends a package for each saved record, overloading the instances that receive the data)
 * The servers that were synced only on every change are synced every hour, so they keep sending their data
 */
const disableSyncOnEveryChange = (callback) => {
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      const systemSettings = dbConn.collection('systemSettings');
      return systemSettings
        .findOne({})
        .then((settings) => {
          const upstreamServers = settings && Array.isArray(settings.upstreamServers) ?
            settings.upstreamServers :
            [];
          let changed = 0;
          upstreamServers.forEach((server) => {
            if (!server || !server.syncOnEveryChange) {
              return;
            }

            server.syncOnEveryChange = false;
            if (!(server.syncInterval > 0)) {
              server.syncInterval = 1;
            }
            changed++;
          });

          if (!changed) {
            return;
          }

          console.log(`Sync on every change disabled for ${changed} upstream server(s)`);
          return systemSettings.updateOne({
            _id: settings._id
          }, {
            $set: {
              upstreamServers
            }
          });
        });
    })
    .then(() => callback())
    .catch(callback);
};

/**
 * The outbreaks of the upstream servers & of the keys of the mobile app must be chosen (an empty list doesn't mean "all the outbreaks" anymore)
 * The ones that synced all the outbreaks get the outbreaks that exist now, so they keep working; a new outbreak must be chosen
 */
const chooseOutbreaksExplicitly = (callback) => {
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      const systemSettings = dbConn.collection('systemSettings');
      const clientApplication = dbConn.collection('clientApplication');
      return dbConn.collection('outbreak')
        .find({
          deleted: false
        }, {
          projection: {
            _id: 1
          }
        })
        .toArray()
        .then((outbreaks) => {
          const allOutbreakIds = outbreaks.map((outbreak) => outbreak._id);
          if (!allOutbreakIds.length) {
            return;
          }

          // upstream servers
          return systemSettings
            .findOne({})
            .then((settings) => {
              const upstreamServers = settings && Array.isArray(settings.upstreamServers) ?
                settings.upstreamServers :
                [];
              const servers = upstreamServers.filter((server) => server && !(Array.isArray(server.outbreakIDs) && server.outbreakIDs.length));
              if (!servers.length) {
                return;
              }

              servers.forEach((server) => {
                server.outbreakIDs = allOutbreakIds;
              });
              console.log(`Outbreaks chosen for ${servers.length} upstream server(s)`);
              return systemSettings.updateOne({
                _id: settings._id
              }, {
                $set: {
                  upstreamServers
                }
              });
            })

            // keys of the mobile app / older keys (the keys of other instances ask for each outbreak)
            .then(() => clientApplication
              .updateMany({
                deleted: false,
                type: {
                  $ne: 'instance'
                },
                $or: [
                  { outbreakIDs: { $exists: false } },
                  { outbreakIDs: null },
                  { outbreakIDs: { $size: 0 } }
                ]
              }, {
                $set: {
                  outbreakIDs: allOutbreakIds
                }
              })
              .then((result) => {
                if (result.modifiedCount) {
                  console.log(`Outbreaks chosen for ${result.modifiedCount} client application(s)`);
                }
              })
            );
        });
    })
    .then(() => callback())
    .catch(callback);
};

/**
 * The keys know when data was sent with them the last time, and the outbreaks when their data arrived (displayed in the lists)
 * Saved from now on by each sync; the ones before are taken from the sync logs
 */
const saveLastReceivedSyncs = (callback) => {
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      const logs = dbConn.collection('databaseActionLog');
      const clientApplication = dbConn.collection('clientApplication');
      const syncOutbreakAccess = dbConn.collection('syncOutbreakAccess');
      const finished = {
        type: 'sync',
        deleted: false,
        syncClientId: {
          $exists: true,
          $not: /^webUser/
        },
        actionCompletionDate: {
          $exists: true
        }
      };

      // last sync of each key
      return logs
        .aggregate([{
          $match: finished
        }, {
          $sort: {
            actionCompletionDate: -1
          }
        }, {
          $group: {
            _id: '$syncClientId',
            lastSyncAt: {
              $first: '$actionCompletionDate'
            },
            lastSyncStatus: {
              $first: '$status'
            }
          }
        }])
        .toArray()
        .then((lastSyncs) => Promise.all(lastSyncs.map((lastSync) => clientApplication.updateOne({
          'credentials.clientId': lastSync._id,
          lastSyncAt: {
            $exists: false
          }
        }, {
          $set: {
            lastSyncAt: lastSync.lastSyncAt,
            lastSyncStatus: lastSync.lastSyncStatus
          }
        }))))

        // last data of each outbreak
        .then(() => logs
          .aggregate([{
            $match: Object.assign({
              'receivedSummary.outbreaks.0': {
                $exists: true
              }
            }, finished)
          }, {
            $unwind: '$receivedSummary.outbreaks'
          }, {
            $match: {
              $or: [{
                'receivedSummary.outbreaks.imported': {
                  $gt: 0
                }
              }, {
                'receivedSummary.outbreaks.staged': {
                  $gt: 0
                }
              }]
            }
          }, {
            $group: {
              _id: {
                clientId: '$syncClientId',
                sourceOutbreakId: '$receivedSummary.outbreaks.sourceOutbreakId'
              },
              lastReceivedAt: {
                $max: '$actionCompletionDate'
              }
            }
          }])
          .toArray()
        )
        .then((lastReceived) => Promise.all(lastReceived.map((item) => syncOutbreakAccess.updateMany({
          clientId: item._id.clientId,
          sourceOutbreakId: item._id.sourceOutbreakId,
          lastReceivedAt: {
            $exists: false
          }
        }, {
          $set: {
            lastReceivedAt: item.lastReceivedAt
          }
        }))));
    })
    .then(() => callback())
    .catch(callback);
};

module.exports = {
  disableSyncOnEveryChange,
  chooseOutbreaksExplicitly,
  saveLastReceivedSyncs
};
