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
   * Retrieve the current user's unread notification occurrences count and the notification occurrences history
   * @param options
   * @param callback
   */
  TeamNotification.myOccurrences = function (options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    // default history count, in case system settings don't have one configured
    const defaultHistoryCount = 20;

    Promise.all([
      getUserTeamIds(userId),
      app.models.systemSettings.findOne()
    ])
      .then(([teamIds, systemSettings]) => {
        // no teams, nothing to retrieve
        if (!teamIds.length) {
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
              teamId: {
                inq: teamIds
              },
              readBy: {
                nin: [userId]
              }
            }),
          app.models.teamNotificationOccurrence
            .find({
              where: {
                teamId: {
                  inq: teamIds
                }
              },
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
   * Mark all team notification occurrences, for the teams the current user belongs to, as read by the current user
   * @param options
   * @param callback
   */
  TeamNotification.markAllOccurrencesRead = function (options, callback) {
    const userId = app.utils.remote.getUserFromOptions(options).id;

    getUserTeamIds(userId)
      .then((teamIds) => {
        if (!teamIds.length) {
          return [];
        }

        return app.models.teamNotificationOccurrence
          .find({
            where: {
              teamId: {
                inq: teamIds
              },
              readBy: {
                nin: [userId]
              }
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
