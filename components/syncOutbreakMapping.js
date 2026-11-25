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

// answer types
const ANSWER_TYPE = {
  SINGLE: 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER',
  MULTIPLE: 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS',
  FREE_TEXT: 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FREE_TEXT',
  MARKUP: 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP'
};

// answer types that have options
const CHOICE_ANSWER_TYPES = [
  ANSWER_TYPE.SINGLE,
  ANSWER_TYPE.MULTIPLE
];

// how the answers of a received question are converted to the question of this instance
// Note: must match the web app (sync-outbreak-mapping.model.ts)
const CONVERSION = {
  // same answer type: values are copied (options are converted)
  SAME: 'same',
  // single answer -> multiple answers: the converted option becomes a list
  SINGLE_TO_MULTIPLE: 'singleToMultiple',
  // single / multiple answers -> free text: the text of the options is written (multiple options separated by comma)
  CHOICE_TO_TEXT: 'choiceToText'
};

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
 * Whether a question can have answers (markup questions are only texts displayed in the questionnaire)
 */
function isAnswerableQuestion(question) {
  return !!question && question.answerType !== ANSWER_TYPE.MARKUP;
}

/**
 * How the answers of a received question are converted to a question of this instance
 * @returns {string|null} one of CONVERSION, null when the questions aren't compatible
 */
function getConversion(sourceQuestion, targetQuestion) {
  if (
    !isAnswerableQuestion(sourceQuestion) ||
    !isAnswerableQuestion(targetQuestion)
  ) {
    return null;
  }

  if (sourceQuestion.answerType === targetQuestion.answerType) {
    return CONVERSION.SAME;
  }

  if (
    sourceQuestion.answerType === ANSWER_TYPE.SINGLE &&
    targetQuestion.answerType === ANSWER_TYPE.MULTIPLE
  ) {
    return CONVERSION.SINGLE_TO_MULTIPLE;
  }

  if (
    isChoiceQuestion(sourceQuestion) &&
    targetQuestion.answerType === ANSWER_TYPE.FREE_TEXT
  ) {
    return CONVERSION.CHOICE_TO_TEXT;
  }

  return null;
}

/**
 * Remove from a mapping the decisions that don't apply anymore to the questionnaires of the outbreak of this instance
 * (question / option removed, answer type changed), so the received questions are mapped again
 * Note: it also completes the conversion of the mappings approved before it was saved
 * @param {Object} mapping
 * @param {Object} targetOutbreak - outbreak of this instance (with its questionnaires)
 * @returns {{questionMappings: Object, changed: boolean}}
 */
function sanitizeQuestionMappings(mapping, targetOutbreak) {
  const questionMappings = _.cloneDeep(mapping.questionMappings || {});
  let changed = false;
  QUESTIONNAIRES.forEach((questionnaire) => {
    const sourceQuestions = _.keyBy(_.get(mapping, `sourceQuestionnaires.${questionnaire}`) || [], 'variable');
    const targetQuestions = _.keyBy(flattenQuestions(targetOutbreak && targetOutbreak[questionnaire]), 'variable');
    _.each(questionMappings[questionnaire] || {}, (questionMapping, sourceVariable) => {
      if (!questionMapping || !questionMapping.targetVariable) {
        return;
      }

      // question of this instance removed / not compatible anymore => map again
      // Note: received questions that aren't in the questionnaire anymore are kept as they are, they don't receive answers
      const sourceQuestion = sourceQuestions[sourceVariable];
      const targetQuestion = targetQuestions[questionMapping.targetVariable];
      const conversion = sourceQuestion ?
        getConversion(sourceQuestion, targetQuestion) :
        questionMapping.conversion;
      if (!targetQuestion || !conversion) {
        delete questionMappings[questionnaire][sourceVariable];
        changed = true;
        return;
      }

      if (questionMapping.conversion !== conversion) {
        questionMapping.conversion = conversion;
        changed = true;
      }

      // options of this instance that were removed => map them again
      if (
        conversion !== CONVERSION.CHOICE_TO_TEXT &&
        isChoiceQuestion(targetQuestion)
      ) {
        const targetValues = targetQuestion.answers.map((answer) => answer.value);
        _.each(questionMapping.answers || {}, (targetValue, sourceValue) => {
          if (
            targetValue !== null &&
            !targetValues.includes(targetValue)
          ) {
            delete questionMapping.answers[sourceValue];
            changed = true;
          }
        });
      }
    });
  });

  return {
    questionMappings,
    changed
  };
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
      // markup questions don't have answers, so there is nothing to map
      if (!isAnswerableQuestion(question)) {
        return;
      }

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

        let value = Array.isArray(item.value) ?
          item.value.map(mapValue).filter((mapped) => mapped !== undefined) :
          mapValue(item.value);

        // format of the question of this instance
        if (value !== undefined && value !== null && value !== '') {
          switch (questionMapping.conversion) {
            case CONVERSION.SINGLE_TO_MULTIPLE:
              value = Array.isArray(value) ? value : [value];
              break;
            case CONVERSION.CHOICE_TO_TEXT:
              // the texts of the options
              value = Array.isArray(value) ?
                (value.length ? value.join(', ') : undefined) :
                value;
              break;
          }
        }

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

      return revalidateMappings(context, mappings);
    })
    .then(() => context);
}

