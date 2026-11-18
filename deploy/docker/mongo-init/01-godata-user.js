/* global db, print */
// Runs once, when MongoDB starts on an empty data folder.
const dbName = process.env.GODATA_DB || 'go-data';
const password = process.env.GODATA_MONGO_PASSWORD;
if (!password) {
  throw new Error('GODATA_MONGO_PASSWORD is required');
}

db.getSiblingDB('admin').createUser({
  user: 'godata',
  pwd: password,
  roles: [
    { role: 'readWrite', db: dbName },
    { role: 'dbAdmin', db: dbName }
  ]
});
print(`created user godata with readWrite and dbAdmin on ${dbName}`);
