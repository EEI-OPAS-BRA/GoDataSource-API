'use strict';

const got = require('got');
const apiError = require('./apiError');

// how long we wait for each request made to the other instance
const REQUEST_TIMEOUT_MS = 10000;

// error codes that indicate a problem with the TLS certificate of the other instance
const CERTIFICATE_ERROR_CODES = [
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID'
];

/**
 * Parse & validate the url received from the user
 * @param {string} url
 * @returns {{origin: string, path: string, apiUrl: string}}
 */
const parseUrl = (url) => {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (err) {
    // invalid url
  }

  if (
    !parsed ||
    !['http:', 'https:'].includes(parsed.protocol)
  ) {
    throw apiError.getError('REQUEST_VALIDATION_ERROR', {
      errorMessages: 'Property "url" must be a valid http / https url'
    });
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return {
    origin: parsed.origin,
    path,
    apiUrl: `${parsed.origin}${path}`
  };
};

/**
 * Convert a request error into a code that the UI can translate
 * @param {Error} err
 * @returns {{errorCode: string, code?: string}}
 */
const describeError = (err) => {
  const code = err && err.code;

  if (
    (err && err.name === 'TimeoutError') ||
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)
  ) {
    return { errorCode: 'TIMEOUT' };
  }

  if (code === 'ECONNREFUSED') {
    return { errorCode: 'CONNECTION_REFUSED' };
  }

  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { errorCode: 'HOST_NOT_FOUND' };
  }

  if (CERTIFICATE_ERROR_CODES.includes(code)) {
    return { errorCode: 'CERTIFICATE' };
  }

  if (err && err.name === 'ParseError') {
    return { errorCode: 'UNEXPECTED_RESPONSE' };
  }

  return {
    errorCode: 'CONNECTION_FAILED',
    code
  };
};

/**
 * Make a GET request that never follows redirects and never throws for http error status codes
 * @param {string} url
 * @param {{clientId: string, clientSecret: string}} [credentials]
 * @returns {Promise<{statusCode: number, body: *}>}
 */
const request = (url, credentials) => {
  const options = {
    method: 'GET',
    responseType: 'json',
    timeout: REQUEST_TIMEOUT_MS,
    retry: 0,
    followRedirect: false,
    throwHttpErrors: false
  };

  if (credentials) {
    options.username = credentials.clientId;
    options.password = credentials.clientSecret;
  }

  return got(url, options).then((response) => ({
    statusCode: response.statusCode,
    body: response.body
  }));
};

/**
 * Check if the other instance is online, using its status route
 * @param {{origin: string, path: string}} target
 * @returns {Promise<{online: boolean, statusCode?: number, errorCode?: string, code?: string, responseTimeMs?: number}>}
 */
const checkServer = (target) => {
  // the status route is registered at the root of the server, not below the api root
  const candidates = [...new Set([
    `${target.origin}${target.path.replace(/\/api$/i, '')}/status`,
    `${target.origin}/status`
  ])];

  const tryCandidate = (index) => {
    const startedAt = Date.now();

    return request(candidates[index])
      .then((response) => {
        if (
          response.statusCode === 200 &&
          response.body &&
          response.body.started
        ) {
          return {
            online: true,
            statusCode: response.statusCode,
            responseTimeMs: Date.now() - startedAt
          };
        }

        return {
          online: false,
          errorCode: response.statusCode === 200 ? 'UNEXPECTED_RESPONSE' : 'HTTP_ERROR',
          statusCode: response.statusCode
        };
      })
      .catch((err) => Object.assign({ online: false }, describeError(err)))
      .then((result) => {
        // the server answered but not like we expect; the status route might be mounted at the root of the host
        const canTryNext = ['HTTP_ERROR', 'UNEXPECTED_RESPONSE'].includes(result.errorCode);
        return !result.online && canTryNext && index + 1 < candidates.length ?
          tryCandidate(index + 1) :
          result;
      });
  };

  return tryCandidate(0);
};

/**
 * Check if the credentials are accepted by the other instance
 * It uses the same request that starts every sync, so if it works the sync is able to start
 * @param {{apiUrl: string}} target
 * @param {{clientId: string, clientSecret: string}} credentials
 * @returns {Promise<{valid: boolean, statusCode?: number, errorCode?: string, code?: string, outbreakIDs?: string[]}>}
 */
const checkCredentials = (target, credentials) => {
  return request(`${target.apiUrl}/sync/available-outbreaks`, credentials)
    .then((response) => {
      if (
        response.statusCode === 200 &&
        response.body &&
        Array.isArray(response.body.outbreakIDs)
      ) {
        return {
          valid: true,
          statusCode: response.statusCode,
          outbreakIDs: response.body.outbreakIDs
        };
      }

      let errorCode = 'HTTP_ERROR';
      if ([401, 403].includes(response.statusCode)) {
        errorCode = 'INVALID_CREDENTIALS';
      } else if (response.statusCode === 404) {
        errorCode = 'API_NOT_FOUND';
      } else if (response.statusCode === 200) {
        errorCode = 'UNEXPECTED_RESPONSE';
      }

      return {
        valid: false,
        errorCode,
        statusCode: response.statusCode
      };
    })
    .catch((err) => Object.assign({ valid: false }, describeError(err)));
};

/**
 * Check an upstream server
 * @param {{url: string, clientId?: string, clientSecret?: string}} data - credentials are checked only when both are sent
 * @returns {Promise<{server: object, credentials: object|null}>}
 */
const check = (data) => {
  return new Promise((resolve, reject) => {
    if (!data || typeof data.url !== 'string') {
      return reject(apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: 'Missing required property "url"'
      }));
    }

    let target;
    try {
      target = parseUrl(data.url.trim());
    } catch (err) {
      return reject(err);
    }

    const checkCredentialsToo = typeof data.clientId === 'string' &&
      data.clientId &&
      typeof data.clientSecret === 'string' &&
      data.clientSecret;

    Promise
      .all([
        checkServer(target),
        checkCredentialsToo ?
          checkCredentials(target, {
            clientId: data.clientId,
            clientSecret: data.clientSecret
          }) :
          null
      ])
      .then(([server, credentials]) => resolve({
        server,
        credentials
      }))
      .catch(reject);
  });
};

module.exports = {
  check
};
