'use strict';

/**
 * Assert the query shapes returned by Person.addGeographicalRestrictionsForMixedPersonTypes.
 *
 * The mixed person type restriction is an authorization rule, so its "both toggles off means the exact same
 * query as before" invariant is asserted mechanically instead of by reading the diff. The person model is
 * loaded against a minimal app stub, so no database and no booted server are needed.
 *
 * Usage: node server/scripts/checkGeoVisibilityQueryShapes.js
 */

const assert = require('assert');
const path = require('path');

// fixtures
const LOGGED_IN_USER_ID = 'user-1';
const OUTBREAK_ID = 'outbreak-1';
const USER_LOCATION_IDS = ['location-niteroi', 'location-marica'];
const RESIDENT_CASE_CONTACT_IDS = ['contact-1', 'contact-2'];

// stub state, changed per scenario
let applyGeographicRestrictions = true;
let userLocationIds = USER_LOCATION_IDS;
let residentCaseContactIdsCalls = 0;

// minimal app stub, covering only what the person model touches while it is being defined
const appStub = {
  utils: {
    helpers: {
      sanitizePersonAddresses: () => {
      },
      sanitizePersonVisualId: () => {
      }
    }
  },
  models: {
    case: {
      modelName: 'case'
    },
    contact: {
      modelName: 'contact'
    },
    user: {
      helpers: {
        applyGeographicRestrictions: () => applyGeographicRestrictions
      },
      cache: {
        getUserLocationsIds: () => Promise.resolve(userLocationIds)
      }
    }
  }
};

// the person model requires the server, so serve the stub instead of booting it
const serverPath = require.resolve(path.resolve(__dirname, '..', 'server.js'));
require.cache[serverPath] = {
  id: serverPath,
  filename: serverPath,
  loaded: true,
  exports: appStub,
  children: [],
  paths: []
};

function Person() {
}

Person.observe = () => {
};

require(path.resolve(__dirname, '..', 'models', 'person.js'))(Person);

// the residence chain resolver is a database query; count its calls instead of running it
Person.getResidentCaseContactIds = () => {
  residentCaseContactIdsCalls++;
  return Promise.resolve(RESIDENT_CASE_CONTACT_IDS);
};

/**
 * Build a remoting context for an outbreak with the given visibility toggles
 * @param outbreakProperties
 * @returns {Object}
 */
const buildContext = (outbreakProperties) => {
  return {
    req: {
      authData: {
        user: {
          id: LOGGED_IN_USER_ID
        }
      }
    },
    instance: Object.assign({
      id: OUTBREAK_ID
    }, outbreakProperties)
  };
};

const baseLocationsQuery = {
  usualPlaceOfResidenceLocationId: {
    inq: USER_LOCATION_IDS.concat([null])
  }
};

const notificationCaseQuery = {
  type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
  notificationLocationId: {
    inq: USER_LOCATION_IDS
  }
};

const residenceChainContactQuery = {
  type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
  id: {
    inq: RESIDENT_CASE_CONTACT_IDS
  }
};

// scenarios, each asserting one query shape
const scenarios = [
  {
    name: 'unrestricted user gets no restriction',
    run: () => {
      applyGeographicRestrictions = false;
      return Person
        .addGeographicalRestrictionsForMixedPersonTypes(buildContext({}))
        .then(query => {
          assert.strictEqual(query, undefined);
        });
    }
  },
  {
    name: 'user without assigned locations gets no restriction',
    run: () => {
      userLocationIds = [];
      return Person
        .addGeographicalRestrictionsForMixedPersonTypes(buildContext({
          allowNotificationLocationAccess: true,
          allowResidenceChainAccess: true
        }))
        .then(query => {
          assert.strictEqual(query, undefined);
        });
    }
  },
  {
    name: 'both toggles off produces the same query as the per model restriction',
    run: () => {
      const where = {
        outbreakId: OUTBREAK_ID
      };
      return Promise
        .all([
          Person.addGeographicalRestrictionsForMixedPersonTypes(buildContext({}), where),
          Person.addGeographicalRestrictions(buildContext({}), where)
        ])
        .then(([mixedTypesQuery, perModelQuery]) => {
          assert.deepStrictEqual(mixedTypesQuery, {
            and: [
              baseLocationsQuery,
              where
            ]
          });
          assert.deepStrictEqual(mixedTypesQuery, perModelQuery);
        });
    }
  },
  {
    name: 'notification location access adds only the case clause',
    run: () => {
      return Person
        .addGeographicalRestrictionsForMixedPersonTypes(buildContext({
          allowNotificationLocationAccess: true
        }))
        .then(query => {
          assert.deepStrictEqual(query, {
            or: [
              baseLocationsQuery,
              notificationCaseQuery
            ]
          });
        });
    }
  },
  {
    name: 'residence chain access adds only the contact clause, resolved once',
    run: () => {
      residentCaseContactIdsCalls = 0;
      return Person
        .addGeographicalRestrictionsForMixedPersonTypes(buildContext({
          allowResidenceChainAccess: true
        }))
        .then(query => {
          assert.deepStrictEqual(query, {
            or: [
              baseLocationsQuery,
              residenceChainContactQuery
            ]
          });
          assert.strictEqual(residentCaseContactIdsCalls, 1);
        });
    }
  },
  {
    name: 'both toggles on add both clauses',
    run: () => {
      return Person
        .addGeographicalRestrictionsForMixedPersonTypes(buildContext({
          allowNotificationLocationAccess: true,
          allowResidenceChainAccess: true
        }))
        .then(query => {
          assert.deepStrictEqual(query, {
            or: [
              baseLocationsQuery,
              notificationCaseQuery,
              residenceChainContactQuery
            ]
          });
        });
    }
  }
];

let failed = 0;

scenarios
  .reduce((chain, scenario) => {
    return chain
      .then(() => {
        // reset the stub state, each scenario opts into what it needs
        applyGeographicRestrictions = true;
        userLocationIds = USER_LOCATION_IDS;

        return scenario.run();
      })
      .then(() => {
        console.log(`PASS ${scenario.name}`);
      })
      .catch(error => {
        failed++;
        console.error(`FAIL ${scenario.name}`);
        console.error(error.message);
      });
  }, Promise.resolve())
  .then(() => {
    console.log(`${scenarios.length - failed}/${scenarios.length} assertions passed`);
    process.exit(failed ? 1 : 0);
  });
