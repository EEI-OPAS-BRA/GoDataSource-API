'use strict';

const _ = require('lodash');
const app = require('../server/server');
const dbSync = require('./dbSync');
const localizationHelper = require('./localizationHelper');

/**
 * Map the outbreaks & questionnaires of another Go.Data instance (e.g. a municipality) to the outbreaks of this instance (e.g. the ministry)
 *
 * The same outbreak might exist in both instances with different ids and slightly different questionnaires.
 * The receiver decides to which of its outbreaks the sender outbreak corresponds and which of its questions (and answers) correspond to the sender ones.
 * Until it approves, the records of the outbreak / the answers of the new questions are kept aside (staged) & imported when the mapping is approved,
 * since the sender only sends again what changes.
 */

// questionnaires of an outbreak
const QUESTIONNAIRES = [
  'caseInvestigationTemplate',
  'contactInvestigationTemplate',
  'eventInvestigationTemplate',
  'caseFollowUpTemplate',
  'contactFollowUpTemplate',
  'labResultsTemplate'
];

// mapping status
const STATUS = {
  // the receiver must choose the outbreak & map the questions
  PENDING: 'PENDING',
  // mapped; used on every sync
  APPROVED: 'APPROVED',
  // the sender questionnaire changed (new questions / answers) & the receiver must review it
  REVIEW: 'REVIEW'
};

// what to do with the sender outbreak
const MODE = {
  // it is one of the outbreaks of this instance
  MAP: 'map',
  // it doesn't exist here, so it is imported as it is
  NEW: 'new'
};

// why a record was kept aside
const STAGE_REASON = {
  OUTBREAK: 'OUTBREAK_PENDING',
  QUESTIONS: 'QUESTIONS_PENDING'
};

// collection of the records kept aside
const STAGED_COLLECTION = 'syncStagedRecord';

/**
 * Collection of the records kept aside
 * Note: it isn't a loopback model, so the native connection is used (connector.collection only accepts model names)
 */
function getStagedCollection() {
  return app.dataSources.mongoDb.connector.db.collection(STAGED_COLLECTION);
}

// collections that belong to an outbreak, in the order they must be imported
const OUTBREAK_COLLECTIONS = [
  'outbreak',
  'person',
  'followUp',
  'labResult',
  'relationship',
  'cluster',
  'fileAttachment'
];

// answer types that have options
const CHOICE_ANSWER_TYPES = [
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS'
];

// person types
const PERSON_TYPE = {
  CASE: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
  CONTACT: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
  EVENT: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
};

/**
 * Questions of a questionnaire as a flat list (the additional questions of an answer follow it)
 * @param {Array} questions
 * @param {number} [depth]
 * @param {string} [parentVariable]
 * @returns {Array<{variable: string, text: string, answerType: string, multiAnswer: boolean, answers: Array<{value: string, label: string}>, depth: number, parentVariable: string}>}
 */
function flattenQuestions(questions, depth = 0, parentVariable = null) {
  const result = [];
  (questions || []).forEach((question) => {
    if (!question || !question.variable) {
      return;
    }

    result.push({
      variable: question.variable,
      text: question.text,
      answerType: question.answerType,
      multiAnswer: !!question.multiAnswer,
      answers: (question.answers || []).map((answer) => ({
        value: answer.value,
        label: answer.label
      })),
      depth,
      parentVariable
    });

    // additional questions of the answers / question
    (question.answers || []).forEach((answer) => {
      result.push(...flattenQuestions(answer.additionalQuestions, depth + 1, question.variable));
    });
    result.push(...flattenQuestions(question.additionalQuestions, depth + 1, question.variable));
  });

  return result;
}

/**
 * Whether a question has options
 */
function isChoiceQuestion(question) {
  return !!question && CHOICE_ANSWER_TYPES.includes(question.answerType);
}

/**
 * Questionnaires of an outbreak as flat lists
 */
function getFlatQuestionnaires(outbreak) {
  const result = {};
  QUESTIONNAIRES.forEach((questionnaire) => {
    result[questionnaire] = flattenQuestions(outbreak && outbreak[questionnaire]);
  });
  return result;
}

/**
 * Sender questions (and answers) that weren't mapped yet
 * @returns {Array<{questionnaire: string, variable: string}>}
 */
