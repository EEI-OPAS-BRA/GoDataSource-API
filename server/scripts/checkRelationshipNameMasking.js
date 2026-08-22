'use strict';

/**
 * Assert how the relationship endpoints treat a related person the logged in user is not allowed to read.
 *
 * The rule is an authorization rule, so it is asserted mechanically instead of by reading the diff: the person
 * stays in the list and in the count, only the name is withheld. The relationship model is loaded against a
 * minimal app stub, so no database and no booted server are needed.
 *
 * Usage: node server/scripts/checkRelationshipNameMasking.js
 */

const assert = require('assert');
const path = require('path');
const mergeFilters = require(path.resolve(__dirname, '..', '..', 'components', 'mergeFilters'));

// fixtures
const OUTBREAK_ID = 'outbreak-1';
const ANCHOR_PERSON_ID = 'contact-maria-niteroi';
const VISIBLE_CASE_ID = 'case-joana-niteroi';
const RESTRICTED_CASE_ID = 'case-fulana-angra';
const RESTRICTED_EVENT_ID = 'event-festa-angra';

// the restriction query the person model would build for a user restricted to Niteroi
const GEOGRAPHICAL_RESTRICTIONS_QUERY = {
  usualPlaceOfResidenceLocationId: {
    inq: ['location-niteroi', null]
  }
};

// stub state, changed per scenario
let geographicalRestrictionsQuery;
let peopleFilterReceived;
let visibilityQueryCalls;

/**
 * Build the people the exposures endpoint would read from the database
 * @returns {Array}
 */
const buildPeople = () => {
  return [
    {
      id: VISIBLE_CASE_ID,
      type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
      firstName: 'Joana',
      middleName: 'Maria',
      lastName: 'Souza',
      visualId: 'CASE-0031',
      classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED'
    },
    {
      id: RESTRICTED_CASE_ID,
      type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
      firstName: 'Fulana',
      middleName: 'Aparecida',
      lastName: 'Silva',
      visualId: 'CASE-0012',
      classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED'
    },
    {
      id: RESTRICTED_EVENT_ID,
      type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT',
      name: 'Festa de Angra',
      visualId: 'EVENT-0002'
    }
  ];
};

/**
 * Build the relationships the anchor person takes part in, one per related person
 * @returns {Array}
 */
const buildRelationships = () => {
  return [
    VISIBLE_CASE_ID,
    RESTRICTED_CASE_ID,
    RESTRICTED_EVENT_ID
  ].map((relatedPersonId, index) => {
    const relationship = {
      id: `relationship-${index}`,
      outbreakId: OUTBREAK_ID,
      persons: [
        {
          id: ANCHOR_PERSON_ID,
          target: true
        },
        {
          id: relatedPersonId,
          source: true
        }
      ]
    };

    relationship.toJSON = () => Object.assign({}, relationship);

    return relationship;
  });
};

// minimal app stub, covering only what the relationship model touches on the exposures path
const appStub = {
  logger: {
    debug: () => {
    }
  },
  utils: {
    remote: {
      mergeFilters: mergeFilters
    }
  },
  models: {
    relationship: undefined,
    person: {
      addGeographicalRestrictionsForMixedPersonTypes: () => Promise.resolve(geographicalRestrictionsQuery),
      find: (filter) => {
        peopleFilterReceived = filter;

        // stand in for the database: a query carrying the geographical restriction only matches the people
        // the user is allowed to read, which is exactly what must not happen here
        const people = buildPeople();
        return Promise.resolve(
          JSON.stringify(filter.where).indexOf('usualPlaceOfResidenceLocationId') === -1 ?
            people :
            people.filter((person) => person.id === VISIBLE_CASE_ID)
        );
      },
      // the visibility resolver reads only the IDs, the restricted people are the ones it leaves out
      rawFind: () => {
        visibilityQueryCalls++;
        return Promise.resolve([
          {
            id: VISIBLE_CASE_ID
          }
        ]);
      }
    }
  }
};

// the relationship model requires the server, so serve the stub instead of booting it
const serverPath = require.resolve(path.resolve(__dirname, '..', 'server.js'));
require.cache[serverPath] = {
  id: serverPath,
  filename: serverPath,
  loaded: true,
  exports: appStub,
  children: [],
  paths: []
};

