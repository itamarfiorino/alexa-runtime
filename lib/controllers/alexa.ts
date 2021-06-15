import { Validator } from '@voiceflow/backend-utils';

import { AlexaContext } from '@/lib/services/alexa/types';
import { Request } from '@/types';

import { validate } from '../utils';
import { AbstractController } from './utils';

const { param } = Validator;

class AlexaController extends AbstractController {
  static VALIDATIONS = {
    PARAMS: {
      versionID: param('versionID')
        .exists()
        .isString(),
    },
  };

  @validate({ VERSION_ID: AlexaController.VALIDATIONS.PARAMS.versionID })
  async handler(req: Request<{ versionID: string }>) {
    const { alexa, runtimeClient, metrics, dataAPI } = this.services;

    metrics.request();

    const alexaContext: AlexaContext = {
      api: dataAPI,
      versionID: req.params.versionID,
      runtimeClient,
    };

    console.log('REQUEST');
    console.log(req.body.request);
    console.log('PERSON', req.body.context?.System?.person);

    const response = await alexa.skill.invoke(req.body, alexaContext);

    console.log('RESPONSE');
    console.log(response.response);
    return response;
  }
}

export default AlexaController;
