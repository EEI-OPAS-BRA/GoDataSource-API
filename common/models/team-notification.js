'use strict';

const app = require('../../server/server');
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (TeamNotification) {

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

    const notification = ctx.instance;
    const triggeredAt = localizationHelper.now().toDate();

    app.models.teamNotificationOccurrence
      .create({
        teamNotificationId: notification.id,
        teamId: notification.teamId,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        triggeredAt: triggeredAt,
        readBy: []
      })
      .then(() => {
        return notification.updateAttributes({
          lastTriggeredAt: triggeredAt
        });
      })
      .then(() => next())
      .catch(next);
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