function Relationship() {
}

Relationship.observe = () => {
};

require(path.resolve(__dirname, '..', '..', 'common', 'models', 'relationship.js'))(Relationship);

appStub.models.relationship = Relationship;

// the anchor relationships are read straight from the database, serve the fixture instead
Relationship.find = () => Promise.resolve(buildRelationships());

// resolving the user relations is a database round trip that adds nothing here
Relationship.userSupportedRelations = [];
Relationship.retrieveUserSupportedRelations = (context, relationships, callback) => callback();

function Outbreak() {
}

Outbreak.observe = () => {
};

Outbreak.setMaxListeners = () => {
};

require(path.resolve(__dirname, '..', '..', 'common', 'models', 'outbreak.js'))(Outbreak);

/**
 * Reset the stub state before a scenario
 * @param restrictionsQuery
 */
const resetState = (restrictionsQuery) => {
  geographicalRestrictionsQuery = restrictionsQuery;
  peopleFilterReceived = undefined;
  visibilityQueryCalls = 0;
};

/**
 * Read the exposures of the anchor person
 * @param onlyCount
 * @returns {Promise}
 */
const readExposures = (onlyCount) => {
  return Relationship.findOrCountPersonRelationshipExposuresOrContacts(
    OUTBREAK_ID,
    ANCHOR_PERSON_ID,
    {},
    false,
    onlyCount,
    {
      remotingContext: {}
    }
  );
};

/**
 * Find one exposure record by the ID of the person it describes
 * @param records
 * @param personId
 * @returns {Object}
 */
const findRecord = (records, personId) => {
  const record = records.find((item) => item.id === personId);
  assert.ok(record, `expected the list to contain person ${personId}`);
  return record;
};