/**
 * The questionnaires of the outbreaks of this instance might have changed since the mappings were approved
 * Decisions that don't apply anymore are removed & the mapping must be reviewed, otherwise answers would be written to questions / options that don't exist
 */
function revalidateMappings(context, mappings) {
  const mappedToOutbreaks = mappings.filter((mapping) => (
    mapping.mode === MODE.MAP &&
    mapping.targetOutbreakId &&
    mapping.status !== STATUS.PENDING
  ));
  if (!mappedToOutbreaks.length) {
    return Promise.resolve();
  }

  return app.models.outbreak
    .rawFind({
      _id: {
        $in: _.uniq(mappedToOutbreaks.map((mapping) => mapping.targetOutbreakId))
      }
    }, {
      projection: QUESTIONNAIRES.reduce((projection, questionnaire) => Object.assign(projection, {
        [questionnaire]: 1
      }), {})
    })
    .then((targetOutbreaks) => {
      const targetOutbreaksMap = _.keyBy(targetOutbreaks, 'id');
      return Promise.all(mappedToOutbreaks.map((mapping) => {
        const sanitized = sanitizeQuestionMappings(mapping.toJSON(), targetOutbreaksMap[mapping.targetOutbreakId]);
        if (!sanitized.changed) {
          return Promise.resolve();
        }

        const unmappedQuestions = getUnmappedQuestions({
          sourceQuestionnaires: mapping.sourceQuestionnaires,
          questionMappings: sanitized.questionMappings
        });
        const data = {
          questionMappings: sanitized.questionMappings
        };
        if (unmappedQuestions.length) {
          data.status = STATUS.REVIEW;
          data.pendingQuestions = unmappedQuestions;
        }

        return mapping
          .updateAttributes(data, context.options)
          .then((savedMapping) => {
            context.mappings[savedMapping.sourceOutbreakId] = savedMapping;
          });
      }));
    });
}

/**
 * Create / update the mapping of a sender outbreak with its questionnaires
 * @param {Object} context
 * @param {string} sourceOutbreakId
 * @param {Object} [outbreak] - sender outbreak, when it was received
 * @returns {Promise<Object>} mapping
 */
