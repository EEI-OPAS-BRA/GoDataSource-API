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

// the geographic anchor of a record: its usual place of residence, the notification address when the
// residence address is missing, and no anchor at all when the record has neither
const baseLocationClauses = [
  {
    usualPlaceOfResidenceLocationId: {
      inq: USER_LOCATION_IDS
    }
  },
  {
    usualPlaceOfResidenceLocationId: {
      inq: [null]
    },
    notificationLocationId: {
      inq: USER_LOCATION_IDS
    }
  },
  {
    usualPlaceOfResidenceLocationId: {
      inq: [null]
    },
    notificationLocationId: {
      inq: [null]
    }
  }
];

const baseLocationsQuery = {
  or: baseLocationClauses
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

// people used to assert what a query actually lets through, one per geographic anchor combination
const people = {
  residenceInside: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: 'location-niteroi',
    notificationLocationId: null
  },
  residenceOutside: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: 'location-rio',
    notificationLocationId: null
  },
  noLocationAtAll: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: null,
    notificationLocationId: null
  },
  notificationOnlyInside: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: null,
    notificationLocationId: 'location-niteroi'
  },
  notificationOnlyOutside: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: null,
    notificationLocationId: 'location-rio'
  },
  residenceOutsideNotifiedInside: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
    usualPlaceOfResidenceLocationId: 'location-rio',
    notificationLocationId: 'location-niteroi'
  }
};

/**
 * Evaluate a where query against a record, covering the operators these restrictions build
 * (or / and / inq / equality), with null matching a missing property the way mongo does
 * @param query
 * @param record
 * @returns {boolean}
 */
const matches = (query, record) => {
  return Object.keys(query).every(property => {
    const condition = query[property];

    if (property === 'or') {
      return condition.some(subQuery => matches(subQuery, record));
    }

    if (property === 'and') {
      return condition.every(subQuery => matches(subQuery, record));
    }

    const value = record[property] === undefined ?
      null :
      record[property];

    if (
      condition !== null &&
      typeof condition === 'object'
    ) {
      return condition.inq.indexOf(value) !== -1;
    }

    return value === condition;
  });
};

/**
 * Assert which of the fixture people a query lets through
 * @param query
 * @param expectedVisiblePeople
 */
const assertVisiblePeople = (query, expectedVisiblePeople) => {
  assert.deepStrictEqual(
    Object.keys(people).filter(name => matches(query, people[name])),
    expectedVisiblePeople
  );
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
            or: baseLocationClauses.concat([notificationCaseQuery])
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
            or: baseLocationClauses.concat([residenceChainContactQuery])
          });
          assert.strictEqual(residentCaseContactIdsCalls, 1);
        });
    }
  },
  {
    name: 'with both toggles off, a record anchored only by its notification address stays with the notifying team',
    run: () => {
      return Person
        .addGeographicalRestrictions(buildContext({}), undefined, 'case')
        .then(query => {
          assertVisiblePeople(query, [
            // the user's own locality, by residence
            'residenceInside',
            // no anchor at all, visible to everybody so it is not lost
            'noLocationAtAll',
            // no residence, so the notification address anchors it here
            'notificationOnlyInside'
          ]);
        });
    }
  },
  {
    name: 'the notification address anchors a record only when it has no residence address',
    run: () => {
      return Person
        .addGeographicalRestrictions(buildContext({
          allowNotificationLocationAccess: true
        }), undefined, 'case')
        .then(query => {
          assertVisiblePeople(query, [
            'residenceInside',
            'noLocationAtAll',
            'notificationOnlyInside',
            // revealed by the toggle, not by the anchor fallback
            'residenceOutsideNotifiedInside'
          ]);
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
            or: baseLocationClauses.concat([
              notificationCaseQuery,
              residenceChainContactQuery
            ])
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
