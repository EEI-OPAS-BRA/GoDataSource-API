'use strict';

/**
 * Outbreak access requests between Go.Data instances
 *
 * The instance that sends the data (e.g. a municipality) asks the instance that receives it (e.g. the ministry) to send each of its outbreaks.
 * The receiver accepts / refuses each outbreak before any of its records is sent; only the accepted outbreaks are exported by the sender,
 * and the receiver refuses the records of any other outbreak.
 *
 * Only for the keys of other instances (client application type "instance"); the mobile app and the older keys keep working as before
 * (they are limited by the outbreaks of the key - clientApplication.outbreakIDs).
 */

const _ = require('lodash');
const app = require('../server/server');
const localizationHelper = require('./localizationHelper');
const syncOutbreakMapping = require('./syncOutbreakMapping');
const SyncClient = require('./syncClient');

// decision of the receiver
const STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REFUSED: 'REFUSED',
  PAUSED: 'PAUSED'
};

// how the receiver decides which outbreaks it receives
const MODE = {
  // it accepts / refuses each outbreak
  REQUEST: 'request',
  // older versions & the keys of the mobile app: the outbreaks of the key
  LEGACY: 'legacy'
};

// type of key (client application)
const CLIENT_TYPE = {
  INSTANCE: 'instance',
  MOBILE: 'mobile'
};

// person types counted in a request
const PERSON_TYPE = {
  CASE: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
  CONTACT: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
};

/**
 * The key asks for each outbreak ?
 */
function usesRequests(client) {
  return !!client && client.type === CLIENT_TYPE.INSTANCE;
}

/**
 * Outbreak of a record
 */
function getRecordOutbreakId(collectionName, record) {
  return collectionName === 'outbreak' ?
    (record._id || record.id) :
    record.outbreakId;
}

// ---------------------------------------------------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Decisions about the outbreaks of a client, as sent to it
 */
function getClientResponse(client) {
  if (!usesRequests(client)) {
    return Promise.resolve({
      mode: MODE.LEGACY,
      outbreaks: []
    });
  }

  return app.models.syncOutbreakAccess
    .rawFind({
      clientId: client.credentials.clientId
    }, {
      projection: {
        sourceOutbreakId: 1,
        status: 1,
        decidedAt: 1,
        requestedAt: 1
      }
    })
    .then((accesses) => ({
      mode: MODE.REQUEST,
      outbreaks: accesses.map((access) => ({
        outbreakId: access.sourceOutbreakId,
        status: access.status,
        decidedAt: access.decidedAt,
        requestedAt: access.requestedAt
      }))
    }));
}

/**
 * A client asks to send outbreaks
 * @param {Object} client Client application (key) that sent the request
 * @param {Object} payload {outbreaks: [{id, name, disease, startDate, casesCount, contactsCount, <questionnaires>}], texts: {token: {languageId: translation}}}
 * @param {Object} options
 */