// scenarios, each asserting one rule
const scenarios = [
  {
    name: 'unrestricted user reads every name',
    run: () => {
      resetState(undefined);
      return readExposures(false)
        .then((records) => {
          assert.strictEqual(records.length, 3);

          const visible = findRecord(records, VISIBLE_CASE_ID);
          assert.strictEqual(visible.firstName, 'Joana');
          assert.strictEqual(visible.lastName, 'Souza');

          const restrictedCase = findRecord(records, RESTRICTED_CASE_ID);
          assert.strictEqual(restrictedCase.firstName, 'Fulana');
          assert.strictEqual(restrictedCase.middleName, 'Aparecida');
          assert.strictEqual(restrictedCase.lastName, 'Silva');

          assert.strictEqual(findRecord(records, RESTRICTED_EVENT_ID).name, 'Festa de Angra');
          assert.strictEqual(visibilityQueryCalls, 0, 'an unrestricted user must not pay for the visibility query');
        });
    }
  },
  {
    name: 'restricted user reads the whole list, without the names it may not read',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);
      return readExposures(false)
        .then((records) => {
          assert.strictEqual(records.length, 3, 'a person the user may not read still belongs in the list');

          const restrictedCase = findRecord(records, RESTRICTED_CASE_ID);
          assert.strictEqual(restrictedCase.firstName, null);
          assert.strictEqual(restrictedCase.middleName, null);
          assert.strictEqual(restrictedCase.lastName, null);

          const restrictedEvent = findRecord(records, RESTRICTED_EVENT_ID);
          assert.strictEqual(restrictedEvent.name, null);
        });
    }
  },
  {
    name: 'restricted user keeps every field other than the name',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);
      return readExposures(false)
        .then((records) => {
          const restrictedCase = findRecord(records, RESTRICTED_CASE_ID);
          assert.strictEqual(restrictedCase.visualId, 'CASE-0012');
          assert.strictEqual(restrictedCase.classification, 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED');
          assert.ok(restrictedCase.relationship, 'the relationship data stays readable');
          assert.strictEqual(findRecord(records, RESTRICTED_EVENT_ID).visualId, 'EVENT-0002');
        });
    }
  },
  {
    name: 'restricted user does not have the name of the people it may read touched',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);
      return readExposures(false)
        .then((records) => {
          const visible = findRecord(records, VISIBLE_CASE_ID);
          assert.strictEqual(visible.firstName, 'Joana');
          assert.strictEqual(visible.middleName, 'Maria');
          assert.strictEqual(visible.lastName, 'Souza');
        });
    }
  },
  {
    name: 'the restriction never reaches the people query, so the list is never cut',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);
      return readExposures(false)
        .then(() => {
          assert.ok(peopleFilterReceived, 'the people query must have been built');
          assert.strictEqual(
            JSON.stringify(peopleFilterReceived.where).indexOf('usualPlaceOfResidenceLocationId'),
            -1,
            'the geographical restriction must not be merged into the people query'
          );
        });
    }
  },
  {
    name: 'the counter of a restricted user is the real one',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);
      return readExposures(true)
        .then((count) => {
          assert.strictEqual(count, 3, 'the count must match the list the user sees');
          assert.strictEqual(visibilityQueryCalls, 0, 'the count needs no name, so it must not pay for the visibility query');
        });
    }
  },
  {
    name: 'nobody is restricted when there is no restriction query',
    run: () => {
      return Relationship
        .resolveRestrictedPeopleMap([VISIBLE_CASE_ID, RESTRICTED_CASE_ID], undefined)
        .then((restrictedPeopleMap) => {
          assert.deepStrictEqual(restrictedPeopleMap, {});
        });
    }
  },
  {
    name: 'a relationship read with include=people keeps every person, without the names it may not read',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);

      const relationship = {
        id: 'relationship-0',
        contactDate: '2026-08-01',
        exposureTypeId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_DIRECT_PHYSICAL_CONTACT',
        people: buildPeople()
      };

      return Outbreak.helpers
        .maskRestrictedRelationshipPeopleNames(relationship, {remotingContext: {}})
        .then(() => {
          assert.strictEqual(relationship.people.length, 3, 'no person is dropped from the relationship');
          assert.strictEqual(relationship.contactDate, '2026-08-01', 'the relationship data itself is untouched');

          const visible = findRecord(relationship.people, VISIBLE_CASE_ID);
          assert.strictEqual(visible.firstName, 'Joana');
          assert.strictEqual(visible.lastName, 'Souza');

          const restrictedCase = findRecord(relationship.people, RESTRICTED_CASE_ID);
          assert.strictEqual(restrictedCase.firstName, null);
          assert.strictEqual(restrictedCase.middleName, null);
          assert.strictEqual(restrictedCase.lastName, null);
          assert.strictEqual(restrictedCase.visualId, 'CASE-0012');

          assert.strictEqual(findRecord(relationship.people, RESTRICTED_EVENT_ID).name, null);
        });
    }
  },
  {
    name: 'a relationship read without include=people costs no visibility query',
    run: () => {
      resetState(GEOGRAPHICAL_RESTRICTIONS_QUERY);

      const relationships = [
        {
          id: 'relationship-0',
          persons: [
            {
              id: ANCHOR_PERSON_ID
            },
            {
              id: RESTRICTED_CASE_ID
            }
          ]
        }
      ];

      return Outbreak.helpers
        .maskRestrictedRelationshipPeopleNames(relationships, {remotingContext: {}})
        .then((result) => {
          assert.strictEqual(result, relationships, 'the relationships come back untouched');
          assert.strictEqual(visibilityQueryCalls, 0);
        });
    }
  },
  {
    name: 'masking adds no field that the record did not already have',
    run: () => {
      const event = {
        id: RESTRICTED_EVENT_ID,
        name: 'Festa de Angra',
        visualId: 'EVENT-0002'
      };

      Relationship.maskPersonName(event);

      assert.deepStrictEqual(Object.keys(event), ['id', 'name', 'visualId']);
      assert.strictEqual(event.name, null);
      assert.strictEqual(event.visualId, 'EVENT-0002');

      return Promise.resolve();
    }
  }
];

// run the scenarios one after the other, so the shared stub state stays predictable
scenarios
  .reduce(
    (previous, scenario) => previous.then(() => {
      return Promise.resolve()
        .then(scenario.run)
        .then(() => {
          console.log(`ok - ${scenario.name}`);
        });
    }),
    Promise.resolve()
  )
  .then(() => {
    console.log(`\n${scenarios.length} checks passed`);
  })
  .catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exitCode = 1;
  });
