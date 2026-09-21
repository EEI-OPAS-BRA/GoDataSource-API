'use strict';

const apiError = require('./apiError');
const localizationHelper = require('./localizationHelper');

/**
 * Validate the date chosen by the user to start sending data to an upstream server
 * @param {Date|string|Moment} value
 * @returns {Moment}
 */
const validateRequestedFromDate = (value) => {
  const requested = localizationHelper.toMoment(value);

  if (
    !requested.isValid() ||
    requested.isAfter(localizationHelper.now())
  ) {
    throw apiError.getError('REQUEST_VALIDATION_ERROR', {
      errorMessages: 'Property "fromDate" must be a valid date that is not in the future'
    });
  }

  return requested;
};

/**
 * Determine from which date the data is sent to an upstream server
 *
 * By default only what was updated since the last successful sync is sent.
 * The user can ask for more data (all of it, or since an older date), which is safe since the other instance only
 * updates records that are newer than the ones it has.
 * The user can't ask for less data than the default, otherwise what was updated between the last sync and the chosen date
 * would never be sent: the next syncs continue from the start of this one.
 *
 * @param {Object} options
 * @param {Date|string|Moment} [options.lastSyncStartDate] start of the last successful sync with the server
 * @param {Date|string|Moment} [options.requestedFromDate] date chosen by the user
 * @param {boolean} [options.fullSync] the user wants all the data
 * @returns {{fromDate: (Moment|undefined), reason: string}} fromDate is undefined when all the data must be sent
 */
const determineFromDate = (options) => {
  options = options || {};

  // all data
  if (options.fullSync) {
    return {
      fromDate: undefined,
      reason: 'Full sync requested'
    };
  }

  // date determined automatically
  // it starts 1 minute earlier to prevent data loss from the moment the last sync started to the moment its start date was set
  const automaticFromDate = options.lastSyncStartDate ?
    localizationHelper.toMoment(options.lastSyncStartDate).subtract(1, 'minutes') :
    undefined;

  // nothing chosen
  if (!options.requestedFromDate) {
    return {
      fromDate: automaticFromDate,
      reason: automaticFromDate ?
        'Since the last successful sync' :
        'No successful sync was found'
    };
  }

  const requestedFromDate = localizationHelper.toMoment(options.requestedFromDate);

  // there is no default to protect
  if (!automaticFromDate) {
    return {
      fromDate: requestedFromDate,
      reason: 'No successful sync was found; using the chosen date'
    };
  }

  // an older date sends more data
  if (requestedFromDate.isBefore(automaticFromDate)) {
    return {
      fromDate: requestedFromDate,
      reason: 'Chosen date is older than the last successful sync'
    };
  }

  return {
    fromDate: automaticFromDate,
    reason: 'Chosen date ignored because it is not older than the last successful sync'
  };
};

module.exports = {
  validateRequestedFromDate,
  determineFromDate
};