function receiveRequest(client, payload, options) {
  // keys that don't ask for outbreaks
  if (!usesRequests(client)) {
    return getClientResponse(client);
  }

  // validate
  const outbreaks = (_.get(payload, 'outbreaks') || [])
    .filter((outbreak) => outbreak && typeof outbreak.id === 'string' && outbreak.id);
  const texts = _.isPlainObject(_.get(payload, 'texts')) ?
    payload.texts :
    {};
  if (!outbreaks.length) {
    return getClientResponse(client);
  }

  const clientId = client.credentials.clientId;
  const now = localizationHelper.now().toDate();
  return Promise.all([
    app.models.syncOutbreakAccess.find({
      where: {
        clientId,
        sourceOutbreakId: {
          inq: outbreaks.map((outbreak) => outbreak.id)
        }
      }
    }),
    // decisions the user removed: the outbreak must be decided again, it is never accepted automatically
    app.models.syncOutbreakAccess.rawFind({
      clientId,
      sourceOutbreakId: {
        $in: outbreaks.map((outbreak) => outbreak.id)
      },
      deleted: true
    }, {
      includeDeletedRecords: true,
      projection: {
        sourceOutbreakId: 1
      }
    }),
    syncOutbreakMapping.createContext(clientId, options)
  ])
    .then(([accesses, removedAccesses, mappingContext]) => {
      const accessesMap = _.keyBy(accesses, 'sourceOutbreakId');
      const removedMap = _.keyBy(removedAccesses, 'sourceOutbreakId');

      // one outbreak at a time, so the mappings aren't created twice
      return outbreaks.reduce((previous, outbreak) => previous.then(() => {
        const sameIdOutbreak = !!mappingContext.sameIdOutbreaks[outbreak.id];

        // texts of the questions of this outbreak
        const outbreakTexts = {};
        _.each(syncOutbreakMapping.getFlatQuestionnaires(outbreak), (questions) => {
          (questions || []).forEach((question) => {
            [question.text].concat(question.answers.map((answer) => answer.label)).forEach((token) => {
              if (texts[token]) {
                outbreakTexts[token] = texts[token];
              }
            });
          });
        });

        // the outbreak doesn't exist here: its data goes where the user says (review of the mapping)
        return (
          sameIdOutbreak ?
            Promise.resolve(null) :
            syncOutbreakMapping.saveOutbreakMapping(mappingContext, outbreak.id, outbreak, outbreakTexts)
        )
          .then((mapping) => {
            // what the sender says about the outbreak
            const data = {
              sourceOutbreakName: outbreak.name,
              sourceDisease: outbreak.disease,
              sourceStartDate: outbreak.startDate,
              sourceCasesCount: outbreak.casesCount,
              sourceContactsCount: outbreak.contactsCount,
              sameIdOutbreak,
              mappingId: mapping ? mapping.id : undefined,
              requestedAt: now
            };

            // asked before
            const access = accessesMap[outbreak.id];
            if (access) {
              // a mapping approved earlier (e.g. before the key asked for its outbreaks) already says where the data goes
              if (
                access.status === STATUS.PENDING &&
                mapping &&
                mapping.status === syncOutbreakMapping.STATUS.APPROVED
              ) {
                data.status = STATUS.ACCEPTED;
                data.decidedAt = now;
              }
              return access.updateAttributes(data, options);
            }

            // new request; it might be accepted right away (never after the user removed the decision)
            const accepted = !removedMap[outbreak.id] && (
              (
                sameIdOutbreak &&
                !!client.autoAcceptSameIdOutbreaks
              ) || (
                !!mapping &&
                mapping.status === syncOutbreakMapping.STATUS.APPROVED
              )
            );
            return app.models.syncOutbreakAccess.create(Object.assign(data, {
              clientId,
              sourceOutbreakId: outbreak.id,
              status: accepted ?
                STATUS.ACCEPTED :
                STATUS.PENDING,
              autoAccepted: accepted,
              decidedAt: accepted ?
                now :
                undefined
            }), options);
          });
      }), Promise.resolve());
    })
    .then(() => getClientResponse(client));
}

/**
 * What the receiver needs to know about a client while it imports its data
 * @returns {Promise<Object|null>} null when the client doesn't ask for its outbreaks
 */
function createImportContext(client, options) {
  if (!usesRequests(client)) {
    return Promise.resolve(null);
  }

  return app.models.syncOutbreakAccess
    .rawFind({
      clientId: client.credentials.clientId
    }, {
      projection: {
        sourceOutbreakId: 1,
        status: 1
      }
    })
    .then((accesses) => {
      const statuses = {};
      accesses.forEach((access) => {
        statuses[access.sourceOutbreakId] = access.status;
      });
      return {
        client,
        options,
        statuses,
        // outbreaks of an older sender that didn't ask for them; asked once per sync
        requesting: {}
      };
    });
}

/**
 * Can a received record be imported ?
 * Records that don't belong to an outbreak (e.g. locations, reference data) are always imported
 */
function isRecordAllowed(importContext, collectionName, record) {
  if (!importContext) {
    return true;
  }

  const sourceOutbreakId = getRecordOutbreakId(collectionName, record);
  return !sourceOutbreakId ||
    importContext.statuses[sourceOutbreakId] === STATUS.ACCEPTED;
}

/**
 * An outbreak was received without a request (e.g. the sender has an older version): it is listed for a decision, its records are refused
 */
