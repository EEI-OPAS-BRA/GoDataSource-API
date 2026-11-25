'use strict';

const _ = require('lodash');
const app = require('../../server/server');
const localizationHelper = require('../../components/localizationHelper');
const syncOutbreakMapping = require('../../components/syncOutbreakMapping');
const syncOutbreakAccess = require('../../components/syncOutbreakAccess');

module.exports = function (SyncOutbreakAccess) {

  /**
   * Find a request
   */
  function findAccess(id) {
    return SyncOutbreakAccess
      .findById(id)
      .then((access) => {
        if (!access) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: SyncOutbreakAccess.modelName,
            id
          });
        }
        return access;
      });
  }

  /**
   * Save the decision of the user
   */
  function decide(access, status, options) {
    return access.updateAttributes({
      status,
      decidedAt: localizationHelper.now().toDate(),
      decidedBy: _.get(app.utils.remote.getUserFromOptions(options), 'id'),
      autoAccepted: false
    }, options);
  }

  /**
   * Number of received outbreaks waiting for the user
   * - requests: outbreaks other instances asked to send
   * - reviews: received outbreaks whose new questions must be reviewed, or whose data arrived without a request (older senders / keys) and waits for the review
   */
  SyncOutbreakAccess.getWaitingCount = function (options, callback) {
    Promise.all([
      app.models.syncOutbreakAccess.rawFind({}, {
        projection: {
          clientId: 1,
          sourceOutbreakId: 1,
          status: 1
        }
      }),
      app.models.syncOutbreakMapping.rawFind({
        status: {
          $ne: syncOutbreakMapping.STATUS.APPROVED
        }
      }, {
        projection: {
          clientId: 1,
          sourceOutbreakId: 1,
          status: 1
        }
      })
    ])
      .then(([accesses, mappings]) => {
        const requested = {};
        let requests = 0;
        accesses.forEach((access) => {
          requested[`${access.clientId}|${access.sourceOutbreakId}`] = access.status;
          if (access.status === syncOutbreakAccess.STATUS.PENDING) {
            requests++;
          }
        });

        // a pending mapping of a requested outbreak is part of its request
        const reviews = mappings.filter((mapping) =>
          mapping.status === syncOutbreakMapping.STATUS.REVIEW ||
          !requested[`${mapping.clientId}|${mapping.sourceOutbreakId}`]
        ).length;

        callback(null, {
          requests,
          reviews,
          total: requests + reviews
        });
      })
      .catch(callback);
  };

  /**
   * Accept an outbreak that exists in this instance with the same id
   * The other outbreaks are accepted when the review of where their data goes is approved
   */
  SyncOutbreakAccess.accept = function (id, options, callback) {
    findAccess(id)
      .then((access) => Promise.all([
        app.models.outbreak.findById(access.sourceOutbreakId),
        access.mappingId ?
          app.models.syncOutbreakMapping.findById(access.mappingId) :
          app.models.syncOutbreakMapping.findOne({
            where: {
              clientId: access.clientId,
              sourceOutbreakId: access.sourceOutbreakId
            }
          })
      ])
        .then(([outbreak, mapping]) => {
          // the data goes straight into the outbreak with the same id, or where the approved review says
          const sameIdOutbreak = !!outbreak && !mapping;
          const reviewed = !!mapping && mapping.status === syncOutbreakMapping.STATUS.APPROVED;
          if (
            !sameIdOutbreak &&
            !reviewed
          ) {
            throw app.utils.apiError.getError('SYNC_OUTBREAK_ACCESS_NEEDS_REVIEW', {
              name: access.sourceOutbreakName || access.sourceOutbreakId
            });
          }

          return decide(access, syncOutbreakAccess.STATUS.ACCEPTED, options);
        }))
      .then((access) => callback(null, access))
      .catch(callback);
  };

  /**
   * Stop receiving the data of an accepted outbreak until it is resumed
   */
  SyncOutbreakAccess.pause = function (id, options, callback) {
    findAccess(id)
      .then((access) => {
        if (access.status !== syncOutbreakAccess.STATUS.ACCEPTED) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: 'Only an accepted outbreak can be paused'
          });
        }
        return decide(access, syncOutbreakAccess.STATUS.PAUSED, options);
      })
      .then((access) => callback(null, access))
      .catch(callback);
  };

  /**
   * Receive again the data of a paused outbreak
   * The other instance sends what changed while it was paused: its next sync starts from the last sync that included this outbreak
   */
  SyncOutbreakAccess.resume = function (id, options, callback) {
    findAccess(id)
      .then((access) => {
        if (access.status !== syncOutbreakAccess.STATUS.PAUSED) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: 'Only a paused outbreak can be resumed'
          });
        }
        return decide(access, syncOutbreakAccess.STATUS.ACCEPTED, options);
      })
      .then((access) => callback(null, access))
      .catch(callback);
  };

  /**
   * Remove the decision about an outbreak; what was received is kept
   * If the other instance still wants to send the outbreak, it is asked again (and must be decided again)
   */
  SyncOutbreakAccess.remove = function (id, options, callback) {
    findAccess(id)
      .then((access) => access
        .updateAttributes({
          decidedAt: localizationHelper.now().toDate(),
          decidedBy: _.get(app.utils.remote.getUserFromOptions(options), 'id')
        }, options)
        .then(() => access.destroy(options))
        .then(() => access))
      .then((access) => callback(null, access))
      .catch(callback);
  };

  /**
   * Refuse the data of an outbreak
   */
  SyncOutbreakAccess.refuse = function (id, options, callback) {
    findAccess(id)
      .then((access) => decide(access, syncOutbreakAccess.STATUS.REFUSED, options))
      .then((access) => callback(null, access))
      .catch(callback);
  };
};
