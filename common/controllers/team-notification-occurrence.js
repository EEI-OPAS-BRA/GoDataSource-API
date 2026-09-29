'use strict';

// this model has no dedicated REST endpoints of its own;
// it is written internally (team-notification.js after save hook, scheduler.js routine)
// and read through the teamNotification.myOccurrences custom method
// eslint-disable-next-line no-unused-vars
module.exports = function (Model) {};
