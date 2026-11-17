'use strict';

const app = require('../../server/server');

module.exports = function (WhatsappMessage) {

  // records the message can be offered for
  WhatsappMessage.appliesToTypes = {
    all: 'all',
    case: 'case',
    contact: 'contact'
  };

  WhatsappMessage.fieldLabelsMap = Object.assign({}, WhatsappMessage.fieldLabelsMap, {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    outbreakId: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_OUTBREAK',
    title: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_TITLE',
    message: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_MESSAGE',
    appliesTo: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_APPLIES_TO',
    active: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_ACTIVE',
    createdAt: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_WHATSAPP_MESSAGE_FIELD_LABEL_DELETED_AT'
  });

  /**
   * Validate the message outbreak
   */
  WhatsappMessage.observe('before save', function (ctx, next) {
    const data = ctx.instance || ctx.data;
    const outbreakId = data.outbreakId !== undefined ?
      data.outbreakId : (
        ctx.currentInstance ?
          ctx.currentInstance.outbreakId :
          undefined
      );

    // outbreak didn't change ?
    if (
      data.outbreakId === undefined &&
      ctx.currentInstance
    ) {
      return next();
    }

    // check that the outbreak exists
    app.models.outbreak
      .findById(outbreakId, {
        fields: ['id']
      })
      .then((outbreak) => {
        if (!outbreak) {
          throw app.utils.apiError.getError('VALIDATION_ERROR', {
            model: WhatsappMessage.modelName,
            details: 'the selected outbreak does not exist'
          });
        }
      })
      .then(() => next(), (err) => next(err));
  });
};