function getUnmappedQuestions(mapping) {
  const result = [];
  QUESTIONNAIRES.forEach((questionnaire) => {
    const questionMappings = _.get(mapping, `questionMappings.${questionnaire}`) || {};
    (_.get(mapping, `sourceQuestionnaires.${questionnaire}`) || []).forEach((question) => {
      const questionMapping = questionMappings[question.variable];

      // never mapped
      if (!questionMapping) {
        result.push({
          questionnaire,
          variable: question.variable
        });
        return;
      }

      // new options of a question that was mapped to another one
      if (
        questionMapping.targetVariable &&
        isChoiceQuestion(question) &&
        question.answers.some((answer) => !_.has(questionMapping.answers || {}, answer.value))
      ) {
        result.push({
          questionnaire,
          variable: question.variable
        });
      }
    });
  });

  return result;
}

/**
 * Questionnaire answers of a record & the questionnaire they belong to
 * @returns {Promise<Array<{field: string, questionnaire: string}>>}
 */
function getQuestionnaireFields(context, collectionName, record) {
  switch (collectionName) {
    case 'person':
      switch (record.type) {
        case PERSON_TYPE.CASE:
          return Promise.resolve([{
            field: 'questionnaireAnswers',
            questionnaire: 'caseInvestigationTemplate'
          }, {
            field: 'questionnaireAnswersContact',
            questionnaire: 'contactInvestigationTemplate'
          }]);
        case PERSON_TYPE.CONTACT:
          return Promise.resolve([{
            field: 'questionnaireAnswers',
            questionnaire: 'contactInvestigationTemplate'
          }, {
            field: 'questionnaireAnswersCase',
            questionnaire: 'caseInvestigationTemplate'
          }]);
        case PERSON_TYPE.EVENT:
          return Promise.resolve([{
            field: 'questionnaireAnswers',
            questionnaire: 'eventInvestigationTemplate'
          }]);
        default:
          return Promise.resolve([]);
      }

    case 'labResult':
      return Promise.resolve([{
        field: 'questionnaireAnswers',
        questionnaire: 'labResultsTemplate'
      }]);

    case 'followUp':
      // the follow-ups of cases & contacts have different questionnaires
      return getPersonType(context, record.personId)
        .then((personType) => [{
          field: 'questionnaireAnswers',
          questionnaire: personType === PERSON_TYPE.CASE ?
            'caseFollowUpTemplate' :
            'contactFollowUpTemplate'
        }]);

    default:
      return Promise.resolve([]);
  }
}

/**
 * Type of a person; from the records already processed, otherwise from the database
 */
function getPersonType(context, personId) {
  if (!personId) {
    return Promise.resolve(null);
  }

  if (context.personTypes[personId]) {
    return Promise.resolve(context.personTypes[personId]);
  }

  return app.models.person
    .rawFind({
      _id: personId
    }, {
      projection: {
        type: 1
      },
      includeDeletedRecords: true,
      limit: 1
    })
    .then((persons) => {
      const type = persons.length ? persons[0].type : null;
      context.personTypes[personId] = type;
      return type;
    });
}

/**
 * Convert the answers of a questionnaire using the mapping of its questions
 * @returns {{answers: Object, pendingVariables: string[]}} pendingVariables - questions (or answers) that weren't mapped yet
 */
function mapAnswers(answers, questionMappings, sourceQuestions) {
  const result = {};
  const pendingVariables = [];
  if (!_.isPlainObject(answers)) {
    return {
      answers: result,
      pendingVariables
    };
  }

  const sourceQuestionsMap = _.keyBy(sourceQuestions || [], 'variable');
  Object.keys(answers).forEach((variable) => {
    const sourceQuestion = sourceQuestionsMap[variable];
    const questionMapping = (questionMappings || {})[variable];

    // answer of a question that isn't in the questionnaire anymore
    if (!sourceQuestion) {
      return;
    }

    // never mapped
    if (!questionMapping) {
      pendingVariables.push(variable);
      return;
    }

    // ignored
    if (!questionMapping.targetVariable) {
      return;
    }

    // convert the values of the options
    const choice = isChoiceQuestion(sourceQuestion);
    let hasUnmappedValues = false;
    const mapValue = (value) => {
      if (!choice || value === undefined || value === null || value === '') {
        return value;
      }

      // option that wasn't mapped yet
      if (!_.has(questionMapping.answers || {}, value)) {
        hasUnmappedValues = true;
        return undefined;
      }

      // null means ignored
      const mapped = questionMapping.answers[value];
      return mapped === null ? undefined : mapped;
    };

    const items = (Array.isArray(answers[variable]) ? answers[variable] : [answers[variable]])
      .map((item) => {
        if (!_.isPlainObject(item)) {
          return item;
        }

        const value = Array.isArray(item.value) ?
          item.value.map(mapValue).filter((mapped) => mapped !== undefined) :
          mapValue(item.value);
        return Object.assign({}, item, {
          value
        });
      })
      // an option without correspondence stays blank
      .filter((item) => !_.isPlainObject(item) || (
        item.value !== undefined && (
          !Array.isArray(item.value) ||
          item.value.length > 0
        )
      ));

    if (hasUnmappedValues) {
      pendingVariables.push(variable);
    }

    if (items.length) {
      result[questionMapping.targetVariable] = items;
    }
  });

  return {
    answers: result,
    pendingVariables
  };
}

