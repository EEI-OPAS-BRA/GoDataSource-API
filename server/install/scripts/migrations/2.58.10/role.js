'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Give the new WhatsApp message permissions to the existing roles
 * - roles that manage outbreaks or team notifications configure the messages ( whatsapp_message_all )
 * - roles that manage cases or contacts can send the messages ( whatsapp_message_send )
 */
const addWhatsappMessagePermissions = (callback) => {
  const managePermissions = [
    'outbreak_all',
    'team_notification_all'
  ];
  const sendPermissions = [
    'case_all',
    'case_modify',
    'contact_all',
    'contact_modify'
  ];

  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      const roleCollection = dbConn.collection('role');
      return roleCollection
        .find({
          deleted: {
            $ne: true
          },
          permissionIds: {
            $in: [
              ...managePermissions,
              ...sendPermissions
            ]
          }
        }, {
          projection: {
            _id: 1,
            name: 1,
            permissionIds: 1
          }
        })
        .toArray()
        .then((roles) => {
          const updates = [];
          roles.forEach((role) => {
            const permissionIds = role.permissionIds || [];
            const toAdd = [];

            // configure messages
            if (
              permissionIds.indexOf('whatsapp_message_all') < 0 &&
              permissionIds.some((permission) => managePermissions.indexOf(permission) > -1)
            ) {
              toAdd.push('whatsapp_message_all');
            }

            // send messages
            if (
              permissionIds.indexOf('whatsapp_message_all') < 0 &&
              toAdd.indexOf('whatsapp_message_all') < 0 &&
              permissionIds.indexOf('whatsapp_message_send') < 0 &&
              permissionIds.some((permission) => sendPermissions.indexOf(permission) > -1)
            ) {
              toAdd.push('whatsapp_message_send');
            }

            // nothing to do ?
            if (!toAdd.length) {
              return;
            }

            // update
            console.log(`Role "${role.name}" ( ${role._id} ) received ${toAdd.join(', ')}`);
            updates.push(
              roleCollection.updateOne({
                _id: role._id
              }, {
                $addToSet: {
                  permissionIds: {
                    $each: toAdd
                  }
                }
              })
            );
          });

          return Promise.all(updates);
        });
    })
    .then(() => callback())
    .catch(callback);
};

module.exports = {
  addWhatsappMessagePermissions
};
