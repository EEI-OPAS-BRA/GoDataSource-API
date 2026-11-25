'use strict';

const app = require('../../server/server');

module.exports = function (TeamNotification) {

  /**
   * Retrieve the ids of the teams the given user belongs to
   * @param userId
   * @return {Promise<Array<string>>}
   */
  function getUserTeamIds(userId) {
    return app.models.team
      .find({
        where: {
          userIds: userId
        },
        fields: ['id']
      })
      .then((teams) => teams.map((team) => team.id));
  }

  /**
   * Build the filter that matches the notification occurrences visible to a user
   * - the occurrence targets at least one of the user's teams ( teamIds, or teamId for legacy occurrences )
   * - the user has access to the occurrence outbreak ( users without outbreak restrictions access all outbreaks; legacy occurrences have no outbreak )
   * Resolves with null if the user can't see any occurrence ( doesn't belong to any team )
   * @param userId
   * @return {Promise<Object|null>}
   */
  function getUserOccurrencesWhere(userId) {
    return Promise.all([
      getUserTeamIds(userId),
      app.models.user.findById(userId, {
        fields: ['id', 'outbreakIds']
      })
    ])
      .then(([teamIds, user]) => {
        // no teams, nothing to retrieve
        if (!teamIds.length) {
          return null;
        }

        // teams
        const conditions = [{
          or: [{
            teamIds: {
              inq: teamIds
            }
          }, {
            teamId: {
              inq: teamIds
            }
          }]
        }, {
          dismissedBy: {
            nin: [userId]
          }
        }];

        // outbreaks
        const outbreakIds = user && user.outbreakIds && user.outbreakIds.length ?
          user.outbreakIds :
          null;
        if (outbreakIds) {
          conditions.push({
            or: [{
              outbreakId: {
                inq: outbreakIds
              }
            }, {
              outbreakId: null
            }]
          });
        }

        // finished
        return {
          and: conditions
        };
      });
  }

  /**
   * Retrieve the current user's unread notification occurrences count and the notification occurrences history
   * @param options
   * @param callback
   */
  TeamNotification.myOccurrences = function (options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    // default history count, in case system settings don't have one configured
    const defaultHistoryCount = 20;

    Promise.all([
      getUserOccurrencesWhere(userId),
      app.models.systemSettings.findOne()
    ])
      .then(([where, systemSettings]) => {
        // no teams, nothing to retrieve
        if (!where) {
          return {
            unreadCount: 0,
            history: []
          };
        }

        const historyCount = (
          systemSettings &&
          systemSettings.notificationSettings &&
          systemSettings.notificationSettings.historyCount
        ) || defaultHistoryCount;

        return Promise.all([
          app.models.teamNotificationOccurrence
            .count({
              and: [
                where, {
                  readBy: {
                    nin: [userId]
                  }
                }
              ]
            }),
          app.models.teamNotificationOccurrence
            .find({
              where: where,
              order: 'triggeredAt DESC',
              limit: historyCount
            })
        ])
          .then(([unreadCount, history]) => ({
            unreadCount: unreadCount,
            history: history
          }));
      })
      .then((result) => callback(null, result))
      .catch(callback);
  };

  /**
   * Mark a team notification occurrence as read by the current user
   * @param occurrenceId
   * @param options
   * @param callback
   */
  TeamNotification.markOccurrenceRead = function (occurrenceId, options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    app.models.teamNotificationOccurrence
      .findById(occurrenceId)
      .then((occurrence) => {
        if (!occurrence) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.teamNotificationOccurrence.modelName,
            id: occurrenceId
          });
        }

        const readBy = occurrence.readBy || [];
        if (readBy.indexOf(userId) === -1) {
          readBy.push(userId);
          return occurrence.updateAttributes({
            readBy: readBy
          });
        }

        return occurrence;
      })
      .then((occurrence) => callback(null, occurrence))
      .catch(callback);
  };

  /**
   * Remove a team notification occurrence from the current user notifications ( other users still see it )
   * @param occurrenceId
   * @param options
   * @param callback
   */
  TeamNotification.dismissOccurrence = function (occurrenceId, options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    app.models.teamNotificationOccurrence
      .findById(occurrenceId)
      .then((occurrence) => {
        if (!occurrence) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.teamNotificationOccurrence.modelName,
            id: occurrenceId
          });
        }

        const dismissedBy = occurrence.dismissedBy || [];
        if (dismissedBy.indexOf(userId) === -1) {
          dismissedBy.push(userId);
          return occurrence.updateAttributes({
            dismissedBy: dismissedBy
          });
        }
      })
      .then(() => callback())
      .catch(callback);
  };

  /**
   * Mark all team notification occurrences, for the teams the current user belongs to, as read by the current user
   * @param options
   * @param callback
   */
  TeamNotification.markAllOccurrencesRead = function (options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    getUserOccurrencesWhere(userId)
      .then((where) => {
        if (!where) {
          return [];
        }

        return app.models.teamNotificationOccurrence
          .find({
            where: {
              and: [
                where, {
                  readBy: {
                    nin: [userId]
                  }
                }
              ]
            }
          });
      })
      .then((occurrences) => {
        return Promise.all(occurrences.map((occurrence) => {
          const readBy = occurrence.readBy || [];
          readBy.push(userId);
          return occurrence.updateAttributes({
            readBy: readBy
          });
        }));
      })
      .then(() => callback())
      .catch(callback);
  };
};
