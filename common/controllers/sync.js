'use strict';

const fs = require('fs');
const formidable = require('formidable');
const app = require('../../server/server');
const dbSync = require('../../components/dbSync');
const _ = require('lodash');
const syncConfig = require('../../server/config.json').sync;
const localizationHelper = require('../../components/localizationHelper');
const Platform = require('../../components/platform');
const upstreamServerCheck = require('../../components/upstreamServerCheck');
const syncFromDate = require('../../components/syncFromDate');
const syncOutbreakAccess = require('../../components/syncOutbreakAccess');

module.exports = function (Sync) {

  /**
   * Check if an upstream server is online and, when credentials are sent, if they are accepted
   * @param data {url, clientId, clientSecret}
   * @param callback
   */
  Sync.checkUpstreamServer = function (data, callback) {
    upstreamServerCheck
      .check(data)
      .then((result) => callback(null, result))
      .catch(callback);
  };

  /**
   * Get encrypt/decrypt password for sync process
   * @param password
   * @param clientCredentials
   * @param autoEncrypt
   * @return {*}
   */
  function getSyncEncryptPassword(password, clientCredentials, autoEncrypt = true) {
    // if a password was not provided, auto-encrypt is enabled and client credentials were provided
    if (password == null && autoEncrypt === true && clientCredentials) {
      // build the password by concatenating clientId and clientSecret
      password = clientCredentials.clientId + clientCredentials.clientSecret;
    }
    // if a password is present
    if (password) {
      // hash it
      password = app.utils.helpers.sha256(password);
    }
    return password;
  }

  /**
   * Get Database Snapshot in sync/async mode
   * @param filter
   * @param asynchronous
   * @param password Encryption password
   * @param autoEncrypt Auto Encrypt
   * @param chunkSize Number of elements to be included in an archive. Default: 10000
   * @param userEmail String; User email; used for filtering data based on user's teams locations
   * @param options
   * @param done
   * @returns {*}
   */
  function getDatabaseSnapshot(filter, asynchronous, password, autoEncrypt, chunkSize, userEmail, options, done) {
    /**
     * Update export log entry and offer file for download if needed
     * @param err
     * @param fileName
     * @param exportLogEntry
     * @param options
     * @param done
     */
    function exportCallback(err, fileName, exportLogEntry, options, done) {
      // update exportLogEntry
      exportLogEntry.actionCompletionDate = localizationHelper.now().toDate();

      if (err) {
        if (err.code === 'NO-DATA') {
          err = app.utils.apiError.getError('SYNC_NO_DATA_TO_EXPORT');
        } else {
          // make error readable
          err.toString = function () {
            return JSON.stringify(this);
          };
        }

        app.logger.debug(`Export ${exportLogEntry.id}: Error ${err}`);
        exportLogEntry.status = 'LNG_SYNC_STATUS_FAILED';
        exportLogEntry.error = err;
      } else {
        app.logger.debug(`Export ${exportLogEntry.id}: Success`);
        exportLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
        exportLogEntry.location = fileName;
      }

      // save sync log entry
      exportLogEntry
        .save(options)
        .then(function () {
          // nothing to do; sync log entry was saved
          app.logger.debug(`Export ${exportLogEntry.id}: Updated export log entry status.`);
        })
        .catch(function (err) {
          app.logger.debug(`Export ${exportLogEntry.id}: Error updating export log entry status. ${err}`);
        });

      // check if a callback function was received; In that case we need to return the file
      if (done) {
        if (err) {
          return done(err);
        }
        return app.utils.remote.helpers.offerFileToDownload(fs.createReadStream(fileName), 'application/octet-stream', fileName, done);
      }
    }

    // if the userEmail is sent we need to do the following:
    // 1. get user information as well as the assigned teams information; if the user is not part of any team request will error as no data needs to be exported
    // 2. get locations for all teams where the user is assigned and filter the data (contacts, cases, follow-ups) based on the locations
    // initialize container for found user data
    let userModel;
    // initialize container for found user teams IDs
    let userTeamsIds;
    // initialize container for locations for which to get related data
    let userLocationIds;

    // initialize userEmail logic promise
    let userEmailLogic = Promise.resolve();
    if (userEmail) {
      // get user
      userEmailLogic = app.models.user
        .findOne({
          where: {
            email: userEmail
          }
        })
        .then(function (user) {
          if (!user) {
            // requested user was not found; return error
            return Promise.reject(app.utils.apiError.getError('MODEL_NOT_FOUND', {
              model: app.models.user.modelName,
              id: userEmail
            }));
          }

          // cache user information
          userModel = user;

          // if user was updated then remove any date constrains since available outbreaks might've changed
          // we can retrieve everything
          if (
            filter &&
            filter.where &&
            filter.where.fromDate && (
              (
                userModel.updatedAt &&
                localizationHelper.toMoment(userModel.updatedAt).isSameOrAfter(localizationHelper.toMoment(filter.where.fromDate))
              ) || (
                userModel.dbUpdatedAt &&
                localizationHelper.toMoment(userModel.dbUpdatedAt).isSameOrAfter(localizationHelper.toMoment(filter.where.fromDate))
              )
            )
          ) {
            delete filter.where.fromDate;
          }

          // get user teams
          return app.models.team
            .find({
              where: {
                userIds: user.id
              }
            });
        })
        .then(function (teams) {
          // requested user is not assigned to any team; return error as we cannot get location information for the user
          if (!teams.length) {
            return Promise.reject(app.utils.apiError.getError('SYNC_PACKAGE_FOR_USER_WITHOUT_TEAMS', {
              userEmail: userEmail
            }));
          }

          // get teams IDs
          userTeamsIds = teams.map(team => team.id);

          // get teams locations
          let teamsLocationsIDs = teams.reduce(function (accumulator, team) {
            return accumulator.concat(team.locationIds);
          }, []);
          // remove duplicates
          teamsLocationsIDs = [...new Set(teamsLocationsIDs)];

          // get teams locations including sub-locations
          return new Promise(function (resolve, reject) {
            app.models.location
              .getSubLocations(teamsLocationsIDs, [], function (error, locationIds) {
                if (error) {
                  return reject(error);
                }

                // cache locationIds
                userLocationIds = locationIds;

                return resolve();
              });
          });
        })
        .then(() => {
          // nothing to do ?
          if (!userModel) {
            return;
          }

          // update lastLogin
          return userModel.updateAttributes({
            lastLogin: localizationHelper.now().toDate()
          });
        });
    }

    // run user email logic at first
    userEmailLogic
      // check if user active outbreak is one of the client outbreaks
      .then(function () {
        const client = _.get(options, 'remotingContext.req.authData.client');
        const allowedOutbreakIDs = _.get(client, 'outbreakIDs') || [];
        if (client) {
          // the keys of other instances only send data; they never download the data of this instance
          if (syncOutbreakAccess.usesRequests(client)) {
            throw app.utils.apiError.getError('CLIENT_APPLICATION_SEND_ONLY', {
              clientName: client.name || _.get(client, 'credentials.clientId')
            });
          }

          // the outbreaks of a key must be chosen: a key without outbreaks doesn't give access to any of them
          if (_.isEmpty(allowedOutbreakIDs)) {
            throw app.utils.apiError.getError('CLIENT_APPLICATION_NO_OUTBREAKS', {
              clientName: client.name || _.get(client, 'credentials.clientId')
            });
          }
        }

        // if we don't have an user account, then there is nothing to check
        if (_.isEmpty(userModel)) {
          return;
        }

        // check if user has an active outbreak, otherwise we should throw an error
        if (_.isEmpty(userModel.activeOutbreakId)) {
          throw app.utils.apiError.getError('NO_ACTIVE_OUTBREAK', {
            username: userModel.email
          });
        }
        if (_.isEmpty(allowedOutbreakIDs)) {
          return;
        }

        // check if the active outbreak of the provided is one of the allowed client outbreaks
        if (allowedOutbreakIDs.indexOf(userModel.activeOutbreakId) < 0) {
          throw app.utils.apiError.getError('NO_ACCESS_TO_ACTIVE_OUTBREAK', {
            username: userModel.email
          });
        }
      })

      // check if user has access to outbreaks for which we're trying to retrieve data
      .then(function () {
        // get asynchronous flag value; default: false
        asynchronous = asynchronous || false;

        filter = filter || {};
        filter.where = filter.where || {};

        // add user locationsIds and teamsIds in filter to have them available for future logic
        filter.where.locationsIds = userLocationIds;
        filter.where.teamsIds = userTeamsIds;

        // get chunkSize; default: 10000
        chunkSize = chunkSize || 10000;

        // check for received outbreakIDs in filter
        let outbreakIDFilter = _.get(filter, 'where.outbreakId');

        // retrieve client application & user restricted outbreaks
        // empty means that there are no restrictions
        const clientOutbreaks = _.get(options, 'remotingContext.req.authData.client.outbreakIDs', []);
        const userOutbreaks = _.get(userModel, 'outbreakIds', []);

        // determine allowed outbreaks accordingly to what client application allows and user limitations
        let allowedOutbreakIDs = [];
        if (!_.isEmpty(clientOutbreaks)) {
          // we have client application outbreaks, so we need to make sure we restrict access
          // check if we have user restrictions two
          if (!_.isEmpty(userOutbreaks)) {
            // we have both client application & user restrictions, so the proper way to limit them is to do an intersection between these two
            allowedOutbreakIDs = _.intersection(
              clientOutbreaks,
              userOutbreaks
            );

            // since intersection didn't return anything then we should throw an error because user doesn't actually have access to anything
            // since he uses client application credentials that aren't configured properly for his user account
            if (_.isEmpty(allowedOutbreakIDs)) {
              return done(app.utils.apiError.getError('ACCESS_DENIED', {
                accessErrors: 'Client is not allowed to access any outbreaks with the provided credentials'
              }, 403));
            }
          } else {
            // there are no user restrictions, so user has access to all client application outbreaks
            allowedOutbreakIDs = clientOutbreaks;
          }
        } else {
          // there are no client outbreaks limitations
          // check if there are limitations per user
          if (!_.isEmpty(userOutbreaks)) {
            // we don't have client application but we have user restrictions, so user has access to all his outbreaks
            allowedOutbreakIDs = userOutbreaks;
          } else {
            // there are no limitations for this use
            // nothing to do anymore
            // allowedOutbreakIDs = [];
          }
        }

        // initialize list of IDs for the outbreaks that will be exported
        let exportedOutbreakIDs = [];

        // the outbreakID filter is accepted as an {inq: ['outbreak ID']} filter of a string value
        if (outbreakIDFilter) {
          let requestOutbreakIDs = [];
          if (typeof outbreakIDFilter === 'object' && outbreakIDFilter !== null && Array.isArray(outbreakIDFilter.inq)) {
            requestOutbreakIDs = outbreakIDFilter.inq;
          } else if (typeof outbreakIDFilter === 'string') {
            requestOutbreakIDs = [outbreakIDFilter];
          }

          if (requestOutbreakIDs.length) {
            // check if all the requested outbreak IDs are allowed
            // if the allowedOutbreakIDs is an empty array all the outbreakIDs are allowed
            if (!allowedOutbreakIDs.length) {
              // nothing to do; will use the received outbreakIDs from the filter
            } else {
              let disallowedOutbreakIDs = requestOutbreakIDs.filter(outbreakID => allowedOutbreakIDs.indexOf(outbreakID) === -1);
              if (disallowedOutbreakIDs.length) {
                // some disallowed outbreak IDs were requested; return error
                return done(app.utils.apiError.getError('ACCESS_DENIED', {
                  accessErrors: `Client is not allowed to access the following outbreaks: ${disallowedOutbreakIDs.join(', ')}`
                }, 403));
              }
            }

            // outbreaks that will be filtered are the ones from the received filter; no need to changes the filter
            exportedOutbreakIDs = requestOutbreakIDs;
          } else {
            // an empty outbreakId filter was sent; nothing to do here, will use the client allowed outbreakIDs
          }
        }

        // set the client allowed outbreakIDs in the filter if the received outbreakId filter was empty/invalid
        if (!exportedOutbreakIDs.length && allowedOutbreakIDs.length) {
          // outbreakId filter was not sent or is in an invalid format
          // use the allowedOutbreakIDs as filter
          filter.where.outbreakId = {
            inq: allowedOutbreakIDs
          };

          // keep exportedOutbreakIDs data
          exportedOutbreakIDs = allowedOutbreakIDs;
        }

        // create list of exported collections depending on different filters
        let collections;

        // get exportType filter
        let exportTypeFilter = _.get(filter, 'where.exportType');
        if (Object.keys(dbSync.collectionsForExportTypeMap).indexOf(exportTypeFilter) !== -1) {
          // sent exportType is valid; export assigned collections
          // in this case the collections filter is ignored
          collections = dbSync.collectionsForExportTypeMap[exportTypeFilter];
        } else {
          // check for collections filter
          let collectionsFilter = _.get(filter, 'where.collections');
          if (Array.isArray(collectionsFilter)) {
            // export the received collections
            collections = collectionsFilter;
          } else {
            // use mobile exportType collections by default
            collections = dbSync.collectionsForExportTypeMap.mobile;
          }
        }

        // get includeUsers filter to check if the user collections need to be exported
        let includeUsersFilter = _.get(filter, 'where.includeUsers');
        if (includeUsersFilter) {
          collections = collections.concat(dbSync.userCollections);
        }

        // get password
        password = getSyncEncryptPassword(password, _.get(options, 'remotingContext.req.authData.credentials'), autoEncrypt);

        // create export log entry
        return app.models.databaseExportLog
          .create({
            syncClientId: _.get(options, 'remotingContext.req.authData.client.credentials.clientId', `webUser: ${_.get(options, 'remotingContext.req.authData.user.id', 'unavailable')}`),
            actionStartDate: localizationHelper.now().toDate(),
            status: 'LNG_SYNC_STATUS_IN_PROGRESS',
            outbreakIDs: exportedOutbreakIDs
          }, options)
          .then(function (exportLogEntry) {
            if (!asynchronous) {
              Sync.exportDatabase(
                filter,
                collections,
                {
                  password: password,
                  chunkSize: chunkSize,
                  exportEmptyCollections: false,
                  applyExcludeDeletedRecordsRules: true
                },
                (err, fileName) => {
                  // send the done function as the response needs to be returned
                  exportCallback(err, fileName, exportLogEntry, options, done);
                });
            } else {
              // export is done asynchronous
              // send response; don't wait for export
              done(null, exportLogEntry.id);

              // export the DB
              Sync.exportDatabase(
                filter,
                collections,
                {
                  password: password,
                  chunkSize: chunkSize,
                  exportEmptyCollections: false,
                  applyExcludeDeletedRecordsRules: true
                },
                (err, fileName) => {
                  // don't send the done function as the response was already sent
                  exportCallback(err, fileName, exportLogEntry, options);
                });
            }
          });
      })
      .catch(done);
  }

  /**
   * Retrieve a compressed snapshot of the database
   * Supported filters:
   * fromDate: Date
   * outbreakId: 'outbreak ID' / {inq: ['outbreak ID1', 'outbreak ID2']}
   * collections: ['modelName']
   * exportType: enum [mobile, system, outbreak, full]
   * includeUsers: boolean
   * Eg filter: {"where": {"fromDate": "dateString", "outbreakId": "outbreak ID", "collections": ["person", "outbreak", ...], "exportType": "mobile", "includeUsers": true}}
   * Note: when exportType is present 'collections' is ignored. If both collections and exportType are not present default 'mobile' export type is used
   * @param filter
   * @param password Encryption password
   * @param autoEncrypt Auto Encrypt
   * @param userEmail String; User email; used for filtering data based on user's teams locations
   * @param options Options from request
   * @param done
   */
  Sync.getDatabaseSnapshot = function (filter, password, autoEncrypt, userEmail, options, done) {
    getDatabaseSnapshot(filter, false, password, autoEncrypt, null, userEmail, options, done);
  };

  /**
   * Export a compressed snapshot of the database. Return an exportLogEntry ID
   * This action is used for asynchronous processes
   * Supported filters:
   * fromDate: Date
   * outbreakId: 'outbreak ID' / {inq: ['outbreak ID1', 'outbreak ID2']}
   * collections: ['modelName']
   * exportType: enum [mobile, system, outbreak, full]
   * includeUsers: boolean
   * Eg filter: {"where": {"fromDate": "dateString", "outbreakId": "outbreak ID", "collections": ["person", "outbreak", ...], "exportType": "mobile", "includeUsers": true}}
   * Note: when exportType is present 'collections' is ignored. If both collections and exportType are not present default 'mobile' export type is used
   * @param filter
   * @param password Encryption password
   * @param autoEncrypt Auto Encrypt
   * @param userEmail String; User email; used for filtering data based on user's teams locations
   * @param options Options from request
   * @param done
   */
  Sync.getDatabaseSnapshotAsynchronous = function (filter, password, autoEncrypt, userEmail, options, done) {
    getDatabaseSnapshot(filter, true, password, autoEncrypt, null, userEmail, options, done);
  };

  /**
   * Retrieve a compressed snapshot of the database
   * Supported filters:
   * fromDate: Date
   * outbreakId: 'outbreak ID' / {inq: ['outbreak ID1', 'outbreak ID2']}
   * collections: ['modelName']
   * exportType: enum [mobile, system, outbreak, full]
   * includeUsers: boolean
   * Eg filter: {"where": {"fromDate": "dateString", "outbreakId": "outbreak ID", "collections": ["person", "outbreak", ...], "exportType": "mobile", "includeUsers": true}}
   * Note: when exportType is present 'collections' is ignored. If both collections and exportType are not present default 'mobile' export type is used
   * @param filter
   * @param password Encryption password
   * @param autoEncrypt Auto Encrypt
   * @param chunkSize Number of elements to be included in an archive. Default: 10000
   * @param data Object; Can contain languageTokens array; if present only those language tokens and the reference data related ones will be exported; Can contain languages array; if present only tokens from these languages will be retrieved (can be used together with languageTokens)
   * @param userEmail String; User email; used for filtering data based on user's teams locations
   * @param options Options from request
   * @param done
   */
  Sync.getDatabaseSnapshotForMobile = function (filter, password, autoEncrypt, chunkSize, data, userEmail, options, done) {
    // check for data.languageTokens; if present, update filter
    if (Array.isArray(data.languageTokens)) {
      filter = filter || {};
      filter.where = filter.where || {};
      // add languageTokens filter; will be further processed before it reaches DB
      filter.where.languageTokens = data.languageTokens;
    }

    // check if languages is present
    if (Array.isArray(data.languages)) {
      filter = filter || {};
      filter.where = filter.where || {};
      // add language filter; will be further processed before it reaches DB
      filter.where.languages = data.languages;
    }

    // download snapshot
    getDatabaseSnapshot(filter, false, password, autoEncrypt, chunkSize, userEmail, options, done);
  };

  /**
   * Download an already exported snapshot of the database
   * @param databaseExportLogId Database Export log ID
   * @param options Options from request
   * @param done
   */
  Sync.getExportedDatabaseSnapshot = function (databaseExportLogId, options, done) {
    // get export log entry
    app.models.databaseExportLog
      .findById(databaseExportLogId)
      .then(function (exportLogEntry) {
        if (!exportLogEntry) {
          return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.databaseExportLog.modelName,
            id: databaseExportLogId
          }));
        }

        // check export log status and location
        if (exportLogEntry.status === 'LNG_SYNC_STATUS_IN_PROGRESS') {
          return done(app.utils.apiError.getError('INSTANCE_EXPORT_STILL_IN_PROGRESS'));
        } else if (exportLogEntry.status === 'LNG_SYNC_STATUS_FAILED') {
          return done(app.utils.apiError.getError('INSTANCE_EXPORT_FAILED', {
            error: exportLogEntry.error
          }));
        }

        // exportLogEntry status is success; check for location and file
        if (!exportLogEntry.location || !fs.existsSync(exportLogEntry.location)) {
          // fail the exportLogEntry
          exportLogEntry
            .updateAttributes({
              status: 'LNG_SYNC_STATUS_FAILED',
              error: 'Export location is missing or file cannot be found'
            })
            .then(() => {
              // nothing to do
              app.logger.debug(`Export ${exportLogEntry.id}: Updated DB export log entry status`);
            })
            .catch((err) => {
              app.logger.debug(`Export ${exportLogEntry.id}: Failed to save DB export log entry: Error ${err}`);
            });

          return done(app.utils.apiError.getError('INSTANCE_EXPORT_FAILED', {
            error: exportLogEntry.error
          }));
        }

        // download file
        return app.utils.remote.helpers.offerFileToDownload(fs.createReadStream(exportLogEntry.location), 'application/octet-stream', exportLogEntry.location, done);
      })
      .catch(done);
  };

  /**
   * Synchronize database based on a given snapshot archive containing matching collections
   * @param req
   * @param snapshot Database snapshot .tar.gz archive
   * @param asynchronous Flag to specify whether the import is sync or async. Default: sync (false)
   * @param triggerBackupBeforeSync Flag to specify whether before the import a backup should be triggered. If the flag is not sent the System settings triggerBackupBeforeSync flag will be used
   * @param password Encryption password
   * @param autoEncrypt Auto Encrypt
   * @param generatePersonVisualId Generate visualId on cases/contacts. Default: false
   * @param done
   */
  Sync.importDatabaseSnapshot = function (req, snapshot, asynchronous, triggerBackupBeforeSync, password, autoEncrypt, generatePersonVisualId, snapshotFromClient, done) {
    const buildError = app.utils.apiError.getError;

    // default should be sync
    req.headers = req.headers || {};
    if (!req.headers['platform']) {
      // only mobile uses basic auth
      req.headers['platform'] = req.authData && req.authData.credentials ?
        Platform.MOBILE :
        Platform.SYNC;
    }

    /**
     * Import action callback; Depending on the asynchronous it can be called with/without the callback
     * @param err
     * @param syncLogEntry
     * @param requestOptions
     * @param callback
     */
    function importCallback(err, syncLogEntry, requestOptions, callback) {
      // invalidate caches
      app.models.location.cache.reset();
      app.models.user.cache.reset();

      // update syncLogEntry
      syncLogEntry.actionCompletionDate = localizationHelper.now().toDate();

      if (err) {
        app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
        syncLogEntry.status = err.errorType === Sync.errorType.fatal ? 'LNG_SYNC_STATUS_FAILED' : 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS';
        let errorMessage = err.errorMessage;
        if (errorMessage) {
          if (typeof errorMessage === 'object') {
            // make error readable
            errorMessage.toString = function () {
              return JSON.stringify(this);
            };
          }
          syncLogEntry.error = errorMessage;
        }
      } else {
        app.logger.debug(`Sync ${syncLogEntry.id}: Success`);
        syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
      }

      // save sync log entry
      syncLogEntry
        .save(requestOptions)
        .then(function () {
          // nothing to do; sync log entry was saved
          app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status`);
        })
        .catch(function (err) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
        });

      // execute callback if received
      if (callback) {
        // if an error was encountered
        if (err) {
          // assume sync failed completely
          let errorCode = 'INSTANCE_SYNC_FAILED';
          // rewrite toString to something useful
          if (typeof err === 'object') {
            // make error readable
            err.toString = function () {
              return JSON.stringify(this);
            };
            // if sync failed only partially
            if (err.errorType === Sync.errorType.partial) {
              // change error to partial failure
              errorCode = 'INSTANCE_SYNC_PARTIAL_FAILURE';
            }
          }
          // rewrite error with API error
          err = buildError(errorCode, {
            syncError: err
          });
        }
        return callback(err, syncLogEntry.id);
      }
    }

    const form = new formidable.IncomingForm({
      maxFileSize: syncConfig.maxPackageSize ? syncConfig.maxPackageSize : 5000 * 1024 * 1024
    });

    form.parse(req, function (err, fields, files) {
      if (err) {
        return done(err);
      }

      // validates snapshot archive
      if (!files.snapshot) {
        // send back the error
        return done(buildError('MISSING_REQUIRED_PROPERTY', {
          model: Sync.modelName,
          properties: 'snapshot'
        }));
      }

      // get asynchronous flag value
      asynchronous = fields.asynchronous && fields.asynchronous === 'true';

      // get request options
      let requestOptions = {
        remotingContext: {
          req: req
        }
      };

      // get outbreaks IDs for client
      const client = _.get(req, 'authData.client');
      let outbreakIDs = _.get(client, 'outbreakIDs');
      if (syncOutbreakAccess.usesRequests(client)) {
        // the keys of other instances ask for each outbreak; the records are checked against the accepted ones while they are imported
        outbreakIDs = [];
      } else if (
        client &&
        (!Array.isArray(outbreakIDs) || !outbreakIDs.length)
      ) {
        // the outbreaks of a key must be chosen: a key without outbreaks can't send data of any of them
        return done(buildError('CLIENT_APPLICATION_NO_OUTBREAKS', {
          clientName: client.name || _.get(client, 'credentials.clientId')
        }));
      } else if (!Array.isArray(outbreakIDs)) {
        outbreakIDs = [];
      }

      // auto-encrypt if not specified otherwise
      let autoEncrypt = true;
      // if auto-encrypt flag was sent
      if (fields.autoEncrypt != null) {
        if (
          fields.autoEncrypt === 'false' ||
          fields.autoEncrypt === '0'
        ) {
          autoEncrypt = false;
        }
      }

      // get generatePersonVisualId value
      let generatePersonVisualId = false;
      // check if the flag was sent and if is true
      if (fields.generatePersonVisualId != null && (
        fields.generatePersonVisualId === 'true' ||
        fields.generatePersonVisualId === '1' ||
        fields.generatePersonVisualId === true ||
        fields.generatePersonVisualId === 1
      )) {
        generatePersonVisualId = true;
      }

      // get snapshotFromClient value
      let snapshotFromClient = false;
      // check if the flag was sent and if is true
      if (fields.snapshotFromClient != null && (
        fields.snapshotFromClient === 'true' ||
        fields.snapshotFromClient === '1' ||
        fields.snapshotFromClient === true ||
        fields.snapshotFromClient === 1
      )) {
        snapshotFromClient = true;
      }

      // get password
      const password = getSyncEncryptPassword(fields.password, _.get(requestOptions, 'remotingContext.req.authData.credentials'), autoEncrypt);

      // create sync log entry
      app.models.syncLog
        .create({
          syncClientId: _.get(req, 'authData.client.credentials.clientId', `webUser: ${_.get(req, 'authData.user.id', 'unavailable')}`),
          actionStartDate: localizationHelper.now().toDate(),
          status: 'LNG_SYNC_STATUS_IN_PROGRESS',
          outbreakIDs: outbreakIDs
        }, requestOptions)
        .then(function (syncLogEntry) {
          if (!asynchronous) {
            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(
              files.snapshot.path,
              syncLogEntry,
              outbreakIDs,
              requestOptions,
              triggerBackupBeforeSync,
              {
                password: password,
                generatePersonVisualId: generatePersonVisualId,
                snapshotFromClient: snapshotFromClient,
                // used to map the outbreaks of the instance that sent the data
                clientId: _.get(req, 'authData.client.credentials.clientId')
              },
              function (err) {
                // send done function to return the response
                importCallback(err, syncLogEntry, requestOptions, done);
              });
          } else {
            // import is done asynchronous
            // send response; don't wait for import
            done(null, syncLogEntry.id);

            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(
              files.snapshot.path,
              syncLogEntry,
              outbreakIDs,
              requestOptions,
              triggerBackupBeforeSync,
              {
                password: password,
                generatePersonVisualId: generatePersonVisualId,
                snapshotFromClient: snapshotFromClient,
                // used to map the outbreaks of the instance that sent the data
                clientId: _.get(req, 'authData.client.credentials.clientId')
              },
              function (err) {
                // don't send the done function as the response was already sent
                importCallback(err, syncLogEntry, requestOptions);
              });
          }
        })
        .catch(done);
    });
  };

  /**
   * Retrieve the list of IDs for the client available outbreaks
   * @param options
   * @param callback
   */
  /**
   * Another instance retrieves the decisions about its outbreaks
   * @param options
   * @param callback
   */
  Sync.getOutbreakAccess = function (options, callback) {
    syncOutbreakAccess
      .getClientResponse(_.get(options, 'remotingContext.req.authData.client'))
      .then((response) => callback(null, response))
      .catch(callback);
  };

  /**
   * Another instance asks to send outbreaks
   * @param data
   * @param options
   * @param callback
   */
  Sync.requestOutbreakAccess = function (data, options, callback) {
    syncOutbreakAccess
      .receiveRequest(
        _.get(options, 'remotingContext.req.authData.client'),
        data,
        options
      )
      .then((response) => callback(null, response))
      .catch(callback);
  };

  /**
   * Ask an upstream server which outbreaks of this instance it accepts (the new ones are requested)
   * @param data
   * @param options
   * @param callback
   */
  Sync.checkUpstreamOutbreakAccess = function (data, options, callback) {
    if (
      !data ||
      !data.upstreamServerURL ||
      typeof data.upstreamServerURL !== 'string'
    ) {
      return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: 'Missing required property "upstreamServerURL"'
      }));
    }

    app.models.systemSettings
      .findOne()
      .then((systemSettings) => {
        const upstreamServer = _.find(
          _.get(systemSettings, 'upstreamServers') || [],
          (server) => server.url === data.upstreamServerURL
        );
        if (!upstreamServer) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_NOT_CONFIGURED', {
            upstreamServerURL: data.upstreamServerURL
          });
        }

        return syncOutbreakAccess.refreshSenderState(upstreamServer, {
          options
        });
      })
      .then((state) => callback(null, state))
      .catch(callback);
  };

  Sync.getAvailableOutbreaksForClient = function (options, callback) {
    let clientInformation = options.remotingContext.req.authData.client;
    callback(null, {
      outbreakIDs: clientInformation.outbreakIDs || []
    });
  };

  /**
   * Start sync process with a received upstream server
   * @param data,
   * @param options
   * @param callback
   */
  Sync.sync = function (data, options, callback) {
    // validate data; check for required upstreamServerURL property in req body
    if (!data.upstreamServerURL || typeof data.upstreamServerURL !== 'string') {
      return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: 'Missing required property "upstreamServerURL"'
      }));
    }

    // validate the date chosen to start sending data; it doesn't matter if all the data was requested
    let requestedFromDate;
    if (
      data.fromDate &&
      !data.fullSync
    ) {
      try {
        requestedFromDate = syncFromDate.validateRequestedFromDate(data.fromDate);
      } catch (err) {
        return callback(err);
      }
    }

    // outbreaks chosen by the user; when not sent, the ones configured for the upstream server are used
    let requestedOutbreakIDs;
    if (data.outbreakIDs !== undefined && data.outbreakIDs !== null) {
      if (
        !Array.isArray(data.outbreakIDs) ||
        data.outbreakIDs.some((outbreakId) => typeof outbreakId !== 'string' || !outbreakId)
      ) {
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
          errorMessages: 'Property "outbreakIDs" must be a list of outbreak ids'
        }));
      }

      requestedOutbreakIDs = _.uniq(data.outbreakIDs);
    }

    // outbreaks offered to the upstream server: the ones chosen by the user or, when none was chosen, the ones configured for it
    // there are no "all the outbreaks": an empty list means nothing is sent
    let offeredOutbreakIDs = [];

    // initialize flag to know if the callback function was already called
    // need to do this as we will call it and then continue doing some actions
    let callbackCalled = false;

    // whether this sync marked the upstream server as being synced
    let inProgressSet = false;

    // initialize upstreamServer options container
    let upstreamServerEntry;

    // initialize variable for caching the syncLogEntry
    let syncLogEntry;

    // initialize variable for caching the system settings
    let systemSettings;

    /**
     * Save the step the sync reached, so it can be displayed while it is in progress
     */
    const setSyncStep = (step) => {
      syncLogEntry.syncStep = step;
      return syncLogEntry
        .save(options)
        .catch((err) => {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry step. ${err}`);
        });
    };

    // check if the received upstream server URL matches one from the configured upstream servers
    app.models.systemSettings
      .findOne()
      .then(function (record) {
        // initialize error
        if (!record) {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System Settings were not found'
          });
        }

        // cache system settings
        systemSettings = record;

        // find the upstream server entry that matches the received url
        if (!Array.isArray(systemSettings.upstreamServers) || !(upstreamServerEntry = systemSettings.upstreamServers.find(serverEntry => serverEntry.url === data.upstreamServerURL))) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_NOT_CONFIGURED', {
            upstreamServerURL: data.upstreamServerURL
          });
        }

        // upstream server was found; check if sync is enabled
        if (!upstreamServerEntry.syncEnabled) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_DISABLED', {
            upstreamServerName: upstreamServerEntry.name,
            upstreamServerURL: upstreamServerEntry.url
          });
        }

        // check if there is a sync in progress to the same server and the sync is not forced
        // sync is forced by the sync on every change functionality
        if (Sync.inProgress.servers[upstreamServerEntry.url] && !data.forceSync) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_IN_PROGRESS', {
            upstreamServerName: upstreamServerEntry.name,
            upstreamServerURL: upstreamServerEntry.url
          });
        }

        // the sync is in progress from now on, so a sync started at the same time is refused
        Sync.inProgress.servers[upstreamServerEntry.url] = true;
        inProgressSet = true;

        // start sync with upstream server
        // create syncLog entry in the DB
        return app.models.syncLog.create({
          syncServerUrl: upstreamServerEntry.url,
          actionStartDate: localizationHelper.now().toDate(),
          status: 'LNG_SYNC_STATUS_IN_PROGRESS',
          syncStep: 'CONNECT'
        }, options);
      })
      .then(function (syncLog) {
        // cache sync log entry as it will need to be updated with different statuses
        syncLogEntry = syncLog;

        // the API might run in several processes, each one with its own in progress map
        // the sync logs are shared: when a sync to the same server started first, this one is dropped
        if (data.forceSync) {
          return;
        }
        return app.models.syncLog
          .find({
            where: {
              syncServerUrl: upstreamServerEntry.url,
              status: 'LNG_SYNC_STATUS_IN_PROGRESS',
              id: {
                neq: syncLog.id
              }
            },
            fields: ['id', 'actionStartDate']
          })
          .then((otherSyncs) => {
            const startedFirst = otherSyncs.some((otherSync) => {
              const otherStart = new Date(otherSync.actionStartDate).getTime();
              const start = new Date(syncLog.actionStartDate).getTime();
              return otherStart < start || (
                otherStart === start &&
                otherSync.id < syncLog.id
              );
            });
            if (!startedFirst) {
              return;
            }

            return syncLog
              .destroy(options)
              .catch(() => null)
              .then(() => {
                throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_IN_PROGRESS', {
                  upstreamServerName: upstreamServerEntry.name,
                  upstreamServerURL: upstreamServerEntry.url
                });
              });
          });
      })
      .then(function () {
        // send response with the syncLogEntry ID
        // the sync action continues after the response is sent with the syncLogEntry being updated when the sync fails/succeeds
        callback(null, syncLogEntry.id);
        callbackCalled = true;

        app.logger.debug(`Started sync ${syncLogEntry.id}`);

        // the outbreaks must be chosen; the sync log tells why nothing was sent
        offeredOutbreakIDs = requestedOutbreakIDs && requestedOutbreakIDs.length ?
          requestedOutbreakIDs :
          _.uniq(upstreamServerEntry.outbreakIDs || []);
        if (!offeredOutbreakIDs.length) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_NO_OUTBREAKS_CHOSEN', {
            upstreamServerName: upstreamServerEntry.name
          });
        }

        // check if the server can be reached & if it accepts the credentials, so the user knows which step failed
        // Note: the check only explains a failure; it never stops a sync that would work
        return upstreamServerCheck
          .check({
            url: upstreamServerEntry.url,
            clientId: _.get(upstreamServerEntry, 'credentials.clientId'),
            clientSecret: _.get(upstreamServerEntry, 'credentials.clientSecret')
          })
          .catch(function (err) {
            app.logger.debug(`Sync ${syncLogEntry.id}: Couldn't check the upstream server. ${err}`);
            return null;
          })
          .then(function (checkResult) {
            // the server was reached
            const serverOffline = checkResult && !checkResult.server.online;
            return (serverOffline ? Promise.resolve() : setSyncStep('CREDENTIALS'))
              .then(function () {
                // get available outbreakIDs for the client
                return Sync.getAvailableOutbreaksIDs(upstreamServerEntry, syncLogEntry);
              })
              .catch(function (err) {
                // explain why
                const failedCheck = serverOffline ?
                  checkResult.server : (
                    checkResult && checkResult.credentials && !checkResult.credentials.valid ?
                      checkResult.credentials :
                      null
                  );
                if (failedCheck) {
                  syncLogEntry.syncStepErrorCode = failedCheck.errorCode;
                  syncLogEntry.syncStepErrorDetail = failedCheck.code;
                }

                // the approval of the outbreaks displayed by this instance must say why it isn't up to date
                return syncOutbreakAccess
                  .saveSenderError(upstreamServerEntry, {
                    code: failedCheck ? failedCheck.errorCode : undefined,
                    message: err && err.message ? err.message : String(err)
                  }, options)
                  .catch(() => null)
                  .then(() => {
                    throw err;
                  });
              });
          });
      })
      .then(function (outbreakIDs) {
        // the upstream server might decide which outbreaks it receives: only the accepted ones are sent, the new ones are requested
        return setSyncStep('ACCESS')
          .then(() => syncOutbreakAccess.refreshSenderState(upstreamServerEntry, {
            syncLogEntry,
            options
          }))
          .then((accessState) => {
            if (accessState.mode !== syncOutbreakAccess.MODE.REQUEST) {
              return outbreakIDs;
            }

            // accepted outbreaks, among the offered ones (an outbreak accepted before & no longer offered isn't sent)
            const acceptedOutbreakIDs = (accessState.outbreaks || [])
              .filter((outbreak) => outbreak.status === syncOutbreakAccess.STATUS.ACCEPTED)
              .map((outbreak) => outbreak.outbreakId)
              .filter((outbreakId) => offeredOutbreakIDs.includes(outbreakId));
            if (!acceptedOutbreakIDs.length) {
              // nothing can be sent yet; the sync log tells why (about the offered outbreaks)
              const consideredOutbreaks = (accessState.outbreaks || [])
                .filter((outbreak) => offeredOutbreakIDs.includes(outbreak.outbreakId));
              const names = (status) => consideredOutbreaks
                .filter((outbreak) => status.includes(outbreak.status))
                .map((outbreak) => outbreak.name || outbreak.outbreakId)
                .join(', ') || '-';
              const pending = consideredOutbreaks.some((outbreak) => outbreak.status === syncOutbreakAccess.STATUS.PENDING);
              syncLogEntry.syncStepErrorCode = pending ?
                'ACCESS_PENDING' :
                'ACCESS_REFUSED';
              throw app.utils.apiError.getError('UPSTREAM_SERVER_OUTBREAKS_NOT_ACCEPTED', {
                upstreamServerName: upstreamServerEntry.name,
                pending: names([syncOutbreakAccess.STATUS.PENDING]),
                refused: names([syncOutbreakAccess.STATUS.REFUSED, syncOutbreakAccess.STATUS.PAUSED])
              });
            }

            // the accepted outbreaks are the ones that are sent (never "all the outbreaks", so a new outbreak isn't sent before it is accepted)
            requestedOutbreakIDs = acceptedOutbreakIDs;
            return [];
          });
      })
      .then(function (outbreakIDs) {
        // send only the chosen outbreaks (the accepted ones, when the upstream server decides), if the upstream server allows them
        const chosenOutbreakIDs = requestedOutbreakIDs && requestedOutbreakIDs.length ?
          requestedOutbreakIDs :
          offeredOutbreakIDs;
        if (chosenOutbreakIDs.length) {
          const acceptedOutbreakIDs = outbreakIDs.length ?
            chosenOutbreakIDs.filter((outbreakId) => outbreakIDs.includes(outbreakId)) :
            chosenOutbreakIDs;
          if (!acceptedOutbreakIDs.length) {
            throw app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
              errorMessages: 'None of the chosen outbreaks is accepted by the upstream server'
            });
          }

          outbreakIDs = acceptedOutbreakIDs;
        }

        app.logger.debug(`Sync ${syncLogEntry.id}: Sync will be done for ${outbreakIDs.length ? ('the following outbreaks: ' + outbreakIDs.join(', ')) : 'all the outbreaks in the system'}`);
        // save retrieve outbreak IDs on the sync log entry
        syncLogEntry.outbreakIDs = outbreakIDs;

        // check if the outbreaks with the given IDs were ever successfully synced with the upstream server
        // we will only sync daca updated from the last sync
        // a previous sync can be used only if it sent all the outbreaks that are sent now, otherwise what was changed in the others would never be sent
        // (e.g. an outbreak was added to the ones synced with the server, or the previous sync sent only some outbreaks)
        const sentAllOutbreaksConditions = [{
          outbreakIDs: {
            $exists: false
          }
        }, {
          outbreakIDs: null
        }, {
          outbreakIDs: {
            $size: 0
          }
        }];
        return app.models.syncLog
          .rawFind({
            syncServerUrl: upstreamServerEntry.url,
            status: 'LNG_SYNC_STATUS_SUCCESS',
            $or: outbreakIDs.length ?
              sentAllOutbreaksConditions.concat([{
                outbreakIDs: {
                  $all: outbreakIDs
                }
              }]) :
              sentAllOutbreaksConditions
          }, {
            projection: {
              actionStartDate: 1
            },
            sort: {
              actionStartDate: -1
            },
            limit: 1
          })
          .then(function (lastSyncLogEntries) {
            const lastSyncLogEntry = lastSyncLogEntries[0];
            // determine the date from which we will sync the data
            // by default it is the start of the last successful sync (or all data if there wasn't any), but the user can ask for more data
            const fromDateResult = syncFromDate.determineFromDate({
              fullSync: data.fullSync,
              requestedFromDate: requestedFromDate,
              lastSyncStartDate: lastSyncLogEntry ? lastSyncLogEntry.actionStartDate : undefined
            });

            if (fromDateResult.fromDate) {
              syncLogEntry.informationStartDate = fromDateResult.fromDate;
              app.logger.debug(`Sync ${syncLogEntry.id}: ${fromDateResult.reason} (upstream server: ${upstreamServerEntry.url}). Syncing data from '${fromDateResult.fromDate.toISOString()}' onwards`);
            } else {
              app.logger.debug(`Sync ${syncLogEntry.id}: ${fromDateResult.reason} (upstream server: ${upstreamServerEntry.url}). Syncing all data from the DB.`);
            }

            // save added details in the sync log entry
            return syncLogEntry.save(options);
          });
      })
      .then(function () {
        // gathered all required data for starting the sync
        // Sync steps:
        // 1: export local DB
        // 2: send DB to be synced on the upstream server

        // export local DB
        // initialize filter and update it if needed
        let filter = {
          where: {
            // the translations of the application belong to each instance
            onlyDataLanguageTokens: true
          }
        };
        // get data from date
        if (syncLogEntry.informationStartDate) {
          filter.where.fromDate = syncLogEntry.informationStartDate;
        }
        // get data from the required outbreaks
        if (Array.isArray(syncLogEntry.outbreakIDs) && syncLogEntry.outbreakIDs.length) {
          filter.where.outbreakId = {
            inq: syncLogEntry.outbreakIDs
          };
        }

        // 1: export local DB
        // export the sync collections
        let collections = dbSync.syncCollections;

        // get password
        const password = getSyncEncryptPassword(null, upstreamServerEntry.credentials, upstreamServerEntry.autoEncrypt);

        app.logger.debug(`Sync ${syncLogEntry.id}: Exporting DB.`);
        return setSyncStep('EXPORT').then(() => new Promise(function (resolve, reject) {
          Sync.exportDatabase(
            filter,
            collections,
            {
              password: password,
              chunkSize: 10000,
              // set flag to know the export is for upstream server as we need to filter some information out of the export
              dbForUpstreamServer: true
            },
            (err, fileName) => {
              if (err) {
                // nothing changed since the last sync, so the upstream server is already up to date
                if (err.code === 'NO-DATA') {
                  app.logger.debug(`Sync ${syncLogEntry.id}: No data to sync.`);
                  syncLogEntry.syncStep = 'NO_DATA';
                  return resolve();
                }

                return reject(err);
              }
              app.logger.debug(`Sync ${syncLogEntry.id}: DB exported at ${fileName}.`);
              return resolve(fileName);
            });
        }));
      })
      .then(function (exportedDBFileName) {
        // nothing to send
        if (!exportedDBFileName) {
          return;
        }

        // 2: send DB to be synced on the upstream server
        return setSyncStep('SEND').then(() => Sync.sendDBSnapshotForImport(upstreamServerEntry, exportedDBFileName, true, syncLogEntry));
      })
      .then(function () {
        // sync was successful
        // update syncLogEntry
        syncLogEntry.actionCompletionDate = localizationHelper.now().toDate();

        // check for partial success
        if (syncLogEntry.error) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Success with warnings; ${syncLogEntry.error}`);
          syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS';
        } else {
          // success
          app.logger.debug(`Sync ${syncLogEntry.id}: Success`);
          syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
        }

        // save sync log entry
        syncLogEntry
          .save(options)
          .then(function () {
            // nothing to do; sync log entry was saved
            app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status.`);
          })
          .catch(function (err) {
            app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
          });

        // update Sync.inProgress map; Sync action just finished
        Sync.inProgress.servers[upstreamServerEntry.url] = false;
        // check for pending sync for the server and trigger it
        Sync.checkAndTriggerPendingSync(upstreamServerEntry, options);
      })
      .catch(function (err) {
        // make error readable
        err.toString = function () {
          return JSON.stringify(this);
        };
        if (!callbackCalled) {
          // sync wasn't started; the error response is sent directly in the response
          if (inProgressSet) {
            Sync.inProgress.servers[upstreamServerEntry.url] = false;
          }
          callback(err);
          callbackCalled = true;
        } else {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
          // update sync log status
          syncLogEntry.actionCompletionDate = localizationHelper.now().toDate();
          syncLogEntry.status = 'LNG_SYNC_STATUS_FAILED';
          syncLogEntry.addError(err);
          syncLogEntry
            .save(options)
            .then(function () {
              // nothing to do; sync log entry was saved
              app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status.`);
            })
            .catch(function (err) {
              app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
            });

          // update Sync.inProgress map; Sync action just finished
          Sync.inProgress.servers[upstreamServerEntry.url] = false;
          // check for pending sync for the server and trigger it
          Sync.checkAndTriggerPendingSync(upstreamServerEntry, options);
        }
      });
  };
};