/**
 * Outbreak of a record
 */
function getRecordOutbreakId(collectionName, record) {
  return collectionName === 'outbreak' ?
    (record._id || record.id) :
    record.outbreakId;
}

/**
 * Keep a record aside until the mapping is approved; only its last version is kept
 */
function stageRecord(context, collectionName, record, reason, pendingVariables) {
  const recordId = record._id || record.id;
  const sourceOutbreakId = getRecordOutbreakId(collectionName, record);
  const stagedRecord = _.cloneDeep(record);
  delete stagedRecord.id;

  context.staged[sourceOutbreakId] = (context.staged[sourceOutbreakId] || 0) + 1;

  return getStagedCollection()
    .updateOne({
      _id: `${context.clientId}|${collectionName}|${recordId}|${reason}`
    }, {
      $set: {
        clientId: context.clientId,
        sourceOutbreakId,
        collectionName,
        recordId,
        reason,
        pendingVariables: pendingVariables || [],
        record: stagedRecord,
        updatedAt: localizationHelper.now().toDate()
      }
    }, {
      upsert: true
    });
}

/**
 * Load what is needed to map the records received from a client
 * @param {string} clientId
 * @param {Object} options - request options, used to save the mappings
 * @returns {Promise<Object>} context used by the other functions
 */
function createContext(clientId, options) {
  const context = {
    clientId,
    options,
    mappings: {},
    // sender outbreaks that also exist here with the same id, so they don't need to be mapped (e.g. synced before)
    sameIdOutbreaks: {},
    personTypes: {},
    staged: {},
    // mappings being created, so parallel records don't create the same mapping twice
    creating: {}
  };

  return Promise.all([
    app.models.syncOutbreakMapping.find({
      where: {
        clientId
      }
    }),
    app.models.outbreak.rawFind({}, {
      projection: {
        _id: 1
      },
      includeDeletedRecords: true
    })
  ])
    .then(([mappings, outbreaks]) => {
      mappings.forEach((mapping) => {
        context.mappings[mapping.sourceOutbreakId] = mapping;
      });
      outbreaks.forEach((outbreak) => {
        // an outbreak that was mapped as new is imported with its id, but it must still use its mapping
        if (!context.mappings[outbreak.id]) {
          context.sameIdOutbreaks[outbreak.id] = true;
        }
      });

      return context;
    });
}

/**
 * Create / update the mapping of a sender outbreak with its questionnaires
 * @param {Object} context
 * @param {string} sourceOutbreakId
 * @param {Object} [outbreak] - sender outbreak, when it was received
 * @returns {Promise<Object>} mapping
 */
function saveOutbreakMapping(context, sourceOutbreakId, outbreak) {
  // wait for a mapping that is being created
  if (context.creating[sourceOutbreakId]) {
    return context.creating[sourceOutbreakId].then(() => saveOutbreakMapping(context, sourceOutbreakId, outbreak));
  }

  const mapping = context.mappings[sourceOutbreakId];

  // no news about the outbreak
  if (mapping && !outbreak) {
    return Promise.resolve(mapping);
  }

  const data = outbreak ? {
    sourceOutbreakName: outbreak.name,
    sourceQuestionnaires: getFlatQuestionnaires(outbreak)
  } : {};

  // new outbreak
  if (!mapping) {
    context.creating[sourceOutbreakId] = app.models.syncOutbreakMapping
      .create(Object.assign({
        clientId: context.clientId,
        sourceOutbreakId,
        status: STATUS.PENDING,
        questionMappings: {}
      }, data), context.options)
      .then((createdMapping) => {
        context.mappings[sourceOutbreakId] = createdMapping;
        delete context.creating[sourceOutbreakId];
        return createdMapping;
      })
      .catch((err) => {
        delete context.creating[sourceOutbreakId];
        throw err;
      });
    return context.creating[sourceOutbreakId];
  }

  // the questionnaire might have changed
  const updatedMapping = Object.assign({}, mapping.toJSON(), data);
  if (
    updatedMapping.mode === MODE.MAP &&
    updatedMapping.status === STATUS.APPROVED
  ) {
    const unmappedQuestions = getUnmappedQuestions(updatedMapping);
    if (unmappedQuestions.length) {
      data.status = STATUS.REVIEW;
      data.pendingQuestions = unmappedQuestions;
    }
  } else if (updatedMapping.status === STATUS.REVIEW) {
    data.pendingQuestions = getUnmappedQuestions(updatedMapping);
  }

  return mapping
    .updateAttributes(data, context.options)
    .then((savedMapping) => {
      context.mappings[sourceOutbreakId] = savedMapping;
      return savedMapping;
    });
}

