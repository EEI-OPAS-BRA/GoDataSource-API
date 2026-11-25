'use strict';

/**
 * Summary of a received sync, per outbreak of the sender
 * Saved in the sync log, so the receiver can see what each sync brought and what happened to it
 */

// what happened to a received record
const STATE = {
  // saved in this instance
  IMPORTED: 'imported',
  // kept aside until the outbreak / questionnaire mapping is approved
  STAGED: 'staged',
  // couldn't be saved
  FAILED: 'failed',
  // the client isn't allowed to send data of the outbreak
  NOT_ALLOWED: 'notAllowed'
};

/**
 * Outbreak of a record
 */
function getRecordOutbreakId(collectionName, record) {
  return collectionName === 'outbreak' ?
    (record._id || record.id) :
    record.outbreakId;
}

/**
 * Empty summary
 */
function create() {
  return {
    outbreaks: {},
    otherImported: 0,
    otherFailed: 0
  };
}

/**
 * Count a received record
 * @param {Object} summary
 * @param {string} collectionName
 * @param {Object} receivedRecord Record as it was received (before converting it to an outbreak of this instance)
 * @param {string} state One of STATE
 * @param {string} [outbreakId] Outbreak of this instance where the record was saved
 */
function count(summary, collectionName, receivedRecord, state, outbreakId) {
  if (
    !summary ||
    !receivedRecord
  ) {
    return;
  }

  // records that don't belong to an outbreak (e.g. locations, reference data)
  const sourceOutbreakId = getRecordOutbreakId(collectionName, receivedRecord);
  if (!sourceOutbreakId) {
    if (state === STATE.IMPORTED) {
      summary.otherImported++;
    } else if (state === STATE.FAILED) {
      summary.otherFailed++;
    }
    return;
  }

  // outbreak entry
  let entry = summary.outbreaks[sourceOutbreakId];
  if (!entry) {
    entry = summary.outbreaks[sourceOutbreakId] = {
      sourceOutbreakId,
      imported: 0,
      staged: 0,
      failed: 0,
      notAllowed: 0
    };
  }

  // where the data went & the name used by the sender
  if (outbreakId) {
    entry.outbreakId = outbreakId;
  }
  if (
    collectionName === 'outbreak' &&
    receivedRecord.name
  ) {
    entry.sourceOutbreakName = receivedRecord.name;
  }

  // count
  if (entry[state] !== undefined) {
    entry[state]++;
  }
}

/**
 * Summary to save in the sync log
 * @param {Object} summary
 * @param {Object} [mappingContext] Outbreak mappings of the sender (see syncOutbreakMapping.createContext)
 */
function toLogFormat(summary, mappingContext) {
  if (!summary) {
    return undefined;
  }

  return {
    outbreaks: Object.values(summary.outbreaks).map((entry) => {
      // the mapping knows the name used by the sender and the outbreak of this instance
      const mapping = mappingContext && mappingContext.mappings ?
        mappingContext.mappings[entry.sourceOutbreakId] :
        undefined;
      if (mapping) {
        entry.sourceOutbreakName = entry.sourceOutbreakName || mapping.sourceOutbreakName;
        entry.mappingId = mapping.id;
        if (
          !entry.outbreakId &&
          mapping.targetOutbreakId
        ) {
          entry.outbreakId = mapping.targetOutbreakId;
        }
      }

      // outbreak with the same id here (or imported as a new outbreak)
      if (
        !entry.outbreakId &&
        entry.imported
      ) {
        entry.outbreakId = entry.sourceOutbreakId;
      }

      return entry;
    }),
    otherImported: summary.otherImported,
    otherFailed: summary.otherFailed
  };
}

module.exports = {
  STATE,
  create,
  count,
  toLogFormat
};