function requestReceivedOutbreak(importContext, outbreak) {
  const sourceOutbreakId = outbreak && (outbreak._id || outbreak.id);
  if (
    !importContext ||
    !sourceOutbreakId ||
    importContext.statuses[sourceOutbreakId] ||
    importContext.requesting[sourceOutbreakId]
  ) {
    return Promise.resolve();
  }

  importContext.requesting[sourceOutbreakId] = receiveRequest(
    importContext.client, {
      outbreaks: [Object.assign({}, outbreak, {
        id: sourceOutbreakId
      })]
    },
    importContext.options
  )
    .then((response) => {
      const access = response.outbreaks.find((item) => item.outbreakId === sourceOutbreakId);
      importContext.statuses[sourceOutbreakId] = access ? access.status : STATUS.PENDING;
    })
    .catch((err) => {
      app.logger.debug(`Couldn't list the outbreak ${sourceOutbreakId} for a decision. ${err}`);
    });
  return importContext.requesting[sourceOutbreakId];
}

/**
 * The review of where the data of an outbreak goes was approved: the outbreak is accepted
 */
function acceptReviewedOutbreak(mapping, options) {
  return app.models.syncOutbreakAccess
    .findOne({
      where: {
        clientId: mapping.clientId,
        sourceOutbreakId: mapping.sourceOutbreakId
      }
    })
    .then((access) => {
      if (
        !access ||
        access.status === STATUS.ACCEPTED
      ) {
        return access;
      }

      // the user decided to receive the outbreak
      return access.updateAttributes({
        status: STATUS.ACCEPTED,
        mappingId: mapping.id,
        decidedAt: localizationHelper.now().toDate(),
        decidedBy: _.get(app.utils.remote.getUserFromOptions(options), 'id')
      }, options);
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What is sent when asking to send outbreaks: the outbreaks with their questionnaires & the texts of the questions; never the data of the persons
 */
function buildRequestPayload(outbreakIds) {
  const projection = {
    name: 1,
    disease: 1,
    startDate: 1,
    endDate: 1
  };
  syncOutbreakMapping.QUESTIONNAIRES.forEach((questionnaire) => {
    projection[questionnaire] = 1;
  });

  return app.models.outbreak
    .rawFind({
      _id: {
        $in: outbreakIds
      }
    }, {
      projection
    })
    .then((outbreaks) => {
      // number of cases & contacts, so the receiver knows what it is accepting
      return Promise.all([
        app.dataSources.mongoDb.connector.db
          .collection('person')
          .aggregate([{
            $match: {
              outbreakId: {
                $in: outbreakIds
              },
              type: {
                $in: [PERSON_TYPE.CASE, PERSON_TYPE.CONTACT]
              },
              deleted: false
            }
          }, {
            $group: {
              _id: {
                outbreakId: '$outbreakId',
                type: '$type'
              },
              count: {
                $sum: 1
              }
            }
          }])
          .toArray(),
        (() => {
          // texts of the questions
          const tokens = [];
          outbreaks.forEach((outbreak) => {
            _.each(syncOutbreakMapping.getFlatQuestionnaires(outbreak), (questions) => {
              (questions || []).forEach((question) => {
                tokens.push(question.text);
                question.answers.forEach((answer) => tokens.push(answer.label));
              });
            });
          });
          const uniqueTokens = _.uniq(tokens.filter((token) => typeof token === 'string' && token));
          return uniqueTokens.length ?
            app.models.languageToken.rawFind({
              token: {
                $in: uniqueTokens
              }
            }, {
              projection: {
                token: 1,
                languageId: 1,
                translation: 1
              }
            }) :
            [];
        })()
      ])
        .then(([counts, languageTokens]) => {
          const countsMap = {};
          counts.forEach((count) => {
            _.set(countsMap, [count._id.outbreakId, count._id.type], count.count);
          });
          const texts = {};
          languageTokens.forEach((languageToken) => {
            _.set(texts, [languageToken.token, languageToken.languageId], languageToken.translation);
          });

          return {
            outbreaks: outbreaks.map((outbreak) => Object.assign(
              _.pick(outbreak, ['id', 'name', 'disease', 'startDate', 'endDate'].concat(syncOutbreakMapping.QUESTIONNAIRES)), {
                casesCount: _.get(countsMap, [outbreak.id, PERSON_TYPE.CASE]) || 0,
                contactsCount: _.get(countsMap, [outbreak.id, PERSON_TYPE.CONTACT]) || 0
              }
            )),
            texts
          };
        });
    });
}

/**
 * Outbreaks of this instance that are offered to an upstream server (the outbreaks must be chosen: none chosen means none is offered)
 */
function getSentOutbreaks(upstreamServer, requestedOutbreakIds) {
  const chosen = Array.isArray(requestedOutbreakIds) && requestedOutbreakIds.length ?
    requestedOutbreakIds :
    (upstreamServer.outbreakIDs || []);
  if (!chosen.length) {
    return Promise.resolve([]);
  }

  return app.models.outbreak
    .rawFind(
      {
        _id: {
          $in: chosen
        }
      }, {
        projection: {
          name: 1
        }
      }
    );
}

/**
 * Save what the upstream server decided
 */
function saveSenderState(upstreamServer, data, options) {
  return app.models.upstreamOutbreakAccess
    .findOne({
      where: {
        upstreamServerUrl: upstreamServer.url
      }
    })
    .then((state) => state ?
      state.updateAttributes(data, options) :
      app.models.upstreamOutbreakAccess.create(Object.assign({
        upstreamServerUrl: upstreamServer.url
      }, data), options)
    );
}

/**
 * Ask the upstream server which outbreaks it accepts; the outbreaks it doesn't know yet are requested
 * @param {Object} upstreamServer Upstream server entry of the system settings
 * @param {Object} params
 *  - syncLogEntry: sync in progress (requests are logged with it)
 *  - requestedOutbreakIds: outbreaks chosen for this sync
 *  - options
 * @returns {Promise<Object>} saved state {mode, outbreaks: [{outbreakId, name, status, decidedAt}], checkedAt}
 */
function refreshSenderState(upstreamServer, params) {
  params = params || {};
  const client = new SyncClient(upstreamServer, params.syncLogEntry || {
    id: 'outbreak-access'
  });
  const now = localizationHelper.now().toDate();
  let requestedAt;

  return client
    .getOutbreakAccess()
    .then((response) => {
      // the upstream server doesn't ask for the outbreaks (older version / key that isn't of an instance)
      if (!response || response.mode !== MODE.REQUEST) {
        return {
          mode: MODE.LEGACY,
          outbreaks: []
        };
      }

      return getSentOutbreaks(upstreamServer, params.requestedOutbreakIds)
        .then((outbreaks) => {
          const decided = _.keyBy(response.outbreaks || [], 'outbreakId');
          // new outbreaks & the ones still waiting for a decision (their numbers & questionnaires must be the current ones when the receiver decides)
          const toRequest = outbreaks
            .filter((outbreak) => !decided[outbreak.id] || decided[outbreak.id].status === STATUS.PENDING)
            .map((outbreak) => outbreak.id);

          return (
            toRequest.length ?
              buildRequestPayload(toRequest)
                .then((payload) => {
                  requestedAt = now;
                  return client.requestOutbreakAccess(payload);
                }) :
              Promise.resolve(response)
          )
            .then((finalResponse) => {
              const finalDecided = _.keyBy(finalResponse.outbreaks || [], 'outbreakId');
              return {
                mode: MODE.REQUEST,
                outbreaks: outbreaks.map((outbreak) => ({
                  outbreakId: outbreak.id,
                  name: outbreak.name,
                  status: finalDecided[outbreak.id] ? finalDecided[outbreak.id].status : STATUS.PENDING,
                  decidedAt: finalDecided[outbreak.id] ? finalDecided[outbreak.id].decidedAt : undefined
                }))
              };
            });
        });
    })
    .then((state) => saveSenderState(upstreamServer, Object.assign(state, {
      checkedAt: now,
      error: null,
      errorCode: null
    }, requestedAt ? {
      requestedAt
    } : {}), params.options))
    .catch((err) => {
      // keep the last decisions, the user must know why they weren't updated
      return saveSenderState(upstreamServer, {
        error: err && err.message ? err.message : String(err)
      }, params.options)
        .catch(() => null)
        .then(() => {
          throw err;
        });
    });
}

/**
 * The upstream server couldn't be reached / didn't accept the credentials: the last decisions are kept, with the reason
 * @param {Object} upstreamServer
 * @param {Object} reason {code: e.g. INVALID_CREDENTIALS / CONNECTION_REFUSED, message}
 */
function saveSenderError(upstreamServer, reason, options) {
  return saveSenderState(upstreamServer, {
    error: reason.message || reason.code || 'error',
    errorCode: reason.code || null
  }, options);
}

module.exports = {
  STATUS,
  MODE,
  CLIENT_TYPE,
  usesRequests,
  getClientResponse,
  receiveRequest,
  createImportContext,
  isRecordAllowed,
  requestReceivedOutbreak,
  acceptReviewedOutbreak,
  buildRequestPayload,
  refreshSenderState,
  saveSenderError
};
