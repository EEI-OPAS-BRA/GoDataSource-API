'use strict';

const got = require('got');
const FormData = require('form-data');
const fs = require('fs');
const app = require('../server/server');

/**
 * Remove last character of a string if it's a '/'
 * @param url
 */
function normalizeURL(url) {
  if (typeof url === 'string' && url.lastIndexOf('/') === url.length - 1) {
    url = url.substring(0, url.length - 1);
  }

  return url;
}

/**
 * Constructor for client for sync requests
 * @param upstreamServer
 * @param syncLogEntry
 * @constructor
 */
// time limit of each request; the import is asynchronous, so the longest request is the upload of the package
// it is also the minimum (the field isn't displayed anymore, so a short limit saved before can't break the upload of a large package),
// and a connection that stopped answering isn't kept forever
const DEFAULT_REQUEST_TIMEOUT_MS = 600000;

const SyncClient = function (upstreamServer, syncLogEntry) {
  // initialize request options
  this.options = {
    prefixUrl: normalizeURL(upstreamServer.url),
    username: upstreamServer.credentials.clientId,
    password: upstreamServer.credentials.clientSecret,
    timeout: Math.max(Number(upstreamServer.timeout) || 0, DEFAULT_REQUEST_TIMEOUT_MS)
  };

  // keep upstream server information for future use
  this.upstreamServerName = upstreamServer.name;
  this.upstreamServerURL = upstreamServer.url;
  this.syncLogEntry = syncLogEntry;

  /**
   * Send request to server
   * @param url
   * @param requestOptions
   * @param callback
   */
  this.sendRequest = function (url, requestOptions, callback) {
    // log request
    app.logger.debug(`Sync ${this.syncLogEntry.id}: Sent request to upstream server: ${requestOptions.method} /${url}${requestOptions.qs ? '?' + JSON.stringify(requestOptions.qs) : ''}`);

    // send request
    // return request(requestOptions, callback);
    got(url, requestOptions)
      .then(response => {
        callback(null, response, response.body);
      })
      .catch(callback);
  };

  /**
   * Check error and response values to figure out if the request succeeded
   * @param error
   * @param response
   * @param expectedStatusCode
   */
  this.getErrorResponse = function (error, response, expectedStatusCode) {
    // set success Status code. Default: 200
    let successStatusCode = expectedStatusCode || 200;

    if (error) {
      // log error
      app.logger.debug(`Sync ${this.syncLogEntry.id}: Error connecting to upstream server`);

      return app.utils.apiError.getError('EXTERNAL_API_CONNECTION_ERROR', {
        serviceName: 'Upstream server',
        error: error
      });
    }

    // log response
    app.logger.debug(`Sync ${this.syncLogEntry.id}: Received response from upstream server. Status code: ${response.statusCode}`);
    if (response.body) {
      app.logger.debug(`Sync ${this.syncLogEntry.id}: Body: ${typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}`);
    }

    if (response.statusCode !== successStatusCode) {
      return app.utils.apiError.getError('UNEXPECTED_EXTERNAL_API_RESPONSE', {
        serviceName: 'Upstream server',
        error: `Expected status code: ${successStatusCode}. Received: ${response.statusCode}`
      });
    }

    // no error
    return;
  };

  /**
   * Get available outbreaks IDs list
   * @returns {Promise}
   */
  this.getAvailableOutbreaks = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      that.sendRequest('sync/available-outbreaks', requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // body contains the outbreakIDs; return them
          resolve(Array.isArray(body.outbreakIDs) ? body.outbreakIDs : []);
        }
      });
    });
  };

  /**
   * Send database to server for import
   * @param DBSnapshotFileName
   * @param asynchronous
   * @param autoEncrypt
   * @returns {Promise}
   */
  this.sendDBSnapshotForImport = function (DBSnapshotFileName, asynchronous, autoEncrypt) {
    const form = new FormData();
    form.append('snapshot', fs.createReadStream(DBSnapshotFileName));
    form.append('asynchronous', asynchronous);
    form.append('autoEncrypt', autoEncrypt);
    // send flag so that the upstream server knows that this is a sync from a desktop client instance
    form.append('snapshotFromClient', 'true');

    let requestOptions = Object.assign({}, this.options, {
      method: 'POST',
      body: form
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync/import-database-snapshot', requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // parse body to JSON
          try {
            body = JSON.parse(body);
            // body contains the sync log ID; return it
            resolve(body.syncLogId);
          } catch (parseError) {
            reject(app.utils.apiError.getError('UNEXPECTED_EXTERNAL_API_RESPONSE', {
              serviceName: 'Upstream server',
              error: `Response parse error: ${parseError}`
            }));
          }
        }
      });
    });
  };

  /**
   * GET sync log entry for given ID
   * @param syncLogId
   * @returns {Promise}
   */
  this.getSyncLogEntry = function (syncLogId) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync-logs/' + syncLogId, requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          resolve(body);
        }
      });
    });
  };

  /**
   * Get server version
   * @returns {Promise}
   */
  this.getServerVersion = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get system version
      that.sendRequest('system-settings/version', requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // return response
          resolve(body);
        }
      });
    });
  };

  /**
   * Decisions of the upstream server about the outbreaks of this instance
   * @returns {Promise<Object|null>} {mode, outbreaks: [{outbreakId, status, decidedAt}]}; null when the upstream server doesn't know this request (older version)
   */
  this.getOutbreakAccess = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync/outbreak-access', requestOptions, function (error, response, body) {
        // older versions don't have this request
        if (
          error &&
          error.response &&
          error.response.statusCode === 404
        ) {
          return resolve(null);
        }

        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);
        if (error) {
          return reject(error);
        }

        resolve(body);
      });
    });
  };

  /**
   * Ask the upstream server to send outbreaks (only the outbreaks & their questionnaires are sent, never the data of the persons)
   * @param payload {outbreaks, texts}
   * @returns {Promise<Object>} decisions {mode, outbreaks: [{outbreakId, status, decidedAt}]}
   */
  this.requestOutbreakAccess = function (payload) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'POST',
      json: payload,
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync/outbreak-access', requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);
        if (error) {
          return reject(error);
        }

        resolve(body);
      });
    });
  };
};

module.exports = SyncClient;
