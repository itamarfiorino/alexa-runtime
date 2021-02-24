import { Node } from '@voiceflow/alexa-types/build/nodes/directive';
import { replaceVariables } from '@voiceflow/common';
import { HandlerFactory } from '@voiceflow/general-runtime/build/runtime';
import { Directive } from 'ask-sdk-model';
import _isString from 'lodash/isString';

import { StaticPostgresDB } from '@/lib/clients/postgres';
import { T } from '@/lib/constants';
import log from '@/logger';

import { ResponseBuilder } from '../types';

export const DirectiveResponseBuilder: ResponseBuilder = (runtime, builder) => {
  const directives = runtime.turn.get(T.DIRECTIVES) as undefined | Directive[];
  if (directives) {
    directives.forEach((directive) => {
      builder.addDirective(directive);
    });
  }
};

const utilsObj = {
  replaceVariables,
};

type SQLDirective = {
  query: string;
  params: any[];
};

type SQLGet = {
  query: any[];
  params: any[];
  to: string;
};
type question = {
  databaseName: string;
  condition: string;
  responseType: string;
  text: string;
  value: any;
  reproOne: string;
  reproTwo: string;
  reproThree: string;
}
interface modifiedType {
  modified: boolean;
}
type questionSeries = modifiedType & {
  [key: string]: question;
}
type questionnaire = {
  [key: string]: questionSeries;
}
const isSQLDirective = (directive?: any): directive is SQLDirective => {
  return directive?.query;
};
const isSQLGet = (directive?: any): directive is SQLGet => {
  return Array.isArray(directive?.query) && Array.isArray(directive?.params) && directive?.to;
};

export const DirectiveHandler: HandlerFactory<Node, typeof utilsObj> = (utils) => ({
  canHandle: (node) => {
    return _isString(node.directive);
  },
  handle: async (node, runtime, variables) => {
    const { directive: unparsedDirective } = node;

    const directiveString = utils.replaceVariables(unparsedDirective, variables.getState());
    console.log(directiveString);
    try {
      const directive = JSON.parse(directiveString) as Directive;
      // check if this is a special custom SQL directive
      if (isSQLDirective(directive) && !isSQLGet(directive)) {
        if (directive.query == 'update') {
          try {
            var entries = variables.get('questionnaire') as questionnaire;
            entries = JSON.parse(JSON.stringify(entries));
            for (const series of Object.keys(entries)) {
              if (entries[series]['modified']) {
                entries[series]['modified'] = false;
                let dbkey = '"checkinid"';
                let dbval = `'${variables.get('checkinId')}'`;
                for (const response of Object.keys(entries[series])) {
                  entries[series][response].databaseName != '' && entries[series][response].value != null
                    ? (dbkey += `,"${entries[series][response].databaseName}"`)
                    : null;
                  entries[series][response].databaseName != '' && entries[series][response].value != null
                    ? (dbval += `,'${entries[series][response].value}'`)
                    : null;
                }
                console.log(`INSERT INTO "${series}" (${dbkey}) VALUES (${dbval})`);
                await StaticPostgresDB.client
                  .query(`INSERT INTO "${series}" (${dbkey}) VALUES (${dbval})`)
                  .then((res: any) => {
                    console.log(res);
                  })
                  .catch((error) => {
                    log.warn(`Custom SQL Fail ${JSON.stringify(directive)}`);
                    log.error(error);
                  });
                await StaticPostgresDB.client
                  .query(`UPDATE "checkin" SET "productive" = 't' WHERE "checkinid" = '${variables.get('checkinId')}'`)
                  .then((res: any) => {
                    console.log('Checkin was productive');
                    console.log(res);
                  })
                  .catch((error) => {
                    log.error(error);
                  });
              }
            }
            variables.set('questionnaire', entries);
          } catch (err) {
            console.log(err);
          }
        } else if (directive.query == 'checkin') {
          await StaticPostgresDB.client
            .query(`INSERT INTO "checkin" (userid, timestamp) VALUES ('${variables.get('cognitoId')}', NOW()) RETURNING "checkinid"`)
            .then((res: any) => {
              console.log(res);
            })
            .catch((error) => {
              log.warn(`Custom SQL Fail ${JSON.stringify(directive)}`);
              log.error(error);
            });
        } else {
          // apply it to the database
          const cleaned: SQLDirective[] = [];
          for (const text of directive.params) {
            try {
              cleaned.push(text.charAt(0) == '_' ? variables.get(text.substring(1)) : text);
            } catch (err) {
              console.log(err);
            }
          }
          console.log(directive.query);
          await StaticPostgresDB.client
            .query(directive.query, cleaned)
            .then((res: any) => {
              console.log(res);
            })
            .catch((error) => {
              log.warn(`Custom SQL Fail ${JSON.stringify(directive)}`);
              log.error(error);
            });
        }
      } else if (isSQLGet(directive)) {
        const cleanedg: SQLGet[] = [];
        for (const text of directive.params) {
          try {
            cleanedg.push(text.charAt(0) == '_' ? variables.get(text.substring(1)) : text);
          } catch (err) {
            cleanedg.push(text);
            console.log(err);
          }
        }
        const len = directive.query.length;
        for (let i = 0; i < len; i++) {
          await StaticPostgresDB.client
            .query(directive.query[i], cleanedg)
            .then((res: any) => {
              console.log(res);
              variables.set(directive.to, res.rows[0][res.fields[0].name]);
            })
            .catch((error: any) => {
              log.warn(`Custom SQL Fail ${JSON.stringify(directive)}`);
              log.error(error);
            });
        }
      } else {
        runtime.turn.produce((draft) => {
          draft[T.DIRECTIVES] = [...(draft[T.DIRECTIVES] || []), directive];
        });
        runtime.trace.debug(`sending directive JSON:\n\`${directiveString}\``);
      }
    } catch (err) {
      console.log(err);
      runtime.trace.debug(`invalid directive JSON:\n\`${directiveString}\`\n\`${err}\``);
    }

    return node.nextId;
  },
});

export default () => DirectiveHandler(utilsObj);
