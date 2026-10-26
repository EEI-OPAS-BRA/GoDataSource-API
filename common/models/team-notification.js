'use strict';

const app = require('../../server/server');
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (TeamNotification) {

  /**
   * Recipient selection types
   */
  TeamNotification.targetTypes = {
    team: 'team',
    location: 'location'
  };

  /**
   * Resolve the teams that should receive a notification
   * - team: the selected teams ( legacy notifications use teamId )
   * - location: all teams working in the selected locations or in any of their sub-locations
   * Resolved every time the notification is triggered, so teams added later to a location receive the next occurrences
   * @param notification
   * @return {Promise<Array<string>>}
   */
  TeamNotification.resolveTargetTeamIds = function (notification) {
    // location based
    if (notification.targetType === TeamNotification.targetTypes.location) {
      const locationIds = notification.locationIds || [];
      if (!locationIds.length) {
        return Promise.resolve([]);
      }

      return new Promise((resolve, reject) => {
        app.models.location.getSubLocations(locationIds, [], (err, allLocationIds) => {
          if (err) {
            return reject(err);
          }

          resolve(allLocationIds);
        });
      })
        .then((allLocationIds) => app.models.team
          .find({
            where: {
              locationIds: {
                inq: allLocationIds
              }
            },
            fields: ['id']
          }))
        .then((teams) => teams.map((team) => team.id));
    }

    // team based
    const teamIds = notification.teamIds && notification.teamIds.length ?
      notification.teamIds :
      (notification.teamId ? [notification.teamId] : []);
    return Promise.resolve(Array.from(new Set(teamIds)));
  };

  /**
   * Trigger a notification - create an occurrence for the current recipient teams and update the last triggered date
   * @param notification
   * @return {Promise}
   */
  TeamNotification.triggerOccurrence = function (notification) {
    const triggeredAt = localizationHelper.now().toDate();

    return TeamNotification
      .resolveTargetTeamIds(notification)
      .then((teamIds) => {
        // no recipients at the moment ( e.g. no teams in the selected locations ) - nothing to create
        if (!teamIds.length) {
          return;
        }

        return app.models.teamNotificationOccurrence
          .create({
            teamNotificationId: notification.id,
            outbreakId: notification.outbreakId,
            teamIds: teamIds,
            title: notification.title,
            message: notification.message,
            severity: notification.severity,
            triggeredAt: triggeredAt,
            readBy: [],
            dismissedBy: []
          });
      })
      .then(() => notification.updateAttributes({
        lastTriggeredAt: triggeredAt
      }));
  };

  /**
   * Before save hook
   * Validate the outbreak and the recipients
   * @param ctx
   * @param next
   */
  TeamNotification.observe('before save', function (ctx, next) {
    // determine the resulting data
    const data = ctx.instance ?
      ctx.instance.toJSON() :
      Object.assign(
        {},
        ctx.currentInstance ? ctx.currentInstance.toJSON() : {},
        ctx.data || {}
      );

    // only validate creates & updates that touch the notification definition ( e.g. not lastTriggeredAt updates )
    const changedProps = ctx.instance ?
      null :
      Object.keys(ctx.data || {});
    const definitionProps = ['outbreakId', 'targetType', 'teamIds', 'locationIds', 'teamId'];
    if (
      changedProps &&
      !changedProps.some((prop) => definitionProps.indexOf(prop) !== -1)
    ) {
      return next();
    }

    // outbreak is required
    if (!data.outbreakId) {
      return next(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: TeamNotification.modelName,
        details: 'outbreakId is required'
      }));
    }

    // recipients are required
    const targetType = data.targetType || TeamNotification.targetTypes.team;
    const hasRecipients = targetType === TeamNotification.targetTypes.location ?
      !!(data.locationIds && data.locationIds.length) :
      !!((data.teamIds && data.teamIds.length) || data.teamId);
    if (!hasRecipients) {
      return next(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: TeamNotification.modelName,
        details: targetType === TeamNotification.targetTypes.location ?
          'at least one location is required' :
          'at least one team is required'
      }));
    }

    // cleanup data that doesn't apply to the selected recipient type
    const target = ctx.instance || ctx.data;
    target.targetType = targetType;
    if (targetType === TeamNotification.targetTypes.location) {
      target.teamIds = [];
      target.teamId = null;
    } else {
      target.locationIds = [];
    }

    // finished
    next();
  });

  /**
   * After save hook
   * Fire an occurrence immediately when a new team notification is created
   * (recurring notifications will keep firing later through the scheduler routine)
   * @param ctx
   * @param next
   */
  TeamNotification.observe('after save', function (ctx, next) {
    // only act on newly created notifications
    if (!ctx.isNewInstance || !ctx.instance) {
      return next();
    }

    TeamNotification
      .triggerOccurrence(ctx.instance)
      .then(
        () => next(),
        (err) => next(err)
      );
  });

  TeamNotification.fieldLabelsMap = Object.assign({}, TeamNotification.fieldLabelsMap, {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdOn: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_CREATED_ON',
    createdAt: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_DELETED_AT',
    outbreakId: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_OUTBREAK',
    targetType: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_TARGET_TYPE',
    teamIds: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_TEAMS',
    locationIds: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_LOCATIONS',
    teamId: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_TEAM',
    title: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_TITLE',
    message: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_MESSAGE',
    severity: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_SEVERITY',
    recurring: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_RECURRING',
    recurrenceInterval: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_RECURRENCE_INTERVAL',
    recurrenceUnit: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_RECURRENCE_UNIT',
    active: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_ACTIVE',
    lastTriggeredAt: 'LNG_TEAM_NOTIFICATION_FIELD_LABEL_LAST_TRIGGERED_AT'
  });
};
