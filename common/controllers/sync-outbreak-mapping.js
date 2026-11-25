'use strict';

const _ = require('lodash');
const app = require('../../server/server');
const localizationHelper = require('../../components/localizationHelper');
const syncOutbreakMapping = require('../../components/syncOutbreakMapping');
const syncOutbreakAccess = require('../../components/syncOutbreakAccess');

module.exports = function (SyncOutbreakMapping) {

  /**
   * Translate language tokens to the language of the user (english when the translation is missing)
   * @returns {Promise<Object>} map of token => translation
   */
  function translate(tokens, options) {
    tokens = _.uniq(tokens.filter((token) => typeof token === 'string' && token));
    if (!tokens.length) {
      return Promise.resolve({});
    }

    const languageId = _.get(app.utils.remote.getUserFromOptions(options), 'languageId') || 'english_us';
    return app.models.languageToken
      .rawFind({
        token: {
          $in: tokens
        },
        languageId: {
          $in: _.uniq([languageId, 'english_us'])
        }
      }, {
        projection: {
          token: 1,
          languageId: 1,
          translation: 1
        }
      })
      .then((languageTokens) => {
        const result = {};
        languageTokens
          // the language of the user has priority
          .sort((a, b) => (a.languageId === languageId ? 1 : 0) - (b.languageId === languageId ? 1 : 0))
          .forEach((languageToken) => {
            result[languageToken.token] = languageToken.translation;
          });
        return result;
      });
  }

  /**
   * Text sent by the other instance with the request of the outbreak (its texts arrive with its data, only after it is accepted)
   */
  function getSourceText(sourceTexts, token, options) {
    const translations = sourceTexts && sourceTexts[token];
    if (!translations) {
      return undefined;
    }

    const languageId = _.get(app.utils.remote.getUserFromOptions(options), 'languageId') || 'english_us';
    return translations[languageId] ||
      translations.english_us ||
      _.values(translations)[0];
  }

  /**
   * Add the texts to the questions of the questionnaires
   */
  function translateQuestionnaires(questionnaires, options, sourceTexts) {
    const tokens = [];
    _.each(questionnaires, (questions) => {
      (questions || []).forEach((question) => {
        tokens.push(question.text);
        question.answers.forEach((answer) => tokens.push(answer.label));
      });
    });

    return translate(tokens, options)
      .then((translations) => {
        const result = {};
        _.each(questionnaires, (questions, questionnaire) => {
          result[questionnaire] = (questions || []).map((question) => Object.assign({}, question, {
            textTranslated: translations[question.text] || getSourceText(sourceTexts, question.text, options) || question.text,
            answers: question.answers.map((answer) => Object.assign({}, answer, {
              labelTranslated: translations[answer.label] || getSourceText(sourceTexts, answer.label, options) || answer.label
            }))
          }));
        });
        return result;
      });
  }

  /**
   * Retrieve what is needed to map a received outbreak
   */
  SyncOutbreakMapping.getDetails = function (id, options, callback) {
    SyncOutbreakMapping
      .findById(id)
      .then((mapping) => {
        if (!mapping) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: SyncOutbreakMapping.modelName,
            id
          });
        }

        return Promise.all([
          translateQuestionnaires(mapping.sourceQuestionnaires || {}, options, mapping.sourceTexts),
          app.models.outbreak.find({
            fields: ['id', 'name'],
            order: 'name ASC'
          }),
          app.models.clientApplication.findOne({
            where: {
              'credentials.clientId': mapping.clientId
            },
            fields: ['id', 'name']
          }),
          syncOutbreakMapping
            .getStagedCollection()
            .countDocuments({
              clientId: mapping.clientId,
              sourceOutbreakId: mapping.sourceOutbreakId
            })
        ])
          .then(([sourceQuestionnaires, outbreaks, clientApplication, stagedRecordsCount]) => callback(null, {
            mapping,
            sourceQuestionnaires,
            outbreaks: outbreaks
              // an outbreak that was imported as new is the received one
              .filter((outbreak) => outbreak.id !== mapping.sourceOutbreakId)
              .map((outbreak) => ({
                id: outbreak.id,
                name: outbreak.name
              })),
            clientApplication: clientApplication ? {
              id: clientApplication.id,
              name: clientApplication.name
            } : null,
            stagedRecordsCount
          }));
      })
      .catch(callback);
  };

  /**
   * Retrieve the questionnaires of an outbreak of this instance, with their texts
   */
  SyncOutbreakMapping.getTargetQuestionnaires = function (outbreakId, options, callback) {
    app.models.outbreak
      .findById(outbreakId)
      .then((outbreak) => {
        if (!outbreak) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.outbreak.modelName,
            id: outbreakId
          });
        }

        return translateQuestionnaires(syncOutbreakMapping.getFlatQuestionnaires(outbreak), options);
      })
      .then((questionnaires) => callback(null, questionnaires))
      .catch(callback);
  };

  /**
   * Validate the question mappings sent by the user
   * @param {Object} sourceLabels - map of received option label token => text (language of the user), written when an option is converted to free text
   * @returns {Object} question mappings with only the known questions
   */
  function validateQuestionMappings(questionMappings, mapping, targetQuestionnaires, sourceLabels) {
    const result = {};
    const typeName = (question) => (question.answerType || '').replace('LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_', '');
    syncOutbreakMapping.QUESTIONNAIRES.forEach((questionnaire) => {
      result[questionnaire] = {};
      const targetQuestions = _.keyBy(targetQuestionnaires[questionnaire] || [], 'variable');
      const usedTargets = {};
      (_.get(mapping, `sourceQuestionnaires.${questionnaire}`) || []).forEach((sourceQuestion) => {
        // markup questions don't have answers
        if (!syncOutbreakMapping.isAnswerableQuestion(sourceQuestion)) {
          return;
        }

        const questionMapping = _.get(questionMappings, [questionnaire, sourceQuestion.variable]);
        if (!questionMapping) {
          return;
        }

        // ignored
        const targetVariable = questionMapping.targetVariable || null;
        if (!targetVariable) {
          result[questionnaire][sourceQuestion.variable] = {
            targetVariable: null
          };
          return;
        }

        // questions are mapped only inside the same questionnaire
        const targetQuestion = targetQuestions[targetVariable];
        if (!targetQuestion) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: `Question "${targetVariable}" doesn't exist in the questionnaire "${questionnaire}" of the outbreak`
          });
        }

        // the answers must fit the question of this instance
        const conversion = syncOutbreakMapping.getConversion(sourceQuestion, targetQuestion);
        if (!conversion) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: `Question "${sourceQuestion.variable}" (${typeName(sourceQuestion)}) can't be mapped to question "${targetVariable}" (${typeName(targetQuestion)}): the answer types aren't compatible`
          });
        }

        // a question of this instance receives the answers of only one received question, otherwise one would overwrite the other
        if (usedTargets[targetVariable]) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: `Questions "${usedTargets[targetVariable]}" and "${sourceQuestion.variable}" are mapped to the same question "${targetVariable}"`
          });
        }
        usedTargets[targetVariable] = sourceQuestion.variable;

        // options
        const answers = {};
        if (syncOutbreakMapping.isChoiceQuestion(sourceQuestion)) {
          const targetValues = targetQuestion.answers.map((answer) => answer.value);
          sourceQuestion.answers.forEach((sourceAnswer) => {
            // option written as text: the text sent by the user or the text of the option
            if (conversion === syncOutbreakMapping.CONVERSION.CHOICE_TO_TEXT) {
              const text = _.get(questionMapping, ['answers', sourceAnswer.value]);
              answers[sourceAnswer.value] = text === null ?
                null : (
                  typeof text === 'string' && text.trim() ?
                    text.trim() :
                    (sourceLabels[sourceAnswer.label] || sourceAnswer.value)
                );
              return;
            }

            if (!_.has(questionMapping.answers || {}, sourceAnswer.value)) {
              return;
            }

            const targetValue = questionMapping.answers[sourceAnswer.value];
            if (
              targetValue !== null &&
              targetValue !== undefined &&
              !targetValues.includes(targetValue)
            ) {
              throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
                errorMessages: `Answer "${targetValue}" doesn't exist in the question "${targetVariable}"`
              });
            }

            answers[sourceAnswer.value] = targetValue === undefined ? null : targetValue;
          });
        }

        result[questionnaire][sourceQuestion.variable] = {
          targetVariable,
          conversion,
          answers
        };
      });
    });

    return result;
  }

  /**
   * Approve the mapping of a received outbreak & import the records that were waiting for it
   */
  SyncOutbreakMapping.approve = function (id, data, options, callback) {
    data = data || {};
    let mapping;
    SyncOutbreakMapping
      .findById(id)
      .then((foundMapping) => {
        mapping = foundMapping;
        if (!mapping) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: SyncOutbreakMapping.modelName,
            id
          });
        }

        // imported as it is; the outbreak name must be unique
        if (data.mode === syncOutbreakMapping.MODE.NEW) {
          return app.models.outbreak
            .findOne({
              where: {
                name: mapping.sourceOutbreakName,
                id: {
                  neq: mapping.sourceOutbreakId
                }
              }
            })
            .then((sameNameOutbreak) => {
              if (sameNameOutbreak) {
                throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
                  errorMessages: `There is already an outbreak named "${mapping.sourceOutbreakName}". Map the received outbreak to it`
                });
              }

              return {
                mode: syncOutbreakMapping.MODE.NEW,
                targetOutbreakId: null,
                questionMappings: {}
              };
            });
        }

        // mapped to an outbreak of this instance
        if (data.mode !== syncOutbreakMapping.MODE.MAP) {
          throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
            errorMessages: 'Property "mode" must be "map" or "new"'
          });
        }

        // texts of the received options, used when they are written to free text questions
        const sourceLabelTokens = [];
        _.each(mapping.sourceQuestionnaires || {}, (questions) => {
          (questions || []).forEach((question) => (question.answers || []).forEach((answer) => sourceLabelTokens.push(answer.label)));
        });

        return Promise.all([
          app.models.outbreak.findById(data.targetOutbreakId),
          translate(sourceLabelTokens, options)
        ])
          .then(([targetOutbreak, sourceLabels]) => {
            if (!targetOutbreak) {
              throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
                errorMessages: 'Property "targetOutbreakId" must be an outbreak of this instance'
              });
            }

            const questionMappings = validateQuestionMappings(
              data.questionMappings,
              mapping,
              syncOutbreakMapping.getFlatQuestionnaires(targetOutbreak),
              sourceLabels
            );

            // every received question (& option) must be reviewed
            const unmappedQuestions = syncOutbreakMapping.getUnmappedQuestions({
              sourceQuestionnaires: mapping.sourceQuestionnaires,
              questionMappings
            });
            if (unmappedQuestions.length) {
              throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
                errorMessages: `Map or ignore every question and answer. Missing: ${unmappedQuestions.map((question) => `${question.questionnaire}.${question.variable}`).join(', ')}`
              });
            }

            return {
              mode: syncOutbreakMapping.MODE.MAP,
              targetOutbreakId: targetOutbreak.id,
              questionMappings
            };
          });
      })
      .then((approvedData) => mapping.updateAttributes(Object.assign(approvedData, {
        status: syncOutbreakMapping.STATUS.APPROVED,
        pendingQuestions: [],
        approvedAt: localizationHelper.now().toDate(),
        approvedBy: _.get(app.utils.remote.getUserFromOptions(options), 'id')
      }), options))
      // the user decided where the data goes, so the outbreak is accepted (keys of other instances)
      .then((approvedMapping) => syncOutbreakAccess
        .acceptReviewedOutbreak(approvedMapping, options)
        .then(() => approvedMapping))
      .then((approvedMapping) => syncOutbreakMapping
        .importStagedRecords(approvedMapping, options)
        .then((importResult) => callback(null, {
          mapping: approvedMapping,
          imported: importResult.imported,
          failed: importResult.failed
        })))
      .catch(callback);
  };
};