/**
 * Decide what to do with a record received from a client
 * @param {Object} context
 * @param {string} collectionName
 * @param {Object} record
 * @returns {Promise<{action: 'import' | 'skip' | 'stage', record?: Object}>}
 *  import - import the returned record (it might be converted);
 *  skip - don't import it (e.g. the sender outbreak is mapped to an outbreak of this instance);
 *  stage - it was kept aside until the mapping is approved
 */
function prepareRecord(context, collectionName, record) {
  if (!OUTBREAK_COLLECTIONS.includes(collectionName)) {
    return Promise.resolve({
      action: 'import',
      record
    });
  }

  // records that don't belong to an outbreak / outbreaks that exist here with the same id
  const sourceOutbreakId = getRecordOutbreakId(collectionName, record);
  if (
    !sourceOutbreakId ||
    context.sameIdOutbreaks[sourceOutbreakId]
  ) {
    return Promise.resolve({
      action: 'import',
      record
    });
  }

  return saveOutbreakMapping(
    context,
    sourceOutbreakId,
    collectionName === 'outbreak' ? record : undefined
  )
    .then((mapping) => {
      // the receiver didn't choose what to do with the outbreak yet
      if (
        !mapping.mode ||
        mapping.status === STATUS.PENDING
      ) {
        return stageRecord(context, collectionName, record, STAGE_REASON.OUTBREAK)
          .then(() => ({
            action: 'stage'
          }));
      }

      // imported as it is
      if (mapping.mode === MODE.NEW) {
        return {
          action: 'import',
          record
        };
      }

      // the receiver keeps its own outbreak
      if (collectionName === 'outbreak') {
        return {
          action: 'skip'
        };
      }

      return convertRecord(context, mapping, collectionName, record)
        .then(({ convertedRecord, pendingVariables }) => {
          // the answers of the questions that weren't mapped yet are imported when the mapping is approved
          return (
            pendingVariables.length ?
              stageRecord(context, collectionName, record, STAGE_REASON.QUESTIONS, pendingVariables) :
              Promise.resolve()
          )
            .then(() => ({
              action: 'import',
              record: convertedRecord
            }));
        });
    });
}

/**
 * Convert a record of a sender outbreak to the receiver outbreak
 * @returns {Promise<{convertedRecord: Object, pendingVariables: string[]}>}
 */
function convertRecord(context, mapping, collectionName, record) {
  const convertedRecord = _.cloneDeep(record);
  convertedRecord.outbreakId = mapping.targetOutbreakId;

  // keep the type of the persons, needed for their follow-ups
  if (collectionName === 'person') {
    context.personTypes[record._id || record.id] = record.type;
  }

  return getQuestionnaireFields(context, collectionName, record)
    .then((fields) => {
      const pendingVariables = [];
      fields.forEach(({ field, questionnaire }) => {
        if (!_.isPlainObject(record[field])) {
          return;
        }

        const mapped = mapAnswers(
          record[field],
          _.get(mapping, `questionMappings.${questionnaire}`),
          _.get(mapping, `sourceQuestionnaires.${questionnaire}`)
        );
        convertedRecord[field] = mapped.answers;
        pendingVariables.push(...mapped.pendingVariables.map((variable) => `${questionnaire}.${variable}`));
      });

      return {
        convertedRecord,
        pendingVariables
      };
    });
}

/**
 * Model used to import a record
 */
function getRecordModel(collectionName, record) {
  if (collectionName === 'person') {
    switch (record.type) {
      case PERSON_TYPE.CASE:
        return app.models.case;
      case PERSON_TYPE.CONTACT:
        return app.models.contact;
      case PERSON_TYPE.EVENT:
        return app.models.event;
      case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT':
        return app.models.contactOfContact;
    }
  }

  return app.models[dbSync.collectionsMap[collectionName]];
}