function saveOutbreakMapping(context, sourceOutbreakId, outbreak, sourceTexts) {
  // wait for a mapping that is being created
  if (context.creating[sourceOutbreakId]) {
    return context.creating[sourceOutbreakId].then(() => saveOutbreakMapping(context, sourceOutbreakId, outbreak, sourceTexts));
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

  // texts of the questions, sent with the request of the outbreak (its data, with the texts, arrives only after it is accepted)
  if (sourceTexts && Object.keys(sourceTexts).length) {
    data.sourceTexts = Object.assign({}, mapping && mapping.sourceTexts, sourceTexts);
  }

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
        .then(({ convertedRecord, pendingVariables, authoritativeFields }) => {
          // the answers of the questions that weren't mapped yet are imported when the mapping is approved
          return (
            pendingVariables.length ?
              stageRecord(context, collectionName, record, STAGE_REASON.QUESTIONS, pendingVariables) :
              Promise.resolve()
          )
            .then(() => ({
              action: 'import',
              record: convertedRecord,
              // the converted answers are complete, they must not be merged with the old ones (removed answers / options would come back)
              syncOptions: {
                skipMergeFields: authoritativeFields
              }
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

  return Promise.all([
    getQuestionnaireFields(context, collectionName, record),
    getCurrentRecord(collectionName, record)
  ])
    .then(([fields, currentRecord]) => {
      const pendingVariables = [];
      const authoritativeFields = [];
      fields.forEach(({ field, questionnaire }) => {
        if (!_.isPlainObject(record[field])) {
          return;
        }

        const mapped = mapAnswers(
          record[field],
          _.get(mapping, `questionMappings.${questionnaire}`),
          _.get(mapping, `sourceQuestionnaires.${questionnaire}`)
        );

        // answers of this instance that don't come from the received questionnaire (e.g. questions that exist only here) are kept
        const receivedTargets = getReceivedTargetVariables(mapping, questionnaire);
        const keptAnswers = _.pickBy(
          _.get(currentRecord, field) || {},
          (answer, variable) => !receivedTargets[variable]
        );
        convertedRecord[field] = Object.assign(keptAnswers, mapped.answers);
        authoritativeFields.push(field);
        pendingVariables.push(...mapped.pendingVariables.map((variable) => `${questionnaire}.${variable}`));
      });

      return {
        convertedRecord,
        pendingVariables,
        authoritativeFields
      };
    });
}

/**
 * Questions of this instance that receive the answers of the received questionnaire
 * Note: questions mapped from received questions that were removed from the received questionnaire keep their answers
 * @returns {Object} map of target variable => true
 */
function getReceivedTargetVariables(mapping, questionnaire) {
  const sourceVariables = _.keyBy(_.get(mapping, `sourceQuestionnaires.${questionnaire}`) || [], 'variable');
  const result = {};
  _.each(_.get(mapping, `questionMappings.${questionnaire}`) || {}, (questionMapping, sourceVariable) => {
    if (
      questionMapping &&
      questionMapping.targetVariable &&
      sourceVariables[sourceVariable]
    ) {
      result[questionMapping.targetVariable] = true;
    }
  });
  return result;
}

/**
 * Record of this instance (if it was already imported)
 */
function getCurrentRecord(collectionName, record) {
  const recordId = record._id || record.id;
  if (!recordId) {
    return Promise.resolve(null);
  }

  return app.dataSources.mongoDb.connector
    .collection(dbSync.collectionsMap[collectionName])
    .findOne({
      _id: recordId
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
          applyPendingAnswers(context, mapping, stagedRecord.collectionName, record, stagedRecord.pendingVariables) :
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
                  Object.assign({}, importOptions, prepared.syncOptions),
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
 * Apply the answers of the questions (and options) that were mapped now to a record that was already imported
 * - the record wasn't changed here since it was imported: the answers of the pending questions are replaced by the complete conversion
 *   (e.g. a received option that is mapped now is added to the options already imported)
 * - the record was changed here after the import: only answers that don't exist are added, so the changes made here aren't lost
 * @param {string[]} pendingVariables - questionnaire.variable of the received questions that were pending when the record was imported
 */
function applyPendingAnswers(context, mapping, collectionName, record, pendingVariables) {
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

            const changedHere = !!dbRecord.updatedAt && !!record.updatedAt &&
              localizationHelper.toMoment(dbRecord.updatedAt).toDate().getTime() > localizationHelper.toMoment(record.updatedAt).toDate().getTime();
            const update = {};
            const unset = {};
            fields.forEach(({ field, questionnaire }) => {
              // questions of this instance that receive the pending answers
              const pendingTargets = {};
              (pendingVariables || []).forEach((pendingVariable) => {
                const [pendingQuestionnaire, sourceVariable] = pendingVariable.split('.');
                const targetVariable = pendingQuestionnaire === questionnaire &&
                  _.get(mapping, ['questionMappings', questionnaire, sourceVariable, 'targetVariable']);
                if (targetVariable) {
                  pendingTargets[targetVariable] = true;
                }
              });

              if (!changedHere) {
                Object.keys(pendingTargets).forEach((variable) => {
                  if (_.has(convertedRecord, [field, variable])) {
                    update[`${field}.${variable}`] = convertedRecord[field][variable];
                  } else if (_.has(dbRecord, [field, variable])) {
                    unset[`${field}.${variable}`] = '';
                  }
                });
                return;
              }

              _.each(convertedRecord[field] || {}, (answer, variable) => {
                if (!_.has(dbRecord, [field, variable])) {
                  update[`${field}.${variable}`] = answer;
                }
              });
            });
            if (
              _.isEmpty(update) &&
              _.isEmpty(unset)
            ) {
              return;
            }

            return collection.updateOne({
              _id: record._id
            }, Object.assign(
              {
                $set: Object.assign(update, {
                  dbUpdatedAt: localizationHelper.now().toDate()
                })
              },
              _.isEmpty(unset) ? {} : {
                $unset: unset
              }
            ));
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
  CONVERSION,
  ANSWER_TYPE,
  isAnswerableQuestion,
  getConversion,
  sanitizeQuestionMappings,
  STAGE_REASON,
  STAGED_COLLECTION,
  OUTBREAK_COLLECTIONS,
  flattenQuestions,
  isChoiceQuestion,
  getFlatQuestionnaires,
  getUnmappedQuestions,
  mapAnswers,
  createContext,
  saveOutbreakMapping,
  prepareRecord,
  importStagedRecords,
  getStagedMessage,
  getStagedCollection
};