/**
 * Import the records kept aside for a mapping that was approved
 * @param {Object} mapping - approved mapping
 * @param {Object} options - request options
 * @returns {Promise<{imported: number, failed: Array<string>}>}
 */
function importStagedRecords(mapping, options) {
  const result = {
    imported: 0,
    failed: []
  };
  const stagedCollection = getStagedCollection();

  return Promise.all([
    stagedCollection
      .find({
        clientId: mapping.clientId,
        sourceOutbreakId: mapping.sourceOutbreakId
      })
      .toArray(),
    createContext(mapping.clientId, options)
  ])
    .then(([stagedRecords, context]) => {
      // the records are imported as received, using the approved mapping
      context.mappings[mapping.sourceOutbreakId] = mapping;
      delete context.sameIdOutbreaks[mapping.sourceOutbreakId];
      const importOptions = Object.assign({}, options, {
        _sync: true,
        snapshotFromClient: true
      });

      // outbreak & persons before the records that depend on them
      stagedRecords.sort((a, b) => OUTBREAK_COLLECTIONS.indexOf(a.collectionName) - OUTBREAK_COLLECTIONS.indexOf(b.collectionName));

      // one by one, so the follow-ups find the type of their persons
      return stagedRecords.reduce((previous, stagedRecord) => previous.then(() => {
        const record = _.cloneDeep(stagedRecord.record);
        record.id = record._id;

        const imported = stagedRecord.reason === STAGE_REASON.QUESTIONS ?
          applyPendingAnswers(context, mapping, stagedRecord.collectionName, record) :
          prepareRecord(context, stagedRecord.collectionName, record)
            .then((prepared) => {
              if (prepared.action !== 'import') {
                return;
              }

              return new Promise((resolve, reject) => {
                dbSync.syncRecord(
                  app,
                  app.logger,
                  getRecordModel(stagedRecord.collectionName, prepared.record),
                  prepared.record,
                  Object.assign({}, importOptions),
                  (err) => err ? reject(err) : resolve()
                );
              });
            });

        return imported
          .then(() => {
            result.imported++;
            return stagedCollection.deleteOne({
              _id: stagedRecord._id
            });
          })
          .catch((err) => {
            result.failed.push(`${stagedRecord.collectionName} ${stagedRecord.recordId}: ${err && err.message ? err.message : err}`);
          });
      }), Promise.resolve());
    })
    .then(() => result);
}

/**
 * Add the answers of the questions that were mapped now to a record that was already imported
 * Note: answers that already exist aren't changed, since they might have been updated after the import
 */
function applyPendingAnswers(context, mapping, collectionName, record) {
  return convertRecord(context, mapping, collectionName, record)
    .then(({ convertedRecord }) => getQuestionnaireFields(context, collectionName, record)
      .then((fields) => {
        const collection = app.dataSources.mongoDb.connector.collection(dbSync.collectionsMap[collectionName]);
        return collection
          .findOne({
            _id: record._id
          })
          .then((dbRecord) => {
            // the record isn't here (e.g. it was deleted)
            if (!dbRecord) {
              return;
            }

            const update = {};
            fields.forEach(({ field }) => {
              _.each(convertedRecord[field] || {}, (answer, variable) => {
                if (!_.has(dbRecord, [field, variable])) {
                  update[`${field}.${variable}`] = answer;
                }
              });
            });
            if (_.isEmpty(update)) {
              return;
            }

            return collection.updateOne({
              _id: record._id
            }, {
              $set: update
            });
          });
      }));
}

/**
 * Message added to the sync log when records were kept aside
 */
function getStagedMessage(context) {
  const sourceOutbreakIds = Object.keys(context.staged);
  if (!sourceOutbreakIds.length) {
    return null;
  }

  const outbreaks = sourceOutbreakIds.map((sourceOutbreakId) => {
    const name = _.get(context.mappings[sourceOutbreakId], 'sourceOutbreakName') || sourceOutbreakId;
    return `${name} (${context.staged[sourceOutbreakId]})`;
  });
  return `Records waiting for the approval of the outbreak / questionnaire mapping: ${outbreaks.join(', ')}. `;
}

module.exports = {
  QUESTIONNAIRES,
  STATUS,
  MODE,
  STAGE_REASON,
  STAGED_COLLECTION,
  OUTBREAK_COLLECTIONS,
  flattenQuestions,
  isChoiceQuestion,
  getFlatQuestionnaires,
  getUnmappedQuestions,
  mapAnswers,
  createContext,
  prepareRecord,
  importStagedRecords,
  getStagedMessage,
  getStagedCollection
};
